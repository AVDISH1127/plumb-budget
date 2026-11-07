import type { Category, Entry } from './storage'

export interface SpendingDay {
  date: string
  day: number
  amount: number
  transactionCount: number
}

export interface SpendingCalendar {
  monthLabel: string
  daysInMonth: number
  firstWeekday: number
  days: SpendingDay[]
}

export interface BudgetSuggestion {
  categoryId: string
  averageSpend: number
  currentBudget: number
  suggestedBudget: number
}

const localDateString = (date: Date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
)

export function getSpendingCalendar(entries: Entry[], referenceDate = new Date()): SpendingCalendar {
  const year = referenceDate.getFullYear()
  const month = referenceDate.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const totals = new Map<number, SpendingDay>()

  entries.forEach(entry => {
    if (entry.type !== 'expense' || !entry.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)) return
    const day = Number(entry.date.slice(8, 10))
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth) return
    const current = totals.get(day) ?? { date: entry.date, day, amount: 0, transactionCount: 0 }
    current.amount += entry.amount
    current.transactionCount += 1
    totals.set(day, current)
  })

  return {
    monthLabel: new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(referenceDate),
    daysInMonth,
    firstWeekday: new Date(year, month, 1).getDay(),
    days: Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1
      return totals.get(day) ?? { date: localDateString(new Date(year, month, day)), day, amount: 0, transactionCount: 0 }
    }),
  }
}

export function getBudgetSuggestions(
  categories: Category[],
  entries: Entry[],
  referenceDate = new Date(),
): BudgetSuggestion[] {
  const previousMonths = Array.from({ length: 3 }, (_, index) => {
    const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - index - 1, 1)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  })
  const spending = new Map<string, Map<string, number>>()

  entries.forEach(entry => {
    const month = entry.date.slice(0, 7)
    if (entry.type !== 'expense' || !previousMonths.includes(month)) return
    const months = spending.get(entry.categoryId) ?? new Map<string, number>()
    months.set(month, (months.get(month) ?? 0) + entry.amount)
    spending.set(entry.categoryId, months)
  })

  return categories.flatMap(category => {
    const monthlySpending = spending.get(category.id)
    if (!monthlySpending || [...monthlySpending.values()].filter(amount => amount > 0).length < 2) return []
    const averageSpend = previousMonths.reduce((sum, month) => sum + (monthlySpending.get(month) ?? 0), 0) / previousMonths.length
    const suggestedBudget = Math.max(100, Math.round((averageSpend * 1.15) / 100) * 100)
    if (Math.abs(suggestedBudget - category.monthlyBudget) < Math.max(100, category.monthlyBudget * 0.1)) return []
    return [{ categoryId: category.id, averageSpend, currentBudget: category.monthlyBudget, suggestedBudget }]
  })
}

export interface QuickAddDraft {
  amount: number
  categoryId: string
  note: string
  type: Entry['type']
}

export function parseQuickAdd(input: string, categories: Category[]): QuickAddDraft | null {
  const match = input.trim().match(/^(?:(income|deposit|expense|spent|paid)\s+)?(?:₹\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?:\s+([\s\S]*))?$/i)
  if (!match || categories.length === 0) return null
  const amount = Number(match[2].replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) return null

  let note = match[3]?.trim() ?? ''
  const category = [...categories]
    .sort((first, second) => second.name.length - first.name.length)
    .find(item => {
      const start = note.toLocaleLowerCase().indexOf(item.name.toLocaleLowerCase())
      if (start < 0) return false
      const end = start + item.name.length
      const isWord = (character: string | undefined) => character !== undefined && /[\p{L}\p{N}]/u.test(character)
      return !isWord(note[start - 1]) && !isWord(note[end])
    }) ?? categories[0]
  const categoryStart = note.toLocaleLowerCase().indexOf(category.name.toLocaleLowerCase())
  if (categoryStart >= 0) {
    note = `${note.slice(0, categoryStart)} ${note.slice(categoryStart + category.name.length)}`
      .replace(/^[\s,·#–—-]+|[\s,·#–—-]+$/g, '')
      .replace(/\s+/g, ' ')
  }

  return {
    amount,
    categoryId: category.id,
    note: note || category.name,
    type: /^(income|deposit)$/i.test(match[1] ?? '') ? 'income' : 'expense',
  }
}
