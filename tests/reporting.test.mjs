import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import test, { after } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/reporting.ts', import.meta.url), 'utf8')
const require = createRequire(import.meta.url)
const tempDir = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.reporting-tests-'))
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
const compiledPath = join(tempDir, 'reporting.cjs')
writeFileSync(compiledPath, compiled.outputText)
const { filterReportEntries, getReportDateRange, reportCsv } = require(compiledPath)
after(() => rmSync(tempDir, { recursive: true, force: true }))

const categories = [
  { id: 'food', profileId: 'profile', name: 'Food & dining', icon: 'Utensils', color: '#34D399', monthlyBudget: 8000, isFixed: false },
  { id: 'salary', profileId: 'profile', name: 'Salary', icon: 'Wallet', color: '#2DD4BF', monthlyBudget: 0, isFixed: true },
]
const entries = [
  { id: 'expense', profileId: 'profile', type: 'expense', amount: 500.5, totalPaid: 500.5, isSplit: false, categoryId: 'food', note: '=1+1', tags: [], isFixed: false, date: '2026-10-10', createdAt: '2026-10-10T12:00:00Z', source: 'manual' },
  { id: 'income', profileId: 'profile', type: 'income', amount: 1000, totalPaid: 1000, isSplit: false, categoryId: 'salary', note: 'Monthly salary', merchantVpa: 'salary@example', utrNumber: '123456789012', tags: [], isFixed: true, date: '2026-10-12', createdAt: '2026-10-12T12:00:00Z', source: 'manual' },
  { id: 'older', profileId: 'profile', type: 'expense', amount: 400, totalPaid: 400, isSplit: false, categoryId: 'food', note: 'Older groceries', tags: [], isFixed: false, date: '2026-09-10', createdAt: '2026-09-10T12:00:00Z', source: 'manual' },
]
const baseOptions = {
  period: 'custom', type: 'all', categoryIds: [], minimum: '', maximum: '', noteContains: '',
  order: 'newest', group: 'none', sections: ['summary'], title: 'Test report', hideNotes: false,
  fromDate: '2026-10-01', toDate: '2026-10-31',
}

test('builds local calendar report ranges, including leap-year February', () => {
  const lastMonth = getReportDateRange('last-month', '', '', new Date(2024, 2, 15))
  assert.deepEqual([lastMonth.from, lastMonth.to], ['2024-02-01', '2024-02-29'])
  const financialYear = getReportDateRange('financial-year', '', '', new Date(2026, 9, 27), 4)
  assert.deepEqual([financialYear.from, financialYear.to], ['2026-04-01', '2027-03-31'])
})

test('filters by date, type, category, amount, and note; applies requested ordering', () => {
  const options = { ...baseOptions, type: 'expense', categoryIds: ['food'], minimum: '450', maximum: '600', noteContains: '1+1' }
  const result = filterReportEntries(entries, categories, options, { from: '2026-10-01', to: '2026-10-31', label: 'October' })
  assert.deepEqual(result.map(entry => entry.id), ['expense'])

  const sorted = filterReportEntries(entries, categories, { ...baseOptions, period: 'all-time', order: 'largest' }, { from: null, to: null, label: 'All time' })
  assert.deepEqual(sorted.map(entry => entry.id), ['income', 'expense', 'older'])
})

test('CSV export includes a BOM, correct currency signs, and formula-injection protection', () => {
  const csv = reportCsv(entries.slice(0, 2), categories, baseOptions)
  assert.ok(csv.startsWith('\uFEFF'))
  assert.match(csv, /"'-500\.50"/)
  assert.match(csv, /"'=1\+1"/)
  assert.match(csv, /"1000\.00"/)
})

test('private report exports suppress notes, merchant identifiers, and UTRs', () => {
  const csv = reportCsv(entries.slice(0, 2), categories, { ...baseOptions, hideNotes: true })
  assert.doesNotMatch(csv, /1\+1|Monthly salary|salary@example|123456789012/)
  assert.match(csv, /"Food & dining"/)
})

test('creates a readable multi-page PDF and honors note privacy', async () => {
  const { createReportPdf } = require(compiledPath)
  const manyEntries = Array.from({ length: 160 }, (_, index) => ({
    ...entries[0],
    id: `page-${index}`,
    note: 'Private merchant note',
    date: `2026-10-${String((index % 28) + 1).padStart(2, '0')}`,
    createdAt: `2026-10-${String((index % 28) + 1).padStart(2, '0')}T12:00:00Z`,
  }))
  const bytes = await createReportPdf(
    manyEntries,
    categories,
    { ...baseOptions, sections: ['summary', 'transactions'], hideNotes: true },
    { from: '2026-10-01', to: '2026-10-31', label: 'October 2026' },
    'Test profile',
  )
  const pdfLib = require('pdf-lib')
  const pdf = await pdfLib.PDFDocument.load(bytes)
  assert.ok(pdf.getPageCount() > 1)
  assert.equal(pdf.getTitle(), 'Test report')
  assert.equal(pdf.getAuthor(), 'Test profile')
  assert.doesNotMatch(Buffer.from(bytes).toString('latin1'), /Private merchant note/)
})
