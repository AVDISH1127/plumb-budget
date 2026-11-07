import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/magicSearch.ts', import.meta.url), 'utf8')
const module = { exports: {} }
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
vm.runInNewContext(compiled.outputText, { module, exports: module.exports })

const { parseMagicSearch } = module.exports
const categories = [
  { id: 'food', name: 'Food & dining' },
  { id: 'transport', name: 'Transport' },
  { id: 'housing', name: 'Housing' },
  { id: 'shopping', name: 'Shopping' },
  { id: 'other', name: 'Other' },
]
const reference = new Date(2026, 9, 27, 12)

test('combines category, date, and strict amount filters', () => {
  const result = parseMagicSearch('food last month over 500', categories, reference)
  assert.equal(result.categoryId, 'food')
  assert.equal(result.minAmount, 500)
  assert.equal(result.minExclusive, true)
  assert.deepEqual([result.startDate, result.endDate], ['2026-09-01', '2026-09-30'])
  assert.equal(result.text, '')
})

test('supports the requested top-N weekly spending search', () => {
  const result = parseMagicSearch('top 5 expenses this week', categories, reference)
  assert.equal(result.type, 'expense')
  assert.equal(result.sort, 'largest')
  assert.equal(result.limit, 5)
  assert.deepEqual([result.startDate, result.endDate], ['2026-10-26', '2026-11-01'])
})

test('keeps merchant names as note searches while parsing amount ranges', () => {
  const result = parseMagicSearch('swiggy between 100 and 500', categories, reference)
  assert.equal(result.text, 'swiggy')
  assert.equal(result.minAmount, 100)
  assert.equal(result.maxAmount, 500)
})

test('recognizes multiple synonyms for the same existing category', () => {
  const result = parseMagicSearch('groceries and food under 1k this month', categories, reference)
  assert.equal(result.categoryId, 'food')
  assert.equal(result.maxAmount, 1_000)
  assert.equal(result.maxExclusive, true)
  assert.deepEqual([result.startDate, result.endDate], ['2026-10-01', '2026-10-31'])
  assert.equal(result.text, '')
})

test('matches category names that contain an ampersand', () => {
  const result = parseMagicSearch('food & dining last month', categories, reference)
  assert.equal(result.categoryId, 'food')
  assert.equal(result.text, '')
})

test('parses income, year, explicit dates, and the financial year', () => {
  const income = parseMagicSearch('income this year', categories, reference)
  assert.equal(income.type, 'income')
  assert.deepEqual([income.startDate, income.endDate], ['2026-01-01', '2026-12-31'])

  const dateRange = parseMagicSearch('between 1 oct and 5 oct', categories, reference)
  assert.deepEqual([dateRange.startDate, dateRange.endDate], ['2026-10-01', '2026-10-05'])

  const financialYear = parseMagicSearch('last financial year', categories, reference, 4)
  assert.deepEqual([financialYear.startDate, financialYear.endDate], ['2025-04-01', '2026-03-31'])

  const since = parseMagicSearch('since 5 oct', categories, reference)
  assert.equal(since.startDate, '2026-10-05')

  const calendarYear = parseMagicSearch('in 2025', categories, reference)
  assert.deepEqual([calendarYear.startDate, calendarYear.endDate], ['2025-01-01', '2025-12-31'])
})

test('supports local calendar dates and inclusive amount operators', () => {
  const date = parseMagicSearch('5 oct', categories, reference)
  assert.deepEqual([date.startDate, date.endDate], ['2026-10-05', '2026-10-05'])

  const amount = parseMagicSearch('at least ₹1k', categories, reference)
  assert.equal(amount.minAmount, 1_000)
  assert.equal(amount.minExclusive, false)
})
