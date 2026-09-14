import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsv, detectDateFormat, parseDate, parseAmount, guessMapping, rowsToImportRows, dedupe,
  categorise, applyRules, initialData, budgetSummary, payoffPlan, compoundProjection, savingsGoal,
  netWorth, holdingsSummary, monthsBetween, transactionsCsv, headerSignature,
} from '../src/scripts/site/money-model.ts'

const near = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`)

test('parseCsv handles BOM, CRLF, quoted commas and escaped quotes', () => {
  const rows = parseCsv('﻿Date,Description,Amount\r\n14/09/2026,"Woolworths, Metro ""North""",-45.20\r\n\r\n15/09/2026,Cafe,-4.50')
  assert.deepEqual(rows, [
    ['Date', 'Description', 'Amount'],
    ['14/09/2026', 'Woolworths, Metro "North"', '-45.20'],
    ['15/09/2026', 'Cafe', '-4.50'],
  ])
})

test('date format detection prefers AU day-first and rejects impossible dates', () => {
  assert.equal(detectDateFormat(['14/09/2026', '01/02/2026']), 'DMY')
  assert.equal(detectDateFormat(['2026-09-14']), 'ISO')
  assert.equal(detectDateFormat(['14 Sep 2026', '1 Jan 26']), 'DMMMY')
  assert.equal(detectDateFormat(['09/14/2026']), 'MDY')
  assert.equal(detectDateFormat(['13/25/2026']), null)
  assert.equal(parseDate('31/02/2026', 'DMY'), null)
  assert.equal(parseDate('1/2/26', 'DMY'), '2026-02-01')
})

test('parseAmount copes with currency symbols, commas, brackets and CR/DR', () => {
  assert.equal(parseAmount('$1,234.50'), 1234.5)
  assert.equal(parseAmount('(45.20)'), -45.2)
  assert.equal(parseAmount('-45.20'), -45.2)
  assert.equal(parseAmount('45.20 DR'), -45.2)
  assert.equal(parseAmount('45.20 CR'), 45.2)
  assert.equal(parseAmount('abc'), null)
  assert.equal(parseAmount(''), null)
})

test('guessMapping merges debit/credit columns and skips the balance column', () => {
  const rows = parseCsv('Date,Narrative,Debit,Credit,Balance\n14/09/2026,Salary,,3000.00,5000.00\n15/09/2026,Coles,52.30,,4947.70')
  const m = guessMapping(rows)
  assert.equal(m.hasHeader, true)
  assert.equal(m.date, 0)
  assert.equal(m.dateFormat, 'DMY')
  assert.equal(m.description, 1)
  assert.equal(m.amount, null)
  assert.equal(m.debit, 2)
  assert.equal(m.credit, 3)
  const { ok, skipped } = rowsToImportRows(rows, m)
  assert.equal(skipped, 0)
  assert.deepEqual(ok, [
    { date: '2026-09-14', amount: 3000, description: 'Salary' },
    { date: '2026-09-15', amount: -52.3, description: 'Coles' },
  ])
})

test('guessMapping finds a single amount column and headerless files', () => {
  const rows = parseCsv('Date,Amount,Description\n2026-09-14,-12.00,Uber')
  const m = guessMapping(rows)
  assert.equal(m.amount, 1)
  assert.equal(m.description, 2)
  assert.equal(m.dateFormat, 'ISO')
  const raw = parseCsv('14/09/2026,-12.00,Uber trip\n15/09/2026,20.00,Refund')
  const m2 = guessMapping(raw)
  assert.equal(m2.hasHeader, false)
  assert.equal(m2.date, 0)
  assert.equal(m2.amount, 1)
  assert.equal(m2.description, 2)
  assert.equal(rowsToImportRows(raw, m2).ok.length, 2)
  assert.equal(headerSignature(['Date', ' Amount ', 'Description']), 'date|amount|description')
})

test('dedupe drops rows already stored, counting duplicates within the file', () => {
  const existing = [{ date: '2026-09-14', amount: -45.2, description: 'Woolworths' }]
  const incoming = [
    { date: '2026-09-14', amount: -45.2, description: 'WOOLWORTHS ' },
    { date: '2026-09-14', amount: -45.2, description: 'Woolworths' },
    { date: '2026-09-15', amount: -4.5, description: 'Cafe' },
  ]
  const { fresh, dupes } = dedupe(existing, incoming)
  assert.equal(dupes, 1)
  assert.equal(fresh.length, 2)
})

test('keyword rules categorise on import and re-run', () => {
  const data = initialData('2026-09')
  assert.equal(categorise('WOOLWORTHS 1234 SYDNEY', data.rules), 'groceries')
  assert.equal(categorise('Something unknown', data.rules), null)
  const txs = [
    { id: '1', date: '2026-09-01', amount: -10, description: 'Coles Express', categoryId: null, accountId: null },
    { id: '2', date: '2026-09-01', amount: -10, description: 'Netflix', categoryId: 'fun', accountId: null },
  ]
  const kept = applyRules(txs, data.rules, true)
  assert.equal(kept.changed, 1)
  assert.equal(kept.transactions[1].categoryId, 'fun')
  const all = applyRules(txs, data.rules, false)
  assert.equal(all.changed, 2)
  assert.equal(all.transactions[1].categoryId, 'subscriptions')
})

test('budget maths: actual, remaining, days left and safe-to-spend', () => {
  const data = {
    categories: [{ id: 'groceries', name: 'Groceries', budget: 600 }],
    transactions: [
      { id: '1', date: '2026-09-03', amount: -120, description: 'a', categoryId: 'groceries', accountId: null },
      { id: '2', date: '2026-09-10', amount: -80, description: 'b', categoryId: 'groceries', accountId: null },
      { id: '3', date: '2026-09-11', amount: 3000, description: 'pay', categoryId: null, accountId: null },
      { id: '4', date: '2026-08-30', amount: -50, description: 'c', categoryId: 'groceries', accountId: null },
      { id: '5', date: '2026-09-12', amount: -40, description: 'd', categoryId: null, accountId: null },
    ],
  }
  const s = budgetSummary(data, '2026-09', '2026-09-14')
  assert.equal(s.lines[0].actual, 200)
  assert.equal(s.lines[0].remaining, 400)
  assert.equal(s.spentTotal, 240)
  assert.equal(s.uncategorised, 40)
  assert.equal(s.incomeTotal, 3000)
  assert.equal(s.budgetTotal, 600)
  assert.equal(s.remaining, 360)
  assert.equal(s.daysLeft, 17)
  assert.equal(s.safePerDay, 21.18)
  assert.equal(budgetSummary(data, '2026-08', '2026-09-14').daysLeft, 0)
})

test('snowball vs avalanche on a hand-checked two-debt fixture', () => {
  const debts = [
    { id: 'a', name: 'Card', balance: 1000, apr: 24, minimum: 50 },
    { id: 'b', name: 'Loan', balance: 500, apr: 12, minimum: 25 },
  ]
  const snow = payoffPlan(debts, 100, 'snowball')
  const aval = payoffPlan(debts, 100, 'avalanche')
  assert.deepEqual(snow.rows[0].balances, [970, 380])
  assert.equal(snow.rows[0].interest, 25)
  assert.equal(snow.rows[0].paid, 175)
  assert.deepEqual(aval.rows[0].balances, [870, 480])
  near(snow.rows[1].interest, 23.2, 0.01)
  near(aval.rows[1].interest, 22.2, 0.01)
  assert.equal(snow.order[0].id, 'b')
  assert.equal(aval.order[0].id, 'a')
  assert.ok(aval.totalInterest < snow.totalInterest)
  assert.ok(aval.months <= snow.months)
  assert.equal(snow.totalSeries.length, snow.months + 1)
  assert.equal(snow.totalSeries[snow.months], 0)
  near(snow.totalPaid, 1500 + snow.totalInterest, 0.02)
})

test('payoff edge cases: zero interest, single-month clear, runaway cap', () => {
  const zero = payoffPlan([{ id: 'z', name: 'z', balance: 1000, apr: 0, minimum: 100 }], 0, 'avalanche')
  assert.equal(zero.months, 10)
  assert.equal(zero.totalInterest, 0)
  const one = payoffPlan([{ id: 'o', name: 'o', balance: 1200, apr: 12, minimum: 2000 }], 0, 'snowball')
  assert.equal(one.months, 1)
  assert.equal(one.totalInterest, 12)
  assert.equal(one.totalPaid, 1212)
  const runaway = payoffPlan([{ id: 'r', name: 'r', balance: 10000, apr: 30, minimum: 10 }], 0, 'snowball')
  assert.equal(runaway.capped, true)
})

test('compound projection with and without fees', () => {
  const r = compoundProjection({ start: 1000, monthly: 0, annualReturnPct: 12, years: 1, feePct: 1 })
  assert.equal(r.series.length, 13)
  near(r.finalNoFee, 1126.83)
  near(r.final, 1115.72)
  assert.equal(r.contributed, 1000)
  const c = compoundProjection({ start: 0, monthly: 100, annualReturnPct: 0, years: 2, feePct: 0 })
  assert.equal(c.final, 2400)
  assert.equal(c.growth, 0)
})

test('savings goal required monthly', () => {
  assert.equal(savingsGoal(12000, 0, 12, 0), 1000)
  near(savingsGoal(12000, 0, 12, 12), 946.2)
  assert.equal(savingsGoal(1000, 2000, 6, 0), 0)
  assert.equal(savingsGoal(1000, 0, 0, 0), null)
  assert.equal(monthsBetween('2026-09-14', '2027-03-01'), 6)
})

test('net worth splits liabilities; holdings summary weights and gains', () => {
  const nw = netWorth([
    { id: '1', name: 'Everyday', type: 'cash', balance: 2000 },
    { id: '2', name: 'Card', type: 'credit', balance: 500 },
    { id: '3', name: 'Home loan', type: 'loan', balance: -300000 },
  ])
  assert.deepEqual(nw, { assets: 2000, liabilities: 300500, net: -298500 })
  const h = holdingsSummary([
    { id: 'a', name: 'VAS', units: 10, avgCost: 90, price: 100, priceAt: '2026-09-14', currency: 'AUD' },
    { id: 'b', name: 'VGS', units: 10, avgCost: 100, price: 100, priceAt: '2026-09-14', currency: 'AUD' },
  ])
  assert.equal(h.value, 2000)
  assert.equal(h.gain, 100)
  assert.equal(h.lines[0].weight, 0.5)
  near(h.lines[0].gainPct, 0.1111, 0.001)
})

test('transactions CSV export quotes fields and resolves names', () => {
  const csv = transactionsCsv(
    [{ id: '1', date: '2026-09-14', amount: -45.2, description: 'Woolworths, Metro', categoryId: 'groceries', accountId: null }],
    [{ id: 'groceries', name: 'Groceries', budget: 1 }], [],
  )
  assert.equal(csv, '"Date","Amount","Description","Category","Account"\r\n"2026-09-14","-45.20","Woolworths, Metro","Groceries",""')
})
