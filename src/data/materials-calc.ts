// Formulas behind the Paint, Tile, Plasterboard-sheet and Concrete-volume
// calculators on /site/materials. Extracted so materials.astro (the live
// calculator) and the /site/materials/<family> search-intent answer pages
// import the exact same maths — the two can never disagree.
//
// Pure functions only (no DOM) so this module works from an in-browser
// <script> tag and from Astro's build-time (Node) getStaticPaths alike.

export const up = (n: number) => Math.max(0, Math.ceil(n));
export const pct = (waste: number) => 1 + (waste || 0) / 100;

export interface PaintInput {
  area: number;
  openings: number;
  coats: number;
  cov: number;
}
export function paintNetArea(v: Pick<PaintInput, "area" | "openings">): number {
  return Math.max(0, v.area - v.openings);
}
export function paintLitres(v: PaintInput): number | null {
  if (v.cov <= 0) return null;
  return (paintNetArea(v) * v.coats) / v.cov;
}

export interface SheetInput {
  area: number;
  w: number;
  h: number;
  waste: number;
}
export function sheetArea(v: Pick<SheetInput, "w" | "h">): number {
  return (v.w / 1000) * (v.h / 1000);
}
export function sheetCount(v: SheetInput): number | null {
  const each = sheetArea(v);
  if (each <= 0 || v.area <= 0) return null;
  return up((v.area * pct(v.waste)) / each);
}

export interface TileInput {
  area: number;
  w: number;
  h: number;
  waste: number;
}
export function tileArea(v: Pick<TileInput, "w" | "h">): number {
  return (v.w / 1000) * (v.h / 1000);
}
export function tileCount(v: TileInput): number | null {
  const each = tileArea(v);
  if (each <= 0 || v.area <= 0) return null;
  return up((v.area * pct(v.waste)) / each);
}

export interface ConcreteInput {
  l: number;
  w: number;
  d: number;
  waste: number;
}
export function concreteVolume(v: ConcreteInput): number | null {
  const vol = v.l * v.w * (v.d / 1000) * pct(v.waste);
  return vol > 0 ? vol : null;
}
export function concreteBags(vol: number): number {
  return up(vol / 0.0108);
}
