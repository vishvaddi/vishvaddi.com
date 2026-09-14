import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// Both scripts are plain browser IIFEs; run them the way the page does.
async function loadVoice() {
  const window = { fetch: () => {}, addEventListener() {} }
  const code = await readFile(new URL('../public/scripts/site-voice.js', import.meta.url), 'utf8')
  vm.runInNewContext(code, { window, navigator: { language: 'en-AU' }, setTimeout, clearTimeout, Date, Math, Number, String, Array, Object, Audio: class {} })
  return window.SiteVoice
}
async function loadClean() {
  const window = {}
  const code = await readFile(new URL('../public/scripts/text-clean.js', import.meta.url), 'utf8')
  vm.runInNewContext(code, { window })
  return window.TextClean
}

test('normalise spells out numbers, years, money, times and abbreviations', async () => {
  const v = await loadVoice()
  assert.equal(v.normalise('Dr. Smith paid $1,250.50 on 3rd March 1984 at 7:30.'), 'Doctor Smith paid one thousand two hundred and fifty dollars and fifty cents on third March nineteen eighty-four at seven thirty.')
  assert.equal(v.normalise('CHAPTER XIV'), 'CHAPTER fourteen')
  assert.equal(v.normalise('It was 2007, 12 km away, 3.5 kg — heavy.'), 'It was two thousand and seven, twelve kilometres away, three point five kilograms, heavy.')
  assert.equal(v.normalise('Mr. and Mrs. Bennet, e.g. the 2 of them.'), 'Mister and Missus Bennet, for example the two of them.')
})

test('segment applies chapter, paragraph and speaker pauses and honours (ms) markers', async () => {
  const v = await loadVoice()
  const text = 'CHAPTER I\n\nIt was late. Nobody moved.\n\n"Who is there?" she said. "Speak."\n\n* * *\n\nMorning came (500ms) slowly.'
  const segs = JSON.parse(JSON.stringify(v.segment(text)))
  assert.deepEqual(segs.map((s) => [s.text, s.pauseAfter]), [
    ['CHAPTER I', 2000],
    ['It was late.', 0],
    ['Nobody moved.', 800],
    ['"Who is there?"', 250],
    ['she said.', 250],
    ['"Speak."', 2000],
    ['Morning came slowly.', 1300],
  ])
})

test('clean rejoins wrapped lines and hyphenation, drops page numbers and running heads', async () => {
  const c = await loadClean()
  const page = (n, w) => `THE GREAT BOOK\n\nThe ${w} brown fox jumped over the lazy dog and kept run-\nning until the ${w} river, where it stopped to drink and to con-\nsider its options for the rest of the ${w} after-\nnoon.\n\n${n}\n`
  const out = c.clean(page(1, 'quick') + page(2, 'slow') + page(3, 'old'))
  assert.doesNotMatch(out, /THE GREAT BOOK/)
  assert.doesNotMatch(out, /^\d$/m)
  assert.match(out, /kept running until the quick river, where it stopped to drink and to consider its options for the rest of the quick afternoon\./)
  assert.equal(out.split('\n\n').length, 3)
  assert.equal(c.clean('One.\n\nTwo.\n'), 'One.\n\nTwo.\n', 'already-clean text is untouched')
})
