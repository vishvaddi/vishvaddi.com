// Lattice data model — TreeSheets-style nested grids, dependency-free by design:
// this file is copied verbatim into the vishvaddi.com /site tool later, so it
// must import nothing and touch no storage/DOM.

export interface LatticeCell {
  id: string
  text: string
  num?: number                                  // numeric value for roll-ups (parsed from text on edit)
  rollup?: 'sum' | 'count' | 'done-pct'         // aggregate of descendants, shown in cell corner
  done?: boolean
  grid?: LatticeGrid
  bind?: { source: 'streaks' | 'ladder' | 'calendar' | 'quests'; key?: string }
  habit?: string
}

export interface LatticeGrid {
  cols: number
  rows: LatticeCell[][]
}

export interface LatticeSheet {
  id: string
  title: string
  root: LatticeGrid
  updated: number
}

let idCounter = 0
export function latticeId(): string {
  return `lc-${Date.now().toString(36)}-${(idCounter++).toString(36)}`
}

export function newCell(text = ''): LatticeCell {
  return { id: latticeId(), text }
}

export function newGrid(cols: number, rows: number): LatticeGrid {
  return {
    cols,
    rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => newCell())),
  }
}

export function newSheet(title: string, root?: LatticeGrid): LatticeSheet {
  return { id: latticeId(), title, root: root ?? newGrid(3, 3), updated: Date.now() }
}

// ---- traversal -------------------------------------------------------------

export interface CellLoc { grid: LatticeGrid; row: number; col: number; cell: LatticeCell }

/** Depth-first search for a cell id; returns its containing grid + coordinates. */
export function locate(root: LatticeGrid, id: string): CellLoc | null {
  for (let r = 0; r < root.rows.length; r++) {
    for (let c = 0; c < root.rows[r].length; c++) {
      const cell = root.rows[r][c]
      if (cell.id === id) return { grid: root, row: r, col: c, cell }
      if (cell.grid) {
        const hit = locate(cell.grid, id)
        if (hit) return hit
      }
    }
  }
  return null
}

/** Path of cells from root to the given id (for breadcrumbs). */
export function pathTo(root: LatticeGrid, id: string, trail: LatticeCell[] = []): LatticeCell[] | null {
  for (const row of root.rows) {
    for (const cell of row) {
      if (cell.id === id) return [...trail, cell]
      if (cell.grid) {
        const hit = pathTo(cell.grid, id, [...trail, cell])
        if (hit) return hit
      }
    }
  }
  return null
}

/** The grid a zoom path points at (each entry is a cell id whose grid we descend into). */
export function gridAtPath(root: LatticeGrid, zoomPath: string[]): LatticeGrid {
  let g = root
  for (const id of zoomPath) {
    const loc = locate(g, id)
    if (!loc?.cell.grid) return g
    g = loc.cell.grid
  }
  return g
}

// ---- mutations (all operate in place; view snapshots for undo) -------------

export function setText(root: LatticeGrid, id: string, text: string): void {
  const loc = locate(root, id)
  if (!loc) return
  loc.cell.text = text
  if (text.startsWith('=')) {
    const v = evalExpr(text.slice(1))
    if (v !== null) loc.cell.num = v
    else delete loc.cell.num
    return
  }
  const n = parseFloat(text.replace(/[^0-9.\-]/g, ''))
  if (!Number.isNaN(n) && /\d/.test(text)) loc.cell.num = n
  else delete loc.cell.num
}

/** First cell (DFS) whose text contains the query, case-insensitive. */
export function findByText(root: LatticeGrid, query: string): CellLoc | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  for (let r = 0; r < root.rows.length; r++) {
    for (let c = 0; c < root.rows[r].length; c++) {
      const cell = root.rows[r][c]
      if (cell.text.toLowerCase().includes(q)) return { grid: root, row: r, col: c, cell }
      if (cell.grid) {
        const hit = findByText(cell.grid, q)
        if (hit) return hit
      }
    }
  }
  return null
}

// ---- =expression cells (Excel's one indispensable feature, minus the trap) ---
// Safe recursive-descent arithmetic: numbers, + - * / ( ) and % (of 1).
// No names, no cell refs, no eval — cross-cell maths is what roll-ups are for.

export function evalExpr(src: string): number | null {
  let i = 0
  const s = src.replace(/\s+/g, '')
  const peek = () => s[i]
  const num = (): number | null => {
    const m = /^\d*\.?\d+/.exec(s.slice(i))
    if (!m) return null
    i += m[0].length
    let v = parseFloat(m[0])
    if (peek() === '%') { i++; v /= 100 }
    return v
  }
  const factor = (): number | null => {
    if (peek() === '(') {
      i++
      const v = expr()
      if (v === null || peek() !== ')') return null
      i++
      return v
    }
    if (peek() === '-') { i++; const v = factor(); return v === null ? null : -v }
    return num()
  }
  const term = (): number | null => {
    let v = factor()
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = s[i++]
      const r = factor()
      if (r === null) return null
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  const expr = (): number | null => {
    let v = term()
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = s[i++]
      const r = term()
      if (r === null) return null
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  const v = expr()
  return i === s.length && v !== null && Number.isFinite(v) ? +v.toFixed(6) : null
}

export function insertSubgrid(root: LatticeGrid, id: string, cols = 2, rows = 2): void {
  const loc = locate(root, id)
  if (loc && !loc.cell.grid) loc.cell.grid = newGrid(cols, rows)
}

export function removeSubgrid(root: LatticeGrid, id: string): void {
  const loc = locate(root, id)
  if (loc) delete loc.cell.grid
}

export function insertRow(grid: LatticeGrid, at: number): void {
  grid.rows.splice(Math.max(0, Math.min(at, grid.rows.length)), 0,
    Array.from({ length: grid.cols }, () => newCell()))
}

export function deleteRow(grid: LatticeGrid, at: number): void {
  if (grid.rows.length > 1 && at >= 0 && at < grid.rows.length) grid.rows.splice(at, 1)
}

export function insertCol(grid: LatticeGrid, at: number): void {
  const i = Math.max(0, Math.min(at, grid.cols))
  grid.cols++
  for (const row of grid.rows) row.splice(i, 0, newCell())
}

export function deleteCol(grid: LatticeGrid, at: number): void {
  if (grid.cols <= 1 || at < 0 || at >= grid.cols) return
  grid.cols--
  for (const row of grid.rows) row.splice(at, 1)
}

/** Swap a cell with its neighbour (Ctrl+arrow move). */
export function moveCell(grid: LatticeGrid, id: string, dr: number, dc: number): boolean {
  const loc = locate(grid, id)
  if (!loc) return false
  const nr = loc.row + dr, nc = loc.col + dc
  if (nr < 0 || nc < 0 || nr >= loc.grid.rows.length || nc >= loc.grid.cols) return false
  const tmp = loc.grid.rows[nr][nc]
  loc.grid.rows[nr][nc] = loc.cell
  loc.grid.rows[loc.row][loc.col] = tmp
  return true
}

// ---- roll-ups ---------------------------------------------------------------

export interface RollupResult { sum: number; count: number; done: number; total: number }

export function aggregate(grid: LatticeGrid): RollupResult {
  const acc: RollupResult = { sum: 0, count: 0, done: 0, total: 0 }
  for (const row of grid.rows) {
    for (const cell of row) {
      if (cell.grid) {
        const sub = aggregate(cell.grid)
        acc.sum += sub.sum; acc.count += sub.count; acc.done += sub.done; acc.total += sub.total
      } else {
        if (typeof cell.num === 'number') { acc.sum += cell.num; acc.count++ }
        if (cell.text.trim()) { acc.total++; if (cell.done) acc.done++ }
      }
    }
  }
  return acc
}

export function rollupLabel(cell: LatticeCell): string | null {
  if (!cell.rollup || !cell.grid) return null
  const a = aggregate(cell.grid)
  if (cell.rollup === 'sum') return `Σ ${+a.sum.toFixed(2)}`
  if (cell.rollup === 'count') return `# ${a.count}`
  return a.total ? `${Math.round((a.done / a.total) * 100)}%` : '0%'
}

// ---- indented-text interop (TreeSheets' clipboard trick) --------------------

/** Parse tab/space-indented lines into a single-column grid of nested grids. */
export function fromIndentedText(text: string): LatticeGrid | null {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim())
  if (!lines.length) return null
  const depthOf = (l: string) => {
    const m = l.match(/^[\t ]*/)![0]
    return m.includes('\t') ? m.split('\t').length - 1 : Math.floor(m.length / 2)
  }
  const clean = (l: string) => l.trim().replace(/^[-*+]\s+/, '')
  interface Node { text: string; children: Node[] }
  const roots: Node[] = []
  const stack: { node: Node; depth: number }[] = []
  for (const line of lines) {
    const node: Node = { text: clean(line), children: [] }
    const d = depthOf(line)
    while (stack.length && stack[stack.length - 1].depth >= d) stack.pop()
    if (stack.length) stack[stack.length - 1].node.children.push(node)
    else roots.push(node)
    stack.push({ node, depth: d })
  }
  const toGrid = (nodes: Node[]): LatticeGrid => ({
    cols: 1,
    rows: nodes.map(n => {
      const cell = newCell(n.text)
      if (n.children.length) cell.grid = toGrid(n.children)
      return [cell]
    }),
  })
  return toGrid(roots)
}

/** Serialise a grid to indented text (rows joined; sub-grids indent). */
export function toIndentedText(grid: LatticeGrid, depth = 0): string {
  const pad = '  '.repeat(depth)
  const out: string[] = []
  for (const row of grid.rows) {
    for (const cell of row) {
      if (!cell.text.trim() && !cell.grid) continue
      out.push(pad + '- ' + cell.text)
      if (cell.grid) out.push(toIndentedText(cell.grid, depth + 1))
    }
  }
  return out.filter(Boolean).join('\n')
}

// ---- TSV interop (paste straight from Excel / Google Sheets) -----------------

export function fromTSV(text: string): LatticeGrid | null {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.length)
  if (!lines.length || !lines.some(l => l.includes('\t'))) return null
  const rows = lines.map(l => l.split('\t'))
  const cols = Math.max(...rows.map(r => r.length))
  return {
    cols,
    rows: rows.map(r => Array.from({ length: cols }, (_, c) => {
      const cell = newCell(r[c] ?? '')
      const n = parseFloat((r[c] ?? '').replace(/[^0-9.\-]/g, ''))
      if (!Number.isNaN(n) && /\d/.test(r[c] ?? '')) cell.num = n
      return cell
    })),
  }
}

export function toTSV(grid: LatticeGrid): string {
  return grid.rows.map(row => row.map(c =>
    c.grid ? `[${c.text || '▦'} ${c.grid.rows.length}×${c.grid.cols}]` : c.text.replace(/\t/g, ' ')
  ).join('\t')).join('\n')
}

// ---- templates ---------------------------------------------------------------

function rowOf(...texts: string[]): LatticeCell[] {
  return texts.map(t => newCell(t))
}

export function templateSheets(): { name: string; blurb: string; make: () => LatticeSheet }[] {
  return [
    {
      name: 'Blank',
      blurb: '3×3 grid, nest as you go',
      make: () => newSheet('Untitled'),
    },
    {
      name: 'Weekly plan',
      blurb: 'Days × when/where — implementation intentions',
      make: () => {
        const g: LatticeGrid = { cols: 3, rows: [rowOf('Day', 'Commitment', 'When / where exactly?')] }
        for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) g.rows.push(rowOf(d, '', ''))
        return newSheet('Weekly plan', g)
      },
    },
    {
      name: 'WOOP',
      blurb: 'Wish · Outcome · Obstacle · Plan',
      make: () => newSheet('WOOP', {
        cols: 2,
        rows: [
          rowOf('Wish', ''), rowOf('Outcome', ''), rowOf('Obstacle', ''),
          rowOf('Plan (if obstacle, then…)', ''),
        ],
      }),
    },
    {
      name: 'Trade breakdown (WBS)',
      blurb: 'Trades → items, qty × rate rolls up',
      make: () => {
        const trade = (name: string): LatticeCell => {
          const c = newCell(name)
          c.rollup = 'sum'
          c.grid = { cols: 3, rows: [rowOf('Item', 'Qty × rate', 'Total'), rowOf('', '', '')] }
          return c
        }
        return newSheet('Trade breakdown', {
          cols: 1,
          rows: ['Demolition', 'Joinery', 'Electrical', 'Painting', 'Flooring'].map(t => [trade(t)]),
        })
      },
    },
    {
      name: 'Tender programme',
      blurb: 'Stages → tasks with %-done roll-up',
      make: () => {
        const stage = (name: string): LatticeCell => {
          const c = newCell(name)
          c.rollup = 'done-pct'
          c.grid = { cols: 1, rows: [[newCell('')]] }
          return c
        }
        return newSheet('Tender programme', {
          cols: 1,
          rows: ['Drawings review', 'Subbie quotes out', 'Quotes back + levelled', 'Pricing', 'Submission'].map(s => [stage(s)]),
        })
      },
    },
    {
      name: 'Packing list',
      blurb: 'Categories → items, tick as packed',
      make: () => {
        const cat = (name: string): LatticeCell => {
          const c = newCell(name)
          c.rollup = 'done-pct'
          c.grid = { cols: 1, rows: [[newCell('')]] }
          return c
        }
        return newSheet('Packing list', { cols: 1, rows: ['Clothes', 'Toiletries', 'Tech', 'Documents'].map(s => [cat(s)]) })
      },
    },
  ]
}
