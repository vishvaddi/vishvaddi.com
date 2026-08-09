// Lattice data model — TreeSheets-style nested grids, dependency-free by design:
// this file is copied verbatim into the vishvaddi.com /site tool later, so it
// must import nothing and touch no storage/DOM.

export interface LatticeCell {
  id: string
  text: string
  num?: number                                  // numeric value for roll-ups (parsed from text on edit)
  rollup?: 'sum' | 'cost' | 'count' | 'done-pct' // aggregate of descendants, shown in cell corner
  rollupCol?: number                             // zero-based column; avoids summing qty + rate + total
  done?: boolean
  grid?: LatticeGrid
  bind?: { source: 'streaks' | 'ladder' | 'calendar' | 'quests'; key?: string }
  habit?: string
  tag?: string
  style?: { b?: boolean; i?: boolean; fill?: number; format?: 'number' | 'currency' | 'percent' }
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
  recalculate(root)
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

// ---- =expression cells -------------------------------------------------------
// Safe recursive-descent arithmetic: numbers, + - * / ( ) and % (of 1).
// A1 references and SUM/AVG ranges are resolved inside the containing grid;
// formulas never execute JavaScript.

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

function colIndex(label: string): number {
  let n = 0
  for (const ch of label.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64
  return n - 1
}

function plainNumber(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (!/^-?\d*\.?\d+%?$/.test(cleaned)) return null
  const percent = cleaned.endsWith('%')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? (percent ? n / 100 : n) : null
}

function formulaValue(grid: LatticeGrid, cell: LatticeCell, visiting: Set<string>): number | null {
  if (!cell.text.startsWith('=')) return plainNumber(cell.text)
  if (visiting.has(cell.id)) return null
  visiting.add(cell.id)
  const valueAt = (col: string, row: string): number | null => {
    const target = grid.rows[Number(row) - 1]?.[colIndex(col)]
    return target ? formulaValue(grid, target, visiting) : null
  }
  let src = cell.text.slice(1)
  src = src.replace(/(SUM|AVG)\(\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\)/gi,
    (_all, fn: string, c1: string, r1: string, c2: string, r2: string) => {
      const values: number[] = []
      const left = colIndex(c1), right = colIndex(c2)
      const top = Number(r1) - 1, bottom = Number(r2) - 1
      for (let r = Math.min(top, bottom); r <= Math.max(top, bottom); r++) {
        for (let c = Math.min(left, right); c <= Math.max(left, right); c++) {
          const target = grid.rows[r]?.[c]
          const value = target ? formulaValue(grid, target, visiting) : null
          if (value !== null) values.push(value)
        }
      }
      const sum = values.reduce((a, b) => a + b, 0)
      return String(fn.toUpperCase() === 'AVG' && values.length ? sum / values.length : sum)
    })
  let invalid = false
  src = src.replace(/\$?([A-Z]+)\$?(\d+)/gi, (_all, col: string, row: string) => {
    const value = valueAt(col, row)
    if (value === null) invalid = true
    return String(value ?? 0)
  })
  visiting.delete(cell.id)
  return invalid ? null : evalExpr(src)
}

export function recalculate(grid: LatticeGrid): void {
  for (const row of grid.rows) for (const cell of row) if (cell.grid) recalculate(cell.grid)
  for (const row of grid.rows) {
    for (const cell of row) {
      const value = formulaValue(grid, cell, new Set())
      if (value === null) delete cell.num
      else cell.num = value
    }
  }
}

export function insertSubgrid(root: LatticeGrid, id: string, cols = 1, rows = 1): void {
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

export function aggregate(grid: LatticeGrid, column?: number): RollupResult {
  const acc: RollupResult = { sum: 0, count: 0, done: 0, total: 0 }
  for (const row of grid.rows) {
    for (let index = 0; index < row.length; index++) {
      const cell = row[index]
      if (cell.grid) {
        const sub = aggregate(cell.grid, column)
        acc.sum += sub.sum; acc.count += sub.count; acc.done += sub.done; acc.total += sub.total
      } else {
        if ((column === undefined || index === column) && typeof cell.num === 'number') { acc.sum += cell.num; acc.count++ }
        if (cell.text.trim()) { acc.total++; if (cell.done) acc.done++ }
      }
    }
  }
  return acc
}

export function rollupLabel(cell: LatticeCell): string | null {
  if (!cell.rollup || !cell.grid) return null
  const a = aggregate(cell.grid, cell.rollupCol)
  if (cell.rollup === 'sum') return `Σ ${+a.sum.toFixed(2)}`
  if (cell.rollup === 'cost') return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 }).format(a.sum)
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

// ---- whole-grid operations (TreeSheets parity) --------------------------------

/** Sort rows by a column: numeric when both sides are numeric, else natural text. */
export function sortGrid(grid: LatticeGrid, col: number, desc = false): void {
  const c = Math.max(0, Math.min(grid.cols - 1, col))
  grid.rows.sort((a, b) => {
    const av = a[c], bv = b[c]
    const cmp = (typeof av.num === 'number' && typeof bv.num === 'number')
      ? av.num - bv.num
      : av.text.localeCompare(bv.text, undefined, { numeric: true, sensitivity: 'base' })
    return desc ? -cmp : cmp
  })
}

export function transposeGrid(grid: LatticeGrid): void {
  const rows = grid.rows
  const newRows: LatticeCell[][] = []
  for (let c = 0; c < grid.cols; c++) newRows.push(rows.map(r => r[c]))
  grid.cols = rows.length
  grid.rows = newRows
}

/** Collapse the hierarchy into a single-column outline (indent as text prefix). */
export function flattenGrid(grid: LatticeGrid): void {
  const out: LatticeCell[][] = []
  const walk = (g: LatticeGrid, depth: number) => {
    for (const row of g.rows) {
      for (const cell of row) {
        if (!cell.text.trim() && !cell.grid) continue
        const sub = cell.grid
        delete cell.grid
        cell.text = `${'    '.repeat(depth)}${cell.text}`
        out.push([cell])
        if (sub) walk(sub, depth + 1)
      }
    }
  }
  walk({ cols: grid.cols, rows: grid.rows }, 0)
  grid.cols = 1
  grid.rows = out.length ? out : [[newCell()]]
}

/** Does any cell in this subtree match the query (case-insensitive)? */
export function subtreeMatches(cell: LatticeCell, q: string): boolean {
  if (cell.text.toLowerCase().includes(q) || (cell.tag ?? '').toLowerCase().includes(q)) return true
  if (cell.grid) for (const row of cell.grid.rows) for (const c of row) if (subtreeMatches(c, q)) return true
  return false
}

/** Replace query text in every matching cell; returns replacement count. */
export function replaceAll(grid: LatticeGrid, q: string, w: string): number {
  let n = 0
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const walk = (g: LatticeGrid) => {
    for (const row of g.rows) for (const cell of row) {
      if (re.test(cell.text)) {
        cell.text = cell.text.replace(re, w)
        n++
      }
      re.lastIndex = 0
      if (cell.grid) walk(cell.grid)
    }
  }
  walk(grid)
  return n
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
      name: 'Trade estimate (WBS)',
      blurb: 'Trades → items; live qty × rate cost roll-ups',
      make: () => {
        const itemRow = (item: string, qty: string, unit: string, rate: string, row: number): LatticeCell[] => {
          const cells = rowOf(item, qty, unit, rate, `=B${row}*D${row}`)
          cells[3].style = { format: 'currency' }
          cells[4].style = { format: 'currency' }
          return cells
        }
        const trade = (name: string): LatticeCell => {
          const c = newCell(name)
          c.rollup = 'cost'
          c.rollupCol = 4
          const header = rowOf('Item / scope', 'Qty', 'Unit', 'Rate', 'Total')
          header.forEach(cell => { cell.style = { b: true, fill: 0 } })
          c.grid = { cols: 5, rows: [header, itemRow('', '', '', '', 2), itemRow('', '', '', '', 3)] }
          return c
        }
        const project = newCell('Project estimate')
        project.rollup = 'cost'
        project.rollupCol = 4
        project.grid = { cols: 1, rows: ['Preliminaries', 'Demolition', 'Joinery', 'Electrical', 'Painting', 'Flooring'].map(t => [trade(t)]) }
        return newSheet('Trade estimate', { cols: 1, rows: [[project]] })
      },
    },
    {
      name: 'Scope comparison',
      blurb: 'Compare inclusions, exclusions and adjusted quotes',
      make: () => {
        const header = rowOf('Scope item', 'Tender allowance', 'Subcontractor A', 'Subcontractor B', 'Notes')
        header.forEach(cell => { cell.style = { b: true, fill: 0 } })
        const rows = [
          header,
          rowOf('Supply', '', '', '', ''),
          rowOf('Installation', '', '', '', ''),
          rowOf('Delivery / access', '', '', '', ''),
          rowOf('Design / shop drawings', '', '', '', ''),
          rowOf('Exclusions / qualifications', '', '', '', ''),
          rowOf('Adjusted total', '', '', '', ''),
        ]
        for (const row of rows.slice(1)) for (const cell of row.slice(1, 4)) cell.style = { format: 'currency' }
        return newSheet('Scope comparison', { cols: 5, rows })
      },
    },
    {
      name: 'Procurement register',
      blurb: 'Package ownership, dates, status and risk',
      make: () => {
        const header = rowOf('Package', 'Owner', 'Required on site', 'Lead time', 'Order by', 'Status / risk')
        header.forEach(cell => { cell.style = { b: true, fill: 0 } })
        return newSheet('Procurement register', {
          cols: 6,
          rows: [header, rowOf('Joinery', '', '', '', '', ''), rowOf('Stone', '', '', '', '', ''), rowOf('Feature lighting', '', '', '', '', '')],
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
