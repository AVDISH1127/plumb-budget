import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlumbData } from './storage'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined }

interface Database {
  public: {
    Tables: {
      plumb_sync: {
        Row: { user_id: string; data: Json; updated_at: string; revision: number }
        Insert: { user_id: string; data: Json; updated_at?: string; revision?: number }
        Update: { user_id?: string; data?: Json; updated_at?: string; revision?: number }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type PlumbSupabaseClient = SupabaseClient<Database>

export interface SupabaseConfig {
  url: string
  anonKey: string
}

const CONFIG_STORAGE_KEY = 'plumb.supabase.config'
const envConfig = {
  url: import.meta.env.VITE_SUPABASE_URL?.trim() ?? '',
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '',
}

const validSupabaseUrl = (value: string | undefined) => {
  if (!value) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !url.hostname.includes('your-project-id')
  } catch {
    return false
  }
}

const validPublishableKey = (key: string) => {
  if (!key || key.includes('your-supabase') || key.startsWith('sb_secret_')) return false
  if (key.startsWith('sb_publishable_')) return true
  if (key.startsWith('eyJ')) {
    try {
      const payload = key.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/')
      if (!payload) return false
      const claims = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))) as { role?: unknown }
      return claims.role === 'anon'
    } catch {
      return false
    }
  }
  return false
}

export function saveSupabaseConfig(url: string, anonKey: string) {
  const config = { url: url.trim(), anonKey: anonKey.trim() }
  if (!validSupabaseUrl(config.url)) throw new Error('Enter a valid Supabase project URL (https://…supabase.co).')
  if (!validPublishableKey(config.anonKey)) {
    throw new Error('Enter a Supabase publishable/anon key. Service-role and secret keys must never be used in the app.')
  }
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config))
}

function readSupabaseConfig(): SupabaseConfig | null {
  if (validSupabaseUrl(envConfig.url) && validPublishableKey(envConfig.anonKey)) return envConfig
  const raw = localStorage.getItem(CONFIG_STORAGE_KEY)
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    throw new Error('Saved Supabase settings could not be read. Re-enter your project URL and publishable/anon key.')
  }
  if (!value || typeof value !== 'object') throw new Error('Saved Supabase settings are invalid.')
  const config = value as Partial<SupabaseConfig>
  return typeof config.url === 'string' && typeof config.anonKey === 'string'
    && validSupabaseUrl(config.url) && validPublishableKey(config.anonKey)
    ? { url: config.url, anonKey: config.anonKey }
    : null
}

let client: PlumbSupabaseClient | null = null
let clientConfig = ''

export function getSupabaseClient(): PlumbSupabaseClient | null {
  const config = readSupabaseConfig()
  if (!config) return null
  const identity = `${config.url}\n${config.anonKey}`
  if (!client || identity !== clientConfig) {
    client = createClient<Database>(config.url, config.anonKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    })
    clientConfig = identity
  }
  return client
}

// One authenticated project workspace is shared by every signed-in Plumb user.
export const PLUMB_SHARED_USER_ID = '00000000-0000-0000-0000-000000000001'
export const syncBaselineKey = (_userId: string) => `plumb.sync.baseline:${PLUMB_SHARED_USER_ID}`

export function canonicalData(data: PlumbData): string {
  const sortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortKeys)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortKeys(item)]),
    )
  }
  return JSON.stringify(sortKeys(data))
}

export async function fetchRemoteData(client: PlumbSupabaseClient, _userId: string) {
  const { data, error } = await client
    .from('plumb_sync')
    .select('data, updated_at, revision')
    .eq('user_id', PLUMB_SHARED_USER_ID)
    .maybeSingle()
  if (error) throw error
  return data ? { data: data.data, updatedAt: data.updated_at, revision: data.revision } : null
}

export async function uploadRemoteData(client: PlumbSupabaseClient, _userId: string, data: PlumbData, expectedRevision?: number) {
  const json = JSON.parse(JSON.stringify(data)) as Json
  const updatedAt = new Date().toISOString()
  if (expectedRevision === undefined) {
    const { error } = await client.from('plumb_sync').insert({
      user_id: PLUMB_SHARED_USER_ID,
      data: json,
      updated_at: updatedAt,
    })
    if (error?.code === '23505') {
      throw new Error('A cloud copy was created on another device. Tap Sync now to review the conflict.')
    }
    if (error) throw error
    return
  }
  const { data: updated, error } = await client
    .from('plumb_sync')
    .update({ data: json, updated_at: updatedAt, revision: expectedRevision + 1 })
    .eq('user_id', PLUMB_SHARED_USER_ID)
    .eq('revision', expectedRevision)
    .select('user_id')
    .maybeSingle()
  if (error) throw error
  if (!updated) {
    throw new Error('The cloud copy changed during sync. Tap Sync now again to review the conflict.')
  }
}
