export interface Part2D {
  name: string
  w: number
  h: number
  qty: number
  material?: string
  canRotate?: boolean
  grain?: boolean
  edge?: string
}

export interface Stock2D {
  name: string
  w: number
  h: number
  qty: number
  material?: string
  cost?: number
}

export interface Placed2D {
  name: string
  x: number
  y: number
  w: number
  h: number
  rot: boolean
  material: string
  edge?: string
}

export interface Sheet2D {
  stock: Stock2D
  parts: Placed2D[]
  usedArea: number
  wasteArea: number
  cutLength: number
  cuts: number
}

export interface Pack2DOptions {
  kerf: number
  trim: number
  allowRotate: boolean
  strategy: 'balanced' | 'fewest-sheets' | 'least-waste' | 'fast'
}

export interface Pack2DResult {
  sheets: Sheet2D[]
  oversize: { name: string; w: number; h: number; material: string }[]
  sheetW: number
  sheetH: number
  usedArea: number
  wasteArea: number
  cutLength: number
  cuts: number
  cost: number
}

interface Rect { x: number; y: number; w: number; h: number }
interface WorkSheet { stock: Stock2D; free: Rect[]; parts: Placed2D[] }
interface Item { name: string; w: number; h: number; material: string; canRotate: boolean; edge?: string }
interface Placement { sheet: WorkSheet; freeIndex: number; w: number; h: number; rot: boolean; score: number }

const cleanMaterial = (value?: string) => value?.trim().toLowerCase() ?? ''

function fitsMaterial(item: Item, stock: Stock2D): boolean {
  const wanted = cleanMaterial(item.material)
  const supplied = cleanMaterial(stock.material)
  return !wanted || !supplied || wanted === supplied
}

function orientations(item: Item, allowRotate: boolean): { w: number; h: number; rot: boolean }[] {
  const out = [{ w: item.w, h: item.h, rot: false }]
  if (allowRotate && item.canRotate && item.w !== item.h) out.push({ w: item.h, h: item.w, rot: true })
  return out
}

function splitFree(free: Rect, w: number, h: number, kerf: number): Rect[] {
  const rightW = free.w - w - kerf
  const belowH = free.h - h - kerf
  const verticalFirst = rightW * free.h > belowH * free.w
  const rects = verticalFirst
    ? [
        { x: free.x + w + kerf, y: free.y, w: rightW, h: free.h },
        { x: free.x, y: free.y + h + kerf, w, h: belowH },
      ]
    : [
        { x: free.x + w + kerf, y: free.y, w: rightW, h },
        { x: free.x, y: free.y + h + kerf, w: free.w, h: belowH },
      ]
  return rects.filter((rect) => rect.w > 0 && rect.h > 0)
}

function orderItems(items: Item[], mode: number): Item[] {
  return [...items].sort((a, b) => {
    if (mode === 1) return Math.max(b.w, b.h) - Math.max(a.w, a.h)
    if (mode === 2) return (b.w + b.h) - (a.w + a.h)
    if (mode === 3) return b.h - a.h
    return b.w * b.h - a.w * a.h
  })
}

function runPack(items: Item[], stocks: Stock2D[], options: Pack2DOptions, orderMode: number): Pack2DResult {
  const kerf = Math.max(0, options.kerf)
  const trim = Math.max(0, options.trim)
  const sheets: WorkSheet[] = []
  const oversize: Pack2DResult['oversize'] = []
  const opened = new Map<number, number>()

  const openStock = (item: Item): WorkSheet | null => {
    const candidates = stocks
      .map((stock, index) => ({ stock, index }))
      .filter(({ stock, index }) => {
        if (!fitsMaterial(item, stock)) return false
        if (stock.qty > 0 && (opened.get(index) ?? 0) >= stock.qty) return false
        const usableW = stock.w - trim * 2, usableH = stock.h - trim * 2
        return orientations(item, options.allowRotate).some((o) => o.w <= usableW && o.h <= usableH)
      })
      .sort((a, b) => {
        if (options.strategy === 'fewest-sheets') return b.stock.w * b.stock.h - a.stock.w * a.stock.h
        const costA = a.stock.cost ?? a.stock.w * a.stock.h
        const costB = b.stock.cost ?? b.stock.w * b.stock.h
        return costA - costB || a.stock.w * a.stock.h - b.stock.w * b.stock.h
      })
    const choice = candidates[0]
    if (!choice) return null
    opened.set(choice.index, (opened.get(choice.index) ?? 0) + 1)
    const sheet: WorkSheet = {
      stock: choice.stock,
      free: [{ x: trim, y: trim, w: choice.stock.w - trim * 2, h: choice.stock.h - trim * 2 }],
      parts: [],
    }
    sheets.push(sheet)
    return sheet
  }

  for (const item of orderItems(items, orderMode)) {
    let best: Placement | null = null
    const inspect = (sheet: WorkSheet) => {
      if (!fitsMaterial(item, sheet.stock)) return
      sheet.free.forEach((free, freeIndex) => {
        for (const o of orientations(item, options.allowRotate)) {
          if (o.w > free.w || o.h > free.h) continue
          const waste = free.w * free.h - o.w * o.h
          const shortSide = Math.min(free.w - o.w, free.h - o.h)
          const score = options.strategy === 'least-waste' ? waste : shortSide * 1e6 + waste
          if (!best || score < best.score) best = { sheet, freeIndex, ...o, score }
        }
      })
    }
    sheets.forEach(inspect)
    if (!best) {
      const openedSheet = openStock(item)
      if (openedSheet) inspect(openedSheet)
    }
    if (!best) {
      oversize.push({ name: item.name, w: item.w, h: item.h, material: item.material })
      continue
    }
    const choice = best as Placement
    const free = choice.sheet.free.splice(choice.freeIndex, 1)[0]
    choice.sheet.free.push(...splitFree(free, choice.w, choice.h, kerf))
    choice.sheet.parts.push({
      name: item.name, x: free.x, y: free.y, w: choice.w, h: choice.h,
      rot: choice.rot, material: item.material, edge: item.edge,
    })
  }

  const finished: Sheet2D[] = sheets.map((sheet) => {
    const usedArea = sheet.parts.reduce((sum, part) => sum + part.w * part.h, 0)
    const usableArea = Math.max(0, (sheet.stock.w - trim * 2) * (sheet.stock.h - trim * 2))
    return {
      stock: sheet.stock,
      parts: sheet.parts,
      usedArea,
      wasteArea: Math.max(0, usableArea - usedArea),
      cutLength: sheet.parts.reduce((sum, part) => sum + part.w + part.h, 0),
      cuts: sheet.parts.length * 2,
    }
  })
  return {
    sheets: finished,
    oversize,
    sheetW: stocks[0]?.w ?? 0,
    sheetH: stocks[0]?.h ?? 0,
    usedArea: finished.reduce((sum, sheet) => sum + sheet.usedArea, 0),
    wasteArea: finished.reduce((sum, sheet) => sum + sheet.wasteArea, 0),
    cutLength: finished.reduce((sum, sheet) => sum + sheet.cutLength, 0),
    cuts: finished.reduce((sum, sheet) => sum + sheet.cuts, 0),
    cost: finished.reduce((sum, sheet) => sum + (sheet.stock.cost ?? 0), 0),
  }
}

export function optimise2d(parts: Part2D[], stocks: Stock2D[], options: Pack2DOptions): Pack2DResult {
  const items: Item[] = []
  for (const part of parts) {
    for (let i = 0; i < part.qty; i++) items.push({
      name: part.name,
      w: part.w,
      h: part.h,
      material: part.material ?? '',
      canRotate: part.canRotate !== false && !part.grain,
      edge: part.edge,
    })
  }
  const modes = options.strategy === 'fast' ? [0] : [0, 1, 2, 3]
  const results = modes.map((mode) => runPack(items, stocks.filter((stock) => stock.w > 0 && stock.h > 0), options, mode))
  return results.sort((a, b) => {
    const unfit = a.oversize.length - b.oversize.length
    if (unfit) return unfit
    if (options.strategy === 'least-waste') return a.wasteArea - b.wasteArea || a.sheets.length - b.sheets.length
    return a.sheets.length - b.sheets.length || a.wasteArea - b.wasteArea
  })[0] ?? runPack([], [], options, 0)
}

// Backwards-compatible entry point for existing links and callers.
export function pack2d(parts: Part2D[], sheetW: number, sheetH: number, kerf: number, allowRotate: boolean): Pack2DResult {
  return optimise2d(parts, [{ name: 'Sheet', w: sheetW, h: sheetH, qty: 0 }], {
    kerf, trim: 0, allowRotate, strategy: 'balanced',
  })
}
