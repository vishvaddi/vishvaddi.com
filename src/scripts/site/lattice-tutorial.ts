// Guided walkthrough + searchable help for Lattice.
//
// Deliberately host-specific: lattice-view.ts is byte-identical with vvDeck's
// copy, so the tour drives the tool through its own DOM exactly as a user would
// rather than reaching into the view's internals. Targets are resolved lazily
// per step because the view rebuilds its whole subtree on every redraw — an
// element captured up front is detached by the time the step runs.
import { loadAll, remove } from './lattice'

const SEEN_KEY = 'vv_lattice_tutorial_seen'
const WBS_TEMPLATE = 'Trade estimate (WBS)'

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text) n.textContent = text
  return n
}

function tbtn(label: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = 'lat-tut-btn'
  b.textContent = label
  return b
}

/** Let the view finish its async redraw before the next step looks for targets. */
const settle = () => new Promise<void>(r => setTimeout(r, 80))

interface Step {
  state: 'list' | 'editor'
  find: () => HTMLElement | null
  title: string
  text: string
}

/** `keys` carries spellings the prose does not — "rollup" for "Roll-ups", "csv" for TSV. */
interface HelpTopic { section: string; title: string; text: string; keys?: string }

const HELP_TOPICS: HelpTopic[] = [
  { section: 'Basics', title: 'Grids inside grids', keys: 'nest nesting subgrid hierarchy wbs breakdown zoom', text: 'Every cell can hold another whole grid. A job becomes trades, a trade becomes items. The ▦ chip on a cell means it contains a grid — click it to zoom in, and use the breadcrumbs at the top to climb back out.' },
  { section: 'Basics', title: 'Selecting and editing', text: 'Click a cell to select it, click again to edit. Escape cancels an edit, Enter commits it, Shift+Enter adds a line break inside the cell.' },
  { section: 'Basics', title: 'Rows, columns and gaps', text: 'Arrow keys walk the cells AND the gaps between them. Land on a gap and start typing to insert a row or column there. On a gap, Backspace or Delete removes the row/column beside it.' },
  { section: 'Estimating', title: 'Roll-ups', keys: 'rollup rollups sum total subtotal aggregate estimate cost aud', text: 'Select a cell that contains a grid and press agg to cycle sum, AUD cost, count and %-done. For sum or cost, choose the exact source column (for example Total) so quantities and rates are never double-counted.' },
  { section: 'Estimating', title: 'Maths in a cell', keys: 'formula calculate equals arithmetic percentage a1 sum avg reference', text: 'Start with = for safe arithmetic. Use A1 references inside the current grid: =B2*D2 calculates quantity × rate, while =SUM(E2:E20) and =AVG(D2:D20) work across a range. Formulas recalculate when referenced cells change.' },
  { section: 'Estimating', title: 'Number formats', keys: 'currency aud dollar percentage display', text: 'Select a numeric cell and use format to cycle automatic, number, AUD currency and percentage display. Formatting changes presentation only; the stored number and calculations stay precise.' },
  { section: 'Estimating', title: 'Estimator templates', keys: 'scope comparison procurement register trade wbs quote levelling', text: 'Trade estimate includes live quantity × rate totals and cost roll-ups. Scope comparison levels inclusions and adjusted quotes. Procurement register tracks package ownership, required dates, lead time and risk.' },
  { section: 'Estimating', title: 'Paste from a spreadsheet', keys: 'excel csv tsv import spreadsheet clipboard', text: 'Copy a range out of Excel and paste it onto a selected cell — the tab-separated block becomes a nested grid keeping its shape. An indented list pastes the same way, one level of nesting per indent.' },
  { section: 'Notes', title: 'Markdown in cells', keys: 'bold italic code strikethrough formatting', text: 'Cells render **bold**, *italic*, `code`, ~~strikethrough~~ and [text](https://example.com) links inline. Only http and https links are clickable.' },
  { section: 'Notes', title: 'Checkboxes', keys: 'task todo tick done percent complete', text: 'Start a cell with "- [ ] " or "[ ] " to get a tickable checkbox. Ticking it also marks the cell done, so a %-done roll-up on the parent stays honest.' },
  { section: 'Notes', title: 'Links between sheets', keys: 'wikilink backlink linked from obsidian', text: 'Type [[Sheet name]] in any cell to link to another sheet — clicking it opens that sheet, creating it if it does not exist yet. Each sheet shows a "Linked from" panel listing the sheets that point at it.' },
  { section: 'Notes', title: 'Tags, colours and emphasis', text: 'With a cell selected, use B and I for bold/italic, ◐ to cycle a background colour, and #tag to label it. Search matches tags as well as text.' },
  { section: 'Getting around', title: 'Search and filter', text: 'The find box highlights matching cells anywhere in the sheet. The ▼ button filters the view down to top-level rows that contain a match.' },
  { section: 'Getting around', title: 'Mind-map view', text: 'The 🗺 map button redraws the same data as a node-link tree — useful for seeing the shape of a breakdown. It is read-only; click a node to select that cell, then switch back to the grid to edit it.' },
  { section: 'Getting around', title: 'Zooming', text: 'Zoom into a nested grid with the ▦ chip, Insert, or Ctrl+scroll. PageUp or the breadcrumbs climb back out. On a touch screen, pinch out to zoom into the cell under your fingers and pinch in to climb out.' },
  { section: 'Getting around', title: 'Fullscreen workspace', keys: 'full screen mobile desktop focus app', text: 'Press ⛶ full to give the sheet the whole desktop or phone viewport. The toolbar remains sticky while you move through a large estimate; press the button again or Escape to leave.' },
  { section: 'Data', title: 'Export and import', keys: 'json download backup save outline tsv csv', text: 'The ⧉ button copies the current grid as an indented outline or as TSV for a spreadsheet, and downloads the whole sheet as JSON. Import JSON brings a sheet back in as a copy.' },
  { section: 'Data', title: 'Where your data lives', text: 'Everything stays in this browser only — nothing is uploaded and there is no account. Clearing site data clears your sheets, so download the JSON for anything you want to keep.' },
  { section: 'Data', title: 'Grid operations', text: 'The ⧉ menu also sorts rows by the selected cell’s column, transposes the grid, flattens a hierarchy into an outline, and does find-and-replace across the whole sheet when a search is active.' },
]

const SHORTCUTS: [string, string][] = [
  ['Arrows', 'Walk cells and the gaps between them'],
  ['Type on a gap', 'Insert a row or column there'],
  ['Enter', 'Edit the selected cell'],
  ['Insert / PageDown', 'Dive into a cell (creates a grid)'],
  ['PageUp', 'Climb out to the parent grid'],
  ['Tab / Shift+Tab', 'Next / previous cell'],
  ['Shift+arrows', 'Select a block'],
  ['Ctrl+arrows', 'Move the selected cell'],
  ['Ctrl+C / X / V', 'Copy / cut / paste a block'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+scroll', 'Zoom into or out of a grid'],
  ['Escape', 'Clear the selection'],
]

export function createLatticeTutorial(root: HTMLElement, helpBtn: HTMLElement): void {
  // ---- overlay ---------------------------------------------------------------
  const overlay = el('div', 'lat-tut')
  overlay.hidden = true
  const shade = el('div', 'lat-tut-shade')
  const card = el('div', 'lat-tut-card')

  const stepLabel = el('span', 'lat-tut-step')
  const title = el('h2', 'lat-tut-title')
  const body = el('p', 'lat-tut-text')
  const tourView = el('div', 'lat-tut-tour')
  tourView.append(stepLabel, title, body)

  const browseView = el('div', 'lat-tut-browse')
  browseView.hidden = true
  const search = document.createElement('input')
  search.type = 'search'
  search.className = 'lat-tut-search'
  search.placeholder = 'Search help…'
  search.setAttribute('aria-label', 'Search help')
  const topicList = el('div', 'lat-tut-topics')
  const shortcutBox = el('div', 'lat-tut-shortcuts')
  shortcutBox.append(el('div', 'lat-tut-sec', 'KEYBOARD'))
  for (const [key, desc] of SHORTCUTS) {
    const row = el('div', 'lat-tut-sc-row')
    row.append(el('span', 'lat-tut-key', key), el('span', 'lat-tut-desc', desc))
    shortcutBox.append(row)
  }
  browseView.append(el('h2', 'lat-tut-title', 'Lattice help'), search, topicList, shortcutBox)

  const actions = el('div', 'lat-tut-actions')
  const closeBtn = tbtn('✕ Close')
  const browseBtn = tbtn('Browse help ▤')
  const tourBtn = tbtn('▶ Take the tour')
  const prevBtn = tbtn('Previous')
  const nextBtn = tbtn('Next')
  actions.append(closeBtn, browseBtn, tourBtn, prevBtn, nextBtn)
  card.append(tourView, browseView, actions)
  overlay.append(shade, card)
  document.body.append(overlay)

  function renderTopics(query: string): void {
    topicList.replaceChildren()
    const q = query.trim().toLowerCase()
    const hits = HELP_TOPICS.filter(t => !q
      || t.title.toLowerCase().includes(q)
      || t.text.toLowerCase().includes(q)
      || t.section.toLowerCase().includes(q)
      || (t.keys?.includes(q) ?? false))
    if (!hits.length) { topicList.append(el('p', 'lat-tut-text', 'No matching topics.')); return }
    let section = ''
    for (const t of hits) {
      if (t.section !== section) { topicList.append(el('div', 'lat-tut-sec', t.section.toUpperCase())); section = t.section }
      const item = el('div', 'lat-tut-topic')
      item.append(el('h3', 'lat-tut-topic-title', t.title), el('p', 'lat-tut-text', t.text))
      topicList.append(item)
    }
  }
  search.addEventListener('input', () => renderTopics(search.value))
  renderTopics('')

  // ---- target resolution -----------------------------------------------------
  const q = (sel: string) => root.querySelector<HTMLElement>(sel)
  const ownerCellOf = (sel: string) => q(sel)?.closest<HTMLElement>('.lat-cell') ?? null
  const nestedCell = () => [...root.querySelectorAll<HTMLElement>('.lat-cell')]
    .find(c => c.querySelector('.lat-grid')) ?? null
  /** An empty leaf cell inside a nested grid — where the tour asks the user to type. */
  const innerLeaf = () => [...root.querySelectorAll<HTMLElement>('.lat-cell .lat-cell')]
    .find(c => !c.querySelector('.lat-grid') && !c.textContent?.trim()) ?? null

  const STEPS: Step[] = [
    {
      state: 'list', find: () => q('.lat-blurb'),
      title: 'A sheet inside a sheet',
      text: 'Lattice is a grid where any cell can hold another whole grid. Break a job into trades, a trade into items, and let the quantities add up on their own. Everything stays in this browser — no account, nothing uploaded.',
    },
    {
      state: 'list', find: () => q('.lat-tpl-wrap'),
      title: 'Start from a template',
      text: 'Start with a live trade estimate, scope comparison or procurement register, or use a general planning template. Each is ordinary Lattice data you can reshape.',
    },
    {
      state: 'list', find: () => q('.lat-card'),
      title: 'Your sheets live here',
      text: 'Every sheet you make is listed here with its size and when you last touched it. Next we will open a Trade estimate so there is something real to inspect.',
    },
    {
      state: 'editor', find: nestedCell,
      title: 'Nesting is the structure',
      text: 'This cell is a trade, and the grid drawn inside it holds that trade’s items. Click the ▦ chip (or press Insert) to zoom in so the nested grid fills the screen; the breadcrumbs above take you back out.',
    },
    {
      state: 'editor', find: () => ownerCellOf('.lat-rollup'),
      title: 'Roll-ups do the adding',
      text: 'The AUD value in the corner totals only the Total column beneath this cell and updates as quantity or rate changes. Select a nested cell to change its aggregation type or source column.',
    },
    {
      state: 'editor', find: innerLeaf,
      title: 'Try it — maths in a cell',
      text: 'Click this empty cell and type  =40*95  then press Enter. It shows 3800 with a small ƒ marker, and the Σ above jumps to match. Percentages work too: =1200*10%.',
    },
    {
      state: 'editor', find: innerLeaf,
      title: 'Notes, markdown and checkboxes',
      text: 'Cells are not just numbers. Type  **bold**  or  `code`  and it renders. Start a cell with  - [ ]  to get a tickable checkbox — ticking it also marks the cell done, so a %-done roll-up stays honest.',
    },
    {
      state: 'editor', find: () => q('.lat-title'),
      title: 'Link sheets together',
      text: 'Type  [[Rate Builder]]  in any cell to link to another sheet — clicking it opens that sheet, creating it if it does not exist. Each sheet also lists what points back at it under "Linked from" at the bottom.',
    },
    {
      state: 'editor', find: () => q('.lat-wrap'),
      title: 'Paste straight from Excel',
      text: 'Copy a range out of a spreadsheet, select a cell here and paste — the block lands as a nested grid with its shape intact. An indented list pastes the same way, one nesting level per indent.',
    },
    {
      state: 'editor', find: () => q('[aria-label="Export"]'),
      title: 'Getting data back out',
      text: 'Copy the grid as an indented outline or as TSV for a spreadsheet, or download the whole sheet as JSON. The same menu sorts, transposes, flattens and does find-and-replace.',
    },
    {
      state: 'editor', find: () => helpBtn,
      title: 'Come back anytime',
      text: 'This button reopens the tour, or Browse help — a searchable reference with the full keyboard shortcut list. That is everything; go and break something.',
    },
  ]

  // ---- tour sheet lifecycle --------------------------------------------------
  // The tour needs a sheet with real nesting and a roll-up to point at. It makes
  // one from the WBS template and removes it on exit — but only if it is still
  // pristine, because steps 6 and 7 invite the user to type into it.
  let tourSheetId: string | null = null
  let pristine: string | null = null

  function snapshotOf(id: string): string | null {
    const s = loadAll().find(x => x.id === id)
    return s ? JSON.stringify({ title: s.title, root: s.root }) : null
  }

  function discardTourSheetIfUntouched(): void {
    if (!tourSheetId) return
    const now = snapshotOf(tourSheetId)
    if (now !== null && now === pristine) remove(tourSheetId)
    tourSheetId = null
    pristine = null
  }

  async function ensureList(): Promise<void> {
    if (q('.lat-tpl-wrap')) return
    q('.lat-toolbar [aria-label="All sheets"]')?.click()
    await settle()
  }

  async function ensureEditor(): Promise<void> {
    if (q('.lat-toolbar')) return
    await ensureList()
    // Reopen the tour sheet if we already made one this session. Matched by
    // position rather than name: loadAll() and drawList agree on order, and the
    // user may well have their own sheet with the same title.
    if (tourSheetId) {
      const idx = loadAll().findIndex(s => s.id === tourSheetId)
      const row = idx < 0 ? null : root.querySelectorAll<HTMLElement>('.lat-sheet-open')[idx]
      if (row) { row.click(); await settle(); if (q('.lat-toolbar')) return }
      tourSheetId = null       // it is gone from storage; fall through and make a fresh one
      pristine = null
    }
    const before = new Set(loadAll().map(s => s.id))
    const tpl = [...root.querySelectorAll<HTMLElement>('.lat-tpl')]
      .find(t => t.querySelector('.lat-tpl-name')?.textContent === WBS_TEMPLATE)
    tpl?.click()
    await settle()
    const made = loadAll().find(s => !before.has(s.id))
    if (made) { tourSheetId = made.id; pristine = snapshotOf(made.id) }
  }

  // ---- tour ------------------------------------------------------------------
  let index = 0
  let spotlit: HTMLElement | null = null

  function clearSpotlight(): void {
    spotlit?.classList.remove('lat-tut-target')
    spotlit = null
  }

  function setMode(mode: 'tour' | 'browse'): void {
    tourView.hidden = mode !== 'tour'
    browseView.hidden = mode !== 'browse'
    card.classList.toggle('lat-tut-browsing', mode === 'browse')
    prevBtn.hidden = mode !== 'tour'
    nextBtn.hidden = mode !== 'tour'
    browseBtn.hidden = mode !== 'tour'
    tourBtn.hidden = mode !== 'browse'
  }

  async function showStep(i: number): Promise<void> {
    setMode('tour')
    index = Math.max(0, Math.min(STEPS.length - 1, i))
    const step = STEPS[index]
    clearSpotlight()
    // Open the overlay first so the state change happens behind the shade.
    overlay.hidden = false
    if (step.state === 'list') await ensureList()
    else await ensureEditor()

    const target = step.find()
    if (target) {
      spotlit = target
      target.classList.add('lat-tut-target')
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    stepLabel.textContent = `${index + 1} / ${STEPS.length}`
    title.textContent = step.title
    body.textContent = step.text
    prevBtn.disabled = index === 0
    nextBtn.textContent = index === STEPS.length - 1 ? 'Finish' : 'Next'
  }

  async function close(): Promise<void> {
    overlay.hidden = true
    clearSpotlight()
    // Hand the sheet back to the list before deleting it. The view re-persists
    // whatever it still has open when you leave the editor, so deleting first
    // just gets the tour sheet resurrected on the next navigation.
    if (tourSheetId) await ensureList()
    discardTourSheetIfUntouched()
    localStorage.setItem(SEEN_KEY, '1')
  }

  function openHelp(): void {
    clearSpotlight()
    setMode('browse')
    overlay.hidden = false
  }

  prevBtn.addEventListener('click', () => void showStep(index - 1))
  nextBtn.addEventListener('click', () => {
    if (index === STEPS.length - 1) void close()
    else void showStep(index + 1)
  })
  closeBtn.addEventListener('click', () => void close())
  shade.addEventListener('click', () => void close())
  browseBtn.addEventListener('click', openHelp)
  tourBtn.addEventListener('click', () => void showStep(0))
  helpBtn.addEventListener('click', openHelp)
  document.addEventListener('keydown', (e) => {
    if (!overlay.hidden && e.key === 'Escape') { e.preventDefault(); void close() }
  })

}
