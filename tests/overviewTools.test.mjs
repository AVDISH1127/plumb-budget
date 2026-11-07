import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import test, { after } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/overviewTools.ts', import.meta.url), 'utf8')
const require = createRequire(import.meta.url)
const tempDir = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.overview-tools-tests-'))
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
const compiledPath = join(tempDir, 'overviewTools.cjs')
writeFileSync(compiledPath, compiled.outputText)
const { getBudgetSuggestions, getSpendingCalendar, parseQuickAdd } = require(compiledPath)
after(() => rmSync(tempDir, { recursive: true, force: true }))

const category = {
  id: 'food', profileId: 'profile', name: 'Food & dining', icon: 'Utensils',
  color: '#34D399', monthlyBudget: 5000, isFixed: false,
}

function entry(id, date, amount, type = 'expense', categoryId = 'food') {
  return {
    id, profileId: 'profile', type, amount, totalPaid: amount, isSplit: false,
    categoryId, note: 'Meal', tags: [], isFixed: false, date,
    createdAt: `${date}T12:00:00.000Z`, source: 'manual',
  }
}

test('calendar aggregates only current-month expenses and keeps empty dates', () => {
  const calendar = getSpendingCalendar([
    entry('a', '2024-02-01', 125),
    entry('b', '2024-02-01', 75),
    entry('c', '2024-02-29', 200),
    entry('old', '2024-01-31', 900),
    entry('income', '2024-02-02', 400, 'income'),
  ], new Date(2024, 1, 15))

  assert.equal(calendar.daysInMonth, 29)
  assert.equal(calendar.firstWeekday, 4)
  assert.equal(calendar.days[0].amount, 200)
  assert.equal(calendar.days[0].transactionCount, 2)
  assert.equal(calendar.days[1].amount, 0)
  assert.equal(calendar.days[28].amount, 200)
})

test('suggests a buffered limit from the previous three months after at least two active months', () => {
  const suggestions = getBudgetSuggestions([category], [
    entry('july', '2024-07-10', 6000),
    entry('august', '2024-08-10', 9000),
    entry('september', '2024-09-10', 3000),
    entry('current', '2024-10-10', 50000),
  ], new Date(2024, 9, 15))

  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].averageSpend, 6000)
  assert.equal(suggestions[0].suggestedBudget, 6900)
})

test('does not make a budget recommendation from only one active month', () => {
  const suggestions = getBudgetSuggestions([category], [
    entry('september', '2024-09-10', 3000),
  ], new Date(2024, 9, 15))

  assert.deepEqual(suggestions, [])
})

test('quick add parses rupee amounts, category labels, income, and safe defaults', () => {
  assert.deepEqual(parseQuickAdd('₹1,250.50 lunch · Food & dining', [category]), {
    amount: 1250.5,
    categoryId: 'food',
    note: 'lunch',
    type: 'expense',
  })
  assert.deepEqual(parseQuickAdd('income 25,000 salary', [category]), {
    amount: 25000,
    categoryId: 'food',
    note: 'salary',
    type: 'income',
  })
  assert.equal(parseQuickAdd('0 lunch', [category]), null)
  assert.equal(parseQuickAdd('₹12,5 lunch', [category]), null)
})
