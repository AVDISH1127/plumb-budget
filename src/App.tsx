import { useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  ArrowDownLeft, ArrowUpRight, ArrowUpRightFromSquare, CalendarDays, Check, ChevronDown, Cloud, Download,
  CircleHelp, CreditCard, Eye, EyeOff, FileDown, FileUp, Filter, Fingerprint, IndianRupee, LockKeyhole,
  LogOut, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Target, Trash2,
  TrendingDown, TrendingUp, Users, Wallet, X,
} from 'lucide-react'
import {
  decryptBackup, defaultCategories, encryptBackup, hashPin, importLegacyJsonBackup, legacyAmountRepairCount,
  loadData, normalizePlumbData, repairLegacyJsonAmounts, saveData, verifyPin,
} from './lib/storage'
import { parseMagicSearch } from './lib/magicSearch'
import {
  createReportPdf, filterReportEntries, getReportDateRange, reportCsv,
} from './lib/reporting'
import type { ReportOptions, ReportPeriod, ReportSection } from './lib/reporting'
import { getBudgetSuggestions, getSpendingCalendar, parseQuickAdd } from './lib/overviewTools'
import type { BudgetSuggestion } from './lib/overviewTools'
import type { Category, Entry, PlumbData, Profile } from './lib/storage'
import { canonicalData, fetchRemoteData, getSupabaseClient, syncBaselineKey, uploadRemoteData } from './lib/supabase'
import type { PlumbSupabaseClient } from './lib/supabase'
import { parseCsvStatement, parsePdfStatement, parseSpreadsheetXml } from './lib/statementImport'
import type { StatementReview } from './lib/statementImport'

type Modal = 'expense' | 'income' | 'profile' | 'pin' | 'security' | 'import' | 'backup' | 'restore' | 'settings' | 'sync' | 'install' | 'more' | 'report' | null
type Page = 'overview' | 'transactions' | 'budgets'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const money = (amount: number, hidden: boolean) => hidden
  ? '₹•••••'
  : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const monthKey = (date: string) => date.slice(0, 7)
const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  period: 'this-month',
  type: 'all',
  categoryIds: [],
  minimum: '',
  maximum: '',
  noteContains: '',
  order: 'newest',
  group: 'none',
  sections: ['summary', 'categories', 'transactions'],
  title: 'Plumb money report',
  hideNotes: false,
  fromDate: '',
  toDate: '',
}

function App() {
  const [data, setData] = useState<PlumbData | null>(null)
  const [error, setError] = useState('')
  const [hidden, setHidden] = useState(false)
  const [modal, setModal] = useState<Modal>(null)
  const [message, setMessage] = useState('')
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [supabaseClient, setSupabaseClient] = useState<PlumbSupabaseClient | null>(null)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [syncUser, setSyncUser] = useState<User | null>(null)
  const [syncEmail, setSyncEmail] = useState('')
  const [syncPassword, setSyncPassword] = useState('')
  const [syncStatus, setSyncStatus] = useState('')
  const [syncUpdatedAt, setSyncUpdatedAt] = useState('')
  const [syncConflict, setSyncConflict] = useState<{ snapshot: PlumbData; revision: number } | null>(null)
  const [syncRecovery, setSyncRecovery] = useState(false)
  const [syncNewPassword, setSyncNewPassword] = useState('')
  const [page, setPage] = useState<Page>('overview')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState('month')
  const [busy, setBusy] = useState(false)
  const [reportOptions, setReportOptions] = useState<ReportOptions>(DEFAULT_REPORT_OPTIONS)
  const [reportProgress, setReportProgress] = useState('')
  const [quickAddValue, setQuickAddValue] = useState('')
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(today())
  const [budgetUndo, setBudgetUndo] = useState<{ categoryId: string; previousBudget: number; appliedBudget: number } | null>(null)
  const [statementReview, setStatementReview] = useState<StatementReview | null>(null)
  const [statementOnlyProblems, setStatementOnlyProblems] = useState(false)
  const reportAbortRef = useRef<AbortController | null>(null)
  const [form, setForm] = useState({ type: 'expense' as 'expense' | 'income', amount: '', totalPaid: '', note: '', categoryId: '', date: today(), merchantVpa: '', isSplit: false, owed: '', owedBy: '', pin: '', confirmPin: '', name: '', passphrase: '', monthlyGoal: '' })
  const [budgetDraft, setBudgetDraft] = useState<Record<string, string>>({})
  const uploadRef = useRef<HTMLInputElement>(null)
  const ocrRef = useRef<HTMLInputElement>(null)
  const profile = data?.profiles.find(item => item.id === activeProfileId) ?? null
  const categories = data?.categories.filter(item => item.profileId === activeProfileId) ?? []
  const allEntries = data?.entries.filter(item => item.profileId === activeProfileId) ?? []
  const legacyRepairCount = data && profile ? legacyAmountRepairCount(data, profile.id) : 0

  useEffect(() => {
    try {
      const saved = loadData()
      setData(saved)
      setActiveProfileId(saved.activeProfileId)
      const current = saved.profiles.find(item => item.id === saved.activeProfileId)
      setLocked(Boolean(current?.pinHash))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load local Plumb data.')
    }
  }, [])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('shared') !== '1') return
    void caches.open('plumb-shell-v3').then(async cache => {
      const response = await cache.match('/__shared-file__')
      if (!response) {
        setMessage('The shared file was received, but could not be read.')
        return
      }
      const sharedFile = await response.blob()
      const type = sharedFile.type
      const name = response.headers.get('X-Plumb-File-Name') || (type === 'application/pdf' ? 'shared-statement.pdf' : 'shared-payment.png')
      if (type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
        setModal('import')
      } else if (type.startsWith('image/')) {
        setMessage('Shared payment image received. Choose Payment screenshot in Import to review it.')
        setModal('import')
      } else {
        setMessage('The shared file type is not supported. Choose a PDF, image, CSV, or Excel statement.')
      }
      await cache.delete('/__shared-file__')
      window.history.replaceState({}, '', window.location.pathname)
    }).catch(() => setMessage('The shared file could not be opened.'))
  }, [])

  useEffect(() => {
    if (!profile || !profile.idleLockMinutes || !profile.pinHash || locked) return
    let timer = 0
    const resetTimer = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setLocked(true), profile.idleLockMinutes! * 60_000)
    }
    const events = ['pointerdown', 'keydown', 'touchstart'] as const
    events.forEach(event => window.addEventListener(event, resetTimer, { passive: true }))
    resetTimer()
    return () => {
      window.clearTimeout(timer)
      events.forEach(event => window.removeEventListener(event, resetTimer))
    }
  }, [profile?.id, profile?.idleLockMinutes, profile?.pinHash, locked])

  useEffect(() => {
    try {
      setSupabaseClient(getSupabaseClient())
    } catch (cause) {
      setSyncStatus(cause instanceof Error ? cause.message : 'Could not load Supabase settings.')
    }
  }, [])

  useEffect(() => {
    if (!supabaseClient) return
    let active = true
    void supabaseClient.auth.getSession().then(({ data: sessionData, error: sessionError }) => {
      if (!active) return
      if (sessionError) setSyncStatus(sessionError.message)
      setSyncUser(sessionData.session?.user ?? null)
    })
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((event, session) => {
      setSyncUser(session?.user ?? null)
      if (!session) setSyncConflict(null)
      if (event === 'PASSWORD_RECOVERY') {
        setSyncRecovery(true)
        setSyncStatus('Recovery link verified. Choose a new password.')
        setModal('sync')
      }
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [supabaseClient])

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)')
    setIsInstalled(standalone.matches)
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const handleInstalled = () => {
      setIsInstalled(true)
      setInstallPrompt(null)
      setMessage('Plumb is installed on this device.')
    }
    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'h' || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      setHidden(current => !current)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const persist = (next: PlumbData) => {
    saveData(next)
    setData(next)
  }
  const uploadLocalSnapshot = async (snapshot: PlumbData, expectedRevision?: number) => {
    if (!supabaseClient || !syncUser) throw new Error('Sign in to Supabase before syncing.')
    await uploadRemoteData(supabaseClient, syncUser.id, snapshot, expectedRevision)
    localStorage.setItem(syncBaselineKey(syncUser.id), canonicalData(snapshot))
    setSyncUpdatedAt(new Date().toISOString())
    setSyncStatus('This device is synced to your Supabase account.')
    setSyncConflict(null)
  }
  const applyRemoteSnapshot = (snapshot: PlumbData) => {
    if (!syncUser) throw new Error('Sign in to Supabase before syncing.')
    persist(snapshot)
    setActiveProfileId(snapshot.activeProfileId)
    setLocked(Boolean(snapshot.profiles.find(item => item.id === snapshot.activeProfileId)?.pinHash))
    localStorage.setItem(syncBaselineKey(syncUser.id), canonicalData(snapshot))
    setSyncUpdatedAt(new Date().toISOString())
    setSyncStatus('Cloud data restored to this device.')
    setSyncConflict(null)
  }
  const syncNow = async () => {
    if (!data || !syncUser || !supabaseClient || locked) return
    setBusy(true)
    setSyncStatus('')
    try {
      const remote = await fetchRemoteData(supabaseClient, syncUser.id)
      const localSnapshot = canonicalData(data)
      if (!remote) {
        await uploadLocalSnapshot(data)
        return
      }
      const remoteSnapshot = normalizePlumbData(remote.data)
      const remoteCanonical = canonicalData(remoteSnapshot)
      const baseline = localStorage.getItem(syncBaselineKey(syncUser.id))
      if (!baseline) {
        if (localSnapshot === remoteCanonical) {
          localStorage.setItem(syncBaselineKey(syncUser.id), remoteCanonical)
          setSyncUpdatedAt(remote.updatedAt)
          setSyncStatus('This device and cloud copy are already in sync.')
        } else {
          setSyncConflict({ snapshot: remoteSnapshot, revision: remote.revision })
          setSyncStatus('This device has no sync history yet. Choose which copy to keep.')
        }
        return
      }
      const localChanged = localSnapshot !== baseline
      const remoteChanged = remoteCanonical !== baseline
      if (localChanged && remoteChanged) {
        setSyncConflict({ snapshot: remoteSnapshot, revision: remote.revision })
        setSyncStatus('Both this device and the cloud changed since the last sync.')
      } else if (localChanged) {
        await uploadLocalSnapshot(data, remote.revision)
      } else if (remoteChanged) {
        applyRemoteSnapshot(remoteSnapshot)
      } else {
        setSyncUpdatedAt(remote.updatedAt)
        setSyncStatus('Already in sync.')
      }
    } catch (cause) {
      setSyncStatus(cause instanceof Error ? cause.message : 'Could not sync with Supabase.')
    } finally {
      setBusy(false)
    }
  }
  const resolveSyncConflict = async (choice: 'device' | 'cloud') => {
    if (!syncConflict || !data) return
    setBusy(true)
    try {
      if (choice === 'device') await uploadLocalSnapshot(data, syncConflict.revision)
      else applyRemoteSnapshot(syncConflict.snapshot)
    } catch (cause) {
      setSyncStatus(cause instanceof Error ? cause.message : 'Could not resolve the sync conflict.')
    } finally {
      setBusy(false)
    }
  }
  const sendPasswordRecovery = async () => {
    if (!supabaseClient) {
      setSyncStatus('Set your Supabase project first.')
      return
    }
    if (!syncEmail.trim()) {
      setSyncStatus('Enter your account email first.')
      return
    }
    setBusy(true)
    setSyncStatus('')
    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(syncEmail.trim(), {
        redirectTo: window.location.origin,
      })
      if (error) throw error
      setSyncStatus('Password recovery email sent. Open the link on this device to choose a new password.')
    } catch (cause) {
      setSyncStatus(cause instanceof Error ? cause.message : 'Could not send the password recovery email.')
    } finally {
      setBusy(false)
    }
  }

  const updateRecoveredPassword = async () => {
    if (!supabaseClient) return
    if (syncNewPassword.length < 6) {
      setSyncStatus('Use at least 6 characters for the new password.')
      return
    }
    setBusy(true)
    try {
      const { error } = await supabaseClient.auth.updateUser({ password: syncNewPassword })
      if (error) throw error
      setSyncRecovery(false)
      setSyncNewPassword('')
      setSyncPassword('')
      setSyncStatus('Password updated. You can now sync with your new password.')
    } catch (cause) {
      setSyncStatus(cause instanceof Error ? cause.message : 'Could not update the password.')
    } finally {
      setBusy(false)
    }
  }

  const authenticateSync = async (register: boolean) => {
    if (!supabaseClient) {
      setSyncStatus('The Supabase connection is not ready yet.')
      return
    }
    if (!syncEmail.trim() || !syncPassword) {
      setSyncStatus('Enter your email and password.')
      return
    }
    setBusy(true)
    setSyncStatus('')
    try {
      const result = register
        ? await supabaseClient.auth.signUp({
          email: syncEmail.trim(),
          password: syncPassword,
          options: { emailRedirectTo: window.location.origin },
        })
        : await supabaseClient.auth.signInWithPassword({ email: syncEmail.trim(), password: syncPassword })
      if (result.error) throw result.error
      if (register && !result.data.session) {
        setSyncStatus('Check your email to confirm the new Supabase account, then sign in here.')
      } else {
        setSyncUser(result.data.user)
        setSyncPassword('')
        setSyncStatus(register ? 'Account created and signed in.' : 'Signed in to Supabase.')
      }
    } catch (cause) {
      setSyncStatus(cause instanceof Error ? cause.message : 'Could not authenticate with Supabase.')
    } finally {
      setBusy(false)
    }
  }
  const signOutSync = async () => {
    if (!supabaseClient) return
    setBusy(true)
    try {
      const { error: signOutError } = await supabaseClient.auth.signOut()
      if (signOutError) throw signOutError
      setSyncUser(null)
      setSyncPassword('')
      setSyncStatus('Signed out. Your local Plumb data has not been changed.')
    } catch (cause) {
      setSyncStatus(cause instanceof Error ? cause.message : 'Could not sign out of Supabase.')
    } finally {
      setBusy(false)
    }
  }
  const activeEntries = useMemo(() => {
    const now = new Date()
    const cutoff = new Date(now.getFullYear(), now.getMonth(), 1)
    return allEntries.filter(entry => period === 'all' || new Date(`${entry.date}T00:00:00`) >= cutoff)
  }, [allEntries, period])
  const monthEntries = allEntries.filter(entry => monthKey(entry.date) === today().slice(0, 7))
  const expenses = monthEntries.filter(entry => entry.type === 'expense')
  const income = monthEntries.filter(entry => entry.type === 'income')
  const spent = expenses.reduce((sum, entry) => sum + entry.amount, 0)
  const earned = income.reduce((sum, entry) => sum + entry.amount, 0)
  const available = Math.max(0, (profile?.monthlyIncomeGoal || earned) - spent)
  const monthExpenses = expenses
  const monthlyBudget = categories.reduce((sum, category) => sum + category.monthlyBudget, 0)
  const days = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
  const daysLeft = Math.max(1, days - new Date().getDate() + 1)
  const dailyPace = (monthlyBudget - monthExpenses.reduce((sum, entry) => sum + entry.amount, 0)) / daysLeft
  const spendingCalendar = getSpendingCalendar(monthExpenses)
  const calendarMaxSpend = Math.max(...spendingCalendar.days.map(day => day.amount), 0)
  const selectedCalendarDay = spendingCalendar.days.find(day => day.date === selectedCalendarDate)
  const budgetSuggestions = getBudgetSuggestions(categories, allEntries)
  const searchPlan = parseMagicSearch(query, categories, new Date())
  const searchEntries = searchPlan.hasDateFilter ? allEntries : activeEntries
  const filteredEntries = searchEntries
    .filter(entry => (categoryFilter === 'all' || entry.categoryId === categoryFilter)
      && (!searchPlan.categoryId || entry.categoryId === searchPlan.categoryId)
      && (!searchPlan.type || entry.type === searchPlan.type)
      && (searchPlan.minAmount === null || (searchPlan.minExclusive ? entry.amount > searchPlan.minAmount : entry.amount >= searchPlan.minAmount))
      && (searchPlan.maxAmount === null || (searchPlan.maxExclusive ? entry.amount < searchPlan.maxAmount : entry.amount <= searchPlan.maxAmount))
      && (!searchPlan.startDate || entry.date >= searchPlan.startDate)
      && (!searchPlan.endDate || entry.date <= searchPlan.endDate)
      && `${entry.note} ${entry.merchantVpa ?? ''}`.toLowerCase().includes(searchPlan.text))
    .sort((a, b) => {
      if (searchPlan.sort === 'largest') return b.amount - a.amount || b.date.localeCompare(a.date)
      if (searchPlan.sort === 'smallest') return a.amount - b.amount || b.date.localeCompare(a.date)
      if (searchPlan.sort === 'oldest') return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)
      return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
    })
    .slice(0, searchPlan.limit ?? searchEntries.length)
  const recent = filteredEntries.slice(0, 7)
  const categoryTotals = categories.map(category => ({
    ...category,
    spent: monthExpenses.filter(entry => entry.categoryId === category.id).reduce((sum, entry) => sum + entry.amount, 0),
  })).sort((a, b) => b.spent - a.spent)
  const overBudgetCategory = categoryTotals.find(category => category.monthlyBudget > 0 && category.spent > category.monthlyBudget)
  const leadingCategory = categoryTotals.find(category => category.spent > 0)
  const monthlyInsight = overBudgetCategory
    ? `${overBudgetCategory.name} is ${money(overBudgetCategory.spent - overBudgetCategory.monthlyBudget, hidden)} above its monthly limit.`
    : leadingCategory
      ? `${leadingCategory.name} is your highest-spend category so far this month.`
      : 'Your monthly insights will appear as you add expenses.'
  const reportDateRange = getReportDateRange(reportOptions.period, reportOptions.fromDate, reportOptions.toDate)
  const reportEntries = filterReportEntries(allEntries, categories, reportOptions, reportDateRange)
  const reportSpent = reportEntries.filter(entry => entry.type === 'expense').reduce((sum, entry) => sum + entry.amount, 0)
  const reportIncome = reportEntries.filter(entry => entry.type === 'income').reduce((sum, entry) => sum + entry.amount, 0)
  const reportMinimum = reportOptions.minimum.trim() ? Number(reportOptions.minimum) : null
  const reportMaximum = reportOptions.maximum.trim() ? Number(reportOptions.maximum) : null
  const reportRangeInvalid = (reportMinimum !== null && (!Number.isFinite(reportMinimum) || reportMinimum < 0))
    || (reportMaximum !== null && (!Number.isFinite(reportMaximum) || reportMaximum < 0))
    || (reportMinimum !== null && reportMaximum !== null && reportMinimum > reportMaximum)
  const reportDatesInvalid = reportOptions.period === 'custom'
    && (!reportOptions.fromDate || !reportOptions.toDate || reportOptions.fromDate > reportOptions.toDate)

  const openReport = () => {
    setReportOptions({ ...DEFAULT_REPORT_OPTIONS })
    setReportProgress('')
    setModal('report')
  }
  const updateReportOptions = (updates: Partial<ReportOptions>) => setReportOptions(current => ({ ...current, ...updates }))
  const toggleReportSection = (section: ReportSection) => setReportOptions(current => ({
    ...current,
    sections: current.sections.includes(section)
      ? current.sections.filter(item => item !== section)
      : [...current.sections, section],
  }))
  const describeReport = (description: string) => {
    const plan = parseMagicSearch(description, categories)
    const updates: Partial<ReportOptions> = { noteContains: plan.text }
    if (plan.type) updates.type = plan.type
    if (plan.categoryId) updates.categoryIds = [plan.categoryId]
    if (plan.minAmount !== null) updates.minimum = String(plan.minAmount)
    if (plan.maxAmount !== null) updates.maximum = String(plan.maxAmount)
    if (plan.hasDateFilter && plan.startDate && plan.endDate && plan.endDate !== '9999-12-31') {
      updates.period = 'custom'
      updates.fromDate = plan.startDate
      updates.toDate = plan.endDate
    }
    if (plan.sort === 'largest' || plan.sort === 'smallest' || plan.sort === 'oldest' || plan.sort === 'newest') updates.order = plan.sort
    setReportOptions(current => ({ ...current, ...updates }))
  }
  const exportReportCsv = () => {
    if (reportRangeInvalid || reportDatesInvalid || reportEntries.length === 0) return
    const blob = new Blob([reportCsv(reportEntries, categories, reportOptions)], { type: 'text/csv;charset=utf-8' })
    download(blob, `plumb-report-${today()}.csv`)
    setMessage(`Exported ${reportEntries.length} matching transactions as CSV.`)
  }
  const exportReportPdf = async () => {
    if (reportRangeInvalid || reportDatesInvalid || reportEntries.length === 0 || !profile) return
    const controller = new AbortController()
    reportAbortRef.current = controller
    setBusy(true)
    setReportProgress('Preparing your report…')
    try {
      const bytes = await createReportPdf(reportEntries, categories, reportOptions, reportDateRange, profile.name, progress => {
        setReportProgress(progress.total > 0
          ? `Preparing transaction ${progress.completed.toLocaleString('en-IN')} of ${progress.total.toLocaleString('en-IN')}…`
          : 'Finishing your report…')
      }, controller.signal)
      if (controller.signal.aborted) return
      const pdf = new File([bytes], `plumb-report-${today()}.pdf`, { type: 'application/pdf' })
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [pdf] }))) {
        try {
          await navigator.share({ title: reportOptions.title || 'Plumb money report', files: [pdf] })
        } catch (cause) {
          if (!(cause instanceof DOMException && cause.name === 'AbortError')) throw cause
        }
      } else {
        download(pdf, pdf.name)
      }
      setModal(null)
      setMessage('Your PDF report is ready on this device.')
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setMessage(cause instanceof Error ? cause.message : 'Could not create the PDF report.')
    } finally {
      if (reportAbortRef.current === controller) reportAbortRef.current = null
      setBusy(false)
      setReportProgress('')
    }
  }
  const closeModal = () => {
    if (modal === 'report' && reportAbortRef.current) {
      reportAbortRef.current.abort()
      reportAbortRef.current = null
    }
    setModal(null)
    setEditingEntryId(null)
    setSyncConflict(null)
  }

  const openForm = (type: 'expense' | 'income') => {
    setEditingEntryId(null)
    setForm(current => ({ ...current, type, amount: '', totalPaid: '', note: '', categoryId: categories[0]?.id ?? '', date: today(), merchantVpa: '', isSplit: false, owed: '', owedBy: '' }))
    setModal(type)
  }
  useEffect(() => {
    if (!data || locked) return
    const url = new URL(window.location.href)
    const action = url.searchParams.get('action')
    if (url.searchParams.get('page') === 'transactions') {
      setPage('transactions')
      setPeriod('all')
    }
    if (action === 'add-expense') openForm('expense')
    if (action || url.searchParams.has('page')) {
      url.searchParams.delete('action')
      url.searchParams.delete('page')
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    }
  }, [data, locked])
  const installApp = async () => {
    if (!installPrompt) {
      setModal('install')
      return
    }
    try {
      await installPrompt.prompt()
      const { outcome } = await installPrompt.userChoice
      setInstallPrompt(null)
      if (outcome === 'accepted') setIsInstalled(true)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not open the install prompt.')
    }
  }
  const openEditEntry = (entry: Entry) => {
    setEditingEntryId(entry.id)
    setForm(current => ({
      ...current,
      type: entry.type,
      amount: String(entry.amount),
      totalPaid: entry.isSplit ? String(entry.totalPaid) : '',
      note: entry.note,
      categoryId: entry.categoryId,
      date: entry.date,
      merchantVpa: entry.merchantVpa ?? '',
      isSplit: entry.isSplit,
      owed: entry.pendingSettlement ? String(entry.pendingSettlement.amountOwedToMe) : '',
      owedBy: entry.pendingSettlement?.owedByNote ?? '',
    }))
    setModal(entry.type)
  }
  const openSettings = () => {
    setBudgetDraft(Object.fromEntries(categories.map(category => [category.id, String(category.monthlyBudget)])))
    setForm(current => ({ ...current, monthlyGoal: String(profile?.monthlyIncomeGoal ?? '') }))
    setModal('settings')
  }
  const saveSettings = () => {
    if (!data || !profile) return
    const monthlyIncomeGoal = form.monthlyGoal.trim() ? Number(form.monthlyGoal) : undefined
    if (monthlyIncomeGoal !== undefined && (!Number.isFinite(monthlyIncomeGoal) || monthlyIncomeGoal < 0)) {
      setMessage('Enter a valid monthly income goal.')
      return
    }
    const invalidCategory = categories.find(category => !Number.isFinite(Number(budgetDraft[category.id])) || Number(budgetDraft[category.id]) < 0)
    if (invalidCategory) {
      setMessage(`Enter a valid budget for ${invalidCategory.name}.`)
      return
    }
    const updatedCategories = data.categories.map(category => {
      if (category.profileId !== profile.id) return category
      const amount = Number(budgetDraft[category.id])
      return { ...category, monthlyBudget: amount }
    })
    try {
      persist({
        ...data,
        profiles: data.profiles.map(item => item.id === profile.id ? { ...item, monthlyIncomeGoal } : item),
        categories: updatedCategories,
      })
      setBudgetUndo(null)
      setModal(null)
      setMessage('Your budget settings are saved.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not save budget settings.')
    }
  }
  const saveEntry = (draft = form, source: Entry['source'] = 'manual'): boolean => {
    if (!data || !profile) return false
    const amount = Number(draft.amount)
    const isSplit = draft.type === 'expense' && draft.isSplit
    const totalPaid = isSplit ? Number(draft.totalPaid || draft.amount) : amount
    if (!Number.isFinite(amount) || amount <= 0 || !draft.categoryId || !draft.date) {
      setMessage('Enter a valid amount, date, and category.')
      return false
    }
    if (isSplit && (!Number.isFinite(totalPaid) || totalPaid < amount)) {
      setMessage('Total paid should be at least your share.')
      return false
    }
    const category = categories.find(item => item.id === draft.categoryId)
    const existingEntry = editingEntryId ? data.entries.find(item => item.id === editingEntryId && item.profileId === profile.id) : undefined
    if (editingEntryId && !existingEntry) {
      setMessage('This transaction is no longer available to edit.')
      return false
    }
    const previousSettlement = existingEntry?.pendingSettlement
    const amountOwedToMe = totalPaid - amount
    const amountSettled = previousSettlement
      ? Math.min(previousSettlement.amountSettled, amountOwedToMe)
      : 0
    const pendingSettlement = isSplit && amountOwedToMe > 0 ? {
      amountOwedToMe,
      amountSettled,
      owedByNote: draft.owedBy.trim() || previousSettlement?.owedByNote || 'Shared expense',
      isSettled: amountSettled >= amountOwedToMe,
      ...(previousSettlement?.settledAt && amountSettled >= amountOwedToMe ? { settledAt: previousSettlement.settledAt } : {}),
    } : undefined
    const entry: Entry = {
      id: existingEntry?.id ?? crypto.randomUUID(), profileId: profile.id, type: draft.type, amount,
      totalPaid, isSplit, categoryId: draft.categoryId,
      note: draft.note.trim() || (category?.name ?? 'Entry'), tags: [],
      merchantVpa: draft.merchantVpa.trim() || undefined,
      isFixed: existingEntry && category?.id === existingEntry.categoryId ? existingEntry.isFixed : category?.isFixed ?? false,
      date: draft.date, createdAt: existingEntry?.createdAt ?? new Date().toISOString(),
      source: existingEntry?.source ?? source,
      pendingSettlement,
    }
    try {
      const rules = data.merchantRules.map(rule => ({ ...rule }))
      if (entry.merchantVpa && !existingEntry) {
        const pattern = normalized(entry.merchantVpa)
        const existing = rules.find(rule => rule.profileId === profile.id && rule.normalizedPattern === pattern)
        if (existing) existing.matchCount += 1
        else rules.push({ id: crypto.randomUUID(), profileId: profile.id, normalizedPattern: pattern, displayName: entry.note, categoryId: entry.categoryId, isFixed: entry.isFixed, matchCount: 1 })
      }
      if (entry.merchantVpa && existingEntry) {
        const rule = rules.find(item => item.profileId === profile.id && item.normalizedPattern === normalized(entry.merchantVpa ?? ''))
        if (rule) {
          rule.displayName = entry.note
          rule.categoryId = entry.categoryId
          rule.isFixed = entry.isFixed
        }
      }
      persist({
        ...data,
        entries: existingEntry
          ? data.entries.map(item => item.id === existingEntry.id ? { ...item, ...entry, tags: existingEntry.tags, utrNumber: existingEntry.utrNumber } : item)
          : [...data.entries, entry],
        merchantRules: rules,
      })
      setModal(null)
      setEditingEntryId(null)
      setMessage(existingEntry ? 'Transaction updated.' : 'Entry added.')
      return true
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not save entry.')
      return false
    }
  }

  const submitQuickAdd = () => {
    const quickEntry = parseQuickAdd(quickAddValue, categories)
    if (!quickEntry) {
      setMessage('Try an amount first, such as “₹120 coffee · Food & dining”.')
      return
    }
    const saved = saveEntry({
      ...form,
      type: quickEntry.type,
      amount: String(quickEntry.amount),
      totalPaid: '',
      note: quickEntry.note,
      categoryId: quickEntry.categoryId,
      date: today(),
      merchantVpa: '',
      isSplit: false,
      owed: '',
      owedBy: '',
    }, 'quick-add')
    if (saved) setQuickAddValue('')
  }

  const applyBudgetSuggestion = (suggestion: BudgetSuggestion) => {
    if (!data || !profile) return
    const category = categories.find(item => item.id === suggestion.categoryId)
    if (!category || category.monthlyBudget !== suggestion.currentBudget) {
      setMessage('This budget changed. Review the latest suggestion before applying it.')
      return
    }
    try {
      persist({
        ...data,
        categories: data.categories.map(item => item.id === category.id
          ? { ...item, monthlyBudget: suggestion.suggestedBudget }
          : item),
      })
      setBudgetUndo({
        categoryId: category.id,
        previousBudget: category.monthlyBudget,
        appliedBudget: suggestion.suggestedBudget,
      })
      setMessage(`${category.name} budget updated. You can undo this change.`)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not apply the budget suggestion.')
    }
  }

  const undoBudgetSuggestion = () => {
    if (!data || !budgetUndo) return
    const category = categories.find(item => item.id === budgetUndo.categoryId)
    if (!category || category.monthlyBudget !== budgetUndo.appliedBudget) {
      setBudgetUndo(null)
      setMessage('This budget changed again, so the suggestion can no longer be undone.')
      return
    }
    try {
      persist({
        ...data,
        categories: data.categories.map(item => item.id === category.id
          ? { ...item, monthlyBudget: budgetUndo.previousBudget }
          : item),
      })
      setBudgetUndo(null)
      setMessage(`${category.name} budget restored.`)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not undo the budget suggestion.')
    }
  }

  const switchProfile = async (id: string) => {
    if (!data) return
    const nextProfile = data.profiles.find(item => item.id === id)
    if (!nextProfile) return
    if (nextProfile.pinHash) {
      setActiveProfileId(id)
      setLocked(true)
      setForm(current => ({ ...current, pin: '', confirmPin: '' }))
      setModal('pin')
    } else {
      try {
        persist({ ...data, activeProfileId: id })
        setActiveProfileId(id)
        setLocked(false)
        setModal(null)
      } catch (cause) {
        setMessage(cause instanceof Error ? cause.message : 'Could not switch profiles.')
      }
    }
  }
  const unlockProfile = async () => {
    if (!profile) return
    setBusy(true)
    try {
      if (!(await verifyPin(form.pin, profile))) {
        setMessage('That PIN did not match. Try again.')
        return
      }
      if (data) persist({ ...data, activeProfileId: profile.id })
      setLocked(false)
      setModal(null)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not verify PIN.')
    } finally {
      setBusy(false)
    }
  }
  const unlockProfileWithBiometric = async () => {
    if (!profile?.biometricCredentialId || !window.PublicKeyCredential) {
      setMessage('Biometric unlock has not been set up for this profile.')
      return
    }
    setBusy(true)
    try {
      const normalizedId = profile.biometricCredentialId.replace(/-/g, '+').replace(/_/g, '/')
      const credentialId = Uint8Array.from(atob(normalizedId.padEnd(Math.ceil(normalizedId.length / 4) * 4, '=')), char => char.charCodeAt(0))
      await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ type: 'public-key', id: credentialId, transports: ['internal'] }],
          userVerification: 'required',
          timeout: 60_000,
        },
      })
      if (data) persist({ ...data, activeProfileId: profile.id })
      setLocked(false)
      setModal(null)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Biometric unlock could not verify this device.')
    } finally {
      setBusy(false)
    }
  }
  const enableProfilePin = async () => {
    if (!data || !profile) return
    if (!/^\d{4}$/.test(form.pin)) {
      setMessage('PIN must be exactly 4 digits.')
      return
    }
    if (form.pin !== form.confirmPin) {
      setMessage('PINs do not match. Enter them again.')
      return
    }
    setBusy(true)
    try {
      const pin = await hashPin(form.pin)
      persist({
        ...data,
        profiles: data.profiles.map(item => item.id === profile.id
          ? { ...item, pinHash: pin.hash, pinSalt: pin.salt }
          : item),
      })
      setModal(null)
      setForm(current => ({ ...current, pin: '', confirmPin: '' }))
      setMessage('PIN protection is enabled for this profile.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not protect this profile with a PIN.')
    } finally {
      setBusy(false)
    }
  }
  const setIdleLockMinutes = (minutes: number) => {
    if (!data || !profile) return
    try {
      persist({ ...data, profiles: data.profiles.map(item => item.id === profile.id ? { ...item, idleLockMinutes: minutes } : item) })
      setMessage(minutes ? `Auto-lock set to ${minutes} minutes.` : 'Auto-lock disabled.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not save the auto-lock setting.')
    }
  }
  const enableBiometricUnlock = async () => {
    if (!data || !profile || !window.PublicKeyCredential) {
      setMessage('Biometric unlock is not supported by this browser.')
      return
    }
    setBusy(true)
    try {
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'Plumb' },
          user: {
            id: new TextEncoder().encode(profile.id),
            name: `${profile.id}@plumb.local`,
            displayName: profile.name,
          },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
          timeout: 60_000,
        },
      })
      if (!(credential instanceof PublicKeyCredential)) throw new Error('Biometric setup was not completed.')
      persist({ ...data, profiles: data.profiles.map(item => item.id === profile.id ? { ...item, biometricCredentialId: credential.id } : item) })
      setMessage('Biometric unlock enabled for this profile.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Biometric unlock could not be enabled.')
    } finally {
      setBusy(false)
    }
  }
  const createProfile = async () => {
    if (!data || !form.name.trim()) {
      setMessage('Add a profile name to continue.')
      return
    }
    try {
      const id = crypto.randomUUID()
      const nextProfile: Profile = { id, name: form.name.trim(), currency: '₹', createdAt: new Date().toISOString() }
      if (form.pin) {
        if (!/^\d{4}$/.test(form.pin)) {
          setMessage('PIN must be exactly 4 digits.')
          return
        }
        const pin = await hashPin(form.pin)
        nextProfile.pinHash = pin.hash
        nextProfile.pinSalt = pin.salt
      }
      const next: PlumbData = { ...data, profiles: [...data.profiles, nextProfile], categories: [...data.categories, ...defaultCategories(id)], activeProfileId: id }
      persist(next)
      setActiveProfileId(id)
      setLocked(false)
      setModal(null)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not create profile.')
    }
  }
  const deleteEntry = (id: string) => {
    if (!data || !window.confirm('Delete this transaction? This cannot be undone.')) return
    try {
      persist({ ...data, entries: data.entries.filter(entry => entry.id !== id) })
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not delete transaction.')
    }
  }

  const importStatement = async (file: File) => {
    if (!data || !profile) return
    setBusy(true)
    try {
      let review: StatementReview
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        let password: string | undefined
        try {
          review = await parsePdfStatement(file)
        } catch (cause) {
          if (cause instanceof Error && cause.message === 'PASSWORD_REQUIRED') {
            password = window.prompt('Enter the PDF statement password. It is used only on this device and is not saved.') || undefined
            if (!password) throw new Error('PDF password is required.')
            review = await parsePdfStatement(file, password)
          } else throw cause
        }
      } else {
        const merchantRules = Object.fromEntries(data.merchantRules.filter(rule => rule.profileId === profile.id).map(rule => [rule.normalizedPattern, categories.find(category => category.id === rule.categoryId)?.name || 'Other']))
        const text = await file.text()
        const csv = /\.xml$/i.test(file.name) || /<Workbook/i.test(text) ? parseSpreadsheetXml(text) : text
        review = await parseCsvStatement(csv, data.entries.filter(entry => entry.profileId === profile.id), merchantRules)
      }
      if (!review.rows.length) throw new Error('No transaction table was found. Download the statement as a PDF from your bank app or website.')
      setStatementReview(review)
      setModal(null)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not import statement.')
    } finally {
      setBusy(false)
    }
  }

  const commitStatementReview = () => {
    if (!data || !profile || !statementReview) return
    const selectedRows = statementReview.rows.filter(row => row.selected && row.problem !== 'paired_reversal' && row.problem !== 'duplicate')
    const rules = [...data.merchantRules]
    const imported: Entry[] = selectedRows.map(row => {
      const category = categories.find(item => item.name === row.category) ?? categories.find(item => item.name === 'Other') ?? categories[0]
      const pattern = row.merchant.toLowerCase()
      const existingRule = rules.find(rule => rule.profileId === profile.id && rule.normalizedPattern === pattern)
      if (existingRule) { existingRule.matchCount += 1; existingRule.categoryId = category.id }
      else rules.push({ id: crypto.randomUUID(), profileId: profile.id, normalizedPattern: pattern, displayName: row.merchant, categoryId: category.id, isFixed: category.isFixed, matchCount: 1 })
      return { id: crypto.randomUUID(), profileId: profile.id, type: row.type, amount: row.amountMinor / 100, totalPaid: row.amountMinor / 100, isSplit: false, categoryId: category.id, note: row.descriptionRaw || row.merchant, tags: [], merchantVpa: row.merchant, utrNumber: row.upiRef || undefined, isFixed: category.isFixed, date: row.date, createdAt: new Date().toISOString(), source: 'bank-statement' }
    })
    persist({ ...data, entries: [...data.entries, ...imported], merchantRules: rules })
    setStatementReview(null)
    setModal(null)
    setMessage(`Added ${imported.length} verified statement ${imported.length === 1 ? 'entry' : 'entries'}.`)
  }

  const importScreenshot = async (file: File) => {
    if (!data || !profile) return
    setBusy(true)
    try {
      const { createWorker, OEM } = await import('tesseract.js')
      const ocrBase = `${import.meta.env.BASE_URL}ocr/`
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: `${ocrBase}worker.min.js`,
        corePath: `${ocrBase}tesseract-core-lstm.wasm.js`,
        langPath: ocrBase,
        gzip: true,
      })
      try {
        const { data: result } = await worker.recognize(file)
        const text = result.text
        const amountMatch = text.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i)
          ?? text.match(/(?:paid|sent|amount)\D{0,16}([\d,]+(?:\.\d{1,2})?)/i)
        const utr = text.match(/(?:utr|upi ref(?:erence)?|transaction id)\D{0,12}(\d{10,16})/i)?.[1]
        const payee = text.match(/(?:to|paid to|sent to)\s+([A-Z][\w .&-]{2,35})/i)?.[1]?.trim()
        const amount = Number(amountMatch?.[1].replace(/,/g, ''))
        if (!amountMatch || !Number.isFinite(amount) || amount <= 0) throw new Error('Could not find a clear payment amount. You can add it manually.')
        const category = categories.find(item => item.name === 'Other') ?? categories[0]
        if (!category) throw new Error('Add a category before importing a payment.')
        const entry: Entry = {
          id: crypto.randomUUID(), profileId: profile.id, type: 'expense', amount, totalPaid: amount,
          isSplit: false, categoryId: category.id, note: payee || 'UPI payment', tags: [],
          merchantVpa: payee, utrNumber: utr, isFixed: category.isFixed, date: today(),
          createdAt: new Date().toISOString(), source: 'upi-screenshot',
        }
        const duplicate = utr && data.entries.some(item => item.profileId === profile.id && item.utrNumber === utr)
        if (duplicate) throw new Error('This UPI reference was already imported.')
        persist({ ...data, entries: [...data.entries, entry] })
        setModal(null)
        setMessage('Payment details recognized and added. Please review the entry.')
      } finally {
        await worker.terminate()
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'OCR could not read the screenshot.')
    } finally {
      setBusy(false)
    }
  }

  const exportBackup = async () => {
    if (!data || !form.passphrase) {
      setMessage('Enter a passphrase to encrypt the backup.')
      return
    }
    setBusy(true)
    try {
      const blob = await encryptBackup(data, form.passphrase)
      download(blob, `plumb-backup-${today()}.plumb`)
      if (profile) {
        const updated = { ...data, profiles: data.profiles.map(item => item.id === profile.id ? { ...item, lastBackupAt: new Date().toISOString() } : item) }
        persist(updated)
      }
      setModal(null)
      setMessage('Encrypted backup downloaded.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not create backup.')
    } finally {
      setBusy(false)
    }
  }
  const restoreBackup = async (file: File) => {
    if (!data) {
      return
    }
    setBusy(true)
    try {
      const isLegacyJson = file.name.toLowerCase().endsWith('.json') || file.type === 'application/json'
      if (!isLegacyJson && !form.passphrase) {
        setMessage('Enter the passphrase for this encrypted .plumb backup.')
        return
      }
      const restored = isLegacyJson
        ? await importLegacyJsonBackup(file)
        : await decryptBackup(file, form.passphrase)
      const confirmation = isLegacyJson
        ? `Restore preview\n\nProfiles: ${restored.profiles.length}\nTransactions: ${restored.entries.length}\nCategories: ${restored.categories.length}\nMerchant rules: ${restored.merchantRules.length}\n\nThis backup replaces the current browser data. Continue?`
        : `Restore preview\n\nProfiles: ${restored.profiles.length}\nTransactions: ${restored.entries.length}\nCategories: ${restored.categories.length}\nMerchant rules: ${restored.merchantRules.length}\n\nThis backup replaces the current browser data. Continue?`
      if (!window.confirm(confirmation)) return
      persist(restored)
      setActiveProfileId(restored.activeProfileId)
      setLocked(Boolean(restored.profiles.find(item => item.id === restored.activeProfileId)?.pinHash))
      setModal(null)
      setMessage(isLegacyJson
        ? `JSON backup restored with ${restored.entries.length} transactions.`
        : 'Backup restored.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not restore this backup. Check the file and, for .plumb files, its passphrase.')
    } finally {
      setBusy(false)
    }
  }
  const repairOldRestoreAmounts = () => {
    if (!data || !profile || legacyRepairCount === 0) return
    const confirmed = window.confirm(
      `Correct ${legacyRepairCount} transactions from this older JSON restore by dividing their saved paise amounts by 100? Newer transactions will not be changed.`,
    )
    if (!confirmed) return
    try {
      const repaired = repairLegacyJsonAmounts(data, profile.id)
      persist(repaired.data)
      setMessage(`Corrected rupee amounts for ${repaired.repairedCount} restored transactions.`)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not correct old restored amounts.')
    }
  }

  if (error) return <div className="fatal"><ShieldCheck size={28} /><h1>Plumb couldn’t open your data</h1><p>{error}</p><p>Your browser data has not been cleared.</p></div>
  if (!data || !profile) return <div className="loading">Opening your private ledger…</div>

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Plumb home"><span className="brand-mark"><span /></span><span>plumb<span className="brand-period">.</span></span></a>
        <div className="workspace-label">YOUR SPACE</div>
        <button className="profile-switcher" onClick={() => { setForm(current => ({ ...current, name: '', pin: '' })); setModal('profile') }}>
          <span className="avatar">{profile.name.slice(0, 1).toUpperCase()}</span>
          <span className="profile-copy"><strong>{profile.name}</strong><small>Personal account</small></span>
          <ChevronDown size={15} />
        </button>
        <nav className="nav-list">
          <button type="button" className={`nav-item ${page === 'overview' ? 'selected' : ''}`} aria-current={page === 'overview' ? 'page' : undefined} onClick={() => setPage('overview')}><Wallet size={17} /> Overview</button>
          <button type="button" className={`nav-item ${page === 'transactions' ? 'selected' : ''}`} aria-current={page === 'transactions' ? 'page' : undefined} onClick={() => { setPage('transactions'); setPeriod('all') }}><CreditCard size={17} /> Transactions <span className="nav-count">{allEntries.length}</span></button>
          <button type="button" className={`nav-item ${page === 'budgets' ? 'selected' : ''}`} aria-current={page === 'budgets' ? 'page' : undefined} onClick={() => setPage('budgets')}><Target size={17} /> Budgets</button>
        </nav>
        <div className="side-bottom">
          <div className="privacy-card"><ShieldCheck size={17} /><div><strong>Your data stays yours</strong><span>Local-first · cloud sync is optional</span></div></div>
          <button className="nav-item" onClick={openReport}><FileDown size={17} /> Export report</button>
          <button className="nav-item" onClick={() => setModal('backup')}><FileDown size={17} /> Encrypted backup</button>
          <button className="nav-item" onClick={() => setModal('restore')}><FileUp size={17} /> Restore backup</button>
          <button className="nav-item" onClick={() => { setSyncStatus(''); setModal('sync') }}><Cloud size={17} /> Sync across devices</button>
          {!isInstalled && <button className="nav-item" onClick={() => void installApp()}><Download size={17} /> Install Plumb</button>}
          <div className="side-foot">PLUMB <span>·</span> PRIVATE BY DESIGN</div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">Your finances <span>/</span> <strong>Overview</strong></div>
          <div className="top-actions flex items-center gap-2">
            <button className="icon-button" title={`${hidden ? 'Show' : 'Hide'} amounts (H)`} aria-label="Toggle privacy mode" onClick={() => setHidden(!hidden)}>{hidden ? <Eye size={17} /> : <EyeOff size={17} />}<span className="shortcut">H</span></button>
            <button className="icon-button" title="Sync across devices" aria-label="Sync across devices" onClick={() => { setSyncStatus(''); setModal('sync') }}><Cloud size={17} /></button>
            {!isInstalled && <button className="icon-button" title="Install Plumb on this device" aria-label="Install Plumb" onClick={() => void installApp()}><Download size={17} /></button>}
            <button className="icon-button" title="Switch profile" aria-label="Switch profile" onClick={() => { setForm(current => ({ ...current, name: '', pin: '', confirmPin: '' })); setModal('profile') }}><Users size={17} /></button>
            <button className="icon-button" title="Import bank statement" onClick={() => setModal('import')}><FileUp size={17} /></button>
            <button className="icon-button" title="Export report" aria-label="Export report" onClick={openReport}><FileDown size={17} /></button>
            <button className="icon-button" title="More options" aria-label="More options" onClick={() => setModal('more')}><MoreHorizontal size={18} /></button>
            <button className="avatar small-avatar" title={profile.pinHash ? 'Lock profile' : 'Set profile PIN'} aria-label={profile.pinHash ? 'Lock profile' : 'Set profile PIN'} onClick={() => {
              setForm(current => ({ ...current, pin: '', confirmPin: '' }))
              if (profile.pinHash) {
                setLocked(true)
                setModal('pin')
              } else {
                setModal('security')
              }
            }}>{profile.name.slice(0, 1).toUpperCase()}</button>
          </div>
        </header>
        {!locked && legacyRepairCount > 0 && <section className="legacy-repair-banner" role="status">
          <div><strong>Older restore may have inflated transaction amounts</strong><span>Correct {legacyRepairCount} original JSON-imported transactions by converting paise to rupees. Transactions added after the restore will be left unchanged.</span></div>
          <button type="button" className="legacy-repair-button" onClick={repairOldRestoreAmounts}>Correct old amounts</button>
        </section>}

        {locked ? (
          <section className="locked-page"><div className="lock-symbol"><LockKeyhole /></div><span className="eyebrow">PRIVATE PROFILE</span><h1>Welcome back, {profile.name}</h1><p>Your finances are protected on this device.</p><button className="primary-button" onClick={() => { setModal('pin'); setMessage('') }}>Unlock your profile <ArrowUpRight size={16} /></button></section>
        ) : <>
        {page === 'overview' && <>
          <section className="welcome-row">
            <div><span className="eyebrow">{new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date()).toUpperCase()} OVERVIEW</span><h1>A clearer view of<br /><em>your money.</em></h1><p className="welcome-note">Small choices, seen clearly. That’s where better habits begin.</p></div>
            <div className="welcome-actions"><div className="date-pill"><CalendarDays size={15} /> {new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date())}</div><button className="secondary-button" onClick={() => openForm('income')}><Plus size={14} /> Add income</button></div>
          </section>
          <section className="summary-grid">
            <article className="summary-card balance-card"><div className="card-top"><span>AVAILABLE THIS MONTH</span><span className="card-icon"><Wallet size={16} /></span></div><div className="hero-amount">{money(available, hidden)}</div><div className="card-bottom"><span className="status-dot" /> {profile.monthlyIncomeGoal ? 'Based on your monthly goal' : 'Based on recorded income'}</div><div className="balance-decoration" /></article>
            <article className="summary-card"><div className="card-top"><span>SPENT THIS MONTH</span><span className="card-icon coral"><TrendingDown size={16} /></span></div><div className="metric-amount">{money(spent, hidden)}</div><div className="card-bottom">Across {expenses.length} {expenses.length === 1 ? 'transaction' : 'transactions'}</div><div className="mini-progress"><span style={{ width: `${Math.min(100, monthlyBudget ? spent / monthlyBudget * 100 : 0)}%` }} /></div></article>
            <article className="summary-card"><div className="card-top"><span>INCOME RECEIVED</span><span className="card-icon teal"><TrendingUp size={16} /></span></div><div className="metric-amount">{money(earned, hidden)}</div><div className="card-bottom">Across {income.length} {income.length === 1 ? 'deposit' : 'deposits'}</div><div className="income-foot"><ArrowDownLeft size={13} /> Money in</div></article>
          </section>

          <section className="pace-banner">
            <div className="pace-mark"><Sparkles size={17} /></div><div className="pace-copy"><strong>Your daily pace</strong><span>{dailyPace >= 0 ? 'You can spend about' : 'You are over monthly budgets by'} <b>{money(Math.abs(dailyPace), hidden)}{dailyPace >= 0 ? '/day' : ''}</b> for the rest of this month.</span></div><span className="pace-caption">A gentle guide, not a rule.</span>
          </section>
          <section className="quick-entry-card">
            <div className="quick-entry-heading"><strong>Quick add</strong><span>{monthlyInsight}</span></div>
            <form className="quick-entry-form" onSubmit={event => { event.preventDefault(); submitQuickAdd() }}>
              <label className="quick-entry-input"><IndianRupee size={16} /><input aria-label="Quick add transaction" value={quickAddValue} onChange={event => setQuickAddValue(event.target.value)} placeholder="₹120 coffee · Food & dining" /></label>
              <button type="submit" className="primary-button">Add entry <ArrowUpRight size={15} /></button>
            </form>
            <span className="quick-entry-hint">Enter an amount first, then a note and optional category. Use “income” for deposits.</span>
          </section>

          <div className="content-columns">
            <section className="panel category-panel">
                <div className="panel-heading"><div><span className="eyebrow">YOUR PLAN</span><h2>Spending by category</h2></div><button className="text-button" onClick={openSettings}>Edit budgets <ArrowUpRightFromSquare size={13} /></button></div>
              <div className="category-list">{categoryTotals.map(category => {
                const usagePercent = category.monthlyBudget > 0 ? category.spent / category.monthlyBudget * 100 : category.spent > 0 ? 100 : 0
                const percent = Math.min(100, usagePercent)
                return <div className="category-row" key={category.id}><span className="category-dot" style={{ background: category.color }} /><div className="category-info"><div className="category-title"><strong>{category.name}</strong><span>{money(category.spent, hidden)} <i>/ {money(category.monthlyBudget, hidden)}</i></span></div><div className="bar-track"><span style={{ width: `${percent}%`, background: usagePercent > 100 ? 'var(--coral)' : category.color }} /></div></div><span className="category-percent">{Math.round(usagePercent)}%</span></div>
              })}</div>
              <div className="budget-total"><span>MONTHLY BUDGET</span><strong>{money(monthlyBudget, hidden)}</strong></div>
            </section>
            <section className="panel transactions-panel">
              <div className="panel-heading"><div><span className="eyebrow">THE LATEST</span><h2>Recent activity</h2></div><select className="period-select" value={period} onChange={event => setPeriod(event.target.value)}><option value="month">This month</option><option value="all">All time</option></select></div>
              <div className="transaction-filters"><label className="search-box"><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search activity" /></label><label className="filter-select"><Filter size={13} /><select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="all">All categories</option>{categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label></div>
              <div className="activity-list">{recent.length ? recent.map(entry =>
                <ActivityRow key={entry.id} entry={entry} categories={categories} hidden={hidden} onEdit={openEditEntry} onDelete={deleteEntry} />
              ) : <div className="empty-state"><div className="empty-icon"><CircleHelp size={19} /></div><strong>No activity yet</strong><span>Your next step is a small one.</span></div>}</div>
              <div className="table-footer"><span>Showing {recent.length} of {activeEntries.length} entries</span><button className="text-button" onClick={() => setPeriod('all')}>All activity <ArrowUpRightFromSquare size={13} /></button></div>
            </section>
          </div>
          <section className="panel spending-calendar-panel" aria-label="Spending calendar">
            <div className="panel-heading">
              <div><span className="eyebrow">DAILY PATTERN</span><h2>Spending calendar</h2></div>
              <span className="calendar-month">{spendingCalendar.monthLabel}</span>
            </div>
            <div className="calendar-grid" role="group" aria-label="Daily spending this month">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span className="calendar-weekday" key={day}>{day}</span>)}
              {Array.from({ length: spendingCalendar.firstWeekday }, (_, index) => <span className="calendar-spacer" aria-hidden="true" key={`empty-${index}`} />)}
              {spendingCalendar.days.map(day => {
                const level = hidden || calendarMaxSpend === 0 || day.amount === 0 ? 0 : Math.max(1, Math.ceil(day.amount / calendarMaxSpend * 4))
                const spokenAmount = hidden ? 'amount hidden' : money(day.amount, false)
                return <button
                  type="button"
                  className="calendar-day"
                  data-level={level}
                  aria-label={`${day.date}, ${spokenAmount}, ${day.transactionCount} transactions`}
                  aria-pressed={day.date === selectedCalendarDate}
                  key={day.date}
                  onClick={() => setSelectedCalendarDate(day.date)}
                >{day.day}</button>
              })}
            </div>
            <div className="calendar-summary" aria-live="polite">
              <span>{selectedCalendarDay ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(`${selectedCalendarDay.date}T00:00:00`)) : 'Select a day'}</span>
              <strong>{money(selectedCalendarDay?.amount ?? 0, hidden)}</strong>
              <span>{selectedCalendarDay?.transactionCount ?? 0} transactions</span>
            </div>
            <p className="calendar-legend">{hidden ? 'Daily spending amounts are hidden.' : 'Brighter days indicate higher recorded spending.'}</p>
          </section>
        </>}
        {page === 'transactions' && <TransactionsPage
          entries={filteredEntries}
          categories={categories}
          recognizedSearch={searchPlan.recognized}
          searchText={searchPlan.text}
          categoryFilter={categoryFilter}
          hidden={hidden}
          onCategoryChange={setCategoryFilter}
          onDelete={deleteEntry}
          onEdit={openEditEntry}
          onQueryChange={setQuery}
          onPeriodChange={setPeriod}
          onAdd={() => openForm('expense')}
          onReport={openReport}
          period={period}
          query={query}
        />}
        {page === 'budgets' && <BudgetsPage
          categories={categoryTotals}
          hidden={hidden}
          monthlyBudget={monthlyBudget}
          suggestions={budgetSuggestions}
          undo={budgetUndo}
          onApplySuggestion={applyBudgetSuggestion}
          onUndoSuggestion={undoBudgetSuggestion}
          onEdit={openSettings}
        />}
        <footer className="app-footer"><span>Made for a more mindful money life.</span><span><ShieldCheck size={13} /> Your data stays local unless you choose to sync.</span></footer>
        <button className="quick-add" aria-label="Add expense" onClick={() => openForm('expense')}><Plus size={18} /><span>New entry</span></button>
        </>}
      </main>
      {!locked && <nav className="mobile-nav" aria-label="Main navigation">
        <button type="button" className={page === 'overview' ? 'selected' : ''} aria-current={page === 'overview' ? 'page' : undefined} onClick={() => setPage('overview')}><Wallet size={17} /><span>Overview</span></button>
        <button type="button" className={page === 'transactions' ? 'selected' : ''} aria-current={page === 'transactions' ? 'page' : undefined} onClick={() => { setPage('transactions'); setPeriod('all') }}><CreditCard size={17} /><span>Transactions</span></button>
        <button type="button" className={page === 'budgets' ? 'selected' : ''} aria-current={page === 'budgets' ? 'page' : undefined} onClick={() => setPage('budgets')}><Target size={17} /><span>Budgets</span></button>
      </nav>}

      {message && <div className="toast" role="status"><span>{message}</span><button onClick={() => setMessage('')} aria-label="Dismiss"><X size={15} /></button></div>}
      {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null) }}><section className="modal" role="dialog" aria-modal="true">
        <div className="modal-header"><div><span className="eyebrow">{modal === 'expense' || modal === 'income' ? editingEntryId ? 'EDIT TRANSACTION' : 'NEW TRANSACTION' : modal === 'sync' ? 'OPTIONAL CLOUD SYNC' : modal === 'install' ? 'PLUMB ON YOUR PHONE' : modal === 'more' ? 'BACKUP & DEVICE OPTIONS' : modal === 'report' ? 'ON-DEVICE EXPORT' : 'PLUMB · LOCAL & PRIVATE'}</span><h2>{modalTitle(modal, editingEntryId !== null)}</h2></div><button className="icon-button" onClick={closeModal} aria-label="Close"><X size={18} /></button></div>
        {(modal === 'expense' || modal === 'income') && <div className="modal-body">
          <div className="segmented"><button className={form.type === 'expense' ? 'active' : ''} onClick={() => setForm({ ...form, type: 'expense' })}><ArrowUpRight size={15} /> Expense</button><button className={form.type === 'income' ? 'active' : ''} onClick={() => setForm({ ...form, type: 'income', isSplit: false, totalPaid: '' })}><ArrowDownLeft size={15} /> Income</button></div>
          <label className="field"><span>AMOUNT</span><div className="amount-input"><IndianRupee size={18} /><input autoFocus type="number" min="0.01" step="0.01" placeholder="0" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} /></div></label>
          {form.type === 'expense' && <label className="split-toggle"><input type="checkbox" checked={form.isSplit} onChange={event => setForm({ ...form, isSplit: event.target.checked })} /><span><strong>Split this expense</strong><small>Track the portion owed back to you</small></span></label>}
          {form.type === 'expense' && form.isSplit && <><label className="field"><span>TOTAL PAID FOR EVERYONE</span><input type="number" min="0" placeholder={form.amount || '0'} value={form.totalPaid} onChange={event => setForm({ ...form, totalPaid: event.target.value })} /></label><label className="field"><span>WHO OWES YOU?</span><input placeholder="e.g. Roommates · dinner" value={form.owedBy} onChange={event => setForm({ ...form, owedBy: event.target.value })} /></label></>}
          <div className="form-two"><label className="field"><span>CATEGORY</span><select value={form.categoryId} onChange={event => setForm({ ...form, categoryId: event.target.value })}>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="field"><span>DATE</span><input type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></label></div>
          <label className="field"><span>NOTE</span><input placeholder="What was this for?" value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} /></label>
          <label className="field"><span>MERCHANT / UPI ID <i>OPTIONAL</i></span><input placeholder="e.g. cafe@okaxis" value={form.merchantVpa} onChange={event => setForm({ ...form, merchantVpa: event.target.value })} /></label>
          <button className="primary-button wide" onClick={() => saveEntry()}>{editingEntryId ? 'Update' : 'Save'} {form.type} <ArrowUpRight size={16} /></button>
        </div>}
        {modal === 'profile' && <div className="modal-body">
          <span className="field-label">SWITCH PROFILE</span><div className="profile-options">{data.profiles.map(item => <button className={`profile-option ${item.id === activeProfileId ? 'current' : ''}`} onClick={() => void switchProfile(item.id)} key={item.id}><span className="avatar">{item.name.slice(0, 1).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.pinHash ? 'PIN protected' : 'No PIN'}{item.id === activeProfileId ? ' · Current' : ''}</small></span>{item.pinHash ? <LockKeyhole size={15} /> : item.id === activeProfileId ? <Check size={16} /> : null}</button>)}</div>
          <div className="divider" /><label className="field"><span>NEW PROFILE NAME</span><input placeholder="e.g. Shared home" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label className="field"><span>4-DIGIT PIN <i>OPTIONAL</i></span><input inputMode="numeric" type="password" maxLength={4} placeholder="Leave blank for no PIN" value={form.pin} onChange={event => setForm({ ...form, pin: event.target.value.replace(/\D/g, '').slice(0, 4) })} /></label><button className="primary-button wide" onClick={() => void createProfile()}>Create profile <Plus size={16} /></button>
        </div>}
        {modal === 'pin' && <div className="modal-body"><div className="pin-lock"><LockKeyhole size={24} /></div><p className="modal-copy">Enter your 4-digit PIN to unlock <strong>{profile.name}</strong>.</p><label className="field"><span>PROFILE PIN</span><input autoFocus inputMode="numeric" type="password" maxLength={4} placeholder="••••" value={form.pin} onChange={event => setForm({ ...form, pin: event.target.value.replace(/\D/g, '').slice(0, 4) })} onKeyDown={event => { if (event.key === 'Enter') void unlockProfile() }} /></label><button disabled={busy || form.pin.length !== 4} className="primary-button wide" onClick={() => void unlockProfile()}>{busy ? 'Checking…' : 'Unlock profile'} <LockKeyhole size={15} /></button>{profile.biometricCredentialId && <button disabled={busy} className="secondary-button wide" onClick={() => void unlockProfileWithBiometric()}><Fingerprint size={16} /> Unlock with biometrics</button>}<button className="subtle-button" onClick={() => { setForm(current => ({ ...current, pin: '', confirmPin: '' })); setModal('profile') }}><LogOut size={14} /> Switch profile</button></div>}
        {modal === 'security' && <div className="modal-body">
          <div className="security-note"><ShieldCheck size={18} /><span>A four-digit PIN locks this profile. Switching profiles always requires that profile's unlock.</span></div>
          <label className="field"><span>NEW 4-DIGIT PIN</span><input autoFocus inputMode="numeric" type="password" maxLength={4} placeholder="Choose a PIN" value={form.pin} onChange={event => setForm({ ...form, pin: event.target.value.replace(/\D/g, '').slice(0, 4) })} /></label>
          <label className="field"><span>CONFIRM PIN</span><input inputMode="numeric" type="password" maxLength={4} placeholder="Enter it again" value={form.confirmPin} onChange={event => setForm({ ...form, confirmPin: event.target.value.replace(/\D/g, '').slice(0, 4) })} onKeyDown={event => { if (event.key === 'Enter') void enableProfilePin() }} /></label>
          <button disabled={busy || form.pin.length !== 4 || form.confirmPin.length !== 4} className="primary-button wide" onClick={() => void enableProfilePin()}>{busy ? 'Saving…' : 'Enable PIN protection'} <LockKeyhole size={15} /></button>
          <label className="field"><span>AUTO-LOCK AFTER INACTIVITY</span><select value={profile?.idleLockMinutes ?? 0} onChange={event => setIdleLockMinutes(Number(event.target.value))}><option value={0}>Never</option><option value={1}>1 minute</option><option value={5}>5 minutes</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option></select></label>
          {window.PublicKeyCredential && <button type="button" disabled={busy} className="secondary-button wide" onClick={() => void enableBiometricUnlock()}>Enable biometric unlock <Fingerprint size={16} /></button>}
        </div>}
        {modal === 'sync' && <div className="modal-body">
          <div className="security-note"><Cloud size={18} /><span>Sync is optional. Your local data remains available, but a copy is stored in your Supabase account and is readable by that account. Your Plumb PIN is not cloud encryption.</span></div>
          {syncRecovery ? <div className="sync-auth"><label className="field"><span>NEW PASSWORD</span><input autoComplete="new-password" type="password" value={syncNewPassword} onChange={event => setSyncNewPassword(event.target.value)} placeholder="At least 6 characters" /></label><button disabled={busy || syncNewPassword.length < 6} className="primary-button wide" onClick={() => void updateRecoveredPassword()}>Save new password</button><button className="subtle-button" type="button" onClick={() => { setSyncRecovery(false); setSyncNewPassword('') }}>Cancel password recovery</button></div>
          : syncUser ? <>
            <div className="sync-account"><span><strong>Signed in</strong><small>{syncUser.email}</small></span><button className="subtle-button" disabled={busy} onClick={() => void signOutSync()}><LogOut size={14} /> Sign out</button></div>
            {syncConflict ? <div className="sync-conflict" role="alert"><strong>Choose which complete copy to keep</strong><span>This replaces all Plumb profiles and transactions on the other side. Nothing will be merged automatically.</span><div><button disabled={busy} className="secondary-button" onClick={() => void resolveSyncConflict('device')}>Keep this device</button><button disabled={busy} className="secondary-button" onClick={() => void resolveSyncConflict('cloud')}>Use cloud copy</button></div></div>
              : <button disabled={busy || locked || !supabaseClient} className="primary-button wide" onClick={() => void syncNow()}>{busy ? 'Syncing…' : locked ? 'Unlock profile to sync' : 'Sync now'} <RefreshCw size={15} /></button>}
            {syncUpdatedAt && <p className="hint">Last cloud update: {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(syncUpdatedAt))}</p>}
          </> : <form className="sync-auth" onSubmit={event => { event.preventDefault(); void authenticateSync(false) }}>
            <label className="field"><span>SUPABASE ACCOUNT EMAIL</span><input autoComplete="email" type="email" value={syncEmail} onChange={event => setSyncEmail(event.target.value)} placeholder="you@example.com" /></label>
            <label className="field"><span>PASSWORD</span><input autoComplete="current-password" type="password" value={syncPassword} onChange={event => setSyncPassword(event.target.value)} placeholder="Your Supabase account password" /></label>
            <button disabled={busy || !supabaseClient} className="primary-button wide" type="submit">{busy ? 'Signing in…' : 'Sign in'} <Cloud size={15} /></button>
            <button disabled={busy || !supabaseClient} className="subtle-button" type="button" onClick={() => void sendPasswordRecovery()}>Forgot password?</button>
            <button disabled={busy || !supabaseClient} className="subtle-button" type="button" onClick={() => void authenticateSync(true)}>Create a Supabase account</button>
          </form>}
          {syncStatus && <p className="sync-status" role="status">{syncStatus}</p>}
          <p className="hint">After making changes on one device, tap Sync now there and on your phone. If both copies changed, Plumb asks which full copy to keep.</p>
        </div>}
        {modal === 'install' && <div className="modal-body">
          <div className="install-app-icon"><img src="/icons/plumb-192.png" alt="" /></div>
          <p className="modal-copy">Add Plumb to your home screen for a full-screen app experience. Once installed, it can open offline on this device.</p>
          {/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
            ? <ol className="install-steps"><li>Open this page in <strong>Safari</strong>.</li><li>Tap the <strong>Share</strong> button.</li><li>Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</li></ol>
            : <ol className="install-steps"><li>In Chrome, tap the <strong>⋮ menu</strong> at the top-right.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Confirm <strong>Install</strong> or <strong>Add</strong>.</li></ol>}
          {installPrompt && <button className="primary-button wide" onClick={() => void installApp()}>Install Plumb <Download size={15} /></button>}
          <p className="hint">Your data remains stored on this device unless you separately turn on Supabase sync.</p>
        </div>}
        {modal === 'more' && <div className="modal-body more-options">
          <button type="button" onClick={() => setModal('import')}><FileUp size={17} /><span><strong>Import bank statement</strong><small>Upload a CSV, TSV, or PDF bank statement.</small></span><ArrowUpRight size={14} /></button>
          <button type="button" onClick={() => { setForm(current => ({ ...current, passphrase: '' })); setModal('backup') }}><FileDown size={17} /><span><strong>Encrypted backup</strong><small>Save a protected copy of your Plumb data.</small></span><ArrowUpRight size={14} /></button>
          <button type="button" onClick={openReport}><FileDown size={17} /><span><strong>Export a report</strong><small>Filter transactions and save a CSV or PDF.</small></span><ArrowUpRight size={14} /></button>
          <button type="button" onClick={() => { setForm(current => ({ ...current, passphrase: '' })); setModal('restore') }}><FileUp size={17} /><span><strong>Restore backup</strong><small>Load a JSON or encrypted Plumb backup.</small></span><ArrowUpRight size={14} /></button>
          <button type="button" onClick={() => { setSyncStatus(''); setModal('sync') }}><Cloud size={17} /><span><strong>Sync across devices</strong><small>Copy your data to another device with Supabase.</small></span><ArrowUpRight size={14} /></button>
          {!isInstalled && <button type="button" onClick={() => void installApp()}><Download size={17} /><span><strong>Install Plumb</strong><small>Add Plumb to your phone home screen.</small></span><ArrowUpRight size={14} /></button>}
        </div>}
        {modal === 'import' && <div className="modal-body"><p className="modal-copy">Import bank statement data locally. CSV, TSV, SpreadsheetML XML, and text-layer PDF files are supported; transactions are reviewed locally before anything is saved.</p><button className="upload-drop" onClick={() => uploadRef.current?.click()}><FileUp size={21} /><strong>Choose a statement file</strong><span>CSV, TSV, XML spreadsheet, or PDF · processed on your device</span></button><input ref={uploadRef} className="hidden-input" type="file" accept=".csv,.tsv,.xml,.pdf,text/csv,text/tab-separated-values,application/xml,text/xml,application/pdf" onChange={event => { const file = event.target.files?.[0]; if (file) void importStatement(file) }} /><div className="import-divider"><span>OR</span></div><button className="upload-drop" onClick={() => ocrRef.current?.click()}><Sparkles size={21} /><strong>Read a UPI payment screenshot</strong><span>GPay, PhonePe, Paytm, BHIM · OCR runs on-device</span></button><input ref={ocrRef} className="hidden-input" type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void importScreenshot(file) }} /><p className="hint">Expected statement columns include date, description or narration, amount or debit/credit, and optionally UTR/reference.</p></div>}
        {modal === 'backup' && <div className="modal-body"><div className="security-note"><ShieldCheck size={18} /><span>Your backup is encrypted with AES-GCM. Plumb cannot recover a forgotten passphrase.</span></div><label className="field"><span>BACKUP PASSPHRASE</span><input type="password" autoComplete="new-password" placeholder="Use a strong passphrase" value={form.passphrase} onChange={event => setForm({ ...form, passphrase: event.target.value })} /></label><button disabled={busy || form.passphrase.length < 8} className="primary-button wide" onClick={() => void exportBackup()}>{busy ? 'Encrypting…' : 'Download encrypted backup'} <FileDown size={16} /></button><p className="hint">Use at least 8 characters. Keep the passphrase somewhere safe.</p></div>}
        {modal === 'restore' && <div className="modal-body"><div className="security-note"><ShieldCheck size={18} /><span>Restore replaces all profiles and data currently saved in this browser. Version 1 JSON backups are imported without a passphrase; encrypted .plumb backups still need their passphrase.</span></div><label className="field"><span>BACKUP PASSPHRASE <i>FOR .PLUMB FILES</i></span><input type="password" autoComplete="current-password" placeholder="Not needed for JSON backups" value={form.passphrase} onChange={event => setForm({ ...form, passphrase: event.target.value })} /></label><button className="upload-drop" disabled={busy} onClick={() => uploadRef.current?.click()}><FileUp size={21} /><strong>{busy ? 'Restoring…' : 'Choose a JSON or .plumb backup'}</strong><span>Version 1 JSON and encrypted Plumb backups</span></button><input ref={uploadRef} className="hidden-input" type="file" accept=".json,.plumb,application/json,application/octet-stream" onChange={event => { const file = event.target.files?.[0]; if (file) void restoreBackup(file); event.target.value = '' }} /></div>}
        {modal === 'settings' && <div className="modal-body"><p className="modal-copy">Set a monthly income goal and give each category a comfortable spending limit.</p><label className="field"><span>MONTHLY INCOME GOAL <i>OPTIONAL</i></span><input type="number" min="0" placeholder="e.g. 50000" value={form.monthlyGoal} onChange={event => setForm({ ...form, monthlyGoal: event.target.value })} /></label><span className="field-label">CATEGORY BUDGETS</span>{categories.map(category => <label className="budget-edit-row" key={category.id}><span><i style={{ background: category.color }} />{category.name}</span><span className="budget-edit-input"><IndianRupee size={13} /><input type="number" min="0" value={budgetDraft[category.id] ?? ''} onChange={event => setBudgetDraft({ ...budgetDraft, [category.id]: event.target.value })} /></span></label>)}<button className="primary-button wide" onClick={saveSettings}>Save budgets <Check size={15} /></button><button type="button" className="subtle-button" onClick={openReport}><FileDown size={14} /> Export a report</button></div>}
        {modal === 'report' && <div className="modal-body report-builder">
          {busy ? <div className="report-progress" role="status"><div className="loading-spinner" /><strong>Creating your report</strong><span>{reportProgress || 'Preparing your report…'}</span><button className="secondary-button" onClick={closeModal}>Cancel report</button></div> : <>
            <label className="field"><span>1 · TIME PERIOD</span><select value={reportOptions.period} onChange={event => updateReportOptions({ period: event.target.value as ReportPeriod })}><option value="this-month">This month</option><option value="last-month">Last month</option><option value="last-3-months">Last 3 months</option><option value="this-year">This year</option><option value="financial-year">Financial year (April–March)</option><option value="all-time">All time</option><option value="custom">Pick dates</option></select></label>
            {reportOptions.period === 'custom' && <div className="form-two"><label className="field"><span>FROM</span><input type="date" value={reportOptions.fromDate} onChange={event => updateReportOptions({ fromDate: event.target.value })} /></label><label className="field"><span>TO</span><input type="date" value={reportOptions.toDate} onChange={event => updateReportOptions({ toDate: event.target.value })} /></label></div>}
            <label className="field"><span>2 · TYPE</span><select value={reportOptions.type} onChange={event => updateReportOptions({ type: event.target.value as ReportOptions['type'] })}><option value="all">Everything</option><option value="expense">Spending</option><option value="income">Income</option></select></label>
            <fieldset className="report-categories"><legend>3 · CATEGORIES <small>Leave all unticked to include every category</small></legend><div>{categories.map(category => <label key={category.id} className={reportOptions.categoryIds.includes(category.id) ? 'selected' : ''}><input type="checkbox" checked={reportOptions.categoryIds.includes(category.id)} onChange={event => updateReportOptions({ categoryIds: event.target.checked ? [...reportOptions.categoryIds, category.id] : reportOptions.categoryIds.filter(id => id !== category.id) })} /><span>{category.name}</span></label>)}</div></fieldset>
            <div className="form-two report-amounts"><label className="field"><span>4 · MINIMUM (₹)</span><input inputMode="decimal" type="number" min="0" step="0.01" value={reportOptions.minimum} onChange={event => updateReportOptions({ minimum: event.target.value })} placeholder="Any" /></label><label className="field"><span>MAXIMUM (₹)</span><input inputMode="decimal" type="number" min="0" step="0.01" value={reportOptions.maximum} onChange={event => updateReportOptions({ maximum: event.target.value })} placeholder="Any" /></label></div>
            {reportRangeInvalid && <p className="report-validation" role="alert">Enter a valid non-negative range. Minimum must not exceed maximum.</p>}
            {reportDatesInvalid && <p className="report-validation" role="alert">Choose a valid date range with a start date before the end date.</p>}
            <details className="report-more"><summary>5 · MORE OPTIONS</summary>
              <label className="field"><span>DESCRIBE IT IN YOUR OWN WORDS</span><input placeholder="e.g. food last month over 500" onChange={event => describeReport(event.target.value)} /></label>
              <label className="field"><span>ONLY NOTES CONTAINING</span><input value={reportOptions.noteContains} onChange={event => updateReportOptions({ noteContains: event.target.value })} placeholder="Optional words" /></label>
              <label className="field"><span>ORDER</span><select value={reportOptions.order} onChange={event => updateReportOptions({ order: event.target.value as ReportOptions['order'] })}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="largest">Largest first</option><option value="smallest">Smallest first</option></select></label>
              <label className="field"><span>GROUP</span><select value={reportOptions.group} onChange={event => updateReportOptions({ group: event.target.value as ReportOptions['group'] })}><option value="none">No grouping</option><option value="category">By category</option><option value="month">By month</option></select></label>
              <div className="report-sections"><span>INCLUDE SECTIONS</span>{([['summary', 'Summary'], ['categories', 'Category chart'], ['trend', 'Trend chart'], ['budgets', 'Budget against actual'], ['transactions', 'Transaction list']] as [ReportSection, string][]).map(([section, label]) => <label key={section}><input type="checkbox" checked={reportOptions.sections.includes(section)} onChange={() => toggleReportSection(section)} />{label}</label>)}</div>
              <label className="field"><span>REPORT TITLE</span><input maxLength={80} value={reportOptions.title} onChange={event => updateReportOptions({ title: event.target.value })} /></label>
              <label className="report-toggle"><input type="checkbox" checked={reportOptions.hideNotes} onChange={event => updateReportOptions({ hideNotes: event.target.checked })} /><span>Hide my notes for sharing</span></label>
            </details>
            <p className="report-live" aria-live="polite">{reportRangeInvalid || reportDatesInvalid ? 'Fix the highlighted filters to continue.' : `${reportEntries.length.toLocaleString('en-IN')} transactions match. Spending ${money(reportSpent, false)}, income ${money(reportIncome, false)}.`}</p>
            <div className="report-actions"><button className="primary-button" disabled={reportEntries.length === 0 || reportRangeInvalid || reportDatesInvalid} onClick={() => void exportReportPdf()}><FileDown size={15} /> Create PDF</button><button className="secondary-button" disabled={reportEntries.length === 0 || reportRangeInvalid || reportDatesInvalid} onClick={exportReportCsv}><Download size={15} /> Export CSV</button></div>
          </>}
        </div>}
      </section></div>}
      {statementReview && <div className="modal-backdrop statement-review-backdrop" role="dialog" aria-modal="true"><section className="modal statement-review-modal">
        <div className="modal-header"><div><span className="eyebrow">FORENSIC STATEMENT REVIEW</span><h2>{statementReview.summary.rows} transactions found</h2></div><button className="icon-button" aria-label="Close review" onClick={() => setStatementReview(null)}><X size={18} /></button></div>
        <div className="modal-body statement-review">
          <div className={`statement-proof ${statementReview.summary.mismatches ? 'warning' : ''}`}><ShieldCheck size={20} /><div><strong>{statementReview.summary.verifiedByBalance} of {statementReview.summary.rows} rows checked against the statement balance</strong><span>{statementReview.summary.totalsMatch ? 'Opening + credits − debits matches the printed closing balance.' : statementReview.summary.hasRunningBalance ? `${statementReview.summary.mismatches} balance mismatch${statementReview.summary.mismatches === 1 ? '' : 'es'} need review.` : statementReview.summary.warnings[0]}</span></div></div>
          <div className="statement-counts"><span><b>{statementReview.summary.rows}</b> rows</span><span><b>{statementReview.summary.unverified}</b> unverified</span><span><b>{statementReview.rows.filter(row => row.needsCategoryCheck).length}</b> categories to check</span></div>
          <label className="statement-filter"><input type="checkbox" checked={statementOnlyProblems} onChange={event => setStatementOnlyProblems(event.target.checked)} /><span>Show only rows that need a look</span></label>
          <div className="statement-table">
            {statementReview.rows.map(row => (statementOnlyProblems && row.problem === '' && row.verified !== 'unverified' && !row.needsCategoryCheck ? null : <div className={`statement-row ${row.selected ? 'selected' : ''}`} key={row.id}>
              <input type="checkbox" checked={row.selected} disabled={row.problem === 'duplicate' || row.problem === 'paired_reversal'} onChange={event => setStatementReview({ ...statementReview, rows: statementReview.rows.map(item => item.id === row.id ? { ...item, selected: event.target.checked } : item) })} aria-label={`Add ${row.merchant}`} />
              <div className="statement-row-main"><strong>{row.merchant}</strong><span>{row.date} · {row.descriptionRaw}</span>{row.problem && <small className="statement-warning">{row.problem.replace(/_/g, ' ')}</small>}</div>
              <select value={row.category} onChange={event => { setStatementReview(current => current ? { ...current, rows: current.rows.map(item => ((item.merchant === row.merchant || item.id === row.id) ? { ...item, category: event.target.value, needsCategoryCheck: false } : item)) } : current) }}>{['Housing','Groceries','Food out','Transport','Bills','Health','Shopping','Fun','Education','Other','Salary','Allowance','Freelance','Gift','Other income'].map(name => <option key={name}>{name}</option>)}</select>
              <strong className={row.type === 'income' ? 'positive' : ''}>{row.type === 'income' ? '+' : '−'}{money(row.amountMinor / 100, false)}</strong>
            </div>))}
          </div>
        </div>
        <div className="statement-actions"><button className="secondary-button" onClick={() => setStatementReview(null)}>Cancel</button><button className="primary-button" disabled={!statementReview.rows.some(row => row.selected)} onClick={commitStatementReview}>Add {statementReview.rows.filter(row => row.selected).length} entries</button></div>
      </section></div>}
    </div>
  )
}

interface ActivityRowProps {
  entry: Entry
  categories: Category[]
  hidden: boolean
  onEdit: (entry: Entry) => void
  onDelete: (id: string) => void
}

function ActivityRow({ entry, categories, hidden, onEdit, onDelete }: ActivityRowProps) {
  const category = categories.find(item => item.id === entry.categoryId)
  const date = new Date(`${entry.date}T00:00:00`)
  return <div className="activity-row" data-entry-id={entry.id}>
    <div className={`activity-icon ${entry.type}`}><span>{entry.type === 'income' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span></div>
    <div className="activity-description">
      <strong>{entry.note}</strong>
      <span>{category?.name ?? 'Uncategorised'}{entry.isSplit ? ' · Split' : ''} · {new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(date)}</span>
    </div>
    <div className="activity-amount">
      <strong className={entry.type === 'income' ? 'positive' : ''}>{entry.type === 'income' ? '+' : '−'}{money(entry.amount, hidden)}</strong>
      <div className="activity-controls">
        <button className="activity-action edit-entry" title="Edit transaction" aria-label={`Edit ${entry.note}`} onClick={() => onEdit(entry)}><Pencil size={12} /></button>
        <button className="activity-action delete-entry" title="Delete transaction" aria-label={`Delete ${entry.note}`} onClick={() => onDelete(entry.id)}><Trash2 size={12} /></button>
      </div>
    </div>
  </div>
}

interface TransactionsPageProps {
  entries: Entry[]
  categories: Category[]
  recognizedSearch: string[]
  searchText: string
  categoryFilter: string
  hidden: boolean
  onCategoryChange: (categoryId: string) => void
  onEdit: (entry: Entry) => void
  onDelete: (id: string) => void
  onQueryChange: (query: string) => void
  onPeriodChange: (period: string) => void
  onAdd: () => void
  onReport: () => void
  period: string
  query: string
}

function TransactionsPage({
  entries, categories, recognizedSearch, searchText, categoryFilter, hidden, onCategoryChange, onEdit, onDelete, onQueryChange,
  onPeriodChange, onAdd, onReport, period, query,
}: TransactionsPageProps) {
  const totalExpenses = entries.filter(entry => entry.type === 'expense').reduce((sum, entry) => sum + entry.amount, 0)
  const totalIncome = entries.filter(entry => entry.type === 'income').reduce((sum, entry) => sum + entry.amount, 0)
  return <section className="page-section transactions-page">
    <div className="page-title-row">
      <div><span className="eyebrow">YOUR LEDGER</span><h1>Transactions</h1><p>Every expense and deposit, all in one place.</p></div>
      <button className="primary-button" onClick={onAdd}><Plus size={15} /> Add transaction</button>
    </div>
    <div className="transaction-totals">
      <article className="summary-card"><span>EXPENSES SHOWN</span><strong>{money(totalExpenses, hidden)}</strong><small>{entries.filter(entry => entry.type === 'expense').length} transactions</small></article>
      <article className="summary-card"><span>INCOME SHOWN</span><strong>{money(totalIncome, hidden)}</strong><small>{entries.filter(entry => entry.type === 'income').length} deposits</small></article>
      <article className="summary-card"><span>ENTRIES SHOWN</span><strong>{entries.length}</strong><small>Matching current filters</small></article>
    </div>
    <section className="panel ledger-panel">
      <div className="ledger-toolbar">
        <label className="search-box"><Search size={14} /><input aria-label="Search transactions" value={query} onChange={event => onQueryChange(event.target.value)} placeholder="Try “food last month over 500”" /></label>
        <label className="filter-select"><Filter size={13} /><select aria-label="Filter transactions by category" value={categoryFilter} onChange={event => onCategoryChange(event.target.value)}><option value="all">All categories</option>{categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
        <select className="period-select" aria-label="Transaction date range" value={period} onChange={event => onPeriodChange(event.target.value)}><option value="month">This month</option><option value="all">All time</option></select>
        <button type="button" className="text-button report-open-button" onClick={onReport}><FileDown size={14} /> Export report</button>
      </div>
      {(recognizedSearch.length > 0 || searchText) && <div className="search-understood" aria-live="polite" aria-label="Search filters understood">
        <span>Understood:</span>
        {recognizedSearch.map((filter, index) => <span className="search-chip" key={`${filter}-${index}`}>{filter}</span>)}
        {searchText && <span className="search-chip">Notes: {searchText}</span>}
      </div>}
      <div className="ledger-list">
        {entries.length ? entries.map(entry => <ActivityRow key={entry.id} entry={entry} categories={categories} hidden={hidden} onEdit={onEdit} onDelete={onDelete} />)
          : <div className="empty-state"><div className="empty-icon"><CircleHelp size={19} /></div><strong>No matching transactions</strong><span>Try another date range or clear a filter.</span></div>}
      </div>
    </section>
  </section>
}

interface BudgetsPageProps {
  categories: (Category & { spent: number })[]
  hidden: boolean
  monthlyBudget: number
  suggestions: BudgetSuggestion[]
  undo: { categoryId: string; previousBudget: number; appliedBudget: number } | null
  onApplySuggestion: (suggestion: BudgetSuggestion) => void
  onUndoSuggestion: () => void
  onEdit: () => void
}

function BudgetsPage({ categories, hidden, monthlyBudget, suggestions, undo, onApplySuggestion, onUndoSuggestion, onEdit }: BudgetsPageProps) {
  const totalSpent = categories.reduce((sum, category) => sum + category.spent, 0)
  const remainingBudget = monthlyBudget - totalSpent
  return <section className="page-section budgets-page">
    <div className="page-title-row">
      <div><span className="eyebrow">YOUR PLAN</span><h1>Budgets</h1><p>Track this month’s spending against your category limits.</p></div>
      <button className="primary-button" onClick={onEdit}><Settings2 size={15} /> Edit budgets</button>
    </div>
    <div className="budget-overview">
      <article className="summary-card balance-card"><span>MONTHLY LIMITS</span><strong>{money(monthlyBudget, hidden)}</strong><small>Across {categories.length} categories</small></article>
      <article className="summary-card"><span>SPENT THIS MONTH</span><strong>{money(totalSpent, hidden)}</strong><small>{monthlyBudget > 0 ? `${Math.round(totalSpent / monthlyBudget * 100)}% of total budget` : 'Set category budgets to track pace'}</small></article>
      <article className={`summary-card ${remainingBudget < 0 ? 'over-budget-summary' : ''}`}><span>{remainingBudget < 0 ? 'OVER BUDGET' : 'REMAINING'}</span><strong>{money(Math.abs(remainingBudget), hidden)}</strong><small>{remainingBudget < 0 ? 'Above your combined monthly limits' : 'Budget remaining this month'}</small></article>
    </div>
    <section className="panel budget-suggestions" aria-labelledby="budget-suggestions-title">
      <div className="panel-heading"><div><span className="eyebrow">BASED ON YOUR HISTORY</span><h2 id="budget-suggestions-title">Budget suggestions</h2></div>{undo && <button type="button" className="text-button" onClick={onUndoSuggestion}>Undo last change</button>}</div>
      <p className="suggestion-explainer">Suggestions use the previous three complete months of spending, with a small buffer. Nothing changes until you apply a suggestion.</p>
      {suggestions.length > 0 ? <div className="suggestion-list">{suggestions.map(suggestion => {
        const category = categories.find(item => item.id === suggestion.categoryId)
        if (!category) return null
        return <div className="suggestion-row" key={suggestion.categoryId}>
          <div><strong>{category.name}</strong><span>Average {money(suggestion.averageSpend, hidden)} per month · now {money(category.monthlyBudget, hidden)}</span></div>
          <div className="suggestion-action"><strong>{money(suggestion.suggestedBudget, hidden)}</strong><button type="button" className="secondary-button" onClick={() => onApplySuggestion(suggestion)}>Apply</button></div>
        </div>
      })}</div> : <p className="suggestion-empty">Keep recording expenses. A suggestion appears when a category has activity in at least two of the last three full months.</p>}
      {undo && <p className="suggestion-undo-note" role="status">Last suggestion changed {categories.find(category => category.id === undo.categoryId)?.name ?? 'a category'} from {money(undo.previousBudget, hidden)} to {money(undo.appliedBudget, hidden)}.</p>}
    </section>
    <div className="budget-card-list">{categories.map(category => {
      const percent = category.monthlyBudget > 0 ? category.spent / category.monthlyBudget * 100 : category.spent > 0 ? 100 : 0
      const overBudget = category.spent > category.monthlyBudget
      return <article className="panel budget-detail-card" key={category.id}>
        <div className="budget-detail-heading"><span className="category-dot" style={{ background: category.color }} /><div><strong>{category.name}</strong><small>{category.isFixed ? 'Fixed expense' : 'Flexible spending'}</small></div><span className={`budget-state ${overBudget ? 'over' : ''}`}>{category.monthlyBudget === 0 ? 'No limit' : overBudget ? 'Over budget' : 'On track'}</span></div>
        <div className="budget-detail-amounts"><strong>{money(category.spent, hidden)} <i>spent</i></strong><span>{money(category.monthlyBudget, hidden)} budget</span></div>
        <div className="bar-track"><span style={{ width: `${Math.min(100, percent)}%`, background: overBudget ? 'var(--coral)' : category.color }} /></div>
        <div className="budget-detail-footer"><span>{category.monthlyBudget > 0 ? `${Math.round(percent)}% used` : category.spent > 0 ? 'Spending without a budget' : 'Add a monthly limit'}</span><span>{money(Math.max(0, category.monthlyBudget - category.spent), hidden)} remaining</span></div>
      </article>
    })}</div>
  </section>
}

function modalTitle(modal: Modal, editing = false) {
  switch (modal) {
    case 'expense': return editing ? 'Edit expense' : 'Add an expense'
    case 'income': return editing ? 'Edit income' : 'Add income'
    case 'profile': return 'Your profiles'
    case 'pin': return 'Unlock your space'
    case 'security': return 'Protect this profile'
    case 'import': return 'Import statement'
    case 'backup': return 'Create a backup'
    case 'restore': return 'Restore your data'
    case 'settings': return 'Budgets & goals'
    case 'sync': return 'Sync across devices'
    case 'install': return 'Install Plumb'
    case 'more': return 'More options'
    case 'report': return 'Export a report'
    default: return ''
  }
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default App
