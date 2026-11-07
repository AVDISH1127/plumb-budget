import Papa from 'papaparse'

export interface StatementReviewRow {
  id: string
  date: string
  type: 'expense' | 'income'
  amountMinor: number
  balanceMinor: number | null
  descriptionRaw: string
  merchant: string
  category: string
  needsCategoryCheck: boolean
  upiRef: string
  verified: 'balance' | 'column' | 'suffix' | 'guess' | 'unverified'
  problem: '' | 'balance_mismatch' | 'direction_guess' | 'paired_reversal' | 'duplicate'
  page: number
  selected: boolean
}

export interface StatementImportSummary {
  rows: number
  verifiedByBalance: number
  unverified: number
  mismatches: number
  openingMinor: number | null
  closingMinor: number | null
  totalDebitsMinor: number
  totalCreditsMinor: number
  totalsMatch: boolean
  dateFrom: string
  dateTo: string
  orderDetected: 'oldest_first' | 'newest_first' | 'unknown'
  hasRunningBalance: boolean
  currency: string
  warnings: string[]
}

export interface StatementReview {
  rows: StatementReviewRow[]
  summary: StatementImportSummary
}

const cleanSpaces = (value: string) => value.replace(/\s+/g, ' ').trim()
const rupeeToMinor = (value: string | number): number => {
  const raw = String(value).replace(/[₹$€£,\s]/gi, '').replace(/\((cr|dr)\)$/i, '').replace(/(cr|dr)$/i, '')
  const n = Number(raw)
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : 0
}
const parseMinorText = (value: string): number => rupeeToMinor(value)

const parseDate = (value: string): string | null => {
  const trimmed = value.trim()
  let match = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  match = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/)
  if (match) {
    const first = Number(match[1]), second = Number(match[2])
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
    const dayFirst = first <= 31 && second <= 12
    const day = dayFirst ? first : second
    const month = dayFirst ? second : first
    const date = new Date(year, month - 1, day)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const months: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
  match = trimmed.match(/^(\d{1,2})[- ]([A-Za-z]{3,9})[- ](?:'(\d{2})|(\d{4}))$/)
  if (match) {
    const month = months[match[2].slice(0, 3).toLowerCase()]
    const year = match[4] ? Number(match[4]) : 2000 + Number(match[3])
    return month ? `${year}-${String(month).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}` : null
  }
  match = trimmed.match(/^([A-Za-z]{3,9}) (\d{1,2}), (\d{4})$/)
  if (match) {
    const month = months[match[1].slice(0, 3).toLowerCase()]
    return month ? `${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}` : null
  }
  return null
}

export const normalizeMerchant = (raw: string) => {
  let text = cleanSpaces(raw)
  text = text.replace(/(?:UPIAR|UPIAB|UPI|P2M|P2A|NEFT|IMPS|RTGS|ACH|NACH|POS|ECOM|ATM|PAYMENT|TRANSFER|BILLPAY|BILLDESK|REV|DR|CR)(?:\/|:|-|\b)/gi, ' ')
  text = text.replace(/[^\w@.& -]/g, ' / ').replace(/\b[\w.-]+@[\w.-]+\b/g, ' ').replace(/\b(?:[A-Z]{4}0[A-Z0-9]{6}|YESB|HDFC000\d+|UTIB\d+|SBIN\d+|ICIC\d+|KKBK\d+)\b/gi, ' ')
  text = text.replace(/(?:\b\d{10,}\b|\bT\d{15,24}\b)/gi, ' ').replace(/\b4\d{3}X+\d{4}\b/gi, ' ')
  text = text.split(/\s[-/]\s|\/| \- /).filter(Boolean)[0] || text
  text = cleanSpaces(text)
  if (!text || /^\d+$/.test(text)) return 'UPI payment'
  return text.replace(/\w+/g, word => word.length <= 3 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()).replace(/\b(Upi|Atm|Neft|Imps)\b/g, '').trim() || 'UPI payment'
}

const categoryFor = (merchant: string, type: 'expense' | 'income', rules: Record<string, string>): string => {
  const remembered = rules[merchant.toLowerCase()]
  if (remembered) return remembered
  const name = merchant.toLowerCase()
  if (type === 'income') {
    if (/salary|payroll|stipend/.test(name)) return 'Salary'
    if (/interest/.test(name)) return 'Other income'
    if (/refund/.test(name)) return 'Other income'
    if (/cashback/.test(name)) return 'Other income'
    return 'Other income'
  }
  if (/atm|cash withdrawal/.test(name)) return 'Other'
  if (/swiggy|zomato|domino|mcdonald/.test(name)) return 'Food out'
  if (/blinkit|bigbasket|dmart|jiomart|grofer/.test(name)) return 'Groceries'
  if (/uber|ola|rapido|irctc|redbus|msrtc|fastag|fuel/.test(name)) return 'Transport'
  if (/rent/.test(name)) return 'Housing'
  if (/electricity|airtel|jio|broadband|lic|emi|loan/.test(name)) return 'Bills'
  if (/apollo|pharmacy|hospital/.test(name)) return 'Health'
  if (/amazon|flipkart|myntra|zudio|decathlon/.test(name)) return 'Shopping'
  if (/netflix|hotstar|bookmyshow|google play/.test(name)) return 'Fun'
  if (/course|book|tuition/.test(name)) return 'Education'
  return 'Other'
}

const moneyFromCell = (value: string) => {
  const match = value.replace(/,/g, '').match(/(?:₹|rs\.?|inr)?\s*(?:[-]?\d+(?:\.\d{1,2})?)/i)
  return match ? parseMinorText(match[0]) : 0
}

export async function parseCsvStatement(text: string, existingEntries: Array<{ utrNumber?: string; date: string; amount: number; type: string }> = [], merchantRules: Record<string, string> = {}): Promise<StatementReview> {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: header => header.trim().toLowerCase() })
  if (parsed.errors.length) throw new Error(`Could not parse statement: ${parsed.errors[0].message}`)
  const rows: StatementReviewRow[] = []
  let openingMinor: number | null = null
  let closingMinor: number | null = null
  for (const row of parsed.data) {
    const field = (...names: string[]) => {
      const key = Object.keys(row).find(header => names.some(name => header.includes(name)))
      return key ? String(row[key] ?? '').trim() : ''
    }
    const description = field('description', 'narration', 'merchant', 'payee', 'particular')
    const date = parseDate(field('transaction date', 'value date', 'date'))
    if (!description || !date) continue
    const debit = field('debit', 'withdrawal')
    const credit = field('credit', 'deposit')
    const amountText = field('amount') || debit || credit
    const amountMinor = moneyFromCell(amountText)
    if (!amountMinor) continue
    const suffix = `${amountText} ${field('type', 'dr/cr')}`.toLowerCase()
    const type: 'expense' | 'income' = debit && !credit ? 'expense' : credit && !debit ? 'income' : /(^|\b)(cr|credit|income|deposit)($|\b)/.test(suffix) ? 'income' : 'expense'
    const rawRef = field('utr', 'transaction id', 'reference', 'ref no')
    const upiRef = (description.match(/\b\d{12}\b/)?.[0] || rawRef.match(/\b\d{12,}\b/)?.[0] || '').trim()
    const merchant = normalizeMerchant(field('vpa', 'upi id', 'merchant') || description)
    const category = categoryFor(merchant, type, merchantRules)
    const duplicate = Boolean(upiRef && existingEntries.some(entry => entry.utrNumber === upiRef)) || existingEntries.some(entry => entry.date === date && entry.type === type && Math.round(entry.amount * 100) === amountMinor)
    rows.push({ id: crypto.randomUUID(), date, type, amountMinor, balanceMinor: null, descriptionRaw: description, merchant, category, needsCategoryCheck: category === 'Other' || category === 'Other income', upiRef, verified: 'column', problem: duplicate ? 'duplicate' : '', page: 1, selected: !duplicate })
  }
  const first = rows[0], last = rows[rows.length - 1]
  const ordered = rows.slice().sort((a, b) => a.date.localeCompare(b.date))
  const isNewest = first && last && first.date > last.date
  return summarizeStatement(rows, openingMinor, closingMinor, ordered, isNewest ? 'newest_first' : 'oldest_first')
}

export function parseTextStatement(lines: string[], existingEntries: Array<{ utrNumber?: string; date: string; amount: number; type: string }> = []): StatementReview {
  const rows: StatementReviewRow[] = []
  let page = 1
  let previousBalance: number | null = null
  for (const rawLine of lines) {
    if (rawLine.includes('\u0000PAGE\u0000')) { page++; continue }
    const line = cleanSpaces(rawLine)
    const dateMatch = line.match(/(?:^|\s)(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}[ -][A-Za-z]{3,9}[ -](?:'\d{2}|\d{4}))/)
    if (!dateMatch) continue
    const date = parseDate(dateMatch[1])
    if (!date) continue
    const dateIndex = line.indexOf(dateMatch[1])
    let rest = line.slice(dateIndex + dateMatch[1].length)
    const amountMatches = [...rest.matchAll(/(?:₹|rs\.?)?\s*\(?\d{1,3}(?:,\d{2,3}|,\d{3})*(?:\.\d{2})(?:\)?(?:cr|dr)?)/gi)]
    const amounts = amountMatches.map(match => ({ text: match[0], minor: moneyFromCell(match[0]) })).filter(item => item.minor > 0)
    if (!amounts.length) continue
    let amountText = amounts[0].text
    let balanceMinor: number | null = null
    let amountMinor = amounts[0].minor
    let type: 'expense' | 'income' = /\bcr\b|\(cr\)|credit|deposit/i.test(rest) && !/\bdr\b|\(dr\)|debit|withdrawal/i.test(rest) ? 'income' : 'expense'
    const lastAmount = amounts[amounts.length - 1]
    if (amounts.length >= 2) balanceMinor = lastAmount.minor
    if (amounts.length === 1 && /balance/i.test(rest)) balanceMinor = amountMinor
    const suffix = `${amountText} ${rest}`.toLowerCase()
    if (/\(cr\)|\bcr\b|credit|deposit/i.test(suffix)) type = 'income'
    if (/\(dr\)|\bdr\b|debit|withdrawal/i.test(suffix) && !/\(cr\)/.test(suffix)) type = 'expense'
    const description = cleanSpaces(rest.replace(amountText, ' ').replace(/(?:₹|rs\.?)?\s*\(?\d{1,3}(?:,\d{2,3}|,\d{3})*(?:\.\d{2})(?:\)?(?:cr|dr)?)/gi, ' '))
    const merchant = normalizeMerchant(description || 'UPI payment')
    const upiRef = rest.match(/\b\d{12}\b/)?.[0] || rest.match(/\bT\d{15,24}\b/)?.[0] || ''
    const duplicate = Boolean(upiRef && existingEntries.some(entry => entry.utrNumber === upiRef)) || existingEntries.some(entry => entry.date === date && entry.type === type && Math.round(entry.amount * 100) === amountMinor)
    let verified: StatementReviewRow['verified'] = 'column'
    let problem: StatementReviewRow['problem'] = duplicate ? 'duplicate' : ''
    if (balanceMinor !== null && previousBalance !== null) {
      const expected: number = type === 'income' ? previousBalance + amountMinor : previousBalance - amountMinor
      if (expected === balanceMinor) verified = 'balance'
      else if (!problem) problem = 'balance_mismatch'
    }
    if (balanceMinor !== null) previousBalance = balanceMinor
    rows.push({ id: crypto.randomUUID(), date, type, amountMinor, balanceMinor, descriptionRaw: description || line, merchant, category: categoryFor(merchant, type, {}), needsCategoryCheck: categoryFor(merchant, type, {}) === 'Other' || categoryFor(merchant, type, {}) === 'Other income', upiRef, verified, problem, page, selected: !problem })
  }
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  const hasRunningBalance = rows.some(row => row.balanceMinor !== null)
  const newestFirst = rows.length > 1 && rows[0].date > rows[rows.length - 1].date
  if (newestFirst) rows.reverse()
  const firstBalance = ordered.find(row => row.balanceMinor !== null)?.balanceMinor ?? null
  const summary = summarizeStatement(newestFirst ? ordered.reverse() : ordered, null, null, ordered, newestFirst ? 'newest_first' : 'oldest_first')
  return hasRunningBalance ? { ...summary, summary: { ...summary.summary, hasRunningBalance: true, openingMinor: firstBalance } } : summary
}

interface PdfTextItem { str: string; transform: number[]; width: number; height: number }

export async function parsePdfStatement(file: File, password?: string): Promise<StatementReview> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  let loadingTask: any
  try {
    loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer(), password })
    const pdf = await loadingTask.promise
    const lines: string[] = []
    let textItemCount = 0
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const items = (content.items as PdfTextItem[]).filter(item => typeof item.str === 'string' && item.str.trim())
      textItemCount += items.length
      const sorted = [...items].sort((a, b) => b.transform[5] - a.transform[5])
      let current: PdfTextItem[] = []
      let y = Infinity
      for (const item of sorted) {
        const itemY = item.transform[5]
        const tolerance = Math.max(2, (item.height || item.transform[3] || 10) * 0.45)
        if (current.length && Math.abs(itemY - y) > tolerance) {
          lines.push(current.sort((a, b) => a.transform[4] - b.transform[4]).map(part => part.str).join(' '))
          current = []
        }
        current.push(item)
        y = current.length === 1 ? itemY : y
      }
      if (current.length) lines.push(current.sort((a, b) => a.transform[4] - b.transform[4]).map(part => part.str).join(' '))
      lines.push('\u0000PAGE\u0000')
    }
    if (!textItemCount) throw new Error('This looks like a scan or photo. Download the PDF from your bank app or website and try again.')
    return parseTextStatement(lines, [])
  } catch (error: any) {
    if (/password|PasswordException/i.test(error?.name || error?.message || '') || /Password/i.test(String(error))) {
      throw new Error('PASSWORD_REQUIRED')
    }
    throw error
  }
}

const summarizeStatement = (_rows: StatementReviewRow[], openingMinor: number | null, closingMinor: number | null, ordered: StatementReviewRow[], orderDetected: StatementImportSummary['orderDetected']): StatementReview => {
  const dates = ordered.map(row => row.date).filter(Boolean).sort()
  const debits = ordered.filter(row => row.type === 'expense').reduce((sum, row) => sum + row.amountMinor, 0)
  const credits = ordered.filter(row => row.type === 'income').reduce((sum, row) => sum + row.amountMinor, 0)
  const verified = ordered.filter(row => row.verified === 'balance').length
  const mismatches = ordered.filter(row => row.problem === 'balance_mismatch').length
  const hasBalance = ordered.some(row => row.balanceMinor !== null)
  const calculatedClosing = openingMinor === null ? null : openingMinor + credits - debits
  const totalsMatch = calculatedClosing !== null && closingMinor !== null ? calculatedClosing === closingMinor : hasBalance ? false : false
  const warnings = hasBalance ? [] : ['This statement has no running balance, so amounts could not be double-checked.']
  return { rows: ordered, summary: { rows: ordered.length, verifiedByBalance: verified, unverified: ordered.filter(row => row.verified !== 'balance').length, mismatches, openingMinor, closingMinor, totalDebitsMinor: debits, totalCreditsMinor: credits, totalsMatch, dateFrom: dates[0] || '', dateTo: dates[dates.length - 1] || '', orderDetected, hasRunningBalance: hasBalance, currency: 'INR', warnings } }
}
