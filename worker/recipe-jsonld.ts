// schema.org Recipe (JSON-LD) → the flat shape /kitchen imports. Pure so the
// Worker route stays a thin fetch wrapper and the parsing can be unit-tested.

export interface NormalisedRecipe {
  title: string;
  sourceUrl: string;
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  ingredients: string[];
  steps: string[];
  tags: string[];
}

type Node = Record<string, unknown>;

function decodeEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

export function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/<\/?(?:p|div|li|br|h\d|tr)\b[^>]*>/gi, " ").replace(/<[^>]+>/g, "");
  return decodeEntities(text).replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
}

export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    // Some CMSs leave CDATA wrappers or HTML comments around the JSON.
    const body = m[1].replace(/^\s*<!--/, "").replace(/-->\s*$/, "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    if (!body) continue;
    try { out.push(JSON.parse(body)); } catch { /* malformed block: skip, another may be fine */ }
  }
  return out;
}

function hasType(node: Node, type: string): boolean {
  const t = node["@type"];
  const list = Array.isArray(t) ? t : [t];
  return list.some((x) => typeof x === "string" && x.toLowerCase() === type.toLowerCase());
}

export function findRecipe(value: unknown, depth = 0): Node | null {
  if (depth > 6 || !value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const v of value) { const r = findRecipe(v, depth + 1); if (r) return r; }
    return null;
  }
  const node = value as Node;
  if (hasType(node, "Recipe")) return node;
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "hasPart", "about"]) {
    if (key in node) { const r = findRecipe(node[key], depth + 1); if (r) return r; }
  }
  return null;
}

export function parseIsoDuration(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value !== "string") return null;
  const m = value.trim().toUpperCase().match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) {
    const loose = value.match(/(\d+)\s*(?:h|hr|hour)/i);
    const looseMin = value.match(/(\d+)\s*(?:m|min|minute)/i);
    if (!loose && !looseMin) return null;
    return (loose ? Number(loose[1]) * 60 : 0) + (looseMin ? Number(looseMin[1]) : 0);
  }
  const [, d, h, min, s] = m;
  if (!d && !h && !min && !s) return null;
  return Math.round((Number(d || 0) * 1440) + (Number(h || 0) * 60) + Number(min || 0) + Number(s || 0) / 60);
}

export function parseYield(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const v of value) { const n = parseYield(v); if (n) return n; }
    return null;
  }
  if (typeof value === "number") return value > 0 ? Math.round(value) : null;
  if (typeof value !== "string") return null;
  const m = value.match(/\d+(?:\.\d+)?/);
  const n = m ? Math.round(Number(m[0])) : 0;
  return n > 0 ? n : null;
}

export function flattenInstructions(value: unknown, depth = 0): string[] {
  if (depth > 5 || value == null) return [];
  if (typeof value === "string") {
    return value.split(/\r?\n+/).map((s) => cleanText(s.replace(/^\s*(?:\d+[.)]|step\s*\d+[:.]?)\s*/i, ""))).filter(Boolean);
  }
  if (Array.isArray(value)) return value.flatMap((v) => flattenInstructions(v, depth + 1));
  if (typeof value === "object") {
    const node = value as Node;
    if (hasType(node, "HowToSection") || Array.isArray(node.itemListElement)) {
      return flattenInstructions(node.itemListElement, depth + 1);
    }
    const text = cleanText(node.text) || cleanText(node.name) || cleanText(node.description);
    return text ? [text] : [];
  }
  return [];
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(stringList);
  if (typeof value === "string") return value.split(",").map(cleanText).filter(Boolean);
  if (value && typeof value === "object") return stringList((value as Node).name);
  return [];
}

export function normaliseRecipe(node: Node, sourceUrl: string): NormalisedRecipe {
  const prep = parseIsoDuration(node.prepTime);
  let cook = parseIsoDuration(node.cookTime);
  const total = parseIsoDuration(node.totalTime);
  if (cook == null && total != null) cook = Math.max(0, total - (prep || 0));

  const tags: string[] = [];
  for (const raw of [...stringList(node.recipeCategory), ...stringList(node.recipeCuisine), ...stringList(node.keywords)]) {
    const t = raw.toLowerCase();
    if (t && t.length <= 40 && !tags.includes(t)) tags.push(t);
    if (tags.length >= 12) break;
  }

  const ingredients = stringListNoSplit(node.recipeIngredient ?? node.ingredients);
  return {
    title: cleanText(node.name) || cleanText(node.headline),
    sourceUrl,
    servings: parseYield(node.recipeYield),
    prepMinutes: prep,
    cookMinutes: cook,
    ingredients,
    steps: flattenInstructions(node.recipeInstructions),
    tags,
  };
}

// Ingredients keep their commas ("1 onion, diced") so they are not split like keywords.
function stringListNoSplit(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(stringListNoSplit);
  if (typeof value === "string") return value.split(/\r?\n/).map(cleanText).filter(Boolean);
  if (value && typeof value === "object") return stringListNoSplit((value as Node).name ?? (value as Node).text);
  return [];
}

export function recipeFromHtml(html: string, sourceUrl: string): NormalisedRecipe | null {
  const node = findRecipe(extractJsonLd(html));
  if (!node) return null;
  const recipe = normaliseRecipe(node, sourceUrl);
  return recipe.title || recipe.ingredients.length ? recipe : null;
}
