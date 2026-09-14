import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseIngredient, parseIngredients, parseSteps, parseTags, formatQty, scaleIngredient, ingredientText,
  searchRecipes, sortRecipes, allTags, recipeToMarkdown, nextMonday, planDates, addDays,
  autoFillDinners, applyCooked, aggregateShopping, aisleFor, shoppingListText, initialDoc,
} from '../src/scripts/site/kitchen-model.ts'

const recipe = (over) => ({
  id: 'r', title: 'R', sourceUrl: '', servings: 2, prepMinutes: 5, cookMinutes: 10, tags: [], ingredients: [],
  steps: [], notes: '', createdAt: '2026-01-01T00:00:00.000Z', lastCookedAt: null, ...over,
})

test('ingredient parser handles units, fractions, ranges, notes and bare items', () => {
  assert.deepEqual(parseIngredient('2 tbsp olive oil'), { qty: 2, qtyMax: null, unit: 'tbsp', item: 'olive oil', note: '', raw: '2 tbsp olive oil' })
  assert.deepEqual(parseIngredient('1/2 cup rice'), { qty: 0.5, qtyMax: null, unit: 'cup', item: 'rice', note: '', raw: '1/2 cup rice' })
  assert.deepEqual(parseIngredient('400 g tinned tomatoes'), { qty: 400, qtyMax: null, unit: 'g', item: 'tinned tomatoes', note: '', raw: '400 g tinned tomatoes' })
  assert.equal(parseIngredient('400g tinned tomatoes').unit, 'g')
  assert.deepEqual(parseIngredient('3 eggs'), { qty: 3, qtyMax: null, unit: '', item: 'eggs', note: '', raw: '3 eggs' })
  assert.deepEqual(parseIngredient('salt'), { qty: null, qtyMax: null, unit: '', item: 'salt', note: '', raw: 'salt' })
  const range = parseIngredient('1-2 cloves garlic, crushed')
  assert.equal(range.qty, 1); assert.equal(range.qtyMax, 2); assert.equal(range.unit, 'clove'); assert.equal(range.item, 'garlic'); assert.equal(range.note, 'crushed')
  assert.equal(parseIngredient('1 ½ cups flour').qty, 1.5)
  assert.equal(parseIngredient('½ tsp salt').qty, 0.5)
  assert.equal(parseIngredient('1 1/2 tsp cumin').qty, 1.5)
  const mult = parseIngredient('2 x 400 g tins chickpeas')
  assert.equal(mult.qty, 800); assert.equal(mult.unit, 'g'); assert.equal(mult.item, 'tins chickpeas')
  const paren = parseIngredient('1 cup of basmati rice (rinsed)')
  assert.equal(paren.item, 'basmati rice'); assert.equal(paren.note, 'rinsed')
  assert.equal(parseIngredient('2 large onions').item, 'large onions')
  assert.equal(parseIngredients('a\n\n  b \n').length, 2)
})

test('steps and tags parse from multi-line text', () => {
  assert.deepEqual(parseSteps('1. Chop\n2) Cook\n- Serve\n'), ['Chop', 'Cook', 'Serve'])
  assert.deepEqual(parseTags('Quick, prep ,quick;Dinner'), ['quick', 'prep', 'dinner'])
})

test('quantities format as nice fractions and scale linearly', () => {
  assert.equal(formatQty(0.5), '1/2')
  assert.equal(formatQty(0.25), '1/4')
  assert.equal(formatQty(1 / 3), '1/3')
  assert.equal(formatQty(1.5), '1 1/2')
  assert.equal(formatQty(2), '2')
  assert.equal(formatQty(0.7), '0.7')
  assert.equal(formatQty(12.4), '12')
  assert.equal(formatQty(null), '')
  const scaled = scaleIngredient(parseIngredient('1 cup rice'), 0.5)
  assert.equal(scaled.qty, 0.5)
  assert.equal(ingredientText(scaled), '1/2 cup rice')
  assert.equal(ingredientText(scaleIngredient(parseIngredient('1-2 cloves garlic, crushed'), 2)), '2–4 clove garlic (crushed)')
  assert.equal(ingredientText(parseIngredient('salt')), 'salt')
})

test('search matches title, tags and ingredients; sort orders by key', () => {
  const rs = [
    recipe({ id: 'a', title: 'Beef stew', tags: ['slow'], ingredients: parseIngredients('500 g beef'), prepMinutes: 20, cookMinutes: 120, createdAt: '2026-01-01' }),
    recipe({ id: 'b', title: 'Omelette', tags: ['quick'], ingredients: parseIngredients('3 eggs'), prepMinutes: 2, cookMinutes: 5, createdAt: '2026-02-01' }),
    recipe({ id: 'c', title: 'Fried rice', tags: ['quick', 'prep'], ingredients: parseIngredients('2 cups rice\n2 eggs'), prepMinutes: 10, cookMinutes: 10, createdAt: '2026-03-01' }),
  ]
  assert.deepEqual(searchRecipes(rs, 'egg').map((r) => r.id), ['b', 'c'])
  assert.deepEqual(searchRecipes(rs, 'slow').map((r) => r.id), ['a'])
  assert.deepEqual(searchRecipes(rs, '', ['quick']).map((r) => r.id), ['b', 'c'])
  assert.deepEqual(searchRecipes(rs, 'rice', ['prep']).map((r) => r.id), ['c'])
  assert.deepEqual(sortRecipes(rs, 'title').map((r) => r.id), ['a', 'c', 'b'])
  assert.deepEqual(sortRecipes(rs, 'recent').map((r) => r.id), ['c', 'b', 'a'])
  assert.deepEqual(sortRecipes(rs, 'quickest').map((r) => r.id), ['b', 'c', 'a'])
  assert.deepEqual(allTags(rs), ['quick', 'prep', 'slow'])
  const md = recipeToMarkdown(rs[2])
  assert.match(md, /^# Fried rice\n/)
  assert.match(md, /- 2 cup rice\n- 2 eggs/)
})

test('dates: next Monday and fortnight range', () => {
  assert.equal(nextMonday('2026-09-14'), '2026-09-14', 'a Monday stays put')
  assert.equal(nextMonday('2026-09-13'), '2026-09-14')
  assert.equal(nextMonday('2026-09-15'), '2026-09-21')
  const dates = planDates('2026-09-14')
  assert.equal(dates.length, 14)
  assert.equal(dates[13], '2026-09-27')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})

const pool = () => [
  recipe({ id: 'quick1', title: 'Quick 1', prepMinutes: 5, cookMinutes: 15 }),
  recipe({ id: 'quick2', title: 'Quick 2', prepMinutes: 10, cookMinutes: 15 }),
  recipe({ id: 'quick3', title: 'Quick 3', prepMinutes: 5, cookMinutes: 20, lastCookedAt: '2026-09-01' }),
  recipe({ id: 'quick4', title: 'Quick 4', prepMinutes: 5, cookMinutes: 10 }),
  recipe({ id: 'quick5', title: 'Quick 5', prepMinutes: 5, cookMinutes: 5 }),
  recipe({ id: 'slow', title: 'Slow roast', prepMinutes: 30, cookMinutes: 180 }),
  recipe({ id: 'batch', title: 'Batch curry', prepMinutes: 20, cookMinutes: 60, tags: ['batch'] }),
]

test('auto-fill respects weekday time cap, Sunday prep day, leftovers, no repeats and is deterministic', () => {
  const settings = { ...initialDoc().settings, weekdayMaxMinutes: 30, leftoverDays: 2, servings: 2, seed: 7 }
  const dates = planDates('2026-09-14') // Mon 14 … Sun 27
  const days = { '2026-09-16': { away: true, slots: {} }, '2026-09-17': { away: false, slots: { dinner: { text: 'out' } } } }
  const filled = autoFillDinners(pool(), days, dates, settings)
  const again = autoFillDinners(pool(), days, dates, settings)
  assert.deepEqual(filled, again, 'same seed gives the same plan')

  assert.equal(filled['2026-09-16'].slots.dinner, undefined, 'away day left alone')
  assert.equal(filled['2026-09-17'].slots.dinner.text, 'out', 'existing free text kept')

  const byId = new Map(pool().map((r) => [r.id, r]))
  for (const date of dates) {
    const cell = filled[date]?.slots.dinner
    if (!cell?.recipeId || cell.leftover) continue
    const dow = new Date(date + 'T00:00:00').getDay()
    if (dow >= 1 && dow <= 5) assert.ok(byId.get(cell.recipeId).prepMinutes + byId.get(cell.recipeId).cookMinutes <= 30, `${date} weekday within cap`)
  }
  const sunday = filled['2026-09-20'].slots.dinner
  assert.equal(sunday.recipeId, 'batch', 'Sunday prefers a batch recipe')
  assert.equal(sunday.servings, 6, 'cooked for two leftover days')
  assert.equal(filled['2026-09-21'].slots.dinner.leftover, true)
  assert.equal(filled['2026-09-21'].slots.dinner.recipeId, 'batch')
  assert.equal(filled['2026-09-22'].slots.dinner.leftover, true)

  const cooked = dates.map((d) => filled[d]?.slots.dinner).filter((c) => c?.recipeId && !c.leftover).map((c) => c.recipeId)
  const weekdayCooked = cooked.filter((id) => id !== 'batch' && id !== 'slow')
  assert.equal(new Set(cooked.slice(0, 5)).size, 5, 'first five cooks are distinct')
  assert.ok(weekdayCooked.indexOf('quick3') > weekdayCooked.indexOf('quick1'), 'recently cooked recipe goes later')
})

test('applyCooked stamps lastCookedAt for past, non-leftover, non-away days only', () => {
  const doc = { ...initialDoc(), recipes: pool() }
  doc.plan.days = {
    '2026-09-10': { away: false, slots: { dinner: { recipeId: 'quick1', servings: 2 } } },
    '2026-09-11': { away: false, slots: { dinner: { recipeId: 'quick1', servings: 2, leftover: true }, lunch: { recipeId: 'quick2' } } },
    '2026-09-12': { away: true, slots: { dinner: { recipeId: 'quick4' } } },
    '2026-09-20': { away: false, slots: { dinner: { recipeId: 'quick5' } } },
  }
  const { doc: next, changed } = applyCooked(doc, '2026-09-14')
  assert.equal(changed, true)
  const by = (id) => next.recipes.find((r) => r.id === id).lastCookedAt
  assert.equal(by('quick1'), '2026-09-10')
  assert.equal(by('quick2'), '2026-09-11')
  assert.equal(by('quick4'), null)
  assert.equal(by('quick5'), null)
  assert.equal(applyCooked(next, '2026-09-14').changed, false)
})

test('shopping list scales by servings, merges item+unit, skips leftovers and away days, groups by aisle', () => {
  const rs = [
    recipe({ id: 'a', title: 'A', servings: 2, ingredients: parseIngredients('1 cup rice\n2 eggs\n1 onion, diced\nsalt') }),
    recipe({ id: 'b', title: 'B', servings: 4, ingredients: parseIngredients('2 cups rice\n400 g tinned tomatoes\n1 onion\nsalt') }),
  ]
  const days = {
    d1: { away: false, slots: { dinner: { recipeId: 'a', servings: 4 } } },
    d2: { away: false, slots: { dinner: { recipeId: 'b', servings: 2 }, lunch: { recipeId: 'a', servings: 2, leftover: true } } },
    d3: { away: true, slots: { dinner: { recipeId: 'b', servings: 4 } } },
  }
  const lines = aggregateShopping(rs, days, ['d1', 'd2', 'd3'], { 'onion': 'other' })
  const find = (item, unit = '') => lines.find((l) => l.item === item && l.unit === unit)
  assert.equal(find('rice', 'cup').qty, 3, '2 cups (a doubled) + 1 cup (b halved)')
  assert.equal(find('eggs').qty, 4)
  assert.equal(find('onion').qty, 2.5)
  assert.equal(find('onion').aisle, 'other', 'per-item override wins')
  assert.equal(find('tinned tomatoes', 'g').qty, 200)
  assert.equal(find('tinned tomatoes', 'g').aisle, 'pantry')
  assert.equal(find('salt').qty, null)
  assert.equal(find('salt').count, 2)
  assert.deepEqual(find('rice', 'cup').from, ['A', 'B'])
  assert.deepEqual(lines.map((l) => l.aisle), ['dairy', 'pantry', 'pantry', 'pantry', 'other'], 'sorted in aisle order')
  const text = shoppingListText(lines, { 'eggs|': true })
  assert.match(text, /DAIRY\n\[x\] 4 eggs/)
  assert.match(text, /PANTRY\n/)
})

test('aisle heuristics', () => {
  assert.equal(aisleFor('chicken thighs'), 'meat & fish')
  assert.equal(aisleFor('frozen peas'), 'frozen')
  assert.equal(aisleFor('tinned tuna'), 'pantry')
  assert.equal(aisleFor('greek yoghurt'), 'dairy')
  assert.equal(aisleFor('sourdough loaf'), 'bakery')
  assert.equal(aisleFor('spring onions'), 'produce')
  assert.equal(aisleFor('olive oil'), 'pantry')
  assert.equal(aisleFor('gaffer tape'), 'other')
})
