export interface SearchCategory {
  id: string
  name: string
}

export interface MagicSearchPlan {
  text: string
  type: 'expense' | 'income' | null
  categoryId: string | null
  minAmount: number | null
  maxAmount: number | null
  minExclusive: boolean
  maxExclusive: boolean
  startDate: string | null
  endDate: string | null
  sort: 'newest' | 'oldest' | 'largest' | 'smallest'
  limit: number | null
  hasDateFilter: boolean
  recognized: string[]
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

const CATEGORY_ALIASES: Record<string, string[]> = {
  'food & dining': ['food', 'dining', 'restaurant', 'restaurants', 'cafe', 'cafes', 'takeaway', 'groceries', 'grocery'],
  transport: ['travel', 'commute', 'fuel', 'petrol', 'bus', 'train', 'metro'],
  housing: ['rent', 'house', 'home'],
  shopping: ['shop', 'shopping', 'purchase'],
  'bills & utilities': ['bill', 'bills', 'electricity', 'utilities', 'recharge'],
  groceries: ['grocery', 'groceries', 'grocery shopping'],
  health: ['medical', 'medicine', 'health'],
  entertainment: ['fun', 'entertainment', 'movie', 'movies'],
}

const localDateString = (date: Date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
)

const dateAt = (year: number, month: number, day: number) => {
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? localDateString(date)
    : null
}

const monthEnd = (year: number, month: number) => new Date(year, month, 0).getDate()

function amountValue(raw: string, suffix = '') {
  const value = Number(raw.replace(/,/g, ''))
  const multiplier = /^(k|thousand)$/i.test(suffix) ? 1_000
    : /^(l|lakh|lakhs)$/i.test(suffix) ? 100_000
      : /^(cr|crore|crores)$/i.test(suffix) ? 10_000_000 : 1
  const amount = value * multiplier
  return Number.isFinite(amount) ? amount : null
}

function monthNumber(value: string) {
  return MONTHS[value.toLowerCase()] ?? null
}

function parseDayMonth(dayText: string, monthText: string, yearText: string | undefined, reference: Date) {
  const day = Number(dayText)
  const month = monthNumber(monthText)
  if (!month || day < 1 || day > 31) return null
  const year = yearText ? Number(yearText) : reference.getFullYear()
  return dateAt(year, month, day)
}

function addMonthsClamped(date: Date, months: number) {
  const targetMonth = date.getMonth() + months
  const year = date.getFullYear() + Math.floor(targetMonth / 12)
  const monthIndex = ((targetMonth % 12) + 12) % 12
  return new Date(year, monthIndex, Math.min(date.getDate(), monthEnd(year, monthIndex + 1)))
}

function removeMatches(value: string, pattern: RegExp) {
  return value.replace(pattern, ' ')
}

export function parseMagicSearch(
  input: string,
  categories: SearchCategory[],
  referenceDate = new Date(),
  financialYearStartMonth = 4,
): MagicSearchPlan {
  let remaining = input.toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').trim()
  let startDate: string | null = null
  let endDate: string | null = null
  let minAmount: number | null = null
  let maxAmount: number | null = null
  let minExclusive = false
  let maxExclusive = false
  let type: MagicSearchPlan['type'] = null
  let categoryId: string | null = null
  let sort: MagicSearchPlan['sort'] = 'newest'
  let limit: number | null = null
  const recognized: string[] = []
  const today = localDateString(referenceDate)

  const setRange = (start: string, end: string, label: string) => {
    startDate = start
    endDate = end
    recognized.push(label)
  }
  const removeDate = (pattern: RegExp) => { remaining = removeMatches(remaining, pattern) }

  const dayRange = (date: Date, label: string) => {
    const value = localDateString(date)
    setRange(value, value, label)
  }
  if (/\btoday\b/.test(remaining)) {
    dayRange(referenceDate, 'Today')
    removeDate(/\btoday\b/g)
  } else if (/\byesterday\b/.test(remaining)) {
    const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate() - 1)
    dayRange(date, 'Yesterday')
    removeDate(/\byesterday\b/g)
  }

  const weekStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate())
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6)
  if (/\b(last|previous)\s+week\b/.test(remaining)) {
    const end = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 1)
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6)
    setRange(localDateString(start), localDateString(end), 'Last week')
    removeDate(/\b(last|previous)\s+week\b/g)
  } else if (/\b(this|current)\s+week\b/.test(remaining)) {
    setRange(localDateString(weekStart), localDateString(weekEnd), 'This week')
    removeDate(/\b(this|current)\s+week\b/g)
  }

  const explicitRange = remaining.match(/\b(?:from|between)\s+(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?\s+(?:to|and)\s+(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?\b/)
  if (explicitRange) {
    const start = parseDayMonth(explicitRange[1], explicitRange[2], explicitRange[3], referenceDate)
    const end = parseDayMonth(explicitRange[4], explicitRange[5], explicitRange[6] ?? explicitRange[3], referenceDate)
    if (start && end) {
      const adjustedEnd = end < start && !explicitRange[6] && !explicitRange[3]
        ? parseDayMonth(explicitRange[4], explicitRange[5], String(referenceDate.getFullYear() + 1), referenceDate)
        : end
      setRange(start, adjustedEnd ?? end, `From ${start} to ${adjustedEnd ?? end}`)
      removeDate(/\b(?:from|between)\s+\d{1,2}\s+[a-z]{3,9}(?:\s+\d{4})?\s+(?:to|and)\s+\d{1,2}\s+[a-z]{3,9}(?:\s+\d{4})?\b/g)
    }
  } else {
    const sinceRange = remaining.match(/\bsince\s+(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?\b/)
    if (sinceRange) {
      const start = parseDayMonth(sinceRange[1], sinceRange[2], sinceRange[3], referenceDate)
      if (start) {
        setRange(start, '9999-12-31', `Since ${start}`)
        removeDate(/\bsince\s+\d{1,2}\s+[a-z]{3,9}(?:\s+\d{4})?\b/g)
      }
    }
  }

  const relativeRange = remaining.match(/\blast\s+(\d{1,3})\s+(days?|weeks?|months?)\b/)
  if (relativeRange) {
    const count = Number(relativeRange[1])
    const unit = relativeRange[2]
    if (count > 0) {
      const start = unit.startsWith('day')
        ? new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate() - count + 1)
        : unit.startsWith('week')
          ? new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate() - count * 7 + 1)
          : addMonthsClamped(referenceDate, -count)
      setRange(localDateString(start), today, `Last ${count} ${unit}`)
      removeDate(/\blast\s+\d{1,3}\s+days?\b|\blast\s+\d{1,3}\s+weeks?\b|\blast\s+\d{1,3}\s+months?\b/g)
    }
  }

  if (/\b(last|previous)\s+month\b/.test(remaining)) {
    const first = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1)
    const last = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 0)
    setRange(localDateString(first), localDateString(last), 'Last month')
    removeDate(/\b(last|previous)\s+month\b/g)
  } else if (/\b(this|current)\s+month\b/.test(remaining)) {
    setRange(localDateString(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1)), localDateString(new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0)), 'This month')
    removeDate(/\b(this|current)\s+month\b/g)
  }

  if (/\b(last|previous)\s+year\b/.test(remaining) && !/\bfinancial\s+year\b/.test(remaining)) {
    const year = referenceDate.getFullYear() - 1
    setRange(`${year}-01-01`, `${year}-12-31`, 'Last year')
    removeDate(/\b(last|previous)\s+year\b/g)
  } else if (/\b(this|current)\s+year\b/.test(remaining) && !/\bfinancial\s+year\b/.test(remaining)) {
    const year = referenceDate.getFullYear()
    setRange(`${year}-01-01`, `${year}-12-31`, 'This year')
    removeDate(/\b(this|current)\s+year\b/g)
  }

  const financialYear = remaining.match(/\b(last|previous|this|current)?\s*financial\s+year\b/)
  if (financialYear) {
    const startMonth = Math.min(12, Math.max(1, financialYearStartMonth))
    let year = referenceDate.getFullYear()
    if (referenceDate.getMonth() + 1 < startMonth) year--
    if (/last|previous/.test(financialYear[1] ?? '')) year--
    const endYear = year + (startMonth === 1 ? 0 : 1)
    setRange(`${year}-${String(startMonth).padStart(2, '0')}-01`, `${endYear}-${String(startMonth === 1 ? 12 : startMonth - 1).padStart(2, '0')}-${monthEnd(endYear, startMonth === 1 ? 12 : startMonth - 1)}`, `${financialYear[1] === 'last' || financialYear[1] === 'previous' ? 'Last' : 'This'} financial year`)
    removeDate(/\b(?:(?:last|previous|this|current)\s+)?financial\s+year\b/g)
  }

  const yearMatch = remaining.match(/\bin\s+(20\d{2})\b/)
  if (yearMatch) {
    const year = Number(yearMatch[1])
    setRange(`${year}-01-01`, `${year}-12-31`, yearMatch[1])
    removeDate(/\bin\s+20\d{2}\b/g)
  }

  const monthMatch = remaining.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)(?:\s+(20\d{2}))?\b/)
  if (monthMatch && !new RegExp(`\\b\\d{1,2}\\s+${monthMatch[1]}\\b`).test(remaining)) {
    const month = monthNumber(monthMatch[1])
    const year = Number(monthMatch[2] ?? referenceDate.getFullYear())
    if (month) {
      setRange(`${year}-${String(month).padStart(2, '0')}-01`, `${year}-${String(month).padStart(2, '0')}-${monthEnd(year, month)}`, new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1)))
      removeDate(/\b(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)(?:\s+20\d{2})?\b/g)
    }
  }

  const singleDate = remaining.match(/\b(\d{1,2})\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)(?:\s+(20\d{2}))?\b/)
  if (singleDate) {
    const date = parseDayMonth(singleDate[1], singleDate[2], singleDate[3], referenceDate)
    if (date) {
      setRange(date, date, date)
      removeDate(/\b\d{1,2}\s+(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)(?:\s+20\d{2})?\b/g)
    }
  }

  const isoDate = remaining.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (isoDate) {
    const date = dateAt(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]))
    if (date) {
      setRange(date, date, date)
      removeDate(/\b20\d{2}-\d{2}-\d{2}\b/g)
    }
  }

  const rangeAmount = remaining.match(/\bbetween\s+(?:₹|rs\.?\s*)?([\d,]+(?:\.\d{1,2})?)\s*(k|thousand|lakh|lakhs|l|crore|crores|cr)?\s+and\s+(?:₹|rs\.?\s*)?([\d,]+(?:\.\d{1,2})?)\s*(k|thousand|lakh|lakhs|l|crore|crores|cr)?\b/)
  if (rangeAmount) {
    minAmount = amountValue(rangeAmount[1], rangeAmount[2] ?? '')
    maxAmount = amountValue(rangeAmount[3], rangeAmount[4] ?? '')
    if (minAmount !== null && maxAmount !== null) {
      recognized.push(`₹${minAmount.toLocaleString('en-IN')}–₹${maxAmount.toLocaleString('en-IN')}`)
      remaining = removeMatches(remaining, /\bbetween\s+(?:₹|rs\.?\s*)?[\d,]+(?:\.\d{1,2})?\s*(?:k|thousand|lakh|lakhs|l|crore|crores|cr)?\s+and\s+(?:₹|rs\.?\s*)?[\d,]+(?:\.\d{1,2})?\s*(?:k|thousand|lakh|lakhs|l|crore|crores|cr)?\b/g)
    } else {
      minAmount = null
      maxAmount = null
    }
  } else {
    const amountMatch = remaining.match(/\b(over|above|more than|greater than|at least|under|below|less than|at most)\s+(?:₹|rs\.?\s*)?([\d,]+(?:\.\d{1,2})?)\s*(k|thousand|lakh|lakhs|l|crore|crores|cr)?\b|([<>]=?)\s*(?:₹|rs\.?\s*)?([\d,]+(?:\.\d{1,2})?)\s*(k|thousand|lakh|lakhs|l|crore|crores|cr)?/i)
    if (amountMatch) {
      const amount = amountValue(amountMatch[2] ?? amountMatch[5], amountMatch[3] ?? amountMatch[6] ?? '')
      const operator = amountMatch[1]?.toLowerCase() ?? amountMatch[4]
      if (amount !== null) {
        if (['over', 'above', 'more than', 'greater than', '>', 'at least', '>='].includes(operator)) {
          minAmount = amount
          minExclusive = !['at least', '>='].includes(operator)
        } else {
          maxAmount = amount
          maxExclusive = !['at most', '<='].includes(operator)
        }
        const label = minAmount !== null
          ? `${['at least', '>='].includes(operator) ? 'At least' : 'Over'} ₹${amount.toLocaleString('en-IN')}`
          : `${['at most', '<='].includes(operator) ? 'At most' : 'Under'} ₹${amount.toLocaleString('en-IN')}`
        recognized.push(label)
        remaining = removeMatches(remaining, amountMatch[0] ? new RegExp(amountMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : /$^/)
      }
    }
  }

  const top = remaining.match(/\btop\s+(\d{1,3})\b/)
  if (top) {
    limit = Math.max(1, Math.min(1_000, Number(top[1])))
    sort = 'largest'
    recognized.push(`Top ${limit}`)
    remaining = removeMatches(remaining, /\btop\s+\d{1,3}\b/g)
  }
  const orderMatch = remaining.match(/\b(biggest|largest|highest|smallest|lowest|latest|newest|recent|oldest|earliest)\b/)
  if (orderMatch) {
    const word = orderMatch[1]
    sort = /biggest|largest|highest/.test(word) ? 'largest'
      : /smallest|lowest/.test(word) ? 'smallest'
        : /oldest|earliest/.test(word) ? 'oldest' : 'newest'
    recognized.push(({ largest: 'Largest first', smallest: 'Smallest first', oldest: 'Oldest first', newest: 'Newest first' })[sort])
    remaining = removeMatches(remaining, /\b(?:biggest|largest|highest|smallest|lowest|latest|newest|recent|oldest|earliest)\b/g)
  }

  if (/\b(income|received|refund|deposit|deposits|salary|allowance|freelance)\b/.test(remaining)) {
    type = 'income'
    recognized.push('Income')
    remaining = removeMatches(remaining, /\b(?:income|received|refund|deposit|deposits|salary|allowance|freelance)\b/g)
  } else if (/\b(expense|expenses|spent|spending|purchase|purchases|paid)\b/.test(remaining)) {
    type = 'expense'
    recognized.push('Spending')
    remaining = removeMatches(remaining, /\b(?:expense|expenses|spent|spending|purchase|purchases|paid)\b/g)
  }

  const categoryCandidates = categories.flatMap(category => {
    const normalizedName = category.name.toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const aliases = CATEGORY_ALIASES[category.name.toLowerCase()] ?? []
    return [...new Set([normalizedName, ...aliases])].map(term => ({ category, term }))
  }).sort((a, b) => b.term.length - a.term.length)
  for (const candidate of categoryCandidates) {
    const escaped = candidate.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    const match = remaining.match(new RegExp(`(^|\\s)${escaped}(?=$|\\s)`, 'i'))
    if (!match) continue
    categoryId = candidate.category.id
    recognized.push(candidate.category.name)
    for (const categoryTerm of categoryCandidates.filter(item => item.category.id === categoryId)) {
      const categoryPattern = categoryTerm.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
      remaining = remaining.replace(new RegExp(`(^|\\s)${categoryPattern}(?=$|\\s)`, 'i'), ' ')
    }
    break
  }

  remaining = removeMatches(remaining, /\b(?:in|on|at|for|the|of|my|a|an|and|or|show|find|me|transactions?|entries|entry)\b/g)
    .replace(/[^\p{L}\p{N}@._-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!recognized.length) {
    if (startDate || endDate) recognized.push(`${startDate ?? ''} – ${endDate ?? ''}`)
  }

  return {
    text: remaining,
    type,
    categoryId,
    minAmount,
    maxAmount,
    minExclusive,
    maxExclusive,
    startDate,
    endDate,
    sort,
    limit,
    hasDateFilter: Boolean(startDate || endDate),
    recognized,
  }
}
