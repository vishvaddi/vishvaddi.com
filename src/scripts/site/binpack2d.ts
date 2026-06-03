// 2D sheet nesting — first-fit-decreasing-height shelf packing with optional
// rotation, across as many identical sheets as needed. Pure/deterministic.
// (Shelf/guillotine, not full MaxRects nesting — good, fast, and easy to cut.)
export interface Part2D { name: string; w: number; h: number; qty: number }
export interface Placed2D { name: string; x: number; y: number; w: number; h: number; rot: boolean }
export interface Sheet2D { parts: Placed2D[] }
export interface Pack2DResult {
  sheets: Sheet2D[];
  oversize: { name: string; w: number; h: number }[];
  sheetW: number;
  sheetH: number;
  usedArea: number;
}

interface Shelf { y: number; h: number; x: number }
interface ISheet { shelves: Shelf[]; usedH: number; parts: Placed2D[] }

export function pack2d(
  parts: Part2D[],
  sheetW: number,
  sheetH: number,
  kerf: number,
  allowRotate: boolean,
): Pack2DResult {
  const items: { name: string; w: number; h: number; rot: boolean }[] = [];
  const oversize: { name: string; w: number; h: number }[] = [];

  for (const p of parts) {
    for (let i = 0; i < p.qty; i++) {
      let w = p.w, h = p.h, rot = false;
      const fitsAsIs = w <= sheetW && h <= sheetH;
      const fitsRot = allowRotate && h <= sheetW && w <= sheetH;
      if (!fitsAsIs && !fitsRot) { oversize.push({ name: p.name, w: p.w, h: p.h }); continue; }
      // orient landscape when allowed (shorter shelves pack better)
      if (allowRotate && w < h && fitsRot) { [w, h] = [h, w]; rot = true; }
      else if (!fitsAsIs && fitsRot) { [w, h] = [h, w]; rot = true; }
      items.push({ name: p.name, w, h, rot });
    }
  }
  items.sort((a, b) => b.h - a.h);

  const sheets: ISheet[] = [];
  const addSheet = (): ISheet => { const s = { shelves: [], usedH: 0, parts: [] }; sheets.push(s); return s; };

  const place = (it: { name: string; w: number; h: number; rot: boolean }): boolean => {
    for (const s of sheets) {
      for (const sh of s.shelves) {
        if (it.h <= sh.h) {
          const x = sh.x === 0 ? 0 : sh.x + kerf;
          if (x + it.w <= sheetW) {
            s.parts.push({ name: it.name, x, y: sh.y, w: it.w, h: it.h, rot: it.rot });
            sh.x = x + it.w;
            return true;
          }
        }
      }
      const y = s.usedH === 0 ? 0 : s.usedH + kerf;
      if (y + it.h <= sheetH) {
        s.shelves.push({ y, h: it.h, x: it.w });
        s.usedH = y + it.h;
        s.parts.push({ name: it.name, x: 0, y, w: it.w, h: it.h, rot: it.rot });
        return true;
      }
    }
    return false;
  };

  for (const it of items) {
    if (!place(it)) { addSheet(); place(it); }
  }

  const usedArea = items.reduce((s, it) => s + it.w * it.h, 0);
  return { sheets: sheets.map((s) => ({ parts: s.parts })), oversize, sheetW, sheetH, usedArea };
}
