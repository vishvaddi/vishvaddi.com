// Kitchen — pure data model shared by /kitchen and /kitchen/plan. No DOM in
// here so `node --experimental-strip-types --test` can exercise it directly.

export interface Ingredient {
  qty: number | null;
  qtyMax: number | null;
  unit: string;
  item: string;
  note: string;
  raw: string;
}

export interface Recipe {
  id: string;
  title: string;
  sourceUrl: string;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  tags: string[];
  ingredients: Ingredient[];
  steps: string[];
  notes: string;
  createdAt: string;
  lastCookedAt: string | null;
}

export type Slot = "breakfast" | "lunch" | "dinner" | "snack";
export const SLOTS: Slot[] = ["breakfast", "lunch", "dinner", "snack"];

export interface PlanCell {
  recipeId?: string;
  text?: string;
  servings?: number;
  leftover?: boolean;
}

export interface PlanDay {
  away: boolean;
  slots: Partial<Record<Slot, PlanCell>>;
}

export type Aisle = "produce" | "meat & fish" | "dairy" | "pantry" | "frozen" | "bakery" | "other";
export const AISLES: Aisle[] = ["produce", "meat & fish", "dairy", "pantry", "frozen", "bakery", "other"];

export interface KitchenSettings {
  weekdayMaxMinutes: number;
  prepDay: boolean;
  leftoverDays: number;
  servings: number;
  showSnacks: boolean;
  seed: number;
}

export interface KitchenDoc {
  recipes: Recipe[];
  plan: { startDate: string; days: Record<string, PlanDay> };
  ticks: Record<string, boolean>;
  aisles: Record<string, Aisle>;
  settings: KitchenSettings;
}

export const KITCHEN_VERSION = 1;

export function initialDoc(): KitchenDoc {
  return {
    recipes: [],
    plan: { startDate: "", days: {} },
    ticks: {},
    aisles: {},
    settings: { weekdayMaxMinutes: 30, prepDay: true, leftoverDays: 2, servings: 2, showSnacks: false, seed: 1 },
  };
}

export function isKitchenDoc(data: unknown): data is KitchenDoc {
  if (!data || typeof data !== "object") return false;
  const d = data as Partial<KitchenDoc>;
  return Array.isArray(d.recipes) && !!d.plan && typeof d.plan === "object" && !!d.settings && typeof d.settings === "object";
}

// ── Ingredient parsing ──

const UNIT_ALIASES: Record<string, string> = {
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  tbsp: "tbsp", tbs: "tbsp", tbl: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  cup: "cup", cups: "cup", c: "cup",
  g: "g", gram: "g", grams: "g", gm: "g", gms: "g",
  kg: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  mg: "mg",
  ml: "ml", millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml",
  l: "l", litre: "l", litres: "l", liter: "l", liters: "l",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  pinch: "pinch", pinches: "pinch",
  clove: "clove", cloves: "clove",
  can: "tin", cans: "tin", tin: "tin", tins: "tin",
  bunch: "bunch", bunches: "bunch",
  slice: "slice", slices: "slice",
  piece: "piece", pieces: "piece", pc: "piece", pcs: "piece",
  sprig: "sprig", sprigs: "sprig",
  handful: "handful", handfuls: "handful",
  stick: "stick", sticks: "stick",
  sheet: "sheet", sheets: "sheet",
  packet: "packet", packets: "packet", pkt: "packet", pack: "packet", punnet: "punnet",
  head: "head", heads: "head",
  stalk: "stalk", stalks: "stalk",
  rasher: "rasher", rashers: "rasher",
  fillet: "fillet", fillets: "fillet",
  jar: "jar", jars: "jar",
  knob: "knob", dash: "dash", splash: "splash", drop: "drop", drops: "drop",
};

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};

const NUM = "(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+\\s*[½⅓⅔¼¾⅛⅜⅝⅞]|[½⅓⅔¼¾⅛⅜⅝⅞]|\\d+(?:[.,]\\d+)?)";
const QTY_RE = new RegExp(`^(${NUM})(?:\\s*(?:-|–|—|to)\\s*(${NUM}))?\\s*(.*)$`, "u");
const MULT_RE = new RegExp(`^[x×]\\s*(${NUM})\\s*(.*)$`, "iu");

export function parseNumber(token: string): number | null {
  const t = token.trim().replace(",", ".");
  if (!t) return null;
  const uni = t.match(/^(\d+)?\s*([½⅓⅔¼¾⅛⅜⅝⅞])$/u);
  if (uni) return (uni[1] ? Number(uni[1]) : 0) + UNICODE_FRACTIONS[uni[2]];
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseIngredient(line: string): Ingredient {
  const raw = line.trim();
  let rest = raw.replace(/^[-*•]\s*/, "");
  let qty: number | null = null;
  let qtyMax: number | null = null;
  let unit = "";

  const qm = rest.match(QTY_RE);
  if (qm) {
    qty = parseNumber(qm[1]);
    qtyMax = qm[2] ? parseNumber(qm[2]) : null;
    rest = qm[3];
    // "2 x 400 g tins" — multiply through so the shopping list aggregates by weight.
    const mm = rest.match(MULT_RE);
    if (mm && qty != null) {
      const n = parseNumber(mm[1]);
      if (n != null) { qty *= n; if (qtyMax != null) qtyMax *= n; }
      rest = mm[2];
    }
  }

  const um = rest.match(/^([A-Za-z]+)\.?(?=\s|$)(.*)$/);
  if (um && UNIT_ALIASES[um[1].toLowerCase()] && qty != null) {
    unit = UNIT_ALIASES[um[1].toLowerCase()];
    rest = um[2].trim();
  }
  rest = rest.replace(/^of\s+/i, "").trim();

  let note = "";
  const paren = rest.match(/^(.*?)\s*\(([^)]*)\)\s*(.*)$/);
  if (paren) {
    note = paren[2].trim();
    rest = `${paren[1]} ${paren[3]}`.trim();
  }
  const comma = rest.indexOf(",");
  if (comma > 0) {
    note = [rest.slice(comma + 1).trim(), note].filter(Boolean).join("; ");
    rest = rest.slice(0, comma).trim();
  }
  return { qty, qtyMax, unit, item: rest.trim(), note, raw };
}

export function parseIngredients(text: string): Ingredient[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(parseIngredient);
}

export function parseSteps(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim().replace(/^(?:\d+[.)]|[-*•])\s*/, "")).filter(Boolean);
}

export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const t of text.split(/[,;\n]/)) {
    const tag = t.trim().toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

// ── Quantities ──

const NICE_FRACTIONS: [number, number][] = [[1, 8], [1, 4], [1, 3], [3, 8], [1, 2], [5, 8], [2, 3], [3, 4], [7, 8]];

export function formatQty(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n === 0) return "0";
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.02) return String(whole);
  if (frac > 0.98) return String(whole + 1);
  for (const [num, den] of NICE_FRACTIONS) {
    if (Math.abs(frac - num / den) < 0.02) return whole ? `${whole} ${num}/${den}` : `${num}/${den}`;
  }
  const rounded = n >= 10 ? Math.round(n) : Math.round(n * 100) / 100;
  return String(rounded);
}

export function scaleIngredient(ing: Ingredient, factor: number): Ingredient {
  return {
    ...ing,
    qty: ing.qty == null ? null : ing.qty * factor,
    qtyMax: ing.qtyMax == null ? null : ing.qtyMax * factor,
  };
}

export function ingredientText(ing: Ingredient): string {
  const q = ing.qty == null ? "" : formatQty(ing.qty) + (ing.qtyMax != null ? `–${formatQty(ing.qtyMax)}` : "");
  const head = [q, ing.unit].filter(Boolean).join(" ");
  const body = [head, ing.item].filter(Boolean).join(" ");
  return ing.note ? `${body} (${ing.note})` : body;
}

export function totalMinutes(r: Recipe): number {
  return (r.prepMinutes || 0) + (r.cookMinutes || 0);
}

// ── Search / sort ──

export type SortKey = "title" | "recent" | "quickest";

export function searchRecipes(recipes: Recipe[], query: string, tags: string[] = []): Recipe[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return recipes.filter((r) => {
    if (tags.length && !tags.every((t) => r.tags.includes(t))) return false;
    if (!tokens.length) return true;
    const hay = [r.title, ...r.tags, ...r.ingredients.map((i) => i.item)].join(" ").toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

export function sortRecipes(recipes: Recipe[], key: SortKey): Recipe[] {
  const out = [...recipes];
  if (key === "title") out.sort((a, b) => a.title.localeCompare(b.title));
  else if (key === "recent") out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  else out.sort((a, b) => totalMinutes(a) - totalMinutes(b) || a.title.localeCompare(b.title));
  return out;
}

export function allTags(recipes: Recipe[]): string[] {
  const counts = new Map<string, number>();
  for (const r of recipes) for (const t of r.tags) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

export function recipeToMarkdown(r: Recipe): string {
  const lines = [`# ${r.title}`, ""];
  const meta: string[] = [];
  if (r.servings) meta.push(`Serves ${r.servings}`);
  if (r.prepMinutes) meta.push(`Prep ${r.prepMinutes} min`);
  if (r.cookMinutes) meta.push(`Cook ${r.cookMinutes} min`);
  if (r.tags.length) meta.push(`Tags: ${r.tags.join(", ")}`);
  if (meta.length) lines.push(meta.join(" · "), "");
  if (r.sourceUrl) lines.push(`Source: ${r.sourceUrl}`, "");
  lines.push("## Ingredients", "");
  for (const i of r.ingredients) lines.push(`- ${ingredientText(i)}`);
  lines.push("", "## Method", "");
  r.steps.forEach((s, n) => lines.push(`${n + 1}. ${s}`));
  if (r.notes) lines.push("", "## Notes", "", r.notes);
  return lines.join("\n") + "\n";
}

// ── Dates ──

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dayOfWeek(iso: string): number {
  return new Date(iso + "T00:00:00").getDay();
}

export function nextMonday(todayIso: string): string {
  const dow = dayOfWeek(todayIso);
  return addDays(todayIso, dow === 1 ? 0 : (8 - dow) % 7 || 7);
}

export function planDates(startIso: string, count = 14): string[] {
  return Array.from({ length: count }, (_, i) => addDays(startIso, i));
}

// ── Auto-fill ──

// mulberry32: tiny seeded PRNG so the e2e and unit tests get the same plan.
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PREP_TAGS = ["prep", "batch", "meal-prep", "meal prep"];

export function autoFillDinners(
  recipes: Recipe[],
  days: Record<string, PlanDay>,
  dates: string[],
  settings: KitchenSettings,
): Record<string, PlanDay> {
  const out: Record<string, PlanDay> = {};
  for (const [k, v] of Object.entries(days)) out[k] = { away: v.away, slots: { ...v.slots } };
  const rng = seededRandom(settings.seed || 1);
  // Ranked in stored order (not by id) so the same recipes + seed replay the same plan.
  const rank = new Map<string, number>();
  for (const r of recipes) rank.set(r.id, rng());

  const used = new Set<string>();
  for (const date of dates) {
    for (const cell of Object.values(out[date]?.slots || {})) if (cell?.recipeId) used.add(cell.recipeId);
  }
  const dayAt = (date: string): PlanDay => (out[date] ??= { away: false, slots: {} });
  const dinnerFree = (date: string): boolean => {
    const day = out[date];
    if (day?.away) return false;
    const c = day?.slots.dinner;
    return !c || (!c.recipeId && !c.text);
  };
  const isPrep = (r: Recipe): boolean => r.tags.some((t) => PREP_TAGS.includes(t));
  // Never cooked sorts first, then longest ago, then the seeded shuffle.
  const pick = (pool: Recipe[], freshOnly = false): Recipe | null => {
    const fresh = pool.filter((r) => !used.has(r.id));
    const cands = fresh.length ? fresh : freshOnly ? [] : pool;
    if (!cands.length) return null;
    return [...cands].sort((a, b) =>
      (a.lastCookedAt || "").localeCompare(b.lastCookedAt || "") || (rank.get(a.id) || 0) - (rank.get(b.id) || 0),
    )[0];
  };
  // Batch recipes are held back for Sunday so they are still fresh when it comes.
  const everyday = settings.prepDay && recipes.some((r) => !isPrep(r)) ? recipes.filter((r) => !isPrep(r)) : recipes;

  dates.forEach((date, i) => {
    if (!dinnerFree(date)) return;
    const dow = dayOfWeek(date);
    let chosen: Recipe | null = null;
    let leftoverDates: string[] = [];
    if (dow === 0 && settings.prepDay) {
      chosen = pick(recipes.filter(isPrep), true) || pick(recipes);
      for (let n = 1; n <= Math.max(0, Math.min(2, settings.leftoverDays)); n++) {
        const next = dates[i + n];
        if (next && dinnerFree(next)) leftoverDates.push(next);
      }
    } else if (dow >= 1 && dow <= 5) {
      const cap = (r: Recipe) => totalMinutes(r) <= settings.weekdayMaxMinutes;
      chosen = pick(everyday.filter(cap), true) || pick(recipes.filter(cap));
    } else {
      chosen = pick(everyday, true) || pick(recipes);
    }
    if (!chosen) return;
    used.add(chosen.id);
    const per = settings.servings || chosen.servings || 2;
    dayAt(date).slots.dinner = { recipeId: chosen.id, servings: per * (1 + leftoverDates.length) };
    for (const d of leftoverDates) dayAt(d).slots.dinner = { recipeId: chosen.id, servings: per, leftover: true };
  });
  return out;
}

// Once a planned day is behind us, remember the recipe was cooked so the next
// auto-fill rotates it to the back of the queue.
export function applyCooked(doc: KitchenDoc, todayIso: string): { doc: KitchenDoc; changed: boolean } {
  let changed = false;
  const recipes = doc.recipes.map((r) => ({ ...r }));
  const byId = new Map(recipes.map((r) => [r.id, r]));
  for (const [date, day] of Object.entries(doc.plan.days)) {
    if (date >= todayIso || day.away) continue;
    for (const cell of Object.values(day.slots)) {
      if (!cell?.recipeId || cell.leftover) continue;
      const r = byId.get(cell.recipeId);
      if (r && (!r.lastCookedAt || r.lastCookedAt < date)) { r.lastCookedAt = date; changed = true; }
    }
  }
  return { doc: changed ? { ...doc, recipes } : doc, changed };
}

// ── Shopping list ──

export interface ShoppingLine {
  key: string;
  item: string;
  unit: string;
  qty: number | null;
  count: number;
  aisle: Aisle;
  from: string[];
}

const AISLE_RULES: [Aisle, RegExp][] = [
  ["frozen", /\bfrozen\b|ice[- ]cream/],
  ["pantry", /\b(tinned|canned|tin|can|dried|paste|stock|broth|sauce|oil|vinegar|flour|sugar|rice|pasta|spaghetti|noodle|lentil|chickpea|couscous|quinoa|oat|cereal|salt|pepper|cumin|paprika|turmeric|curry|coriander seed|cinnamon|nutmeg|chilli flake|spice|soy|honey|maple|nut|almond|peanut|cashew|seed|coconut milk|coconut cream|passata|mustard|mayo|tahini|miso|kimchi|crackers?|biscuit|chocolate|cocoa|vanilla|baking|yeast|breadcrumb|stock cube|jam|tuna|sardine|anchov)\w*/],
  ["meat & fish", /\b(chicken|beef|pork|lamb|mince|bacon|sausage|salmon|fish|prawn|shrimp|steak|thigh|breast|ham|chorizo|turkey|veal|duck|kangaroo|squid|mussel|barramundi|snapper|cod|drumstick|wing|ribs?|brisket|chops?)\b/],
  ["dairy", /\b(milk|cheese|butter|yog(h)?urt|cream|eggs?|parmesan|feta|cheddar|mozzarella|ricotta|ghee|haloumi|halloumi|paneer|sour cream|creme fraiche|mascarpone|tofu)\b/],
  ["bakery", /\b(bread|rolls?|wraps?|tortillas?|buns?|pita|naan|sourdough|croissant|bagel|baguette|flatbread|roti|loaf)\b/],
  ["produce", /\b(onion|garlic|tomato|potato|carrot|capsicum|lettuce|spinach|basil|coriander|parsley|mint|thyme|rosemary|dill|chilli|chili|ginger|lemon|lime|apple|banana|avocado|cucumber|zucchini|pumpkin|broccoli|cauliflower|mushroom|celery|leek|spring onion|shallot|kale|cabbage|corn|beans?|peas?|berry|berries|orange|mango|salad|sweet potato|eggplant|beetroot|fruit|veg|herbs?|rocket|asparagus|bok choy|pak choi|snow pea|radish|fennel|sprouts?|grapes?|pear|peach|plum|kiwi|melon|pineapple|lemongrass|kaffir|turnip|parsnip|squash|okra)\w*/],
];

export function aisleFor(item: string): Aisle {
  const s = item.toLowerCase();
  for (const [aisle, re] of AISLE_RULES) if (re.test(s)) return aisle;
  return "other";
}

export function itemKey(item: string): string {
  return item.toLowerCase().replace(/\s+/g, " ").trim();
}

export function aggregateShopping(
  recipes: Recipe[],
  days: Record<string, PlanDay>,
  dates: string[],
  aisleOverrides: Record<string, Aisle> = {},
): ShoppingLine[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const lines = new Map<string, ShoppingLine>();
  for (const date of dates) {
    const day = days[date];
    if (!day || day.away) continue;
    for (const cell of Object.values(day.slots)) {
      if (!cell?.recipeId || cell.leftover) continue;
      const r = byId.get(cell.recipeId);
      if (!r) continue;
      const factor = (cell.servings || r.servings || 1) / (r.servings || 1);
      for (const ing of r.ingredients) {
        if (!ing.item) continue;
        const ik = itemKey(ing.item);
        const key = `${ik}|${ing.unit}`;
        let line = lines.get(key);
        if (!line) {
          line = { key, item: ing.item, unit: ing.unit, qty: null, count: 0, aisle: aisleOverrides[ik] || aisleFor(ing.item), from: [] };
          lines.set(key, line);
        }
        if (ing.qty != null) line.qty = (line.qty || 0) + ing.qty * factor;
        line.count++;
        if (!line.from.includes(r.title)) line.from.push(r.title);
      }
    }
  }
  return [...lines.values()].sort((a, b) => AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) || a.item.localeCompare(b.item));
}

export function shoppingLineText(line: ShoppingLine): string {
  const q = line.qty == null ? (line.count > 1 ? `×${line.count}` : "") : formatQty(line.qty);
  return [q, line.unit, line.item].filter(Boolean).join(" ");
}

export function shoppingListText(lines: ShoppingLine[], ticks: Record<string, boolean> = {}): string {
  const out: string[] = [];
  let current: Aisle | null = null;
  for (const line of lines) {
    if (line.aisle !== current) {
      if (current) out.push("");
      out.push(line.aisle.toUpperCase());
      current = line.aisle;
    }
    out.push(`${ticks[line.key] ? "[x]" : "[ ]"} ${shoppingLineText(line)}`);
  }
  return out.join("\n");
}
