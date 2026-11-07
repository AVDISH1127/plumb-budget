import type { Category, Entry } from './storage'

export type ReportPeriod = 'this-month' | 'last-month' | 'last-3-months' | 'this-year' | 'financial-year' | 'all-time' | 'custom'
export type ReportType = 'all' | 'expense' | 'income'
export type ReportOrder = 'newest' | 'oldest' | 'largest' | 'smallest'
export type ReportGroup = 'none' | 'category' | 'month'
export type ReportSection = 'summary' | 'categories' | 'trend' | 'budgets' | 'transactions'

export interface ReportOptions {
  period: ReportPeriod
  type: ReportType
  categoryIds: string[]
  minimum: string
  maximum: string
  noteContains: string
  order: ReportOrder
  group: ReportGroup
  sections: ReportSection[]
  title: string
  hideNotes: boolean
  fromDate: string
  toDate: string
}

export interface ReportDateRange {
  from: string | null
  to: string | null
  label: string
}

export interface ReportProgress {
  completed: number
  total: number
}

const localDateString = (date: Date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
)

const shiftMonths = (date: Date, count: number) => new Date(date.getFullYear(), date.getMonth() + count, 1)

export function getReportDateRange(
  period: ReportPeriod,
  fromDate: string,
  toDate: string,
  referenceDate = new Date(),
  financialYearStartMonth = 4,
): ReportDateRange {
  const year = referenceDate.getFullYear()
  const month = referenceDate.getMonth()
  if (period === 'all-time') return { from: null, to: null, label: 'All time' }
  if (period === 'custom') return { from: fromDate || null, to: toDate || null, label: `${fromDate || 'Start'} to ${toDate || 'Today'}` }
  if (period === 'this-month') return {
    from: localDateString(new Date(year, month, 1)),
    to: localDateString(new Date(year, month + 1, 0)),
    label: new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(referenceDate),
  }
  if (period === 'last-month') {
    const lastMonth = shiftMonths(referenceDate, -1)
    return {
      from: localDateString(lastMonth),
      to: localDateString(new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0)),
      label: new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(lastMonth),
    }
  }
  if (period === 'last-3-months') {
    const start = shiftMonths(referenceDate, -2)
    return { from: localDateString(start), to: localDateString(new Date(year, month + 1, 0)), label: 'Last 3 months' }
  }
  if (period === 'this-year') return { from: `${year}-01-01`, to: `${year}-12-31`, label: String(year) }
  const startMonth = Math.min(12, Math.max(1, financialYearStartMonth))
  const startYear = month + 1 >= startMonth ? year : year - 1
  const endYear = startMonth === 1 ? startYear : startYear + 1
  const endMonth = startMonth === 1 ? 12 : startMonth - 1
  return {
    from: `${startYear}-${String(startMonth).padStart(2, '0')}-01`,
    to: localDateString(new Date(endYear, endMonth, 0)),
    label: `Financial year ${startYear}–${endYear}`,
  }
}

export function filterReportEntries(
  entries: Entry[],
  categories: Category[],
  options: ReportOptions,
  dateRange: ReportDateRange,
): Entry[] {
  const minimum = options.minimum.trim() ? Number(options.minimum) : null
  const maximum = options.maximum.trim() ? Number(options.maximum) : null
  const selectedCategories = new Set(options.categoryIds)
  const categoryIds = new Set(categories.map(category => category.id))
  const noteQuery = options.noteContains.trim().toLocaleLowerCase()
  const filtered = entries.filter(entry => {
    if (options.type !== 'all' && entry.type !== options.type) return false
    if (selectedCategories.size > 0 && (!categoryIds.has(entry.categoryId) || !selectedCategories.has(entry.categoryId))) return false
    if (dateRange.from && entry.date < dateRange.from) return false
    if (dateRange.to && entry.date > dateRange.to) return false
    if (minimum !== null && entry.amount < minimum) return false
    if (maximum !== null && entry.amount > maximum) return false
    return !noteQuery || entry.note.toLocaleLowerCase().includes(noteQuery)
  })

  const ordered = filtered.sort((a, b) => {
    if (options.order === 'largest') return b.amount - a.amount || b.date.localeCompare(a.date)
    if (options.order === 'smallest') return a.amount - b.amount || b.date.localeCompare(a.date)
    if (options.order === 'oldest') return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)
    return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
  })

  if (options.group === 'none') return ordered
  const categoryNames = new Map(categories.map(category => [category.id, category.name]))
  const groupKey = (entry: Entry) => options.group === 'category'
    ? categoryNames.get(entry.categoryId) ?? 'Uncategorised'
    : entry.date.slice(0, 7)
  return ordered.sort((a, b) => {
    const groupComparison = groupKey(a).localeCompare(groupKey(b))
    if (groupComparison) return groupComparison
    if (options.order === 'largest') return b.amount - a.amount || b.date.localeCompare(a.date)
    if (options.order === 'smallest') return a.amount - b.amount || b.date.localeCompare(a.date)
    return options.order === 'oldest'
      ? a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)
      : b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
  })
}

function csvCell(value: string | number) {
  let text = String(value)
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function reportCsv(entries: Entry[], categories: Category[], options: ReportOptions) {
  const names = new Map(categories.map(category => [category.id, category.name]))
  const lines = [
    ['Date', 'Type', 'Category', 'Amount (INR)', 'Note', 'Merchant / VPA', 'UTR', 'Fixed', 'Split'].map(csvCell).join(','),
    ...entries.map(entry => [
      entry.date,
      entry.type,
      names.get(entry.categoryId) ?? 'Uncategorised',
      entry.type === 'expense' ? `-${entry.amount.toFixed(2)}` : entry.amount.toFixed(2),
      options.hideNotes ? names.get(entry.categoryId) ?? 'Uncategorised' : entry.note,
      options.hideNotes ? '' : entry.merchantVpa ?? '',
      options.hideNotes ? '' : entry.utrNumber ?? '',
      entry.isFixed ? 'Yes' : 'No',
      entry.isSplit ? 'Yes' : 'No',
    ].map(csvCell).join(','),
    ),
  ]
  return `\uFEFF${lines.join('\r\n')}`
}

const toPdfText = (value: string) => value
  .replace(/[₹]/g, '?')
  .replace(/[^\x20-\x7E]/g, '?')

const moneyText = (amount: number) => `INR ${Math.abs(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dateText = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(year, month - 1, day))
}

export async function createReportPdf(
  entries: Entry[],
  categories: Category[],
  options: ReportOptions,
  dateRange: ReportDateRange,
  profileName: string,
  onProgress?: (progress: ReportProgress) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const document = await PDFDocument.create()
  document.setTitle(options.title.trim() || 'Plumb money report')
  document.setAuthor(profileName)
  document.setSubject(`Personal money report: ${dateRange.label}`)
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const width = 595.28
  const height = 841.89
  const margin = 44
  const color = { ink: rgb(0.08, 0.16, 0.14), muted: rgb(0.34, 0.43, 0.39), mint: rgb(0.12, 0.52, 0.36), coral: rgb(0.72, 0.28, 0.28), line: rgb(0.86, 0.89, 0.87), light: rgb(0.95, 0.97, 0.95) }
  const names = new Map(categories.map(category => [category.id, category.name]))
  const expenses = entries.filter(entry => entry.type === 'expense')
  const income = entries.filter(entry => entry.type === 'income')
  const spent = expenses.reduce((sum, entry) => sum + entry.amount, 0)
  const earned = income.reduce((sum, entry) => sum + entry.amount, 0)
  const dayCount = new Set(entries.map(entry => entry.date)).size || 1
  const totalsByCategory = categories.map(category => ({
    name: category.name,
    spent: expenses.filter(entry => entry.categoryId === category.id).reduce((sum, entry) => sum + entry.amount, 0),
    budget: category.monthlyBudget,
  })).filter(item => item.spent > 0 || item.budget > 0).sort((a, b) => b.spent - a.spent)
  const tallestExpense = expenses.reduce<Entry | null>((largest, entry) => !largest || entry.amount > largest.amount ? entry : largest, null)
  const sections = new Set(options.sections)
  let page = document.addPage()
  page.setSize(width, height)
  let y = height - margin
  let pageNumber = 1

  const drawHeader = (first: boolean) => {
    if (first) {
      page.drawRectangle({ x: margin, y: y - 34, width: 30, height: 30, color: rgb(0.04, 0.18, 0.15) })
      page.drawText('P', { x: margin + 9, y: y - 27, size: 19, font: bold, color: rgb(1, 1, 1) })
      page.drawCircle({ x: margin + 24, y: y - 25, size: 3, color: rgb(0.96, 0.62, 0.08) })
      page.drawText(toPdfText(options.title.trim() || 'Plumb money report'), { x: margin + 42, y: y - 20, size: 18, font: bold, color: color.ink, maxWidth: width - margin * 2 - 50 })
      y -= 52
      page.drawText(toPdfText(`${profileName}  |  ${dateRange.label}`), { x: margin, y, size: 9, font: regular, color: color.muted })
      y -= 15
      const filters = [
        options.type === 'all' ? 'All transaction types' : options.type === 'expense' ? 'Spending only' : 'Income only',
        options.categoryIds.length ? `Categories: ${options.categoryIds.map(id => names.get(id) ?? 'Unknown').join(', ')}` : 'All categories',
        options.minimum ? `Minimum: ${moneyText(Number(options.minimum))}` : '',
        options.maximum ? `Maximum: ${moneyText(Number(options.maximum))}` : '',
        options.noteContains && !options.hideNotes ? `Notes containing: ${options.noteContains}` : '',
        options.hideNotes ? 'Notes hidden' : '',
      ].filter(Boolean).join('  |  ')
      page.drawText(toPdfText(filters), { x: margin, y, size: 8, font: regular, color: color.muted, maxWidth: width - margin * 2 })
      y -= 20
    } else {
      page.drawText(toPdfText(options.title.trim() || 'Plumb money report'), { x: margin, y, size: 10, font: bold, color: color.ink })
      y -= 20
    }
  }

  const drawFooter = () => {
    page.drawLine({ start: { x: margin, y: 29 }, end: { x: width - margin, y: 29 }, thickness: 0.6, color: color.line })
    page.drawText('Made on this device', { x: margin, y: 17, size: 8, font: regular, color: color.muted })
    page.drawText(`Page ${pageNumber}`, { x: width - margin - 48, y: 17, size: 8, font: regular, color: color.muted })
  }

  const nextPage = () => {
    drawFooter()
    page = document.addPage()
    page.setSize(width, height)
    pageNumber += 1
    y = height - margin
    drawHeader(false)
  }

  const ensureSpace = (needed: number) => {
    if (y - needed < 48) nextPage()
  }

  const sectionHeading = (title: string) => {
    ensureSpace(25)
    page.drawText(toPdfText(title), { x: margin, y, size: 12, font: bold, color: color.ink })
    y -= 18
  }

  const drawTableHeader = () => {
    page.drawRectangle({ x: margin, y: y - 16, width: width - margin * 2, height: 19, color: color.light })
    page.drawText('Date', { x: margin + 5, y: y - 11, size: 8, font: bold, color: color.ink })
    page.drawText('Category / note', { x: margin + 78, y: y - 11, size: 8, font: bold, color: color.ink })
    page.drawText('Amount', { x: width - margin - 85, y: y - 11, size: 8, font: bold, color: color.ink })
    y -= 22
  }

  drawHeader(true)

  if (sections.has('summary')) {
    sectionHeading('Summary')
    const summaryLines = [
      `Income: ${moneyText(earned)}`,
      `Spending: ${moneyText(spent)}`,
      `Net: ${moneyText(earned - spent)}`,
      `Transactions: ${entries.length}`,
      `Average spending per day: ${moneyText(spent / dayCount)}`,
      `Largest expense: ${tallestExpense ? `${moneyText(tallestExpense.amount)} (${names.get(tallestExpense.categoryId) ?? 'Uncategorised'})` : 'None'}`,
    ]
    for (const summary of summaryLines) {
      ensureSpace(14)
      page.drawText(toPdfText(summary), { x: margin, y, size: 9, font: regular, color: color.ink })
      y -= 13
    }
    y -= 8
  }

  if (sections.has('categories')) {
    sectionHeading('Category spending')
    for (const item of totalsByCategory.slice(0, 10)) {
      ensureSpace(18)
      const percent = spent > 0 ? item.spent / spent : 0
      const text = `${item.name}: ${moneyText(item.spent)} (${Math.round(percent * 100)}%)`
      page.drawText(toPdfText(text), { x: margin, y, size: 8, font: regular, color: color.ink })
      const barX = margin + 260
      page.drawRectangle({ x: barX, y: y - 2, width: 195, height: 7, color: color.light })
      if (percent > 0) page.drawRectangle({ x: barX, y: y - 2, width: 195 * Math.min(1, percent), height: 7, color: color.mint })
      y -= 14
    }
    y -= 8
  }

  if (sections.has('trend')) {
    sectionHeading('Spending trend')
    const byMonth = new Map<string, number>()
    for (const entry of expenses) byMonth.set(monthKey(entry.date), (byMonth.get(monthKey(entry.date)) ?? 0) + entry.amount)
    const trends = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
    const max = Math.max(...trends.map(([, amount]) => amount), 1)
    for (const [month, amount] of trends) {
      ensureSpace(18)
      const barX = margin + 100
      page.drawText(toPdfText(month), { x: margin, y, size: 8, font: regular, color: color.ink })
      page.drawRectangle({ x: barX, y: y - 2, width: 340, height: 8, color: color.light })
      page.drawRectangle({ x: barX, y: y - 2, width: 340 * amount / max, height: 8, color: color.mint })
      page.drawText(toPdfText(moneyText(amount)), { x: barX + 345, y, size: 7, font: regular, color: color.muted })
      y -= 15
    }
    y -= 8
  }

  if (sections.has('budgets')) {
    sectionHeading('Budget against actual')
    const months = Math.max(1, new Set(entries.map(entry => monthKey(entry.date))).size)
    for (const item of totalsByCategory) {
      ensureSpace(16)
      page.drawText(toPdfText(`${item.name}: ${moneyText(item.spent)} spent / ${moneyText(item.budget * months)} budget`), { x: margin, y, size: 8, font: regular, color: color.ink })
      y -= 13
    }
    y -= 8
  }

  if (sections.has('transactions')) {
    sectionHeading(`Transactions (${entries.length})`)
    drawTableHeader()
    const categoryName = (entry: Entry) => names.get(entry.categoryId) ?? 'Uncategorised'
    let activeGroup = ''
    let zebra = false
    let groupSpend = 0
    let groupIncome = 0
    const flushGroup = () => {
      if (!activeGroup || options.group === 'none') return
      ensureSpace(15)
      page.drawText(toPdfText(`${activeGroup} subtotal  |  Spending ${moneyText(groupSpend)}  |  Income ${moneyText(groupIncome)}`), { x: margin + 5, y, size: 7, font: bold, color: color.muted, maxWidth: width - margin * 2 - 10 })
      y -= 13
      groupSpend = 0
      groupIncome = 0
    }
    for (let index = 0; index < entries.length; index += 1) {
      if (signal?.aborted) throw new DOMException('Report generation was cancelled.', 'AbortError')
      const entry = entries[index]
      const group = options.group === 'category' ? categoryName(entry) : options.group === 'month' ? monthKey(entry.date) : ''
      if (options.group !== 'none' && group !== activeGroup) {
        flushGroup()
        activeGroup = group
        ensureSpace(21)
        page.drawText(toPdfText(group), { x: margin, y, size: 9, font: bold, color: color.mint })
        y -= 13
      }
      if (y - 17 < 48) {
        drawFooter()
        page = document.addPage()
        page.setSize(width, height)
        pageNumber += 1
        y = height - margin
        drawHeader(false)
        drawTableHeader()
      }
      if (zebra) page.drawRectangle({ x: margin, y: y - 4, width: width - margin * 2, height: 16, color: color.light })
      zebra = !zebra
      const label = options.hideNotes ? categoryName(entry) : entry.note
      page.drawText(toPdfText(dateText(entry.date)), { x: margin + 5, y, size: 7, font: regular, color: color.ink })
      page.drawText(toPdfText(`${categoryName(entry)} | ${label}`), { x: margin + 78, y, size: 7, font: regular, color: color.ink, maxWidth: width - margin * 2 - 180 })
      page.drawText(toPdfText(`${entry.type === 'expense' ? '-' : '+'}${moneyText(entry.amount)}`), { x: width - margin - 85, y, size: 7, font: regular, color: entry.type === 'income' ? color.mint : color.coral })
      y -= 16
      if (entry.type === 'expense') groupSpend += entry.amount
      else groupIncome += entry.amount
      if ((index + 1) % 100 === 0) {
        onProgress?.({ completed: index + 1, total: entries.length })
        await new Promise<void>(resolve => setTimeout(resolve, 0))
      }
    }
    flushGroup()
    ensureSpace(30)
    page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 0.6, color: color.line })
    page.drawText(toPdfText(`Total spending: ${moneyText(spent)}    Total income: ${moneyText(earned)}`), { x: margin + 5, y: y - 8, size: 8, font: bold, color: color.ink })
  }

  drawFooter()
  onProgress?.({ completed: entries.length, total: entries.length })
  return document.save()
}

export function csvCellForTest(value: string | number) {
  return csvCell(value)
}

export function monthKey(date: string) {
  return date.slice(0, 7)
}
