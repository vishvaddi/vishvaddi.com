// Data for the /site/materials/<family> search-intent answer pages
// (plasterboard, tiles, paint, concrete). Each page answers one quantity
// question ("how many plasterboard sheets for a 4x5m room?") using the exact
// same maths as the /site/materials calculator (src/data/materials-calc.ts),
// so the calculator and these pages can never disagree.
//
// Sizes are a small, real-world grid — not every possible dimension. See the
// comment above each SIZES constant for why that grid was chosen.
import {
  up, pct,
  paintNetArea, paintLitres,
  sheetArea, sheetCount,
  tileArea, tileCount,
  concreteVolume, concreteBags,
} from "./materials-calc";
import { auFmt } from "../scripts/site/calc";

const f0 = (n: number) => auFmt(n, 0);
const f1 = (n: number) => auFmt(n, 1);
const f2 = (n: number) => auFmt(n, 2);
const numSlug = (n: number) => auFmt(n, 2).replace(/,/g, "").replace(".", "-");

export interface AnswerRow { label: string; value: string }
export interface AnswerFaq { q: string; a: string }
export interface AnswerLink { href: string; label: string }
export interface AnswerPage {
  family: string;
  slug: string;
  h1: string;
  metaTitle: string;
  metaDescription: string;
  intro: string;
  answerLead: string;
  answerNumber: string;
  context: string;
  rows: AnswerRow[];
  assumptions: string[];
  checkNote: string;
  changeHref: string;
  faq: AnswerFaq[];
  howTo: string[];
  keywords: string[];
  neighbours: AnswerLink[];
  indexLabel: string;
}

export interface FamilyIndex {
  family: string;
  href: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  intro: string;
  pages: AnswerLink[];
}

// AU project-home room footprints from a small bedroom to a living room, in
// roughly 1 m steps — the sizes an estimator is actually asked about, not an
// exhaustive L x W matrix.
const ROOM_SIZES: [number, number][] = [
  [3, 3], [3, 4], [3, 5], [3, 6],
  [4, 4], [4, 5], [4, 6],
  [5, 5], [5, 6],
  [6, 6],
];
// Stud/ceiling heights actually stocked and quoted in AU project homes.
const CEILING_HEIGHTS = [2.4, 2.55, 2.7];

// Typical wet-area / living-area floor sizes (bathroom through open living).
const TILE_AREAS = [4, 6, 8, 10, 12, 15, 20, 25];
// Common AU stocked tile sizes, small format to large format (mm).
const TILE_SIZES: [number, number][] = [[300, 300], [300, 600], [400, 400], [600, 600]];

// Common shed / patio / carport slab footprints.
const SLAB_SIZES: [number, number][] = [
  [3, 3], [3, 4], [3, 6],
  [4, 4], [4, 5], [4, 6],
  [5, 5], [5, 6],
  [6, 6], [6, 9],
];
// Standard residential (100), light-commercial/path (125) and driveway (150) thicknesses.
const SLAB_THICKNESS = [100, 125, 150];

const heightSlug = (h: number) => String(h).replace(".", "-");
const roomSlug = (l: number, w: number) => `${l}x${w}m-room`;

// ---------------------------------------------------------------------------
// Plasterboard
// ---------------------------------------------------------------------------
function buildPlasterboard(): AnswerPage[] {
  const pages: AnswerPage[] = [];
  for (const [l, w] of ROOM_SIZES) {
    for (const h of CEILING_HEIGHTS) {
      const perim = 2 * (l + w);
      const wallArea = perim * h;
      const each = sheetArea({ w: 1200, h: 2400 });
      const sheets = sheetCount({ area: wallArea, w: 1200, h: 2400, waste: 10 })!;
      const slug = `${roomSlug(l, w)}-${heightSlug(h)}m-ceiling`;
      const h1 = `How many plasterboard sheets for a ${l}×${w} m room with a ${h} m ceiling?`;
      const context = h <= 2.4
        ? `A standard 2400 mm sheet matches this ceiling height, so it runs vertically wall-to-ceiling in one piece with no horizontal joins needed.`
        : `A standard 2400 mm sheet is shorter than this ceiling, so plan on a horizontal joint partway up the wall, or order 2700 mm/3000 mm sheets to run full height instead.`;
      pages.push({
        family: "plasterboard",
        slug,
        h1,
        metaTitle: `${l}x${w}m Room, ${h}m Ceiling — Plasterboard Sheets (AU)`,
        metaDescription: `${sheets} sheets of standard 1200x2400mm plasterboard line a ${l}x${w}m room with a ${h}m ceiling, including 10% waste. Worked calculation and a pre-filled calculator link.`,
        intro: `A quick worked answer for lining a ${l}×${w} m room at a ${h} m ceiling height, using the same sheet size and waste allowance as the Material Calculators tool.`,
        answerLead: `You'll need ${f0(sheets)} sheets of standard 1200×2400 mm plasterboard to line the walls of this room, including a 10% cutting waste allowance.`,
        answerNumber: f0(sheets),
        context,
        rows: [
          { label: "Room size", value: `${l} m × ${w} m` },
          { label: "Ceiling height", value: `${h} m` },
          { label: "Wall perimeter", value: `${f2(perim)} m` },
          { label: "Wall area (perimeter × height)", value: `${f2(wallArea)} m²` },
          { label: "Waste allowance", value: `10%` },
          { label: "Area incl. waste", value: `${f2(wallArea * pct(10))} m²` },
          { label: "Sheet size", value: `1200 mm × 2400 mm (${f2(each)} m² each)` },
          { label: "Sheets needed", value: `${f0(sheets)}` },
        ],
        assumptions: [
          "Standard sheet size 1200 × 2400 mm (2.88 m²), the /site/materials calculator default.",
          "10% cutting waste allowance.",
          "Wall area only — perimeter × ceiling height. The ceiling lining and any door/window openings are not deducted, so the true count on a room with large openings will be a little lower.",
        ],
        checkNote: "Confirm the sheet size your supplier actually stocks (1200×2400/2700/3000 mm and 1350 mm-wide sheets all exist) and the wastage allowance with your plasterer before ordering — this figure doesn't deduct door or window openings.",
        changeHref: `/site/materials?calc=sheet&area=${wallArea.toFixed(2)}&w=1200&h=2400&waste=10#sheet`,
        faq: [
          { q: "Does this include the ceiling?", a: "No — this figure is walls only (perimeter × ceiling height). Add the room's floor area again, divided by 2.88 m² per sheet, if you're also lining the ceiling." },
          { q: "Why not deduct doors and windows?", a: "It keeps the figure a safe over-estimate for ordering. Openings reduce the true area needed, but offcuts from a cut sheet often can't be reused elsewhere, so most estimators order on the full wall area anyway." },
          { q: "What if my ceiling height isn't listed?", a: `Use the calculator directly at /site/materials — enter your own wall area (perimeter × height) and it will work out the sheet count instantly.` },
        ],
        howTo: [
          "Work out the wall perimeter: 2 × (length + width).",
          "Multiply the perimeter by the ceiling height to get wall area.",
          "Add the waste allowance, then divide by the sheet area and round up.",
        ],
        keywords: [`plasterboard sheets ${l}x${w} room`, `how many plasterboard sheets ${l}x${w}m`, "plasterboard calculator australia", `gyprock sheets ${l}x${w}m room`],
        neighbours: [],
        indexLabel: `${l}×${w} m, ${h} m ceiling`,
      });
    }
  }
  // 2-4 neighbour links: other ceiling heights on the same room, plus the
  // adjacent room size (by list order) at the same height.
  const byRoom = new Map<string, AnswerPage[]>();
  for (const p of pages) {
    const [l, w] = p.h1.match(/(\d+)×(\d+)/)!.slice(1);
    const key = `${l}x${w}`;
    if (!byRoom.has(key)) byRoom.set(key, []);
    byRoom.get(key)!.push(p);
  }
  ROOM_SIZES.forEach(([l, w], roomIdx) => {
    const forRoom = byRoom.get(`${l}x${w}`)!;
    CEILING_HEIGHTS.forEach((h, hIdx) => {
      const page = forRoom[hIdx];
      const links: AnswerLink[] = [];
      CEILING_HEIGHTS.forEach((otherH, otherIdx) => {
        if (otherIdx === hIdx) return;
        links.push({ href: `/site/materials/plasterboard/${forRoom[otherIdx].slug}/`, label: `${l}×${w} m, ${otherH} m ceiling` });
      });
      const prev = ROOM_SIZES[roomIdx - 1];
      const next = ROOM_SIZES[roomIdx + 1];
      if (prev) {
        const prevPage = byRoom.get(`${prev[0]}x${prev[1]}`)![hIdx];
        links.push({ href: `/site/materials/plasterboard/${prevPage.slug}/`, label: `${prev[0]}×${prev[1]} m, ${h} m ceiling` });
      }
      if (next) {
        const nextPage = byRoom.get(`${next[0]}x${next[1]}`)![hIdx];
        links.push({ href: `/site/materials/plasterboard/${nextPage.slug}/`, label: `${next[0]}×${next[1]} m, ${h} m ceiling` });
      }
      page.neighbours = links.slice(0, 4);
    });
  });
  return pages;
}

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------
function buildPaint(): AnswerPage[] {
  const pages: AnswerPage[] = [];
  const OPENINGS = 2; // a door + a window, the calculator default
  const COATS = 2;
  const COV = 11;
  for (const [l, w] of ROOM_SIZES) {
    for (const h of CEILING_HEIGHTS) {
      const perim = 2 * (l + w);
      const wallArea = perim * h;
      const net = paintNetArea({ area: wallArea, openings: OPENINGS });
      const litres = paintLitres({ area: wallArea, openings: OPENINGS, coats: COATS, cov: COV })!;
      const tins4 = up(litres / 4);
      const tins10 = up(litres / 10);
      const slug = `${roomSlug(l, w)}-${heightSlug(h)}m-ceiling`;
      const h1 = `How much paint for a ${l}×${w} m room with a ${h} m ceiling?`;
      pages.push({
        family: "paint",
        slug,
        h1,
        metaTitle: `${l}x${w}m Room, ${h}m Ceiling — Paint Quantity (AU)`,
        metaDescription: `${f2(litres)} L of paint covers the walls of a ${l}x${w}m room with a ${h}m ceiling over 2 coats. Worked calculation and a pre-filled calculator link.`,
        intro: `A quick worked answer for painting the walls of a ${l}×${w} m room at a ${h} m ceiling height, using the same coverage rate and coat count as the Material Calculators tool.`,
        answerLead: `You'll need about ${f2(litres)} L of paint for two coats on the walls of this room, after deducting ${f0(OPENINGS)} m² for a door and window.`,
        answerNumber: f2(litres),
        context: `That's roughly ${f0(tins4)} × 4 L tins, or ${f0(tins10)} × 10 L if your brand stocks the larger size — buying the bigger tin is almost always cheaper per litre.`,
        rows: [
          { label: "Room size", value: `${l} m × ${w} m` },
          { label: "Ceiling height", value: `${h} m` },
          { label: "Wall perimeter", value: `${f2(perim)} m` },
          { label: "Gross wall area", value: `${f2(wallArea)} m²` },
          { label: "Openings deducted", value: `${f0(OPENINGS)} m²` },
          { label: "Net area to paint", value: `${f2(net)} m²` },
          { label: "Coats", value: `${COATS}` },
          { label: "Coverage", value: `${COV} m²/L per coat` },
          { label: "Paint needed", value: `${f2(litres)} L` },
        ],
        assumptions: [
          `${COATS} coats at ${COV} m²/L coverage per coat — the /site/materials calculator defaults.`,
          `${OPENINGS} m² deducted for one door and one window combined; adjust this in the calculator if your room has more or fewer openings.`,
          "Wall area only — perimeter × ceiling height. The ceiling itself is not included.",
        ],
        checkNote: "Coverage varies by brand, surface porosity, colour change and whether it's a feature or textured wall — check the tin's stated coverage rate and buy a little extra for a dark base coat.",
        changeHref: `/site/materials?calc=paint&area=${wallArea.toFixed(2)}&openings=${OPENINGS}&coats=${COATS}&cov=${COV}#paint`,
        faq: [
          { q: "Does this include the ceiling?", a: "No — this is wall paint only. Ceilings are usually a different (flat) finish and are best estimated separately using the room's floor area." },
          { q: "What if my room has more doors and windows?", a: "Increase the openings deduction in the calculator — every extra 1 m² of opening reduces the area to paint by the same amount." },
          { q: "Why two coats?", a: "Two coats is the standard practical minimum for even coverage and colour depth on new or repainted plaster — one coat rarely covers evenly." },
        ],
        howTo: [
          "Work out the wall perimeter: 2 × (length + width).",
          "Multiply by ceiling height for gross wall area, then subtract openings.",
          "Multiply the net area by the number of coats, then divide by the coverage rate.",
        ],
        keywords: [`how much paint for a ${l}x${w} room`, `paint calculator ${l}x${w}m room`, "litres of paint per room australia", `paint quantity ${l}x${w}m room`],
        neighbours: [],
        indexLabel: `${l}×${w} m, ${h} m ceiling`,
      });
    }
  }
  const byRoom = new Map<string, AnswerPage[]>();
  for (const p of pages) {
    const [l, w] = p.h1.match(/(\d+)×(\d+)/)!.slice(1);
    const key = `${l}x${w}`;
    if (!byRoom.has(key)) byRoom.set(key, []);
    byRoom.get(key)!.push(p);
  }
  ROOM_SIZES.forEach(([l, w], roomIdx) => {
    const forRoom = byRoom.get(`${l}x${w}`)!;
    CEILING_HEIGHTS.forEach((h, hIdx) => {
      const page = forRoom[hIdx];
      const links: AnswerLink[] = [];
      CEILING_HEIGHTS.forEach((otherH, otherIdx) => {
        if (otherIdx === hIdx) return;
        links.push({ href: `/site/materials/paint/${forRoom[otherIdx].slug}/`, label: `${l}×${w} m, ${otherH} m ceiling` });
      });
      const prev = ROOM_SIZES[roomIdx - 1];
      const next = ROOM_SIZES[roomIdx + 1];
      if (prev) {
        const prevPage = byRoom.get(`${prev[0]}x${prev[1]}`)![hIdx];
        links.push({ href: `/site/materials/paint/${prevPage.slug}/`, label: `${prev[0]}×${prev[1]} m, ${h} m ceiling` });
      }
      if (next) {
        const nextPage = byRoom.get(`${next[0]}x${next[1]}`)![hIdx];
        links.push({ href: `/site/materials/paint/${nextPage.slug}/`, label: `${next[0]}×${next[1]} m, ${h} m ceiling` });
      }
      page.neighbours = links.slice(0, 4);
    });
  });
  return pages;
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------
function buildTiles(): AnswerPage[] {
  const pages: AnswerPage[] = [];
  for (const area of TILE_AREAS) {
    for (const [w, hmm] of TILE_SIZES) {
      const each = tileArea({ w, h: hmm });
      const count = tileCount({ area, w, h: hmm, waste: 10 })!;
      const perSqm = 1 / each;
      const slug = `${numSlug(area)}sqm-${w}x${hmm}mm-tiles`;
      const h1 = `How many tiles for ${area} m² using ${w}×${hmm} mm tiles?`;
      const isSmall = w <= 300 && hmm <= 300;
      const isLarge = w >= 600 && hmm >= 600;
      const context = isSmall
        ? "This is a small-format tile, so expect more grout lines and a slower lay than a large-format tile covering the same area."
        : isLarge
          ? "This is a large-format tile — fewer grout lines and a faster-looking finish, but it often takes two people to place each tile without cracking it."
          : "This is a mid-size tile, a reasonable balance between cutting waste and ease of handling.";
      pages.push({
        family: "tiles",
        slug,
        h1,
        metaTitle: `${area}sqm, ${w}x${hmm}mm Tiles — Tile Count (AU)`,
        metaDescription: `${f0(count)} tiles cover ${area} m² using ${w}x${hmm}mm tiles, including 10% cutting waste. Worked calculation and a pre-filled calculator link.`,
        intro: `A quick worked answer for tiling ${area} m² with ${w}×${hmm} mm tiles, using the same waste allowance as the Material Calculators tool.`,
        answerLead: `You'll need ${f0(count)} tiles to cover ${area} m² with ${w}×${hmm} mm tiles, including a 10% cutting waste allowance.`,
        answerNumber: f0(count),
        context,
        rows: [
          { label: "Area to tile", value: `${area} m²` },
          { label: "Tile size", value: `${w} mm × ${hmm} mm` },
          { label: "Area per tile", value: `${f2(each)} m²` },
          { label: "Tiles per m²", value: `${f2(perSqm)}` },
          { label: "Waste allowance", value: `10%` },
          { label: "Area incl. waste", value: `${f2(area * pct(10))} m²` },
          { label: "Tiles needed", value: `${f0(count)}` },
        ],
        assumptions: [
          "10% cutting/wastage allowance, the /site/materials calculator default.",
          "Straight (grid) lay. Diagonal, herringbone or feature layouts typically need more waste.",
        ],
        checkNote: "Confirm the exact tile size and lay pattern with your tiler — offset, diagonal and herringbone layouts all waste more than a straight lay — and buy a few extra of the same batch for future repairs.",
        changeHref: `/site/materials?calc=tiles&area=${area}&w=${w}&h=${hmm}&waste=10#tiles`,
        faq: [
          { q: "Does this allow for a pattern lay?", a: "No — this is a straight lay allowance. Diagonal, herringbone or feature layouts need a higher waste percentage; use the calculator directly to raise it." },
          { q: "Should I buy extra for future repairs?", a: "Yes — tile batches (and even the same range) can vary in shade between production runs, so keep spare tiles from the same batch rather than trying to match one later." },
          { q: "What if my area or tile size isn't listed?", a: "Use the calculator directly at /site/materials — enter your own area and tile dimensions and it updates instantly." },
        ],
        howTo: [
          "Work out the area per tile from its width and length in mm.",
          "Add the waste allowance to the area you're tiling.",
          "Divide by the area per tile and round up.",
        ],
        keywords: [`how many tiles for ${area}m2`, `tile calculator ${w}x${hmm}mm`, "tile quantity calculator australia", `tiles needed for ${area} square metres`],
        neighbours: [],
        indexLabel: `${area} m², ${w}×${hmm} mm`,
      });
    }
  }
  TILE_AREAS.forEach((area, areaIdx) => {
    TILE_SIZES.forEach(([w, hmm], sizeIdx) => {
      const page = pages.find((p) => p.slug === `${numSlug(area)}sqm-${w}x${hmm}mm-tiles`)!;
      const links: AnswerLink[] = [];
      TILE_SIZES.forEach(([ow, oh], otherIdx) => {
        if (otherIdx === sizeIdx) return;
        links.push({ href: `/site/materials/tiles/${numSlug(area)}sqm-${ow}x${oh}mm-tiles/`, label: `${area} m², ${ow}×${oh} mm` });
      });
      const prevArea = TILE_AREAS[areaIdx - 1];
      const nextArea = TILE_AREAS[areaIdx + 1];
      if (prevArea !== undefined) links.push({ href: `/site/materials/tiles/${numSlug(prevArea)}sqm-${w}x${hmm}mm-tiles/`, label: `${prevArea} m², ${w}×${hmm} mm` });
      if (nextArea !== undefined) links.push({ href: `/site/materials/tiles/${numSlug(nextArea)}sqm-${w}x${hmm}mm-tiles/`, label: `${nextArea} m², ${w}×${hmm} mm` });
      page.neighbours = links.slice(0, 4);
    });
  });
  return pages;
}

// ---------------------------------------------------------------------------
// Concrete
// ---------------------------------------------------------------------------
function buildConcrete(): AnswerPage[] {
  const pages: AnswerPage[] = [];
  for (const [l, w] of SLAB_SIZES) {
    for (const d of SLAB_THICKNESS) {
      const vol = concreteVolume({ l, w, d, waste: 5 })!;
      const bags = concreteBags(vol);
      const mass = vol * 2.4;
      const slug = `${l}x${w}m-slab-${d}mm`;
      const h1 = `How much concrete for a ${l}×${w} m slab at ${d} mm thick?`;
      const context = vol > 1.5
        ? "Over about 1.5 m³, pre-mixed delivery from a truck is usually cheaper and far less effort than mixing this many bags by hand — get a quote before defaulting to bags."
        : "At this volume, bagged premix is a practical DIY option — budget real time for mixing this many bags by hand.";
      pages.push({
        family: "concrete",
        slug,
        h1,
        metaTitle: `${l}x${w}m Slab, ${d}mm Thick — Concrete Volume (AU)`,
        metaDescription: `${f2(vol)} m³ of concrete (${f0(bags)} x 20kg bags) for a ${l}x${w}m slab at ${d}mm thick, including 5% waste. Worked calculation and a pre-filled calculator link.`,
        intro: `A quick worked answer for a ${l}×${w} m slab at ${d} mm thick, using the same waste allowance and bag yield as the Material Calculators tool.`,
        answerLead: `You'll need about ${f2(vol)} m³ of concrete for this slab, including a 5% wastage allowance — that's roughly ${f0(bags)} × 20 kg premix bags if you're not ordering pre-mixed.`,
        answerNumber: f2(vol),
        context,
        rows: [
          { label: "Slab size", value: `${l} m × ${w} m` },
          { label: "Thickness", value: `${d} mm` },
          { label: "Waste allowance", value: `5%` },
          { label: "Concrete volume", value: `${f2(vol)} m³` },
          { label: "20 kg bags", value: `${f0(bags)}` },
          { label: "Approx. mass", value: `${f2(mass)} t (@ 2.4 t/m³)` },
        ],
        assumptions: [
          "5% wastage allowance, the /site/materials calculator default.",
          "20 kg premix bags yield about 0.0108 m³ each.",
          "Volume only — excludes reinforcement (mesh), formwork, base preparation and any fall/thickening at edges.",
        ],
        checkNote: "Confirm reinforcement (mesh/reo), site access for a mixer truck, and the exact thickness with your slab supplier or engineer before ordering — this figure is volume only.",
        changeHref: `/site/materials?calc=concrete&l=${l}&w=${w}&d=${d}&waste=5#concrete`,
        faq: [
          { q: "Should I order bags or a truck?", a: vol > 1.5 ? "At this volume, a mixer truck is almost always cheaper and much less labour than bags — get a delivered quote before committing to bags." : "At this volume, bagged premix is usually practical, though it's worth a quick delivered quote for comparison if you're short on time." },
          { q: "Does this include reinforcement mesh?", a: "No — this is concrete volume only. Use the Reo mesh calculator on /site/materials for SL-mesh sheet counts separately." },
          { q: "What about edge thickening or footings?", a: "Not included — this assumes a uniform slab thickness. Add extra volume separately for any thickened edges or integrated footings." },
        ],
        howTo: [
          "Multiply length × width × thickness (in metres) for raw volume.",
          "Add the waste allowance.",
          "Divide by 0.0108 m³ per 20 kg bag and round up, if using bags.",
        ],
        keywords: [`concrete calculator ${l}x${w}m slab`, `how much concrete for a ${l}x${w} slab`, `concrete bags ${l}x${w}m ${d}mm`, "concrete volume calculator australia"],
        neighbours: [],
        indexLabel: `${l}×${w} m, ${d} mm`,
      });
    }
  }
  const bySize = new Map<string, AnswerPage[]>();
  for (const p of pages) {
    const key = p.slug.split("-slab-")[0];
    if (!bySize.has(key)) bySize.set(key, []);
    bySize.get(key)!.push(p);
  }
  SLAB_SIZES.forEach(([l, w], sizeIdx) => {
    const forSize = bySize.get(`${l}x${w}m`)!;
    SLAB_THICKNESS.forEach((d, dIdx) => {
      const page = forSize[dIdx];
      const links: AnswerLink[] = [];
      SLAB_THICKNESS.forEach((otherD, otherIdx) => {
        if (otherIdx === dIdx) return;
        links.push({ href: `/site/materials/concrete/${forSize[otherIdx].slug}/`, label: `${l}×${w} m, ${otherD} mm` });
      });
      const prev = SLAB_SIZES[sizeIdx - 1];
      const next = SLAB_SIZES[sizeIdx + 1];
      if (prev) {
        const prevPage = bySize.get(`${prev[0]}x${prev[1]}m`)![dIdx];
        links.push({ href: `/site/materials/concrete/${prevPage.slug}/`, label: `${prev[0]}×${prev[1]} m, ${d} mm` });
      }
      if (next) {
        const nextPage = bySize.get(`${next[0]}x${next[1]}m`)![dIdx];
        links.push({ href: `/site/materials/concrete/${nextPage.slug}/`, label: `${next[0]}×${next[1]} m, ${d} mm` });
      }
      page.neighbours = links.slice(0, 4);
    });
  });
  return pages;
}

export const PLASTERBOARD_PAGES = buildPlasterboard();
export const PAINT_PAGES = buildPaint();
export const TILE_PAGES = buildTiles();
export const CONCRETE_PAGES = buildConcrete();

export const FAMILY_INDEXES: FamilyIndex[] = [
  {
    family: "plasterboard",
    href: "/site/materials/plasterboard",
    title: "Plasterboard Sheets by Room Size",
    metaTitle: "Plasterboard Sheets by Room Size — Worked Answers (AU)",
    metaDescription: "How many plasterboard sheets for common AU room sizes and ceiling heights, worked out with standard 1200x2400mm sheets and 10% waste.",
    intro: "Worked sheet counts for common room sizes and ceiling heights, using standard 1200×2400 mm plasterboard and the same 10% waste allowance as the Material Calculators tool. Pick your room size below, or use the calculator directly for anything else.",
    pages: PLASTERBOARD_PAGES.map((p) => ({ href: `/site/materials/plasterboard/${p.slug}/`, label: p.indexLabel })),
  },
  {
    family: "paint",
    href: "/site/materials/paint",
    title: "Paint Quantity by Room Size",
    metaTitle: "Paint Quantity by Room Size — Worked Answers (AU)",
    metaDescription: "How much paint for common AU room sizes and ceiling heights, worked out at 2 coats and 11 m2/L coverage.",
    intro: "Worked paint quantities for common room sizes and ceiling heights, at two coats and 11 m²/L coverage — the same defaults as the Material Calculators tool. Pick your room size below, or use the calculator directly for anything else.",
    pages: PAINT_PAGES.map((p) => ({ href: `/site/materials/paint/${p.slug}/`, label: p.indexLabel })),
  },
  {
    family: "tiles",
    href: "/site/materials/tiles",
    title: "Tile Count by Area and Tile Size",
    metaTitle: "Tile Count by Area and Tile Size — Worked Answers (AU)",
    metaDescription: "How many tiles for common AU floor and wall areas and tile sizes, worked out with 10% cutting waste.",
    intro: "Worked tile counts for common areas and tile sizes, with a 10% cutting waste allowance — the same default as the Material Calculators tool. Pick your area and tile size below, or use the calculator directly for anything else.",
    pages: TILE_PAGES.map((p) => ({ href: `/site/materials/tiles/${p.slug}/`, label: p.indexLabel })),
  },
  {
    family: "concrete",
    href: "/site/materials/concrete",
    title: "Concrete Volume by Slab Size",
    metaTitle: "Concrete Volume by Slab Size — Worked Answers (AU)",
    metaDescription: "How much concrete for common AU shed, patio and carport slab sizes and thicknesses, worked out with 5% waste and 20kg bag yields.",
    intro: "Worked concrete volumes and bag counts for common slab sizes and thicknesses, with a 5% waste allowance — the same default as the Material Calculators tool. Pick your slab size below, or use the calculator directly for anything else.",
    pages: CONCRETE_PAGES.map((p) => ({ href: `/site/materials/concrete/${p.slug}/`, label: p.indexLabel })),
  },
];
