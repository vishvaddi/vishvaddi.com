import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractJsonLd, findRecipe, parseIsoDuration, parseYield, flattenInstructions, recipeFromHtml } from '../worker/recipe-jsonld.ts'

const wrap = (json) => `<html><head><title>x</title><script type="application/ld+json">${JSON.stringify(json)}</script></head><body><p>hello</p></body></html>`

const graphPage = wrap({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', name: 'Site' },
    {
      '@type': ['Recipe', 'NewsArticle'],
      name: 'Chicken &amp; rice',
      recipeYield: ['4', '4 servings'],
      prepTime: 'PT15M',
      totalTime: 'PT1H30M',
      recipeIngredient: ['2 tbsp olive oil', '1 onion, diced', '400 g tinned tomatoes'],
      recipeInstructions: [
        { '@type': 'HowToSection', name: 'Prep', itemListElement: [{ '@type': 'HowToStep', text: 'Chop <b>everything</b>.' }] },
        { '@type': 'HowToStep', text: 'Cook it.' },
        'Serve.',
      ],
      recipeCategory: 'Dinner',
      recipeCuisine: ['Italian'],
      keywords: 'quick, weeknight, Dinner',
    },
  ],
})

test('extracts a Recipe from an @graph with nested @type arrays', () => {
  const recipe = recipeFromHtml(graphPage, 'https://example.com/r')
  assert.equal(recipe.title, 'Chicken & rice')
  assert.equal(recipe.sourceUrl, 'https://example.com/r')
  assert.equal(recipe.servings, 4)
  assert.equal(recipe.prepMinutes, 15)
  assert.equal(recipe.cookMinutes, 75, 'cook derived from total minus prep')
  assert.deepEqual(recipe.ingredients, ['2 tbsp olive oil', '1 onion, diced', '400 g tinned tomatoes'])
  assert.deepEqual(recipe.steps, ['Chop everything.', 'Cook it.', 'Serve.'])
  assert.deepEqual(recipe.tags, ['dinner', 'italian', 'quick', 'weeknight'])
})

test('handles a top-level array and a plain string instruction block', () => {
  const html = wrap([{ '@type': 'Organization' }, { '@type': 'recipe', name: 'Toast', recipeYield: 2, cookTime: 'PT5M', recipeIngredient: '2 slices bread', recipeInstructions: '1. Toast the bread\n2. Butter it' }])
  const recipe = recipeFromHtml(html, 'https://example.com/t')
  assert.equal(recipe.title, 'Toast')
  assert.equal(recipe.servings, 2)
  assert.equal(recipe.prepMinutes, null)
  assert.equal(recipe.cookMinutes, 5)
  assert.deepEqual(recipe.ingredients, ['2 slices bread'])
  assert.deepEqual(recipe.steps, ['Toast the bread', 'Butter it'])
})

test('returns null when no Recipe JSON-LD exists, and survives malformed blocks', () => {
  assert.equal(recipeFromHtml('<html><body>no data</body></html>', 'https://x.y'), null)
  const html = `<script type="application/ld+json">{ not json</script>${wrap({ '@type': 'Article', name: 'Not a recipe' })}`
  assert.equal(recipeFromHtml(html, 'https://x.y'), null)
  assert.equal(extractJsonLd(html).length, 1)
})

test('finds a recipe nested under mainEntity and inside CDATA/comment wrappers', () => {
  const html = `<script type="application/ld+json"><!--{"@type":"WebPage","mainEntity":{"@type":"Recipe","name":"Nested","recipeIngredient":["1 egg"]}}--></script>`
  const recipe = recipeFromHtml(html, 'https://x.y')
  assert.equal(recipe.title, 'Nested')
  assert.equal(findRecipe({ '@type': 'Thing' }), null)
})

test('ISO-8601 durations convert to minutes', () => {
  assert.equal(parseIsoDuration('PT1H30M'), 90)
  assert.equal(parseIsoDuration('PT45M'), 45)
  assert.equal(parseIsoDuration('PT2H'), 120)
  assert.equal(parseIsoDuration('P0DT0H20M'), 20)
  assert.equal(parseIsoDuration('PT90S'), 2)
  assert.equal(parseIsoDuration('1 hr 10 mins'), 70)
  assert.equal(parseIsoDuration(''), null)
  assert.equal(parseIsoDuration(undefined), null)
  assert.equal(parseIsoDuration('PT'), null)
})

test('recipeYield accepts numbers, strings and arrays', () => {
  assert.equal(parseYield(6), 6)
  assert.equal(parseYield('Serves 4-6'), 4)
  assert.equal(parseYield(['12 muffins']), 12)
  assert.equal(parseYield('a few'), null)
})

test('HowToSection nesting flattens in order', () => {
  const steps = flattenInstructions([
    { '@type': 'HowToSection', itemListElement: [{ text: 'a' }, { '@type': 'HowToSection', itemListElement: [{ text: 'b' }] }] },
    { name: 'c' },
  ])
  assert.deepEqual(steps, ['a', 'b', 'c'])
})
