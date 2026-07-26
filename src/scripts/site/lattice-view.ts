// Lattice shared renderer — dependency-free like lattice-model.ts, and for the
// same reason: this file is byte-identical in vvDeck and vishvaddi.com. Host
// differences (storage, toasts, sounds) come in through the adapter. Do not
// import anything except the model here.
import {
  type LatticeSheet, type LatticeGrid, type LatticeCell,
  locate, gridAtPath, setText, insertSubgrid, removeSubgrid,
  insertRow, deleteRow, insertCol, deleteCol, moveCell, rollupLabel,
  fromIndentedText, toIndentedText, fromTSV, toTSV, templateSheets, newSheet, latticeId,
  sortGrid, transposeGrid, flattenGrid, subtreeMatches, replaceAll,
} from './lattice-model'

export interface LatticeAdapter {
  loadAll(): Promise<LatticeSheet[]> | LatticeSheet[]
  persist(sheet: LatticeSheet): Promise<void> | void
  remove(id: string): Promise<void> | void
  toast(msg: string, kind?: 'info' | 'success' | 'error'): void
  /** optional hook: a cell was ticked done (deck plays a sound) */
  onTick?(): void
}

const COLLAPSE_DEPTH = 2
const UNDO_CAP = 50

// selected grid line: the grid it belongs to (via owner cell id or root),
// axis, and boundary index (row line i sits between rows i-1 and i).
// `at` remembers the perpendicular coordinate so keyboard traversal
// (cell → line → cell, TreeSheets-style) returns to the right row/column.
interface LineSel { owner: string | null; axis: 'row' | 'col'; index: number; at?: number }
interface RectSel { owner: string | null; r0: number; c0: number; r1: number; c1: number }

interface ClipBlock { rows: LatticeCell[][] }
let clipboard: ClipBlock | null = null      // module-level: survives sheet switches

function deepCloneNewIds(cell: LatticeCell): LatticeCell {
  const c: LatticeCell = { ...cell, id: latticeId() }
  if (cell.grid) c.grid = { cols: cell.grid.cols, rows: cell.grid.rows.map(r => r.map(deepCloneNewIds)) }
  return c
}

// tap-twice destructive confirm — shared behaviour on both hosts, no dialogs
export function armTwice(btn: HTMLButtonElement, label: string, fn: () => void): void {
  btn.addEventListener('click', () => {
    if (btn.dataset.armed) { fn(); return }
    btn.dataset.armed = '1'
    const prev = btn.textContent
    btn.textContent = label
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = prev }, 2500)
  })
}

// 8 fill colours that read on both hosts' light + dark surfaces
const FILLS = ['#5b8dd633', '#c5683f33', '#6aa84f33', '#8e63ce33', '#d0a03f33', '#4fa8a033', '#c65b7a33', '#7a7a7a33']

// Obsidian-style inline markdown, rendered XSS-safe (textContent only, no innerHTML).
// Order matters: wikilink · [text](url) · `code` · **bold** · ~~strike~~ · *italic* · _italic_.
// Bold/strike bodies are lazy (not [^*]+/[^~]+) so they can contain nested emphasis —
// a greedy-free class made "**a *b* c**" fall through to the single-* branch mid-string.
const INLINE_RE = /\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*(.+?)\*\*|~~(.+?)~~|\*([^*\n]+)\*|_([^_\n]+)_/g

/** Append `text` to `parent` as inline-markdown DOM nodes. Recurses into emphasis, never into code. */
function renderInline(parent: HTMLElement, text: string): void {
  let last = 0
  // matchAll, not an exec loop: this function recurses into emphasis, and a shared /g
  // regex's lastIndex is reset by the inner call — the outer loop then re-matches from
  // the start forever. matchAll iterates over its own clone, so recursion can't clobber it.
  for (const m of text.matchAll(INLINE_RE)) {
    const at = m.index ?? 0
    if (at > last) parent.appendChild(document.createTextNode(text.slice(last, at)))
    if (m[1] !== undefined) {
      const a = document.createElement('button')
      a.className = 'lat-link'; a.dataset.link = m[1]; a.textContent = m[1]
      parent.appendChild(a)
    } else if (m[2] !== undefined) {
      const a = document.createElement('a')
      a.className = 'lat-extlink'; a.textContent = m[2]
      if (/^https?:\/\//i.test(m[3])) { a.href = m[3]; a.target = '_blank'; a.rel = 'noopener noreferrer' }  // http(s) only — blocks javascript:/data:
      parent.appendChild(a)
    } else if (m[4] !== undefined) {
      const c = document.createElement('code'); c.className = 'lat-code'; c.textContent = m[4]
      parent.appendChild(c)
    } else if (m[5] !== undefined) {
      const b = document.createElement('strong'); renderInline(b, m[5]); parent.appendChild(b)
    } else if (m[6] !== undefined) {
      const s = document.createElement('s'); renderInline(s, m[6]); parent.appendChild(s)
    } else {
      const em = document.createElement('em'); renderInline(em, (m[7] ?? m[8])!); parent.appendChild(em)
    }
    last = at + m[0].length
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)))
}

// Leading task marker: "[ ] ", "[x] ", or "- [ ] " (Obsidian checkbox syntax).
// The "- " is captured, not skipped, so toggling can put it back — dropping it would
// rewrite a list item into a bare marker and break round-tripping to Obsidian.
const TASK_RE = /^(- )?\[([ xX])\]\s+/

/** True if any cell in the subtree wiki-links to `title` (case-insensitive). */
function gridLinksTo(grid: LatticeGrid, title: string): boolean {
  const want = title.trim().toLowerCase()
  for (const row of grid.rows) for (const cell of row) {
    const re = /\[\[([^\]]+)\]\]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(cell.text))) if (m[1].trim().toLowerCase() === want) return true
    if (cell.grid && gridLinksTo(cell.grid, title)) return true
  }
  return false
}

export function createLatticeView(el: HTMLElement, adapter: LatticeAdapter): void {
  let sheet: LatticeSheet | null = null
  let zoomPath: string[] = []
  let selectedId: string | null = null
  let lineSel: LineSel | null = null
  let rectSel: RectSel | null = null
  let editing = false
  let undoStack: string[] = []
  let redoStack: string[] = []
  let saveTimer: number | undefined
  let mapMode = false
  let searchQ = ''
  let filterOn = false

  const resolveGrid = (owner: string | null, root: LatticeGrid): LatticeGrid | null =>
    owner === null ? root : (locate(root, owner)?.cell.grid ?? null)

  /** Owner-cell id of a grid within the displayed tree (null = the displayed root). */
  function ownerOf(display: LatticeGrid, g: LatticeGrid): string | null {
    if (display === g) return null
    const walk = (gr: LatticeGrid): string | undefined => {
      for (const row of gr.rows) for (const cell of row) {
        if (cell.grid === g) return cell.id
        if (cell.grid) {
          const r = walk(cell.grid)
          if (r !== undefined) return r
        }
      }
      return undefined
    }
    return walk(display) ?? null
  }

  function scheduleSave() {
    if (!sheet) return
    sheet.updated = Date.now()
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => { if (sheet) void adapter.persist(sheet) }, 400)
  }

  function snapshot() {
    if (!sheet) return
    undoStack.push(JSON.stringify(sheet.root))
    if (undoStack.length > UNDO_CAP) undoStack.shift()
    redoStack = []
  }

  function undo() {
    if (!sheet || !undoStack.length) return
    redoStack.push(JSON.stringify(sheet.root))
    sheet.root = JSON.parse(undoStack.pop()!)
    afterMutate()
  }

  function redo() {
    if (!sheet || !redoStack.length) return
    undoStack.push(JSON.stringify(sheet.root))
    sheet.root = JSON.parse(redoStack.pop()!)
    afterMutate()
  }

  function afterMutate() {
    if (sheet) {
      const valid: string[] = []
      let g = sheet.root
      for (const id of zoomPath) {
        const loc = locate(g, id)
        if (!loc?.cell.grid) break
        valid.push(id)
        g = loc.cell.grid
      }
      zoomPath = valid
    }
    lineSel = null
    rectSel = null
    scheduleSave()
    drawEditor()
  }

  // ---- sheet list -------------------------------------------------------------

  async function drawList() {
    sheet = null
    const sheets = await adapter.loadAll()
    el.innerHTML = ''

    const listCard = document.createElement('div')
    listCard.className = 'lat-card'
    const h = document.createElement('div')
    h.className = 'lat-card-title'
    h.textContent = 'SHEETS'
    listCard.appendChild(h)
    const blurb = document.createElement('p')
    blurb.className = 'lat-blurb'
    blurb.textContent = 'Grids inside grids — plans, breakdowns, brain dumps. Click a gap between cells and type to insert a row or column.'
    listCard.appendChild(blurb)

    if (!sheets.length) {
      const empty = document.createElement('p')
      empty.className = 'lat-blurb'
      empty.textContent = 'No sheets yet — start from a template below.'
      listCard.appendChild(empty)
    }
    for (const s of sheets) {
      const row = document.createElement('div')
      row.className = 'lat-sheet-row'
      const open = document.createElement('button')
      open.className = 'lat-sheet-open'
      const t = document.createElement('div')
      t.className = 'lat-sheet-name'
      t.textContent = s.title
      const sub = document.createElement('div')
      sub.className = 'lat-sheet-sub'
      sub.textContent = `${new Date(s.updated).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} · ${s.root.rows.length}×${s.root.cols}`
      open.append(t, sub)
      open.addEventListener('click', async () => {
        const fresh = (await adapter.loadAll()).find(x => x.id === s.id)
        if (fresh) openSheet(fresh)
      })
      const del = document.createElement('button')
      del.className = 'lat-del'
      del.setAttribute('aria-label', `Delete ${s.title}`)
      del.textContent = '✕'
      armTwice(del, 'sure?', async () => { await adapter.remove(s.id); drawList() })
      row.append(open, del)
      listCard.appendChild(row)
    }
    el.appendChild(listCard)

    const tplCard = document.createElement('div')
    tplCard.className = 'lat-card'
    const th = document.createElement('div')
    th.className = 'lat-card-title'
    th.textContent = 'NEW SHEET'
    tplCard.appendChild(th)
    const wrap = document.createElement('div')
    wrap.className = 'lat-tpl-wrap'
    templateSheets().forEach(tpl => {
      const b = document.createElement('button')
      b.className = 'lat-tpl'
      const n = document.createElement('div')
      n.className = 'lat-tpl-name'
      n.textContent = tpl.name
      const d = document.createElement('div')
      d.className = 'lat-tpl-blurb'
      d.textContent = tpl.blurb
      b.append(n, d)
      b.addEventListener('click', async () => {
        const s = tpl.make()
        await adapter.persist(s)
        openSheet(s)
      })
      wrap.appendChild(b)
    })
    tplCard.appendChild(wrap)
    el.appendChild(tplCard)
  }

  function openSheet(s: LatticeSheet) {
    sheet = s
    zoomPath = []
    selectedId = null
    lineSel = null
    rectSel = null
    editing = false
    undoStack = []
    redoStack = []
    drawEditor()
  }

  async function openLinkedSheet(title: string) {
    clearTimeout(saveTimer)
    if (sheet) await adapter.persist(sheet)
    const hit = (await adapter.loadAll()).find(s => s.title.toLowerCase() === title.trim().toLowerCase())
    if (hit) {
      openSheet(hit)
    } else {
      const s = newSheet(title.trim())
      await adapter.persist(s)
      openSheet(s)
      adapter.toast(`Created "${title.trim()}"`, 'success')
    }
  }

  /** Sheets that wiki-link to `title` — the Obsidian backlinks panel. */
  async function renderBacklinks(container: HTMLElement, title: string) {
    const cur = sheet
    if (!cur) return
    const all = await adapter.loadAll()
    if (!container.isConnected) return          // a later redraw replaced us
    const hits = all.filter(s => s.id !== cur.id && gridLinksTo(s.root, title))
    if (!hits.length) return
    const card = document.createElement('div')
    card.className = 'lat-backlinks'
    const h = document.createElement('div')
    h.className = 'lat-backlinks-title'
    h.textContent = `↩ Linked from (${hits.length})`
    card.appendChild(h)
    for (const s of hits) {
      const b = document.createElement('button')
      b.className = 'lat-backlink'
      b.textContent = s.title
      b.addEventListener('click', () => openSheet(s))
      card.appendChild(b)
    }
    container.appendChild(card)
  }

  // ---- rendering ----------------------------------------------------------------

  function inRect(owner: string | null, r: number, c: number): boolean {
    if (!rectSel || rectSel.owner !== owner) return false
    return r >= Math.min(rectSel.r0, rectSel.r1) && r <= Math.max(rectSel.r0, rectSel.r1)
      && c >= Math.min(rectSel.c0, rectSel.c1) && c <= Math.max(rectSel.c0, rectSel.c1)
  }

  function cellEl(cell: LatticeCell, depth: number, owner: string | null, r: number, c: number): HTMLElement {
    const d = document.createElement('div')
    d.className = 'lat-cell'
    d.dataset.id = cell.id
    d.dataset.owner = owner ?? ''
    d.dataset.r = String(r)
    d.dataset.c = String(c)
    if (cell.id === selectedId) d.classList.add('lat-selected')
    if (inRect(owner, r, c)) d.classList.add('lat-multi')
    if (cell.done) d.classList.add('lat-done')
    if (cell.style?.b) d.classList.add('lat-b')
    if (cell.style?.i) d.classList.add('lat-i')
    if (typeof cell.style?.fill === 'number') d.style.background = FILLS[cell.style.fill % FILLS.length]
    if (searchQ && (cell.text.toLowerCase().includes(searchQ) || (cell.tag ?? '').toLowerCase().includes(searchQ))) d.classList.add('lat-hit')

    if (cell.tag) {
      const tg = document.createElement('span')
      tg.className = 'lat-tag'
      tg.textContent = cell.tag
      d.appendChild(tg)
    }

    const label = rollupLabel(cell)
    if (label) {
      const rl = document.createElement('span')
      rl.className = 'lat-rollup'
      rl.textContent = label
      d.appendChild(rl)
    }

    if (cell.text) {
      const t = document.createElement('span')
      t.className = 'lat-text'
      if (cell.text.startsWith('=') && typeof cell.num === 'number') {
        t.textContent = String(cell.num)
        const f = document.createElement('span')
        f.className = 'lat-formula'
        f.textContent = 'ƒ'
        f.title = cell.text
        t.appendChild(f)
      } else {
        const task = TASK_RE.exec(cell.text)
        if (task) {
          const box = document.createElement('button')
          box.className = 'lat-check'
          box.dataset.check = cell.id
          const checked = task[2] !== ' '
          box.textContent = checked ? '☑' : '☐'
          box.setAttribute('role', 'checkbox')
          box.setAttribute('aria-checked', String(checked))
          t.appendChild(box)
          renderInline(t, cell.text.slice(task[0].length))
        } else {
          renderInline(t, cell.text)
        }
      }
      d.appendChild(t)
    }

    if (cell.grid) {
      if (depth < COLLAPSE_DEPTH) {
        d.appendChild(gridEl(cell.grid, depth + 1, cell.id))
      } else {
        const chip = document.createElement('button')
        chip.className = 'lat-chip'
        chip.dataset.zoom = cell.id
        chip.textContent = `▦ ${cell.grid.rows.length}×${cell.grid.cols}`
        d.appendChild(chip)
      }
    }
    if (!cell.text && !cell.grid) d.classList.add('lat-empty')
    return d
  }

  function gridEl(grid: LatticeGrid, depth: number, owner: string | null): HTMLElement {
    const g = document.createElement('div')
    g.className = 'lat-grid'
    g.dataset.gridOwner = owner ?? ''
    g.style.gridTemplateColumns = `repeat(${grid.cols}, minmax(${depth === 0 ? 72 : 48}px, 1fr))`
    grid.rows.forEach((row, r) => {
      // filter mode: hide top-level rows whose subtree has no match
      if (depth === 0 && filterOn && searchQ && !row.some(c => subtreeMatches(c, searchQ))) return
      row.forEach((cell, c) => g.appendChild(cellEl(cell, depth, owner, r, c)))
    })
    return g
  }

  // ---- mind-map view: same data, node-link layout -------------------------------

  function mapEl(grid: LatticeGrid): HTMLElement {
    const NODE_W = 150, NODE_H = 34, GAP_X = 44, GAP_Y = 10
    interface Node { cell: LatticeCell; depth: number; y: number; children: Node[] }
    let nextY = 0
    const build = (cell: LatticeCell, depth: number): Node => {
      const kids: Node[] = []
      if (cell.grid) for (const row of cell.grid.rows) for (const c of row) {
        if (c.text.trim() || c.grid) kids.push(build(c, depth + 1))
      }
      let y: number
      if (kids.length) y = (kids[0].y + kids[kids.length - 1].y) / 2
      else { y = nextY; nextY += NODE_H + GAP_Y }
      return { cell, depth, y, children: kids }
    }
    const roots: Node[] = []
    for (const row of grid.rows) for (const c of row) {
      if (c.text.trim() || c.grid) roots.push(build(c, 0))
    }
    const all: Node[] = []
    const collect = (n: Node) => { all.push(n); n.children.forEach(collect) }
    roots.forEach(collect)
    const maxDepth = Math.max(0, ...all.map(n => n.depth))
    const width = (maxDepth + 1) * (NODE_W + GAP_X) + 20
    const height = Math.max(nextY, NODE_H) + 20

    const holder = document.createElement('div')
    holder.className = 'lat-map'
    holder.style.cssText = `position:relative;width:${width}px;height:${height}px`
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    svg.setAttribute('class', 'lat-map-links')
    holder.appendChild(svg)
    for (const n of all) {
      const x = n.depth * (NODE_W + GAP_X) + 10
      for (const k of n.children) {
        const path = document.createElementNS(NS, 'path')
        const x1 = x + NODE_W, y1 = n.y + NODE_H / 2
        const x2 = k.depth * (NODE_W + GAP_X) + 10, y2 = k.y + NODE_H / 2
        path.setAttribute('d', `M ${x1} ${y1} C ${x1 + GAP_X / 2} ${y1}, ${x2 - GAP_X / 2} ${y2}, ${x2} ${y2}`)
        svg.appendChild(path)
      }
      const nd = document.createElement('button')
      nd.className = 'lat-map-node'
      nd.dataset.id = n.cell.id
      if (n.cell.id === selectedId) nd.classList.add('lat-selected')
      if (typeof n.cell.style?.fill === 'number') nd.style.background = FILLS[n.cell.style.fill % FILLS.length]
      nd.style.cssText += `;position:absolute;left:${x}px;top:${n.y}px;width:${NODE_W}px;min-height:${NODE_H}px`
      const txt = n.cell.text.startsWith('=') && typeof n.cell.num === 'number' ? String(n.cell.num) : n.cell.text
      nd.textContent = txt.length > 40 ? txt.slice(0, 39) + '…' : (txt || '▦')
      if (n.cell.done) nd.classList.add('lat-done-node')
      nd.addEventListener('click', () => {
        selectedId = n.cell.id === selectedId ? null : n.cell.id
        drawEditor()
      })
      holder.appendChild(nd)
    }
    return holder
  }

  /** Highlight the selected grid line by measuring the rendered cells around it. */
  function paintLineSel(wrap: HTMLElement, root: LatticeGrid) {
    wrap.querySelectorAll('.lat-linesel').forEach(x => x.remove())
    if (!lineSel) return
    const gridDom = [...wrap.querySelectorAll<HTMLElement>('.lat-grid')]
      .find(g => (g.dataset.gridOwner ?? '') === (lineSel!.owner ?? ''))
    const grid = resolveGrid(lineSel.owner, root)
    if (!gridDom || !grid) { lineSel = null; return }
    const gr = gridDom.getBoundingClientRect()
    const hl = document.createElement('div')
    hl.className = 'lat-linesel'
    if (lineSel.axis === 'row') {
      // y = between rows index-1 and index — measure first cell of each row
      let y: number
      if (lineSel.index === 0) y = 0
      else if (lineSel.index >= grid.rows.length) y = gr.height
      else {
        const below = gridDom.querySelector<HTMLElement>(`.lat-cell[data-owner="${lineSel.owner ?? ''}"][data-r="${lineSel.index}"][data-c="0"]`)
        y = below ? below.getBoundingClientRect().top - gr.top - 2 : 0
      }
      hl.style.cssText = `top:${y - 1}px;left:0;width:100%;height:4px`
    } else {
      let x: number
      if (lineSel.index === 0) x = 0
      else if (lineSel.index >= grid.cols) x = gr.width
      else {
        const right = gridDom.querySelector<HTMLElement>(`.lat-cell[data-owner="${lineSel.owner ?? ''}"][data-r="0"][data-c="${lineSel.index}"]`)
        x = right ? right.getBoundingClientRect().left - gr.left - 2 : 0
      }
      hl.style.cssText = `left:${x - 1}px;top:0;height:100%;width:4px`
    }
    gridDom.style.position = 'relative'
    gridDom.appendChild(hl)
  }

  function startEdit(cell: LatticeCell, cellDiv: HTMLElement, seed?: string) {
    if (editing) return
    editing = true
    const ta = document.createElement('textarea')
    ta.className = 'lat-edit'
    ta.value = seed !== undefined ? seed : cell.text
    ta.rows = 1
    cellDiv.querySelector('.lat-text')?.remove()
    cellDiv.classList.remove('lat-empty')
    cellDiv.appendChild(ta)
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px` }
    grow()
    ta.addEventListener('input', grow)

    const commit = () => {
      if (!editing) return
      editing = false
      if (sheet && ta.value !== cell.text) {
        snapshot()
        setText(sheet.root, cell.id, ta.value)
        afterMutate()
      } else {
        drawEditor()
      }
    }
    ta.addEventListener('blur', commit)
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur() }
      if (e.key === 'Escape') { e.preventDefault(); editing = false; drawEditor() }
    })
  }

  // ---- clipboard ------------------------------------------------------------------

  function selectedBlock(root: LatticeGrid): { grid: LatticeGrid; r0: number; c0: number; r1: number; c1: number } | null {
    if (rectSel) {
      const g = resolveGrid(rectSel.owner, root)
      if (!g) return null
      return {
        grid: g,
        r0: Math.min(rectSel.r0, rectSel.r1), r1: Math.max(rectSel.r0, rectSel.r1),
        c0: Math.min(rectSel.c0, rectSel.c1), c1: Math.max(rectSel.c0, rectSel.c1),
      }
    }
    if (selectedId) {
      const loc = locate(root, selectedId)
      if (!loc) return null
      return { grid: loc.grid, r0: loc.row, r1: loc.row, c0: loc.col, c1: loc.col }
    }
    return null
  }

  async function copySelection(cut: boolean) {
    if (!sheet) return
    const blk = selectedBlock(sheet.root)
    if (!blk) return
    const rows: LatticeCell[][] = []
    for (let r = blk.r0; r <= blk.r1; r++) {
      const row: LatticeCell[] = []
      for (let c = blk.c0; c <= blk.c1; c++) row.push(JSON.parse(JSON.stringify(blk.grid.rows[r][c])))
      rows.push(row)
    }
    clipboard = { rows }
    const asGrid: LatticeGrid = { cols: rows[0].length, rows }
    try { await navigator.clipboard.writeText(rows.length === 1 && rows[0].length === 1 && !rows[0][0].grid ? rows[0][0].text : toTSV(asGrid)) } catch { /* system clipboard optional */ }
    if (cut) {
      snapshot()
      for (let r = blk.r0; r <= blk.r1; r++) for (let c = blk.c0; c <= blk.c1; c++) {
        blk.grid.rows[r][c] = { id: latticeId(), text: '' }
      }
      afterMutate()
    } else {
      adapter.toast('Copied', 'success')
    }
  }

  function pasteBlock() {
    if (!sheet || !clipboard || !selectedId) return
    const loc = locate(sheet.root, selectedId)
    if (!loc) return
    snapshot()
    const need = loc.row + clipboard.rows.length - loc.grid.rows.length
    for (let i = 0; i < need; i++) insertRow(loc.grid, loc.grid.rows.length)
    const needC = loc.col + clipboard.rows[0].length - loc.grid.cols
    for (let i = 0; i < needC; i++) insertCol(loc.grid, loc.grid.cols)
    clipboard.rows.forEach((row, dr) => row.forEach((cell, dc) => {
      loc.grid.rows[loc.row + dr][loc.col + dc] = deepCloneNewIds(cell)
    }))
    afterMutate()
  }

  // ---- editor ---------------------------------------------------------------------

  function drawEditor() {
    if (!sheet) return
    const root = sheet.root
    const grid = gridAtPath(root, zoomPath)
    const zoomOwner = zoomPath.length ? zoomPath[zoomPath.length - 1] : null
    const crumbs: LatticeCell[] = []
    {
      let g = root
      for (const id of zoomPath) {
        const loc = locate(g, id)
        if (!loc?.cell.grid) break
        crumbs.push(loc.cell)
        g = loc.cell.grid
      }
    }

    el.innerHTML = ''

    const bar = document.createElement('div')
    bar.className = 'lat-toolbar'
    const back = document.createElement('button')
    back.className = 'lat-tb'
    back.setAttribute('aria-label', 'All sheets')
    back.textContent = '☰'
    const title = document.createElement('input')
    title.className = 'lat-title'
    title.value = sheet.title
    title.setAttribute('aria-label', 'Sheet name')
    title.addEventListener('change', () => {
      if (!sheet) return
      const v = title.value.trim()
      if (v) { sheet.title = v; scheduleSave() }
    })
    const spacer = document.createElement('span')
    spacer.className = 'lat-spacer'
    const undoB = document.createElement('button')
    undoB.className = 'lat-tb'
    undoB.setAttribute('aria-label', 'Undo')
    undoB.textContent = '↶'
    undoB.disabled = !undoStack.length
    undoB.addEventListener('click', undo)
    const redoB = document.createElement('button')
    redoB.className = 'lat-tb'
    redoB.setAttribute('aria-label', 'Redo')
    redoB.textContent = '↷'
    redoB.disabled = !redoStack.length
    redoB.addEventListener('click', redo)
    const exportB = document.createElement('button')
    exportB.className = 'lat-tb'
    exportB.setAttribute('aria-label', 'Export')
    exportB.textContent = '⧉'
    const mapB = document.createElement('button')
    mapB.className = 'lat-tb'
    mapB.setAttribute('aria-label', 'Toggle mind-map view')
    mapB.textContent = mapMode ? '▦ grid' : '🗺 map'
    mapB.addEventListener('click', () => { mapMode = !mapMode; lineSel = null; rectSel = null; drawEditor() })
    const search = document.createElement('input')
    search.className = 'lat-search'
    search.type = 'search'
    search.placeholder = 'find…'
    search.value = searchQ
    search.setAttribute('aria-label', 'Search cells')
    let searchT: number | undefined
    search.addEventListener('input', () => {
      clearTimeout(searchT)
      searchT = window.setTimeout(() => {
        searchQ = search.value.trim().toLowerCase()
        drawEditor()
        const s2 = el.querySelector<HTMLInputElement>('.lat-search')
        if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length) }
      }, 300)
    })
    search.addEventListener('keydown', e => e.stopPropagation())
    const filterB = document.createElement('button')
    filterB.className = 'lat-tb'
    filterB.setAttribute('aria-label', 'Filter to matches')
    filterB.textContent = filterOn ? '▼ on' : '▼'
    filterB.title = 'Show only rows with a match'
    filterB.addEventListener('click', () => { filterOn = !filterOn; drawEditor() })
    bar.append(back, title, spacer, search, filterB, mapB, undoB, redoB, exportB)
    el.appendChild(bar)

    back.addEventListener('click', async () => {
      clearTimeout(saveTimer)
      if (sheet) await adapter.persist(sheet)
      drawList()
    })

    if (zoomPath.length) {
      const bc = document.createElement('div')
      bc.className = 'lat-crumbs'
      const rootBtn = document.createElement('button')
      rootBtn.textContent = '⌂'
      rootBtn.setAttribute('aria-label', 'Zoom to root')
      rootBtn.addEventListener('click', () => { zoomPath = []; selectedId = null; lineSel = null; rectSel = null; drawEditor() })
      bc.appendChild(rootBtn)
      crumbs.forEach((c, i) => {
        const sep = document.createElement('span')
        sep.textContent = '›'
        sep.className = 'lat-crumb-sep'
        bc.appendChild(sep)
        const b = document.createElement('button')
        b.textContent = c.text.trim() ? (c.text.length > 18 ? c.text.slice(0, 17) + '…' : c.text) : '▦'
        b.addEventListener('click', () => { zoomPath = zoomPath.slice(0, i + 1); selectedId = null; lineSel = null; rectSel = null; drawEditor() })
        bc.appendChild(b)
      })
      el.appendChild(bc)
    }

    const wrap = document.createElement('div')
    wrap.className = 'lat-wrap'
    wrap.appendChild(mapMode ? mapEl(grid) : gridEl(grid, 0, zoomOwner))
    el.appendChild(wrap)

    const sel = selectedId ? locate(grid, selectedId) : null
    const act = document.createElement('div')
    act.className = 'lat-actions'
    el.appendChild(act)

    // export menu
    exportB.addEventListener('click', () => {
      const existing = el.querySelector('#lat-export')
      if (existing) { existing.remove(); return }
      const menu = document.createElement('div')
      menu.id = 'lat-export'
      menu.className = 'lat-actions'
      const src = sel?.cell.grid ?? grid
      const copyBtn = (label: string, fn: () => string) => {
        const b = document.createElement('button')
        b.className = 'lat-tb'
        b.textContent = label
        b.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(fn()); adapter.toast('Copied', 'success') }
          catch { adapter.toast('Clipboard blocked', 'error') }
          menu.remove()
        })
        return b
      }
      menu.appendChild(copyBtn('copy outline', () => toIndentedText(src)))
      menu.appendChild(copyBtn('copy table (TSV)', () => toTSV(src)))
      const dl = document.createElement('button')
      dl.className = 'lat-tb'
      dl.textContent = 'download JSON'
      dl.addEventListener('click', () => {
        if (!sheet) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([JSON.stringify(sheet, null, 2)], { type: 'application/json' }))
        a.download = `${sheet.title.replace(/[^\w\- ]+/g, '')}.lattice.json`
        a.click()
        URL.revokeObjectURL(a.href)
        menu.remove()
      })
      menu.appendChild(dl)
      const imp = document.createElement('button')
      imp.className = 'lat-tb'
      imp.textContent = 'import JSON'
      imp.addEventListener('click', () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json,application/json'
        input.addEventListener('change', async () => {
          const f = input.files?.[0]
          if (!f) return
          try {
            const s = JSON.parse(await f.text()) as LatticeSheet
            if (!s.root?.rows) throw new Error('bad shape')
            s.id = `${s.id}-imp${Date.now().toString(36)}`
            await adapter.persist(s)
            openSheet(s)
            adapter.toast(`Imported "${s.title}"`, 'success')
          } catch { adapter.toast('Not a Lattice JSON file', 'error') }
        })
        input.click()
        menu.remove()
      })
      menu.appendChild(imp)
      // grid ops — act on the selected cell's grid, else the displayed grid;
      // sort keys off the selected cell's column (or column 0)
      const op = (label: string, fn: () => void, aria?: string) => {
        const b = document.createElement('button')
        b.className = 'lat-tb'
        b.textContent = label
        if (aria) b.setAttribute('aria-label', aria)
        b.addEventListener('click', () => {
          if (!sheet) return
          snapshot()
          fn()
          menu.remove()
          afterMutate()
        })
        menu.appendChild(b)
      }
      const opGrid = sel?.cell.grid ?? grid
      const sortCol = sel && !sel.cell.grid ? sel.col : 0
      op('sort ↓', () => sortGrid(opGrid, sortCol), 'Sort rows ascending')
      op('sort ↑', () => sortGrid(opGrid, sortCol, true), 'Sort rows descending')
      op('transpose', () => transposeGrid(opGrid))
      op('flatten', () => flattenGrid(opGrid), 'Flatten hierarchy to an outline')
      if (searchQ) {
        const rep = document.createElement('input')
        rep.className = 'lat-search'
        rep.placeholder = `replace "${searchQ}" with… (Enter)`
        rep.setAttribute('aria-label', 'Replacement text')
        rep.addEventListener('keydown', (e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && sheet) {
            snapshot()
            const n = replaceAll(sheet.root, searchQ, rep.value)
            adapter.toast(`Replaced in ${n} cell${n === 1 ? '' : 's'}`, 'success')
            menu.remove()
            afterMutate()
          }
        })
        menu.appendChild(rep)
      }
      bar.insertAdjacentElement('afterend', menu)
    })

    // per-selection actions
    const multi = rectSel && (rectSel.r0 !== rectSel.r1 || rectSel.c0 !== rectSel.c1)
    if (multi) {
      const mk = (label: string, fn: () => void) => {
        const b = document.createElement('button')
        b.className = 'lat-tb'
        b.textContent = label
        b.addEventListener('click', fn)
        act.appendChild(b)
        return b
      }
      mk('copy', () => void copySelection(false))
      mk('cut', () => void copySelection(true))
      mk('clear', () => {
        if (!sheet) return
        snapshot()
        const blk = selectedBlock(sheet.root)
        if (blk) for (let r = blk.r0; r <= blk.r1; r++) for (let c = blk.c0; c <= blk.c1; c++) setText(sheet.root, blk.grid.rows[r][c].id, '')
        afterMutate()
      })
      const hint = document.createElement('span')
      hint.className = 'lat-hint'
      hint.textContent = `${Math.abs(rectSel!.r1 - rectSel!.r0) + 1}×${Math.abs(rectSel!.c1 - rectSel!.c0) + 1} selected`
      act.appendChild(hint)
    } else if (lineSel) {
      const hint = document.createElement('span')
      hint.className = 'lat-hint'
      hint.textContent = `${lineSel.axis === 'row' ? 'Row' : 'Column'} line selected — type to insert, Backspace/Delete removes the ${lineSel.axis} ${lineSel.axis === 'row' ? 'above/below' : 'before/after'}`
      act.appendChild(hint)
    } else if (sel && sheet) {
      const sid = sel.cell.id
      const mkBtn = (label: string, fn: () => void, aria?: string) => {
        const b = document.createElement('button')
        b.className = 'lat-tb'
        b.textContent = label
        if (aria) b.setAttribute('aria-label', aria)
        b.addEventListener('click', fn)
        act.appendChild(b)
        return b
      }
      mkBtn(sel.cell.grid ? '▦ open' : '▦ nest', () => {
        if (!sheet) return
        if (sel.cell.grid) { zoomPath = [...zoomPath, sid]; selectedId = null; drawEditor() }
        else { snapshot(); insertSubgrid(sheet.root, sid); zoomPath = [...zoomPath, sid]; selectedId = null; afterMutate() }
      })
      if (sel.cell.grid) {
        mkBtn(sel.cell.rollup ? `agg: ${sel.cell.rollup}` : 'agg: off', () => {
          if (!sheet) return
          snapshot()
          const order: (LatticeCell['rollup'] | undefined)[] = [undefined, 'sum', 'count', 'done-pct']
          const next = order[(order.indexOf(sel.cell.rollup) + 1) % order.length]
          if (next) sel.cell.rollup = next; else delete sel.cell.rollup
          afterMutate()
        })
      } else {
        mkBtn(sel.cell.done ? '☑' : '☐', () => {
          if (!sheet) return
          snapshot()
          sel.cell.done = !sel.cell.done
          if (sel.cell.done) adapter.onTick?.()
          afterMutate()
        }, 'Toggle done')
      }
      mkBtn('＋row', () => { snapshot(); insertRow(sel.grid, sel.row + 1); afterMutate() }, 'Add row below')
      mkBtn('＋col', () => { snapshot(); insertCol(sel.grid, sel.col + 1); afterMutate() }, 'Add column right')
      mkBtn('−row', () => { snapshot(); deleteRow(sel.grid, sel.row); selectedId = null; afterMutate() }, 'Delete row')
      mkBtn('−col', () => { snapshot(); deleteCol(sel.grid, sel.col); selectedId = null; afterMutate() }, 'Delete column')
      const bBtn = mkBtn('B', () => {
        snapshot()
        sel.cell.style = { ...sel.cell.style, b: !sel.cell.style?.b }
        afterMutate()
      }, 'Bold')
      bBtn.style.fontWeight = '700'
      const iBtn = mkBtn('I', () => {
        snapshot()
        sel.cell.style = { ...sel.cell.style, i: !sel.cell.style?.i }
        afterMutate()
      }, 'Italic')
      iBtn.style.fontStyle = 'italic'
      const fillBtn = mkBtn('◐', () => {
        snapshot()
        const cur = sel.cell.style?.fill
        const next = cur === undefined ? 0 : cur + 1
        if (next >= FILLS.length) {
          const st = { ...sel.cell.style }
          delete st.fill
          sel.cell.style = st
        } else {
          sel.cell.style = { ...sel.cell.style, fill: next }
        }
        afterMutate()
      }, 'Cycle cell colour')
      if (typeof sel.cell.style?.fill === 'number') fillBtn.style.background = FILLS[sel.cell.style.fill % FILLS.length]
      mkBtn(sel.cell.tag ? `#${sel.cell.tag}` : '#tag', () => {
        const existingTag = act.querySelector('#lat-tag-edit')
        if (existingTag) { existingTag.remove(); return }
        const inp = document.createElement('input')
        inp.id = 'lat-tag-edit'
        inp.className = 'lat-search'
        inp.placeholder = 'tag (empty clears)'
        inp.value = sel.cell.tag ?? ''
        inp.addEventListener('keydown', e => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            snapshot()
            const v = inp.value.trim()
            if (v) sel.cell.tag = v
            else delete sel.cell.tag
            afterMutate()
          }
          if (e.key === 'Escape') inp.remove()
        })
        act.appendChild(inp)
        inp.focus()
      }, 'Set tag')
      if (clipboard) mkBtn('paste', pasteBlock, 'Paste block')
      if (sel.cell.grid) {
        const un = mkBtn('un-nest', () => {}, 'Remove nested grid')
        un.classList.add('lat-tb-danger')
        armTwice(un, 'sure?', () => {
          if (!sheet) return
          snapshot()
          removeSubgrid(sheet.root, sid)
          afterMutate()
        })
      }
    } else {
      const hint = document.createElement('div')
      hint.className = 'lat-hint'
      hint.textContent = 'Arrows walk cells AND the gaps between them — type on a gap to insert a row/col. Insert dives into a cell (creating a grid), PageUp climbs out. Shift+arrows select a block · Ctrl+arrows move a cell · =12*85 evaluates · [[Sheet]] links'
      act.appendChild(hint)
    }

    // ---- pointer interactions ------------------------------------------------

    let dragSel: { owner: string | null; r: number; c: number } | null = null
    let dragMoved = false

    wrap.addEventListener('pointerdown', (e) => {
      if (editing || e.pointerType !== 'mouse') return
      const cd = (e.target as HTMLElement).closest<HTMLElement>('.lat-cell')
      if (!cd?.dataset.id) return
      // innermost cell under the pointer belongs to some grid; drag selects in THAT grid
      dragSel = { owner: cd.dataset.owner || null, r: Number(cd.dataset.r), c: Number(cd.dataset.c) }
      dragMoved = false
    })

    wrap.addEventListener('pointermove', (e) => {
      if (!dragSel || editing) return
      const cd = (e.target as HTMLElement).closest<HTMLElement>('.lat-cell')
      if (!cd) return
      // walk up until we find a cell in the SAME grid as the anchor (TreeSheets:
      // crossing a child boundary selects the entire child)
      let node: HTMLElement | null = cd
      while (node && (node.dataset.owner || null) !== dragSel.owner) {
        node = node.parentElement?.closest<HTMLElement>('.lat-cell') ?? null
      }
      if (!node) return
      const r = Number(node.dataset.r), c = Number(node.dataset.c)
      if (r !== dragSel.r || c !== dragSel.c) {
        dragMoved = true
        rectSel = { owner: dragSel.owner, r0: dragSel.r, c0: dragSel.c, r1: r, c1: c }
        selectedId = null
        lineSel = null
        // live-paint without full redraw
        wrap.querySelectorAll('.lat-multi').forEach(x => x.classList.remove('lat-multi'))
        wrap.querySelectorAll<HTMLElement>('.lat-cell').forEach(x => {
          if ((x.dataset.owner || null) === rectSel!.owner && inRect(rectSel!.owner, Number(x.dataset.r), Number(x.dataset.c))) x.classList.add('lat-multi')
        })
      }
    })

    wrap.addEventListener('pointerup', () => {
      if (dragSel && dragMoved) drawEditor()
      dragSel = null
    })

    wrap.addEventListener('click', (e) => {
      if (dragMoved) { dragMoved = false; return }
      if ((e.target as HTMLElement).closest('.lat-extlink')) return   // real <a>, let the browser open it
      const check = (e.target as HTMLElement).closest<HTMLElement>('.lat-check')
      if (check?.dataset.check && sheet) {
        e.stopPropagation()
        const loc = locate(sheet.root, check.dataset.check)
        if (loc) {
          snapshot()
          const t = TASK_RE.exec(loc.cell.text)
          if (t) {
            const nowDone = t[2] === ' '
            setText(sheet.root, loc.cell.id, loc.cell.text.replace(TASK_RE, `${t[1] ?? ''}[${nowDone ? 'x' : ' '}] `))
            loc.cell.done = nowDone            // keep %-done roll-ups honest
            if (nowDone) adapter.onTick?.()
          }
          afterMutate()
        }
        return
      }
      const link = (e.target as HTMLElement).closest<HTMLElement>('.lat-link')
      if (link?.dataset.link) {
        e.stopPropagation()
        void openLinkedSheet(link.dataset.link)
        return
      }
      const chip = (e.target as HTMLElement).closest<HTMLElement>('.lat-chip')
      if (chip?.dataset.zoom) {
        zoomPath = [...zoomPath, chip.dataset.zoom]
        selectedId = null
        lineSel = null
        rectSel = null
        drawEditor()
        return
      }
      const cd = (e.target as HTMLElement).closest<HTMLElement>('.lat-cell')
      if (cd?.dataset.id && !editing) {
        if (rectSel) { rectSel = null; selectedId = cd.dataset.id; drawEditor(); return }
        if (selectedId === cd.dataset.id) {
          const loc = locate(grid, cd.dataset.id)
          if (loc) startEdit(loc.cell, cd)
        } else {
          selectedId = cd.dataset.id
          lineSel = null
          drawEditor()
        }
        return
      }
      // click landed in a gap of some grid → select that line (TreeSheets)
      const gd = (e.target as HTMLElement).closest<HTMLElement>('.lat-grid')
      if (gd && !editing && sheet) {
        const owner = gd.dataset.gridOwner || null
        const g = resolveGrid(owner, sheet.root)
        if (!g) return
        // find nearest boundary by measuring this grid's DIRECT cells
        const cells = [...gd.children].filter((n): n is HTMLElement => n instanceof HTMLElement && n.classList.contains('lat-cell') && (n.dataset.owner || null) === owner)
        if (!cells.length) return
        let best: LineSel | null = null
        let bestDist = 12
        for (const cell of cells) {
          const r = Number(cell.dataset.r), c = Number(cell.dataset.c)
          const cr = cell.getBoundingClientRect()
          const candidates: { sel: LineSel; dist: number }[] = [
            { sel: { owner, axis: 'col', index: c, at: r }, dist: Math.abs(e.clientX - cr.left) },
            { sel: { owner, axis: 'col', index: c + 1, at: r }, dist: Math.abs(e.clientX - cr.right) },
            { sel: { owner, axis: 'row', index: r, at: c }, dist: Math.abs(e.clientY - cr.top) },
            { sel: { owner, axis: 'row', index: r + 1, at: c }, dist: Math.abs(e.clientY - cr.bottom) },
          ]
          for (const cand of candidates) {
            // the other axis must actually be near the cell too
            const inline = cand.sel.axis === 'col'
              ? e.clientY >= cr.top - 6 && e.clientY <= cr.bottom + 6
              : e.clientX >= cr.left - 6 && e.clientX <= cr.right + 6
            if (inline && cand.dist < bestDist) { best = cand.sel; bestDist = cand.dist }
          }
        }
        if (best) {
          lineSel = best
          selectedId = null
          rectSel = null
          drawEditor()
        }
      }
    })

    wrap.addEventListener('paste', (e) => {
      if (editing || !selectedId || !sheet) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (!text.includes('\n') && !text.includes('\t')) return
      const parsed = text.includes('\t') ? fromTSV(text) : fromIndentedText(text)
      if (!parsed) return
      e.preventDefault()
      snapshot()
      const loc = locate(sheet.root, selectedId)
      if (loc) {
        loc.cell.grid = parsed
        afterMutate()
        adapter.toast(text.includes('\t') ? 'Table pasted as nested grid' : 'Outline pasted as nested grid', 'success')
      }
    })

    // ---- keyboard -----------------------------------------------------------------

    // TreeSheets cursor model: arrows walk a single sequence of cells AND the
    // boundary lines between them — line(0), cell(0), line(1), cell(1) … —
    // so keyboard-only insert is: arrow onto a line, type. Arrowing past a
    // grid's outer edge pops the selection out to the owner cell.
    el.onkeydown = (e) => {
      if (editing || !sheet) return

      const selectCell = (c: LatticeCell) => { selectedId = c.id; lineSel = null; rectSel = null; drawEditor() }
      const selectLine = (owner: string | null, axis: 'row' | 'col', index: number, at: number) => {
        lineSel = { owner, axis, index, at }
        selectedId = null
        rectSel = null
        drawEditor()
      }
      const popOut = (owner: string | null) => {
        if (owner === null) return         // already at the displayed root's edge
        const loc = locate(grid, owner)
        if (loc) selectCell(loc.cell)
        else if (zoomPath.length) { zoomPath = zoomPath.slice(0, -1); selectedId = owner; lineSel = null; drawEditor() }
      }

      // grid-line mode
      if (lineSel) {
        const g = resolveGrid(lineSel.owner, sheet.root)
        if (!g) { lineSel = null; return }
        const at = lineSel.at ?? 0
        if (e.key === 'Escape') { e.preventDefault(); lineSel = null; drawEditor(); return }
        if (e.key.startsWith('Arrow')) {
          e.preventDefault()
          const { owner, axis, index } = lineSel
          if (axis === 'col') {
            const r = Math.max(0, Math.min(g.rows.length - 1, at))
            if (e.key === 'ArrowRight') { if (index < g.cols) selectCell(g.rows[r][index]); else popOut(owner) }
            else if (e.key === 'ArrowLeft') { if (index > 0) selectCell(g.rows[r][index - 1]); else popOut(owner) }
            else selectCell(g.rows[Math.max(0, Math.min(g.rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))][Math.min(index, g.cols - 1)])
          } else {
            const c = Math.max(0, Math.min(g.cols - 1, at))
            if (e.key === 'ArrowDown') { if (index < g.rows.length) selectCell(g.rows[index][c]); else popOut(owner) }
            else if (e.key === 'ArrowUp') { if (index > 0) selectCell(g.rows[index - 1][c]); else popOut(owner) }
            else selectCell(g.rows[Math.min(index, g.rows.length - 1)][Math.max(0, Math.min(g.cols - 1, at + (e.key === 'ArrowRight' ? 1 : -1)))])
          }
          return
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault()
          snapshot()
          const idx = e.key === 'Backspace' ? lineSel.index - 1 : lineSel.index
          if (lineSel.axis === 'row') {
            if (idx >= 0 && idx < g.rows.length && g.rows.length > 1) deleteRow(g, idx)
            else { undoStack.pop(); return }
          } else {
            if (idx >= 0 && idx < g.cols && g.cols > 1) deleteCol(g, idx)
            else { undoStack.pop(); return }
          }
          afterMutate()
          return
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          snapshot()
          const idx = lineSel.index
          if (lineSel.axis === 'row') insertRow(g, idx)
          else insertCol(g, idx)
          const cell = lineSel.axis === 'row'
            ? g.rows[idx][Math.max(0, Math.min(g.cols - 1, at))]
            : g.rows[Math.max(0, Math.min(g.rows.length - 1, at))][idx]
          const seed = e.key
          lineSel = null
          selectedId = cell.id
          scheduleSave()
          drawEditor()
          const cd = el.querySelector<HTMLElement>(`.lat-cell[data-id="${cell.id}"]`)
          const loc2 = locate(sheet!.root, cell.id)
          if (cd && loc2) startEdit(loc2.cell, cd, seed)
          return
        }
        return
      }

      // clipboard shortcuts (single or rect selection)
      if (e.ctrlKey && (e.key === 'c' || e.key === 'x')) {
        if (rectSel || selectedId) { e.preventDefault(); void copySelection(e.key === 'x'); return }
      }
      if (e.ctrlKey && e.key === 'v' && clipboard && selectedId) {
        e.preventDefault()
        pasteBlock()
        return
      }
      if (e.key === 'Escape') {
        if (rectSel || selectedId) { e.preventDefault(); rectSel = null; selectedId = null; drawEditor() }
        return
      }
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); return }
      if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redo(); return }
      if (e.key === 'PageUp') {
        e.preventDefault()
        if (zoomPath.length) { zoomPath = zoomPath.slice(0, -1); selectedId = null; drawEditor() }
        return
      }

      // rect selection + arrows: plain arrow collapses to the moving corner
      if (rectSel && e.key.startsWith('Arrow') && !e.shiftKey && !e.ctrlKey) {
        e.preventDefault()
        const g = resolveGrid(rectSel.owner, sheet.root)
        if (g) selectCell(g.rows[Math.max(0, Math.min(g.rows.length - 1, rectSel.r1))][Math.max(0, Math.min(g.cols - 1, rectSel.c1))])
        return
      }
      if (rectSel && e.key.startsWith('Arrow') && e.shiftKey) {
        e.preventDefault()
        const g = resolveGrid(rectSel.owner, sheet.root)
        if (!g) return
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]!
        rectSel = {
          ...rectSel,
          r1: Math.max(0, Math.min(g.rows.length - 1, rectSel.r1 + d[0])),
          c1: Math.max(0, Math.min(g.cols - 1, rectSel.c1 + d[1])),
        }
        drawEditor()
        return
      }

      const cur = selectedId ? locate(grid, selectedId) : null
      if (!cur) return
      const curOwner = ownerOf(grid, cur.grid)

      if (e.ctrlKey && e.key.startsWith('Arrow')) {
        // Ctrl+arrows move the cell itself (TreeSheets)
        e.preventDefault()
        snapshot()
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]!
        if (moveCell(cur.grid, cur.cell.id, d[0], d[1])) afterMutate()
        else undoStack.pop()
        return
      }
      if (e.shiftKey && e.key.startsWith('Arrow')) {
        // Shift+arrows start/extend a rectangular selection
        e.preventDefault()
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]!
        rectSel = {
          owner: curOwner,
          r0: cur.row, c0: cur.col,
          r1: Math.max(0, Math.min(cur.grid.rows.length - 1, cur.row + d[0])),
          c1: Math.max(0, Math.min(cur.grid.cols - 1, cur.col + d[1])),
        }
        selectedId = null
        drawEditor()
        return
      }

      switch (e.key) {
        // arrows step from the cell onto the adjacent boundary line
        case 'ArrowRight': e.preventDefault(); selectLine(curOwner, 'col', cur.col + 1, cur.row); break
        case 'ArrowLeft': e.preventDefault(); selectLine(curOwner, 'col', cur.col, cur.row); break
        case 'ArrowDown': e.preventDefault(); selectLine(curOwner, 'row', cur.row + 1, cur.col); break
        case 'ArrowUp': e.preventDefault(); selectLine(curOwner, 'row', cur.row, cur.col); break
        // Tab walks cell-to-cell (skipping lines), wrapping rows
        case 'Tab': {
          e.preventDefault()
          const flat = cur.grid.rows.flat()
          const i = flat.indexOf(cur.cell)
          const next = flat[(i + (e.shiftKey ? flat.length - 1 : 1)) % flat.length]
          selectCell(next)
          break
        }
        case 'Home': e.preventDefault(); selectCell(cur.grid.rows[cur.row][0]); break
        case 'End': e.preventDefault(); selectCell(cur.grid.rows[cur.row][cur.grid.cols - 1]); break
        case 'Enter': {
          e.preventDefault()
          const cd = wrap.querySelector<HTMLElement>(`.lat-cell[data-id="${cur.cell.id}"]`)
          if (cd) startEdit(cur.cell, cd)
          break
        }
        // Insert = go deeper: create the subgrid if needed, dive, select its first cell
        case 'Insert': case 'PageDown': {
          e.preventDefault()
          if (!cur.cell.grid) {
            if (e.key === 'PageDown') break        // PageDown only dives into existing grids
            snapshot()
            insertSubgrid(sheet.root, cur.cell.id)
            scheduleSave()
          }
          const sub = cur.cell.grid ?? locate(sheet.root, cur.cell.id)?.cell.grid
          zoomPath = [...zoomPath, cur.cell.id]
          selectedId = sub?.rows[0]?.[0]?.id ?? null
          lineSel = null
          drawEditor()
          break
        }
        case 'Delete': case 'Backspace': {
          if (cur.cell.text) { e.preventDefault(); snapshot(); setText(sheet.root, cur.cell.id, ''); afterMutate() }
          break
        }
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const cd = wrap.querySelector<HTMLElement>(`.lat-cell[data-id="${cur.cell.id}"]`)
            if (cd) { e.preventDefault(); startEdit(cur.cell, cd, e.key) }
          }
      }
    }
    el.tabIndex = 0

    // ---- pinch + wheel zoom ---------------------------------------------------

    let pinchStart = 0
    wrap.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        pinchStart = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY)
      }
    }, { passive: true })
    wrap.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !pinchStart) return
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY)
      if (d > pinchStart * 1.45) {
        pinchStart = 0
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2
        const target = document.elementFromPoint(midX, midY)?.closest<HTMLElement>('.lat-cell')
        const id = target?.dataset.id
        if (id) {
          const loc = locate(grid, id)
          if (loc?.cell.grid) { zoomPath = [...zoomPath, id]; selectedId = null; drawEditor() }
        }
      } else if (d < pinchStart * 0.65 && zoomPath.length) {
        pinchStart = 0
        zoomPath = zoomPath.slice(0, -1)
        selectedId = null
        drawEditor()
      }
    }, { passive: true })

    wrap.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      if (e.deltaY < 0) {
        const target = (e.target as HTMLElement).closest<HTMLElement>('.lat-cell')
        const id = target?.dataset.id
        if (id) {
          const loc = locate(grid, id)
          if (loc?.cell.grid) { zoomPath = [...zoomPath, id]; selectedId = null; drawEditor() }
        }
      } else if (zoomPath.length) {
        zoomPath = zoomPath.slice(0, -1)
        selectedId = null
        drawEditor()
      }
    }, { passive: false })

    const backlinks = document.createElement('div')
    el.appendChild(backlinks)
    void renderBacklinks(backlinks, sheet.title)

    paintLineSel(wrap, root)
    el.focus()
  }

  void drawList()
}
