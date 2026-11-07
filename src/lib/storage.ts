export interface Profile {
  id: string
  name: string
  pinHash?: string
  pinSalt?: string
  currency: string
  monthlyIncomeGoal?: number
  createdAt: string
  lastBackupAt?: string
  legacyJsonAmountsConverted?: boolean
}

export interface Category {
  id: string
  profileId: string
  name: string
  icon: string
  color: string
  monthlyBudget: number
  isFixed: boolean
}

export interface PendingSettlement {
  amountOwedToMe: number
  amountSettled: number
  owedByNote: string
  isSettled: boolean
  settledAt?: string
}

export interface Entry {
  id: string
  profileId: string
  type: 'expense' | 'income'
  amount: number
  totalPaid: number
  isSplit: boolean
  pendingSettlement?: PendingSettlement
  categoryId: string
  note: string
  tags: string[]
  merchantVpa?: string
  utrNumber?: string
  isFixed: boolean
  date: string
  createdAt: string
  source: 'manual' | 'quick-add' | 'upi-screenshot' | 'bank-statement'
}

export interface MerchantRule {
  id: string
  profileId: string
  normalizedPattern: string
  displayName: string
  categoryId: string
  isFixed: boolean
  matchCount: number
}

export interface PlumbData {
  schemaVersion: number
  profiles: Profile[]
  categories: Category[]
  entries: Entry[]
  merchantRules: MerchantRule[]
  activeProfileId: string | null
}

const STORAGE_KEY = 'plumb.data'
const CURRENT_SCHEMA = 1

export const defaultCategories = (profileId: string): Category[] => [
  { id: crypto.randomUUID(), profileId, name: 'Food & dining', icon: 'Utensils', color: '#F59E0B', monthlyBudget: 8000, isFixed: false },
  { id: crypto.randomUUID(), profileId, name: 'Transport', icon: 'TrainFront', color: '#2DD4BF', monthlyBudget: 3500, isFixed: false },
  { id: crypto.randomUUID(), profileId, name: 'Housing', icon: 'House', color: '#A78BFA', monthlyBudget: 12000, isFixed: true },
  { id: crypto.randomUUID(), profileId, name: 'Shopping', icon: 'ShoppingBag', color: '#F87171', monthlyBudget: 5000, isFixed: false },
  { id: crypto.randomUUID(), profileId, name: 'Other', icon: 'CircleEllipsis', color: '#94A3B8', monthlyBudget: 5000, isFixed: false },
]

function migrate(value: unknown): PlumbData {
  if (!value || typeof value !== 'object') throw new Error('Saved Plumb data is not valid.')
  const data = value as Partial<PlumbData>
  const migrated: PlumbData = {
    schemaVersion: CURRENT_SCHEMA,
    profiles: Array.isArray(data.profiles) ? data.profiles : [],
    categories: Array.isArray(data.categories) ? data.categories : [],
    entries: Array.isArray(data.entries) ? data.entries : [],
    merchantRules: Array.isArray(data.merchantRules) ? data.merchantRules : [],
    activeProfileId: typeof data.activeProfileId === 'string' ? data.activeProfileId : null,
  }
  if (migrated.profiles.length === 0) {
    const profile: Profile = {
      id: crypto.randomUUID(),
      name: 'My profile',
      currency: '₹',
      createdAt: new Date().toISOString(),
    }
    migrated.profiles.push(profile)
    migrated.categories.push(...defaultCategories(profile.id))
    migrated.activeProfileId = profile.id
  }
  if (!migrated.profiles.some(profile => profile.id === migrated.activeProfileId)) {
    migrated.activeProfileId = migrated.profiles[0]?.id ?? null
  }
  return migrated
}

export function normalizePlumbData(value: unknown): PlumbData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The synced Plumb data is not a valid data object.')
  }
  const candidate = value as Partial<PlumbData>
  if (!Array.isArray(candidate.profiles) || !Array.isArray(candidate.categories)
    || !Array.isArray(candidate.entries) || !Array.isArray(candidate.merchantRules)) {
    throw new Error('The synced Plumb data is missing required collections.')
  }
  if (candidate.profiles.some(profile => !profile || typeof profile.id !== 'string'
    || typeof profile.name !== 'string' || typeof profile.currency !== 'string'
    || typeof profile.createdAt !== 'string')) {
    throw new Error('The synced Plumb data contains an invalid profile.')
  }
  if (candidate.categories.some(category => !category || typeof category.id !== 'string'
    || typeof category.profileId !== 'string' || typeof category.name !== 'string'
    || typeof category.monthlyBudget !== 'number' || typeof category.isFixed !== 'boolean')) {
    throw new Error('The synced Plumb data contains an invalid category.')
  }
  if (candidate.entries.some(entry => !entry || typeof entry.id !== 'string'
    || typeof entry.profileId !== 'string' || (entry.type !== 'expense' && entry.type !== 'income')
    || typeof entry.amount !== 'number' || !Number.isFinite(entry.amount) || entry.amount <= 0
    || typeof entry.totalPaid !== 'number' || !Number.isFinite(entry.totalPaid)
    || typeof entry.categoryId !== 'string' || typeof entry.date !== 'string')) {
    throw new Error('The synced Plumb data contains an invalid transaction.')
  }
  if (candidate.merchantRules.some(rule => !rule || typeof rule.id !== 'string'
    || typeof rule.profileId !== 'string' || typeof rule.normalizedPattern !== 'string'
    || typeof rule.categoryId !== 'string' || typeof rule.matchCount !== 'number')) {
    throw new Error('The synced Plumb data contains an invalid merchant rule.')
  }
  return migrate(value)
}

export function loadData(): PlumbData {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const fresh = migrate({})
    saveData(fresh)
    return fresh
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Plumb could not read its saved data. Export or restore a backup before continuing.')
  }
  const data = migrate(parsed)
  if ((parsed as Partial<PlumbData>).schemaVersion !== CURRENT_SCHEMA) saveData(data)
  return data
}

export function saveData(data: PlumbData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, schemaVersion: CURRENT_SCHEMA }))
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      throw new Error('Your browser storage is full. Export a backup and remove some older data.')
    }
    throw error
  }
}

export async function hashPin(pin: string, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<{ hash: string; salt: string }> {
  const saltHex = [...salt].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120_000, hash: 'SHA-256' }, material, 256)
  const hash = [...new Uint8Array(bits)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return { hash, salt: saltHex }
}

export async function verifyPin(pin: string, profile: Profile): Promise<boolean> {
  if (!profile.pinHash || !profile.pinSalt) return true
  const salt = Uint8Array.from(profile.pinSalt.match(/.{1,2}/g) ?? [], byte => Number.parseInt(byte, 16))
  const { hash } = await hashPin(pin, salt)
  return hash === profile.pinHash
}

export async function encryptBackup(data: PlumbData, passphrase: string): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250_000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)))
  const bytes = new Uint8Array(4 + salt.length + iv.length + encrypted.byteLength)
  bytes.set([80, 76, 85, 77])
  bytes.set(salt, 4)
  bytes.set(iv, 20)
  bytes.set(new Uint8Array(encrypted), 32)
  return new Blob([bytes], { type: 'application/octet-stream' })
}

export async function decryptBackup(file: File, passphrase: string): Promise<PlumbData> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length < 48 || String.fromCharCode(...bytes.slice(0, 4)) !== 'PLUM') throw new Error('This is not a valid .plumb backup file.')
  const salt = bytes.slice(4, 20)
  const iv = bytes.slice(20, 32)
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250_000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.slice(32))
  return migrate(JSON.parse(new TextDecoder().decode(decrypted)) as unknown)
}

export async function importLegacyJsonBackup(file: File): Promise<PlumbData> {
  let backup: unknown
  try {
    backup = JSON.parse(await file.text()) as unknown
  } catch {
    throw new Error('This JSON file could not be read as a Plumb backup.')
  }
  if (!backup || typeof backup !== 'object') throw new Error('This JSON file is not a supported Plumb backup.')
  const envelope = backup as { app?: unknown; version?: unknown; data?: unknown }
  if (envelope.app !== 'plumb' || envelope.version !== 1 || !envelope.data || typeof envelope.data !== 'object') {
    throw new Error('This is not a supported Plumb JSON backup (version 1).')
  }
  const legacy = envelope.data as { tx?: unknown; cats?: unknown; budgets?: unknown }
  if (!Array.isArray(legacy.tx)) throw new Error('The Plumb backup does not contain a transaction list.')

  const profileId = crypto.randomUUID()
  const profile: Profile = {
    id: profileId,
    name: 'Restored profile',
    currency: '₹',
    createdAt: new Date().toISOString(),
    legacyJsonAmountsConverted: true,
  }
  const defaultByName = new Map(defaultCategories(profileId).map(category => [category.name.toLowerCase(), category]))
  const legacyCategories = Array.isArray(legacy.cats) ? legacy.cats : []
  const budgetValues = legacy.budgets && typeof legacy.budgets === 'object' && !Array.isArray(legacy.budgets)
    ? legacy.budgets as Record<string, unknown>
    : {}
  const categoriesByName = new Map<string, Category>()

  const addCategory = (name: string, details?: Record<string, unknown>) => {
    const key = name.trim().toLowerCase()
    if (!key) return undefined
    const existing = categoriesByName.get(key)
    if (existing) return existing
    const defaults = defaultByName.get(key)
    const budget = details?.monthlyBudget ?? details?.budget ?? budgetValues[name] ?? budgetValues[key]
    const parsedBudget = typeof budget === 'number' && Number.isFinite(budget) && budget >= 0
      ? budget
      : defaults?.monthlyBudget ?? 0
    const category: Category = {
      id: typeof details?.id === 'string' && details.id ? details.id : crypto.randomUUID(),
      profileId,
      name: typeof details?.name === 'string' && details.name.trim() ? details.name.trim() : name.trim(),
      icon: typeof details?.icon === 'string' ? details.icon : defaults?.icon ?? 'CircleEllipsis',
      color: typeof details?.color === 'string' && /^#[\da-f]{6}$/i.test(details.color) ? details.color : defaults?.color ?? '#94A3B8',
      monthlyBudget: parsedBudget,
      isFixed: typeof details?.isFixed === 'boolean' ? details.isFixed : defaults?.isFixed ?? false,
    }
    categoriesByName.set(key, category)
    return category
  }

  for (const item of legacyCategories) {
    if (typeof item === 'string') addCategory(item)
    else if (item && typeof item === 'object') {
      const details = item as Record<string, unknown>
      const name = typeof details.name === 'string' ? details.name : typeof details.cat === 'string' ? details.cat : ''
      if (name) addCategory(name, details)
    }
  }

  const entries: Entry[] = legacy.tx.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Transaction ${index + 1} in the backup is invalid.`)
    const tx = item as Record<string, unknown>
    if (tx.type !== 'expense' && tx.type !== 'income') throw new Error(`Transaction ${index + 1} has an unsupported type.`)
    if (typeof tx.amt !== 'number' || !Number.isFinite(tx.amt) || tx.amt <= 0) throw new Error(`Transaction ${index + 1} has an invalid amount.`)
    const parsedDate = typeof tx.date === 'string' ? new Date(`${tx.date}T00:00:00.000Z`) : new Date(Number.NaN)
    if (typeof tx.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(tx.date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== tx.date) {
      throw new Error(`Transaction ${index + 1} has an invalid date.`)
    }
    const categoryName = typeof tx.cat === 'string' && tx.cat.trim() ? tx.cat.trim() : 'Other'
    const category = addCategory(categoryName)
    if (!category) throw new Error(`Transaction ${index + 1} is missing a category.`)
    const createdDate = typeof tx.t === 'number' && Number.isFinite(tx.t) ? new Date(tx.t) : new Date()
    const timestamp = Number.isNaN(createdDate.getTime()) ? new Date().toISOString() : createdDate.toISOString()
    return {
      id: typeof tx.id === 'string' && tx.id ? tx.id : crypto.randomUUID(),
      profileId,
      type: tx.type,
      amount: tx.amt / 100,
      totalPaid: tx.amt / 100,
      isSplit: false,
      categoryId: category.id,
      note: typeof tx.note === 'string' && tx.note.trim() ? tx.note : categoryName,
      tags: [],
      isFixed: category.isFixed,
      date: tx.date,
      createdAt: timestamp,
      source: 'manual',
    }
  })

  return {
    schemaVersion: CURRENT_SCHEMA,
    profiles: [profile],
    categories: [...categoriesByName.values()],
    entries,
    merchantRules: [],
    activeProfileId: profileId,
  }
}

export function legacyAmountRepairCount(data: PlumbData, profileId: string): number {
  const profile = data.profiles.find(item => item.id === profileId)
  if (!profile || profile.legacyJsonAmountsConverted) return 0
  const profileCreatedAt = Date.parse(profile.createdAt)
  if (Number.isNaN(profileCreatedAt)) return 0
  return data.entries.filter(entry =>
    entry.profileId === profileId
    && entry.source === 'manual'
    && Date.parse(entry.createdAt) <= profileCreatedAt
    && Number.isFinite(entry.amount)
    && entry.amount > 0,
  ).length
}

export function repairLegacyJsonAmounts(data: PlumbData, profileId: string): { data: PlumbData; repairedCount: number } {
  const profile = data.profiles.find(item => item.id === profileId)
  const profileCreatedAt = Date.parse(profile?.createdAt ?? '')
  const repairedIds = new Set(data.entries.filter(entry =>
    entry.profileId === profileId
    && entry.source === 'manual'
    && !Number.isNaN(profileCreatedAt)
    && Date.parse(entry.createdAt) <= profileCreatedAt
    && Number.isFinite(entry.amount)
    && entry.amount > 0,
  ).map(entry => entry.id))

  if (!profile || profile.legacyJsonAmountsConverted || repairedIds.size === 0) {
    throw new Error('No eligible transactions from an older JSON restore were found.')
  }

  return {
    repairedCount: repairedIds.size,
    data: {
      ...data,
      profiles: data.profiles.map(item => item.id === profileId
        ? { ...item, legacyJsonAmountsConverted: true }
        : item),
      entries: data.entries.map(entry => {
        if (!repairedIds.has(entry.id)) return entry
        const scaleSettlement = entry.pendingSettlement
          ? {
            ...entry.pendingSettlement,
            amountOwedToMe: entry.pendingSettlement.amountOwedToMe / 100,
            amountSettled: entry.pendingSettlement.amountSettled / 100,
          }
          : undefined
        return {
          ...entry,
          amount: entry.amount / 100,
          totalPaid: entry.totalPaid / 100,
          ...(scaleSettlement ? { pendingSettlement: scaleSettlement } : {}),
        }
      }),
    },
  }
}
