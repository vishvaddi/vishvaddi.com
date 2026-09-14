// Pure logic for /money: data shapes, CSV import, budget maths, debt payoff and
// projections. No DOM, no storage — unit-tested directly under node.

export type AccountType = "cash" | "savings" | "super" | "investment" | "property" | "loan" | "credit";
export const ACCOUNT_TYPES: { id: AccountType; label: string; liability: boolean }[] = [
  { id: "cash", label: "Cash / everyday", liability: false },
  { id: "savings", label: "Savings / offset", liability: false },
  { id: "super", label: "Super", liability: false },
  { id: "investment", label: "Investment", liability: false },
  { id: "property", label: "Property", liability: false },
  { id: "loan", label: "Loan / mortgage", liability: true },
  { id: "credit", label: "Credit card", liability: true },
];

export interface Category { id: string; name: string; budget: number }
export interface Account { id: string; name: string; type: AccountType; balance: number }
// amount: negative = money out, positive = money in.
export interface Transaction { id: string; date: string; amount: number; description: string; categoryId: string | null; accountId: string | null }
export interface Snapshot { month: string; assets: number; liabilities: number; net: number; at: string }
export interface Holding { id: string; name: string; units: number; avgCost: number; price: number; priceAt: string; currency: string }
export interface Debt { id: string; name: string; balance: number; apr: number; minimum: number }
export interface Rule { id: string; pattern: string; categoryId: string }
export interface ColumnMapping {
  date: number;
  dateFormat: DateFormat;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  description: number;
  // Some banks list debits as positive numbers in a single column; flip when so.
  negateAmount: boolean;
  hasHeader: boolean;
}
export interface CsvPreset { signature: string; name: string; mapping: ColumnMapping }
export interface MoneyData {
  categories: Category[];
  accounts: Account[];
  transactions: Transaction[];
  snapshots: Snapshot[];
  holdings: Holding[];
  debts: Debt[];
  rules: Rule[];
  presets: CsvPreset[];
  settings: { month: string; extra?: number; strategy?: Strategy };
}

export const DEFAULT_CATEGORIES: [string, number][] = [
  ["Rent/Mortgage", 2000], ["Groceries", 600], ["Eating out", 250], ["Transport", 250],
  ["Utilities", 200], ["Phone/Internet", 100], ["Insurance", 150], ["Health", 100],
  ["Subscriptions", 60], ["Fun", 200], ["Gifts", 50], ["Savings", 500],
  ["Debt repayments", 300], ["Other", 100],
];

export const DEFAULT_RULES: [string, string][] = [
  ["woolworths|coles|aldi|iga|harris farm", "Groceries"],
  ["uber eats|menulog|doordash|cafe|coffee|mcdonald|kfc|hungry jack|domino", "Eating out"],
  ["opal|myki|translink|uber|didi|bp |caltex|ampol|shell|7-eleven|linkt|e-toll", "Transport"],
  ["agl|origin|energyaustralia|alinta|sydney water|yarra valley water", "Utilities"],
  ["telstra|optus|vodafone|tpg|aussie broadband|belong", "Phone/Internet"],
  ["nib|bupa|medibank|ahm|hcf|allianz|nrma|racv|budget direct", "Insurance"],
  ["chemist|pharmacy|medical|dental|physio", "Health"],
  ["netflix|spotify|stan |binge|disney|youtube|apple.com/bill|kayo|prime video", "Subscriptions"],
  ["rent|mortgage|loan repayment", "Rent/Mortgage"],
];

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function initialData(month = currentMonth()): MoneyData {
  const categories = DEFAULT_CATEGORIES.map(([name, budget]) => ({ id: slug(name), name, budget }));
  const rules = DEFAULT_RULES.map(([pattern, cat], i) => ({ id: `rule-${i}`, pattern, categoryId: slug(cat) }));
  return { categories, accounts: [], transactions: [], snapshots: [], holdings: [], debts: [], rules, presets: [], settings: { month } };
}

export function isMoneyData(d: unknown): d is MoneyData {
  if (!d || typeof d !== "object") return false;
  const o = d as Record<string, unknown>;
  return ["categories", "accounts", "transactions", "snapshots", "holdings", "debts", "rules", "presets"].every((k) => Array.isArray(o[k]))
    && typeof o.settings === "object" && o.settings !== null;
}

// ── Dates ──
export type DateFormat = "DMY" | "ISO" | "DMMMY" | "MDY";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

export function currentMonth(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return currentMonth(d);
}

export function parseDate(raw: string, fmt: DateFormat): string | null {
  const s = raw.trim();
  let y = 0, m = 0, d = 0;
  if (fmt === "ISO") {
    const mt = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (!mt) return null;
    [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  } else if (fmt === "DMY" || fmt === "MDY") {
    const mt = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(s);
    if (!mt) return null;
    const a = Number(mt[1]), b = Number(mt[2]);
    y = Number(mt[3]);
    if (mt[3].length === 2) y += 2000;
    [d, m] = fmt === "DMY" ? [a, b] : [b, a];
  } else {
    const mt = /^(\d{1,2})[ \-]([A-Za-z]{3})[A-Za-z]*[ \-,]+(\d{2,4})/.exec(s);
    if (!mt) return null;
    d = Number(mt[1]);
    m = MONTHS.indexOf(mt[2].toLowerCase()) + 1;
    y = Number(mt[3]);
    if (mt[3].length === 2) y += 2000;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return null;
  if (d > new Date(y, m, 0).getDate()) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

// Picks the format that parses every sample. DMY beats MDY on a tie because
// this is an Australian tool.
export function detectDateFormat(samples: string[]): DateFormat | null {
  const clean = samples.map((s) => s.trim()).filter(Boolean);
  if (!clean.length) return null;
  const order: DateFormat[] = ["ISO", "DMMMY", "DMY", "MDY"];
  for (const fmt of order) if (clean.every((s) => parseDate(s, fmt) !== null)) return fmt;
  return null;
}

export function fmtDateAu(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(y, m - 1, d));
}

export function fmtMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
}

// ── Money ──
const aud = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const aud0 = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
export const fmtAud = (n: number, whole = false): string => (whole ? aud0 : aud).format(Math.abs(n) < 0.005 ? 0 : n);
export const round2 = (n: number): number => Math.round(n * 100) / 100;

export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^-/.test(s)) { neg = true; s = s.slice(1); }
  if (/(cr|dr)$/i.test(s)) { if (/dr$/i.test(s)) neg = !neg; s = s.replace(/\s*(cr|dr)$/i, ""); }
  s = s.replace(/[$A-Za-z,\s]/g, "");
  if (!s || !/^\d*\.?\d*$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

// ── CSV ──
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export function csvLine(fields: (string | number)[]): string {
  return fields.map((f) => `"${String(f ?? "").replace(/"/g, '""')}"`).join(",");
}

export function headerSignature(headers: string[]): string {
  return headers.map((h) => h.trim().toLowerCase()).join("|");
}

function looksLikeHeader(row: string[]): boolean {
  return row.some((f) => /[A-Za-z]{3,}/.test(f)) && !row.some((f) => parseAmount(f) !== null && /\d/.test(f) && !/[A-Za-z]/.test(f));
}

// Best-effort column guess from header names, falling back to sniffing the data
// rows. Always returns something; the user confirms in the mapping UI.
export function guessMapping(rows: string[][]): ColumnMapping {
  const first = rows[0] ?? [];
  const hasHeader = looksLikeHeader(first);
  const headers = hasHeader ? first.map((h) => h.trim().toLowerCase()) : first.map(() => "");
  const body = hasHeader ? rows.slice(1) : rows;
  const cols = Math.max(first.length, ...body.map((r) => r.length));
  const findHeader = (re: RegExp) => headers.findIndex((h) => re.test(h));
  const colSamples = (i: number) => body.slice(0, 20).map((r) => r[i] ?? "");
  const isDateCol = (i: number) => detectDateFormat(colSamples(i).filter(Boolean)) !== null && colSamples(i).some(Boolean);
  const isNumCol = (i: number) => {
    const s = colSamples(i).filter((v) => v.trim());
    return s.length > 0 && s.every((v) => parseAmount(v) !== null);
  };

  let date = findHeader(/date/);
  if (date < 0) date = Array.from({ length: cols }, (_, i) => i).find(isDateCol) ?? 0;
  const dateFormat = detectDateFormat(colSamples(date).filter(Boolean)) ?? "DMY";

  let debit = findHeader(/debit|withdraw|money out|spent/);
  let credit = findHeader(/credit|deposit|money in|received/);
  let amount = findHeader(/^amount|amount$|value|total/);
  if (debit >= 0 && credit >= 0) amount = -1;
  else { debit = -1; credit = -1; }
  if (amount < 0 && debit < 0) {
    amount = Array.from({ length: cols }, (_, i) => i).find((i) => i !== date && isNumCol(i) && !/balance/.test(headers[i] ?? "")) ?? -1;
  }
  let description = findHeader(/desc|narrat|detail|memo|payee|particular|transaction/);
  if (description < 0) {
    description = Array.from({ length: cols }, (_, i) => i).find((i) => i !== date && i !== amount && i !== debit && i !== credit && !isNumCol(i)) ?? 0;
  }
  return {
    date, dateFormat,
    amount: amount >= 0 ? amount : null,
    debit: debit >= 0 ? debit : null,
    credit: credit >= 0 ? credit : null,
    description, negateAmount: false, hasHeader,
  };
}

export interface ImportRow { date: string; amount: number; description: string }

export function rowsToImportRows(rows: string[][], mapping: ColumnMapping): { ok: ImportRow[]; skipped: number } {
  const body = mapping.hasHeader ? rows.slice(1) : rows;
  const ok: ImportRow[] = [];
  let skipped = 0;
  for (const r of body) {
    const date = parseDate(r[mapping.date] ?? "", mapping.dateFormat);
    let amount: number | null = null;
    if (mapping.amount !== null) {
      amount = parseAmount(r[mapping.amount] ?? "");
      if (amount !== null && mapping.negateAmount) amount = -amount;
    } else if (mapping.debit !== null || mapping.credit !== null) {
      const d = mapping.debit !== null ? parseAmount(r[mapping.debit] ?? "") : null;
      const c = mapping.credit !== null ? parseAmount(r[mapping.credit] ?? "") : null;
      if (d === null && c === null) amount = null;
      else amount = (c ?? 0) - Math.abs(d ?? 0);
    }
    const description = (r[mapping.description] ?? "").replace(/\s+/g, " ").trim();
    if (!date || amount === null) { skipped++; continue; }
    ok.push({ date, amount: round2(amount), description });
  }
  return { ok, skipped };
}

export const txKey = (t: { date: string; amount: number; description: string }): string =>
  `${t.date}|${t.amount.toFixed(2)}|${t.description.toLowerCase().replace(/\s+/g, " ").trim()}`;

// Drops incoming rows that already exist, counting duplicates within the file
// itself so re-importing the same statement is a no-op.
export function dedupe<T extends { date: string; amount: number; description: string }>(existing: { date: string; amount: number; description: string }[], incoming: T[]): { fresh: T[]; dupes: number } {
  const seen = new Map<string, number>();
  for (const t of existing) seen.set(txKey(t), (seen.get(txKey(t)) ?? 0) + 1);
  const fresh: T[] = [];
  let dupes = 0;
  for (const t of incoming) {
    const k = txKey(t);
    const n = seen.get(k) ?? 0;
    if (n > 0) { seen.set(k, n - 1); dupes++; continue; }
    fresh.push(t);
  }
  return { fresh, dupes };
}

// ── Categorisation ──
export function categorise(description: string, rules: Rule[]): string | null {
  const d = description.toLowerCase();
  for (const rule of rules) {
    const terms = rule.pattern.split("|").map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (terms.some((t) => d.includes(t))) return rule.categoryId;
  }
  return null;
}

export function applyRules(transactions: Transaction[], rules: Rule[], onlyUncategorised: boolean): { transactions: Transaction[]; changed: number } {
  let changed = 0;
  const out = transactions.map((t) => {
    if (onlyUncategorised && t.categoryId) return t;
    const c = categorise(t.description, rules);
    if (!c || c === t.categoryId) return t;
    changed++;
    return { ...t, categoryId: c };
  });
  return { transactions: out, changed };
}

// ── Budget ──
export interface BudgetLine { category: Category; actual: number; remaining: number; pct: number }
export interface BudgetSummary {
  lines: BudgetLine[];
  budgetTotal: number;
  spentTotal: number;
  incomeTotal: number;
  uncategorised: number;
  remaining: number;
  daysLeft: number;
  safePerDay: number;
}

export function budgetSummary(data: Pick<MoneyData, "categories" | "transactions">, month: string, today: string): BudgetSummary {
  const inMonth = data.transactions.filter((t) => t.date.startsWith(month));
  const spentBy = new Map<string, number>();
  let uncategorised = 0, incomeTotal = 0, spentTotal = 0;
  for (const t of inMonth) {
    if (t.amount > 0) { incomeTotal += t.amount; continue; }
    const spend = -t.amount;
    spentTotal += spend;
    if (t.categoryId && data.categories.some((c) => c.id === t.categoryId)) spentBy.set(t.categoryId, (spentBy.get(t.categoryId) ?? 0) + spend);
    else uncategorised += spend;
  }
  const lines = data.categories.map((category) => {
    const actual = round2(spentBy.get(category.id) ?? 0);
    return { category, actual, remaining: round2(category.budget - actual), pct: category.budget > 0 ? actual / category.budget : actual > 0 ? 1 : 0 };
  });
  const budgetTotal = round2(data.categories.reduce((s, c) => s + c.budget, 0));
  const remaining = round2(budgetTotal - spentTotal);
  const dim = daysInMonth(month);
  let daysLeft: number;
  if (today.startsWith(month)) daysLeft = dim - Number(today.slice(8, 10)) + 1;
  else daysLeft = today < month ? dim : 0;
  const safePerDay = daysLeft > 0 ? round2(Math.max(0, remaining) / daysLeft) : 0;
  return { lines, budgetTotal, spentTotal: round2(spentTotal), incomeTotal: round2(incomeTotal), uncategorised: round2(uncategorised), remaining, daysLeft, safePerDay };
}

export function topCategories(summary: BudgetSummary, n = 5): BudgetLine[] {
  return summary.lines.filter((l) => l.actual > 0).sort((a, b) => b.actual - a.actual).slice(0, n);
}

// ── Net worth ──
export function netWorth(accounts: Account[]): { assets: number; liabilities: number; net: number } {
  let assets = 0, liabilities = 0;
  for (const a of accounts) {
    const liab = ACCOUNT_TYPES.find((t) => t.id === a.type)?.liability ?? false;
    if (liab) liabilities += Math.abs(a.balance); else assets += a.balance;
  }
  return { assets: round2(assets), liabilities: round2(liabilities), net: round2(assets - liabilities) };
}

export function upsertSnapshot(snapshots: Snapshot[], snap: Snapshot): Snapshot[] {
  return [...snapshots.filter((s) => s.month !== snap.month), snap].sort((a, b) => a.month.localeCompare(b.month));
}

// ── Investments ──
export interface HoldingLine { holding: Holding; cost: number; value: number; gain: number; gainPct: number; weight: number }
export function holdingsSummary(holdings: Holding[]): { lines: HoldingLine[]; cost: number; value: number; gain: number; gainPct: number } {
  const value = holdings.reduce((s, h) => s + h.units * h.price, 0);
  const cost = holdings.reduce((s, h) => s + h.units * h.avgCost, 0);
  const lines = holdings.map((holding) => {
    const c = holding.units * holding.avgCost, v = holding.units * holding.price;
    return { holding, cost: round2(c), value: round2(v), gain: round2(v - c), gainPct: c > 0 ? (v - c) / c : 0, weight: value > 0 ? v / value : 0 };
  });
  return { lines, cost: round2(cost), value: round2(value), gain: round2(value - cost), gainPct: cost > 0 ? (value - cost) / cost : 0 };
}

// ── Debts ──
export type Strategy = "snowball" | "avalanche";
export interface PayoffMonth { month: number; balances: number[]; interest: number; paid: number; total: number }
export interface PayoffPlan {
  strategy: Strategy;
  months: number;
  totalInterest: number;
  totalPaid: number;
  order: { id: string; name: string; paidOffMonth: number }[];
  rows: PayoffMonth[];
  totalSeries: number[];
  capped: boolean;
}

// Monthly compounding; minimums on every debt, then everything spare (extra +
// freed minimums) rolls onto the focus debt. Capped at 100 years so a debt
// whose minimum doesn't cover interest still terminates.
export function payoffPlan(debts: Debt[], extra: number, strategy: Strategy): PayoffPlan {
  const order = debts.map((_, i) => i).sort((a, b) =>
    strategy === "snowball" ? debts[a].balance - debts[b].balance || debts[b].apr - debts[a].apr : debts[b].apr - debts[a].apr || debts[a].balance - debts[b].balance);
  const balances = debts.map((d) => Math.max(0, d.balance));
  const paidOff = debts.map<number | null>((d) => (d.balance <= 0 ? 0 : null));
  const rows: PayoffMonth[] = [];
  const totalSeries: number[] = [round2(balances.reduce((s, b) => s + b, 0))];
  let totalInterest = 0, totalPaid = 0, month = 0;
  const MAX = 1200;
  while (balances.some((b) => b > 0.005) && month < MAX) {
    month++;
    let interest = 0, paid = 0;
    for (let i = 0; i < debts.length; i++) {
      if (balances[i] <= 0) continue;
      const int = round2(balances[i] * (debts[i].apr / 100 / 12));
      balances[i] = round2(balances[i] + int);
      interest += int;
    }
    let pool = extra;
    for (let i = 0; i < debts.length; i++) {
      if (balances[i] <= 0) { pool += debts[i].minimum; continue; }
      const pay = Math.min(balances[i], debts[i].minimum);
      balances[i] = round2(balances[i] - pay);
      paid += pay;
      pool += debts[i].minimum - pay;
    }
    for (const i of order) {
      if (pool <= 0) break;
      if (balances[i] <= 0) continue;
      const pay = Math.min(balances[i], pool);
      balances[i] = round2(balances[i] - pay);
      paid += pay;
      pool -= pay;
    }
    for (let i = 0; i < debts.length; i++) if (balances[i] <= 0.005 && paidOff[i] === null) { balances[i] = 0; paidOff[i] = month; }
    totalInterest += interest;
    totalPaid += paid;
    const total = round2(balances.reduce((s, b) => s + b, 0));
    rows.push({ month, balances: [...balances], interest: round2(interest), paid: round2(paid), total });
    totalSeries.push(total);
  }
  const capped = month >= MAX && balances.some((b) => b > 0.005);
  return {
    strategy, months: month, totalInterest: round2(totalInterest), totalPaid: round2(totalPaid),
    order: order.map((i) => ({ id: debts[i].id, name: debts[i].name, paidOffMonth: paidOff[i] ?? month })).sort((a, b) => a.paidOffMonth - b.paidOffMonth),
    rows, totalSeries, capped,
  };
}

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1 + months, d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

// ── Projections ──
export interface GrowthInput { start: number; monthly: number; annualReturnPct: number; years: number; feePct: number }
export interface GrowthResult { series: number[]; seriesNoFee: number[]; final: number; finalNoFee: number; contributed: number; growth: number }

// Monthly compounding of (return - fee); the no-fee series shows what the fee
// drag costs over the horizon.
export function compoundProjection(input: GrowthInput): GrowthResult {
  const months = Math.max(0, Math.round(input.years * 12));
  const run = (annual: number): number[] => {
    const r = annual / 100 / 12;
    const out = [input.start];
    let v = input.start;
    for (let i = 0; i < months; i++) { v = v * (1 + r) + input.monthly; out.push(round2(v)); }
    return out;
  };
  const series = run(input.annualReturnPct - input.feePct);
  const seriesNoFee = run(input.annualReturnPct);
  const contributed = round2(input.start + input.monthly * months);
  const final = series[series.length - 1];
  return { series, seriesNoFee, final, finalNoFee: seriesNoFee[seriesNoFee.length - 1], contributed, growth: round2(final - contributed) };
}

export function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm] = fromIso.split("-").map(Number);
  const [ty, tm] = toIso.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// Required monthly contribution to hit `target` from `current` in `months`,
// with contributions at the end of each month earning `annualReturnPct`.
export function savingsGoal(target: number, current: number, months: number, annualReturnPct = 0): number | null {
  if (months <= 0) return current >= target ? 0 : null;
  const r = annualReturnPct / 100 / 12;
  const fv = current * Math.pow(1 + r, months);
  const need = target - fv;
  if (need <= 0) return 0;
  const factor = r === 0 ? months : (Math.pow(1 + r, months) - 1) / r;
  return round2(need / factor);
}

// ── Export ──
export function transactionsCsv(transactions: Transaction[], categories: Category[], accounts: Account[]): string {
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const lines = [csvLine(["Date", "Amount", "Description", "Category", "Account"])];
  for (const t of [...transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push(csvLine([t.date, t.amount.toFixed(2), t.description, t.categoryId ? cat.get(t.categoryId) ?? "" : "", t.accountId ? acc.get(t.accountId) ?? "" : ""]));
  }
  return lines.join("\r\n");
}
