// /money — personal finance workbench. One store document; every panel is a
// static form plus a re-rendered result block, so typing is never wiped by a
// store update. All user text goes through textContent (CSP clean, no innerHTML).
import { createStore, mountStoreControls, uid, todayIso } from "./store";
import { download } from "./calc";
import { drawLineChart, watchTheme } from "./money-chart";
import {
  ACCOUNT_TYPES, type MoneyData, type Transaction, type ColumnMapping, type DateFormat, type Strategy, type AccountType,
  initialData, isMoneyData, currentMonth, shiftMonth, fmtAud, fmtDateAu, fmtMonth, round2,
  parseCsv, guessMapping, rowsToImportRows, dedupe, headerSignature, detectDateFormat, categorise, applyRules,
  budgetSummary, topCategories, netWorth, upsertSnapshot, holdingsSummary, payoffPlan, addMonths,
  compoundProjection, savingsGoal, monthsBetween, transactionsCsv, slug,
} from "./money-model";

type Panel = "overview" | "budget" | "transactions" | "networth" | "investments" | "debts" | "projections";
const PANELS: [Panel, string][] = [
  ["overview", "Overview"], ["budget", "Budget"], ["transactions", "Transactions"], ["networth", "Net worth"],
  ["investments", "Investments"], ["debts", "Debts"], ["projections", "Projections"],
];

// ── tiny DOM helpers ──
const mk = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (label: string, cls: string, onClick: () => void, id?: string): HTMLButtonElement => {
  const b = mk("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  if (id) b.id = id;
  b.addEventListener("click", onClick);
  return b;
};
const input = (type: string, id?: string, attrs: Record<string, string> = {}): HTMLInputElement => {
  const i = document.createElement("input");
  i.type = type;
  if (id) i.id = id;
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  return i;
};
const select = (options: [string, string][], id?: string): HTMLSelectElement => {
  const s = document.createElement("select");
  if (id) s.id = id;
  setOptions(s, options);
  return s;
};
function setOptions(s: HTMLSelectElement, options: [string, string][], keep = true): void {
  const prev = s.value;
  s.textContent = "";
  for (const [v, l] of options) { const o = document.createElement("option"); o.value = v; o.textContent = l; s.append(o); }
  if (keep && options.some(([v]) => v === prev)) s.value = prev;
}
const field = (label: string, control: HTMLElement): HTMLElement => {
  const w = mk("div", "field");
  w.append(mk("label", undefined, label), control);
  return w;
};
const fields = (...items: HTMLElement[]): HTMLElement => { const w = mk("div", "calc-fields"); w.append(...items); return w; };
const stats = (items: [string, string, string?][]): HTMLElement => {
  const g = mk("div", "stat-grid");
  for (const [n, l, cls] of items) { const s = mk("div", "stat" + (cls ? " " + cls : "")); s.append(mk("div", "n", n), mk("div", "l", l)); g.append(s); }
  return g;
};
const num = (el: HTMLInputElement, fallback = 0): number => { const n = parseFloat(el.value); return Number.isFinite(n) ? n : fallback; };
const bar = (pct: number, over: boolean): HTMLElement => {
  const b = mk("div", "money-bar");
  const f = mk("div", "money-bar-fill" + (over ? " over" : ""));
  f.style.width = `${Math.min(100, Math.max(0, pct * 100))}%`;
  b.append(f);
  return b;
};
const chartCanvas = (id: string): HTMLCanvasElement => {
  const c = document.createElement("canvas");
  c.id = id;
  c.className = "money-chart";
  c.width = 900; c.height = 300;
  return c;
};
const signed = (n: number): string => (n > 0 ? "+" : "") + fmtAud(n);

export function initMoney(): void {
  const root = document.getElementById("money-app");
  if (!root) return;
  const store = createStore<MoneyData>({ key: "money", version: 1, initial: () => initialData(), validate: isMoneyData });
  const controlsHost = document.getElementById("money-store");
  const redraws = new Map<Panel, () => void>();

  const tabs = mk("nav", "money-tabs no-print");
  tabs.id = "money-tabs";
  tabs.setAttribute("role", "tablist");
  const content = mk("div", "money-content");
  const layout = mk("div", "money-layout");
  layout.append(tabs, content);
  root.append(layout);

  const panels = new Map<Panel, HTMLElement>();
  const tabButtons = new Map<Panel, HTMLButtonElement>();
  let active: Panel = (location.hash.slice(1) as Panel) || "overview";
  if (!PANELS.some(([p]) => p === active)) active = "overview";

  for (const [id, label] of PANELS) {
    const b = btn(label, "money-tab", () => show(id));
    b.dataset.tab = id;
    b.setAttribute("role", "tab");
    tabs.append(b);
    tabButtons.set(id, b);
    const panel = mk("section", "money-panel");
    panel.dataset.panel = id;
    panel.hidden = true;
    content.append(panel);
    panels.set(id, panel);
  }

  function show(id: Panel): void {
    active = id;
    for (const [pid, p] of panels) p.hidden = pid !== id;
    for (const [pid, b] of tabButtons) { b.classList.toggle("active", pid === id); b.setAttribute("aria-selected", String(pid === id)); }
    history.replaceState(null, "", `#${id}`);
    redraws.get(id)?.();
  }

  const catOptions = (blank = true): [string, string][] => [...(blank ? [["", "— uncategorised —"] as [string, string]] : []), ...store.get().categories.map((c) => [c.id, c.name] as [string, string])];
  const accOptions = (): [string, string][] => [["", "— no account —"], ...store.get().accounts.map((a) => [a.id, a.name] as [string, string])];
  const catName = (id: string | null): string => store.get().categories.find((c) => c.id === id)?.name ?? "Uncategorised";

  // ════════ Overview ════════
  {
    const panel = panels.get("overview")!;
    panel.append(mk("h2", undefined, "Overview"));
    const body = mk("div");
    panel.append(body);
    redraws.set("overview", () => {
      body.textContent = "";
      const d = store.get();
      const month = currentMonth();
      const s = budgetSummary(d, month, todayIso());
      body.append(mk("h3", undefined, fmtMonth(month)));
      body.append(stats([
        [fmtAud(s.spentTotal, true), "spent"], [fmtAud(s.budgetTotal, true), "budget"],
        [fmtAud(s.remaining, true), "remaining", s.remaining < 0 ? "over" : undefined], [fmtAud(s.safePerDay), `safe/day · ${s.daysLeft} days left`],
      ]));
      const nw = netWorth(d.accounts);
      const snaps = d.snapshots;
      const prev = snaps.length >= 2 ? snaps[snaps.length - 2] : null;
      const change = prev ? nw.net - prev.net : null;
      body.append(mk("h3", undefined, "Net worth"));
      body.append(stats([
        [fmtAud(nw.net, true), "net worth"],
        [change === null ? "—" : signed(round2(change)), prev ? `since ${fmtMonth(prev.month)}` : "no earlier snapshot"],
        [fmtAud(nw.assets, true), "assets"], [fmtAud(nw.liabilities, true), "liabilities"],
      ]));
      const debts = d.debts.filter((x) => x.balance > 0);
      if (debts.length) {
        const plan = payoffPlan(debts, d.settings.extra ?? 0, d.settings.strategy ?? "avalanche");
        body.append(mk("h3", undefined, "Debts"));
        body.append(stats([
          [fmtAud(debts.reduce((t, x) => t + x.balance, 0), true), "owing"],
          [plan.capped ? "never (raise repayments)" : fmtDateAu(addMonths(todayIso(), plan.months)), `debt-free (${plan.strategy}, +${fmtAud(d.settings.extra ?? 0, true)}/mo)`],
          [fmtAud(plan.totalInterest, true), "interest to pay"],
        ]));
      }
      const top = topCategories(s);
      body.append(mk("h3", undefined, "Top categories this month"));
      if (!top.length) body.append(mk("p", "calc-blurb", "No spending recorded this month yet — add transactions or import a bank CSV."));
      for (const line of top) {
        const row = mk("div", "money-row");
        const head = mk("div", "money-row-head");
        head.append(mk("span", "rec-title", line.category.name), mk("span", "money-mono", `${fmtAud(line.actual)} / ${fmtAud(line.category.budget, true)}`));
        row.append(head, bar(line.pct, line.actual > line.category.budget));
        body.append(row);
      }
    });
  }

  // ════════ Budget ════════
  {
    const panel = panels.get("budget")!;
    panel.append(mk("h2", undefined, "Budget"));
    const monthInput = input("month", "mb-month");
    monthInput.value = store.get().settings.month || currentMonth();
    const monthRow = mk("div", "money-month");
    monthRow.append(
      btn("‹", "btn btn-ghost btn-sm", () => { monthInput.value = shiftMonth(monthInput.value, -1); onMonth(); }),
      monthInput,
      btn("›", "btn btn-ghost btn-sm", () => { monthInput.value = shiftMonth(monthInput.value, 1); onMonth(); }),
      btn("This month", "btn btn-ghost btn-sm", () => { monthInput.value = currentMonth(); onMonth(); }),
    );
    const onMonth = () => { if (monthInput.value) store.update((d) => { d.settings.month = monthInput.value; }); };
    monthInput.addEventListener("change", onMonth);
    panel.append(monthRow);
    const totals = mk("div");
    const list = mk("div");
    const addForm = mk("div", "calc");
    addForm.append(mk("h3", undefined, "Add category"));
    const name = input("text", "mb-cat-name", { placeholder: "e.g. Pets" });
    const budget = input("number", "mb-cat-budget", { min: "0", step: "1", placeholder: "monthly $" });
    addForm.append(fields(field("Name", name), field("Monthly budget", budget)));
    const addRow = mk("div", "btn-row");
    addRow.append(btn("Add category", "btn", () => {
      const n = name.value.trim();
      if (!n) return;
      let id = slug(n) || uid();
      if (store.get().categories.some((c) => c.id === id)) id = `${id}-${uid().slice(0, 4)}`;
      store.update((d) => { d.categories.push({ id, name: n, budget: num(budget) }); });
      name.value = ""; budget.value = "";
    }, "mb-cat-add"));
    addForm.append(addRow);
    panel.append(totals, list, addForm);

    redraws.set("budget", () => {
      const d = store.get();
      const month = d.settings.month || currentMonth();
      if (monthInput.value !== month) monthInput.value = month;
      const s = budgetSummary(d, month, todayIso());
      totals.textContent = "";
      totals.append(stats([
        [fmtAud(s.budgetTotal, true), "budget"], [fmtAud(s.spentTotal), "spent"],
        [fmtAud(s.remaining), "remaining", s.remaining < 0 ? "over" : undefined],
        [String(s.daysLeft), "days left"], [fmtAud(s.safePerDay), "safe to spend / day"],
        [fmtAud(s.incomeTotal), "income"],
      ]));
      if (s.uncategorised > 0) totals.append(mk("p", "calc-blurb", `${fmtAud(s.uncategorised)} spent without a category — set one in Transactions.`));
      list.textContent = "";
      for (const line of s.lines) {
        const row = mk("div", "money-row mb-row");
        row.dataset.cat = line.category.id;
        const head = mk("div", "money-row-head");
        head.append(mk("span", "rec-title", line.category.name));
        const amt = mk("span", "money-mono");
        amt.append(mk("span", undefined, `${fmtAud(line.actual)} of `));
        const bIn = input("number", undefined, { min: "0", step: "1", "aria-label": `${line.category.name} budget` });
        bIn.className = "money-inline";
        bIn.value = String(line.category.budget);
        bIn.addEventListener("change", () => store.update((dd) => { const c = dd.categories.find((x) => x.id === line.category.id); if (c) c.budget = num(bIn); }));
        amt.append(bIn);
        head.append(amt);
        row.append(head, bar(line.pct, line.remaining < 0));
        const foot = mk("div", "money-row-foot");
        const rem = mk("span", "mb-remaining" + (line.remaining < 0 ? " over" : ""), line.remaining < 0 ? `${fmtAud(-line.remaining)} over` : `${fmtAud(line.remaining)} left`);
        foot.append(rem, btn("Delete", "btn btn-ghost btn-sm", () => {
          if (!confirm(`Delete category "${line.category.name}"? Its transactions become uncategorised.`)) return;
          store.update((dd) => {
            dd.categories = dd.categories.filter((c) => c.id !== line.category.id);
            dd.transactions = dd.transactions.map((t) => (t.categoryId === line.category.id ? { ...t, categoryId: null } : t));
            dd.rules = dd.rules.filter((r) => r.categoryId !== line.category.id);
          });
        }));
        row.append(foot);
        list.append(row);
      }
    });
  }

  // ════════ Transactions ════════
  {
    const panel = panels.get("transactions")!;
    panel.append(mk("h2", undefined, "Transactions"));

    // manual add
    const addForm = mk("div", "calc");
    addForm.append(mk("h3", undefined, "Add transaction"));
    const tDate = input("date", "mt-date"); tDate.value = todayIso();
    const tAmt = input("number", "mt-amount", { step: "0.01", placeholder: "-45.20 (spend is negative)" });
    const tDesc = input("text", "mt-desc", { placeholder: "Description" });
    const tCat = select(catOptions(), "mt-cat");
    const tAcc = select(accOptions(), "mt-acc");
    addForm.append(fields(field("Date", tDate), field("Amount (AUD)", tAmt), field("Description", tDesc), field("Category", tCat), field("Account", tAcc)));
    const addRow = mk("div", "btn-row");
    addRow.append(btn("Add", "btn", () => {
      const amount = parseFloat(tAmt.value);
      if (!tDate.value || !Number.isFinite(amount)) return;
      const desc = tDesc.value.trim();
      const cat = tCat.value || categorise(desc, store.get().rules);
      store.update((d) => { d.transactions.push({ id: uid(), date: tDate.value, amount: round2(amount), description: desc, categoryId: cat, accountId: tAcc.value || null }); });
      tAmt.value = ""; tDesc.value = ""; tCat.value = "";
    }, "mt-add"));
    addForm.append(addRow);
    panel.append(addForm);

    // CSV import
    const imp = mk("div", "calc");
    imp.append(mk("h3", undefined, "Import bank CSV"));
    imp.append(mk("p", "calc-blurb", "Export a statement as CSV from your bank, choose it here, confirm which columns are which, and import. Rows already stored (same date, amount and description) are skipped."));
    const file = input("file", "mt-csv", { accept: ".csv,text/csv" });
    imp.append(field("CSV file", file));
    const mapWrap = mk("div");
    mapWrap.hidden = true;
    imp.append(mapWrap);
    const impStatus = mk("p", "calc-blurb");
    impStatus.id = "mt-import-status";
    imp.append(impStatus);
    panel.append(imp);

    let csvRows: string[][] = [];
    let mapping: ColumnMapping | null = null;
    let fileName = "";

    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      if (!f) return;
      fileName = f.name;
      csvRows = parseCsv(await f.text());
      if (csvRows.length < 1) { impStatus.textContent = "That file looks empty."; return; }
      const sig = headerSignature(csvRows[0]);
      const preset = store.get().presets.find((p) => p.signature === sig);
      mapping = preset ? { ...preset.mapping } : guessMapping(csvRows);
      impStatus.textContent = preset ? `Recognised "${preset.name}" — mapping applied from last time. Check the preview and import.` : `${csvRows.length} rows read. Check the column mapping below.`;
      renderMapping();
      file.value = "";
    });

    function renderMapping(): void {
      mapWrap.textContent = "";
      mapWrap.hidden = false;
      if (!mapping) return;
      const m = mapping;
      const cols = Math.max(...csvRows.map((r) => r.length));
      const colOpts = (allowNone: boolean): [string, string][] => [
        ...(allowNone ? [["", "— none —"] as [string, string]] : []),
        ...Array.from({ length: cols }, (_, i) => [String(i), m.hasHeader ? `${i + 1}: ${(csvRows[0][i] ?? "").trim() || "(blank)"}` : `Column ${i + 1}`] as [string, string]),
      ];
      const header = input("checkbox"); header.checked = m.hasHeader;
      header.addEventListener("change", () => { m.hasHeader = header.checked; renderMapping(); });
      const headerLabel = mk("label", "money-check"); headerLabel.append(header, document.createTextNode(" First row is a header"));
      const dateSel = select(colOpts(false), "mt-map-date"); dateSel.value = String(m.date);
      const fmtSel = select([["DMY", "DD/MM/YYYY"], ["ISO", "YYYY-MM-DD"], ["DMMMY", "D MMM YYYY"], ["MDY", "MM/DD/YYYY"]], "mt-map-fmt"); fmtSel.value = m.dateFormat;
      dateSel.addEventListener("change", () => {
        m.date = Number(dateSel.value);
        const body = m.hasHeader ? csvRows.slice(1) : csvRows;
        m.dateFormat = detectDateFormat(body.slice(0, 20).map((r) => r[m.date] ?? "")) ?? m.dateFormat;
        fmtSel.value = m.dateFormat; renderPreview();
      });
      fmtSel.addEventListener("change", () => { m.dateFormat = fmtSel.value as DateFormat; renderPreview(); });
      const modeSel = select([["single", "One amount column"], ["split", "Separate debit / credit columns"]], "mt-map-mode");
      modeSel.value = m.amount !== null || (m.debit === null && m.credit === null) ? "single" : "split";
      const amtSel = select(colOpts(false), "mt-map-amount"); amtSel.value = String(m.amount ?? "");
      const debSel = select(colOpts(true), "mt-map-debit"); debSel.value = String(m.debit ?? "");
      const creSel = select(colOpts(true), "mt-map-credit"); creSel.value = String(m.credit ?? "");
      const negate = input("checkbox"); negate.checked = m.negateAmount;
      const negateLabel = mk("label", "money-check"); negateLabel.append(negate, document.createTextNode(" Flip sign (bank lists spending as positive)"));
      const descSel = select(colOpts(false), "mt-map-desc"); descSel.value = String(m.description);
      const accSel = select(accOptions(), "mt-map-account");
      const amtField = field("Amount column", amtSel), debField = field("Debit (money out)", debSel), creField = field("Credit (money in)", creSel);
      const syncMode = () => {
        const single = modeSel.value === "single";
        amtField.hidden = !single; negateLabel.hidden = !single; debField.hidden = single; creField.hidden = single;
        if (single) { m.amount = amtSel.value === "" ? null : Number(amtSel.value); m.debit = null; m.credit = null; }
        else { m.amount = null; m.debit = debSel.value === "" ? null : Number(debSel.value); m.credit = creSel.value === "" ? null : Number(creSel.value); }
        renderPreview();
      };
      for (const s of [modeSel, amtSel, debSel, creSel]) s.addEventListener("change", syncMode);
      negate.addEventListener("change", () => { m.negateAmount = negate.checked; renderPreview(); });
      descSel.addEventListener("change", () => { m.description = Number(descSel.value); renderPreview(); });
      mapWrap.append(headerLabel, fields(field("Date column", dateSel), field("Date format", fmtSel), field("Amount layout", modeSel), amtField, debField, creField, field("Description column", descSel), field("Account for these rows", accSel)), negateLabel);
      const preview = mk("div", "money-table-wrap");
      const previewNote = mk("p", "calc-blurb");
      mapWrap.append(mk("h4", undefined, "Preview (first 10)"), preview, previewNote);
      const goRow = mk("div", "btn-row");
      goRow.append(btn("Import", "btn", () => {
        const { ok } = rowsToImportRows(csvRows, m);
        const d = store.get();
        const { fresh, dupes } = dedupe(d.transactions, ok);
        const accountId = accSel.value || null;
        const txs: Transaction[] = fresh.map((r) => ({ id: uid(), date: r.date, amount: r.amount, description: r.description, categoryId: categorise(r.description, d.rules), accountId }));
        const sig = headerSignature(csvRows[0]);
        const presetName = prompt("Name this bank / CSV layout so next time is one click:", store.get().presets.find((p) => p.signature === sig)?.name ?? fileName.replace(/\.csv$/i, "")) ?? "";
        store.update((dd) => {
          dd.transactions.push(...txs);
          if (presetName.trim()) dd.presets = [...dd.presets.filter((p) => p.signature !== sig), { signature: sig, name: presetName.trim(), mapping: { ...m } }];
        });
        impStatus.textContent = `Imported ${txs.length} transactions (${dupes} already stored, ${txs.filter((t) => t.categoryId).length} auto-categorised).`;
        mapWrap.hidden = true; csvRows = []; mapping = null;
      }, "mt-import-go"), btn("Cancel", "btn btn-ghost", () => { mapWrap.hidden = true; csvRows = []; mapping = null; impStatus.textContent = ""; }));
      mapWrap.append(goRow);

      function renderPreview(): void {
        const { ok, skipped } = rowsToImportRows(csvRows, m);
        preview.textContent = "";
        const table = mk("table", "money-table");
        const thead = mk("thead"); const hr = mk("tr");
        for (const h of ["Date", "Amount", "Description", "Category (auto)"]) hr.append(mk("th", undefined, h));
        thead.append(hr); table.append(thead);
        const tb = mk("tbody");
        for (const r of ok.slice(0, 10)) {
          const tr = mk("tr");
          tr.className = "mt-preview-row";
          tr.append(mk("td", "money-mono", fmtDateAu(r.date)), mk("td", "money-mono " + (r.amount < 0 ? "neg" : "pos"), fmtAud(r.amount)), mk("td", undefined, r.description), mk("td", undefined, catName(categorise(r.description, store.get().rules))));
          tb.append(tr);
        }
        table.append(tb); preview.append(table);
        previewNote.textContent = `${ok.length} rows will be checked for duplicates and imported${skipped ? `; ${skipped} rows skipped (unreadable date or amount)` : ""}.`;
      }
      syncMode();
    }

    // rules
    const rules = mk("details", "calc money-details");
    const rulesSummary = mk("summary", undefined, "Auto-categorise rules");
    rules.append(rulesSummary);
    rules.append(mk("p", "calc-blurb", "Keywords separated by | — matched anywhere in the description, case-insensitive, first rule wins."));
    const rulesList = mk("div");
    const rPattern = input("text", "mt-rule-pattern", { placeholder: "woolworths|coles|aldi" });
    const rCat = select(catOptions(false), "mt-rule-cat");
    const rulesForm = fields(field("Keywords", rPattern), field("Category", rCat));
    const rulesRow = mk("div", "btn-row");
    rulesRow.append(
      btn("Add rule", "btn btn-sm", () => {
        if (!rPattern.value.trim() || !rCat.value) return;
        store.update((d) => { d.rules.push({ id: uid(), pattern: rPattern.value.trim(), categoryId: rCat.value }); });
        rPattern.value = "";
      }, "mt-rule-add"),
      btn("Apply to uncategorised", "btn btn-ghost btn-sm", () => {
        const r = applyRules(store.get().transactions, store.get().rules, true);
        store.update((d) => { d.transactions = r.transactions; });
        impStatus.textContent = `Categorised ${r.changed} transactions.`;
      }),
      btn("Re-run on all", "btn btn-ghost btn-sm", () => {
        if (!confirm("Re-apply rules to every transaction, overriding manual categories where a rule matches?")) return;
        const r = applyRules(store.get().transactions, store.get().rules, false);
        store.update((d) => { d.transactions = r.transactions; });
        impStatus.textContent = `Changed ${r.changed} transactions.`;
      }),
    );
    rules.append(rulesList, rulesForm, rulesRow);
    panel.append(rules);

    // list + filters
    const listSec = mk("div", "calc");
    listSec.append(mk("h3", undefined, "All transactions"));
    const fMonth = input("month", "mt-f-month"); fMonth.value = currentMonth();
    const fCat = select([["", "All categories"], ["_none", "Uncategorised"], ...catOptions(false)], "mt-f-cat");
    const fSearch = input("search", "mt-f-search", { placeholder: "Search description" });
    listSec.append(fields(field("Month (blank = all)", fMonth), field("Category", fCat), field("Search", fSearch)));
    const listStats = mk("div");
    const list = mk("div");
    listSec.append(listStats, list);
    const exportRow = mk("div", "btn-row");
    exportRow.append(btn("Export CSV", "btn btn-ghost btn-sm", () => {
      const d = store.get();
      const blob = new Blob(["﻿" + transactionsCsv(d.transactions, d.categories, d.accounts)], { type: "text/csv;charset=utf-8" });
      download("money-transactions.csv", URL.createObjectURL(blob));
    }, "mt-export-csv"), btn("Delete shown", "btn btn-ghost btn-sm", () => {
      const shown = filtered();
      if (!shown.length || !confirm(`Delete the ${shown.length} transactions currently shown?`)) return;
      const ids = new Set(shown.map((t) => t.id));
      store.update((d) => { d.transactions = d.transactions.filter((t) => !ids.has(t.id)); });
    }));
    listSec.append(exportRow);
    panel.append(listSec);
    for (const el of [fMonth, fCat, fSearch]) el.addEventListener("input", () => renderList());

    function filtered(): Transaction[] {
      const q = fSearch.value.trim().toLowerCase();
      return store.get().transactions
        .filter((t) => (!fMonth.value || t.date.startsWith(fMonth.value)) && (!fCat.value || (fCat.value === "_none" ? !t.categoryId : t.categoryId === fCat.value)) && (!q || t.description.toLowerCase().includes(q)))
        .sort((a, b) => b.date.localeCompare(a.date));
    }

    function renderList(): void {
      const rows = filtered();
      const out = rows.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
      const inn = rows.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      listStats.textContent = "";
      listStats.append(stats([[String(rows.length), "shown"], [fmtAud(out), "out"], [fmtAud(inn), "in"]]));
      list.textContent = "";
      if (!rows.length) { list.append(mk("p", "calc-blurb", "Nothing matches — add a transaction or import a CSV above.")); return; }
      const accName = new Map(store.get().accounts.map((a) => [a.id, a.name]));
      for (const t of rows.slice(0, 300)) {
        const card = mk("div", "rec-card mt-row");
        card.dataset.id = t.id;
        const head = mk("div", "rec-card-head");
        head.append(mk("span", "rec-title", t.description || "(no description)"), mk("span", "money-mono " + (t.amount < 0 ? "neg" : "pos"), fmtAud(t.amount)));
        card.append(head);
        const meta = mk("div", "money-row-foot");
        const cSel = select(catOptions());
        cSel.className = "money-inline-select";
        cSel.value = t.categoryId ?? "";
        cSel.addEventListener("change", () => store.update((d) => { const x = d.transactions.find((y) => y.id === t.id); if (x) x.categoryId = cSel.value || null; }));
        meta.append(mk("span", "rec-meta", `${fmtDateAu(t.date)}${t.accountId ? " · " + (accName.get(t.accountId) ?? "") : ""}`), cSel, btn("Delete", "btn btn-ghost btn-sm", () => store.update((d) => { d.transactions = d.transactions.filter((x) => x.id !== t.id); })));
        card.append(meta);
        list.append(card);
      }
      if (rows.length > 300) list.append(mk("p", "calc-blurb", `Showing the newest 300 of ${rows.length} — narrow the filter to see the rest.`));
    }

    redraws.set("transactions", () => {
      setOptions(tCat, catOptions()); setOptions(tAcc, accOptions()); setOptions(rCat, catOptions(false));
      setOptions(fCat, [["", "All categories"], ["_none", "Uncategorised"], ...catOptions(false)]);
      rulesList.textContent = "";
      for (const r of store.get().rules) {
        const row = mk("div", "money-rule");
        const p = input("text"); p.value = r.pattern; p.setAttribute("aria-label", "keywords");
        p.addEventListener("change", () => store.update((d) => { const x = d.rules.find((y) => y.id === r.id); if (x) x.pattern = p.value.trim(); }));
        const c = select(catOptions(false)); c.value = r.categoryId;
        c.addEventListener("change", () => store.update((d) => { const x = d.rules.find((y) => y.id === r.id); if (x) x.categoryId = c.value; }));
        row.append(p, c, btn("✕", "btn btn-ghost btn-sm", () => store.update((d) => { d.rules = d.rules.filter((x) => x.id !== r.id); })));
        rulesList.append(row);
      }
      renderList();
    });
  }

  // ════════ Net worth ════════
  {
    const panel = panels.get("networth")!;
    panel.append(mk("h2", undefined, "Net worth"));
    const totals = mk("div");
    const chart = chartCanvas("money-nw-chart");
    const snapRow = mk("div", "btn-row");
    const snapNote = mk("p", "calc-blurb");
    snapRow.append(btn("Snapshot this month", "btn", () => {
      const nw = netWorth(store.get().accounts);
      store.update((d) => { d.snapshots = upsertSnapshot(d.snapshots, { month: currentMonth(), ...nw, at: new Date().toISOString() }); });
      snapNote.textContent = `Saved ${fmtMonth(currentMonth())}: ${fmtAud(nw.net)}.`;
    }, "mn-snapshot"));
    const list = mk("div");
    const snapList = mk("details", "money-details");
    snapList.append(mk("summary", undefined, "Snapshots"));
    const snapBody = mk("div"); snapList.append(snapBody);
    const form = mk("div", "calc");
    form.append(mk("h3", undefined, "Add account"));
    const aName = input("text", "mn-name", { placeholder: "e.g. Everyday, Home loan" });
    const aType = select(ACCOUNT_TYPES.map((t) => [t.id, t.label]), "mn-type");
    const aBal = input("number", "mn-balance", { step: "0.01", placeholder: "current balance" });
    form.append(fields(field("Name", aName), field("Type", aType), field("Balance (AUD)", aBal)));
    const formRow = mk("div", "btn-row");
    formRow.append(btn("Add account", "btn", () => {
      if (!aName.value.trim()) return;
      store.update((d) => { d.accounts.push({ id: uid(), name: aName.value.trim(), type: aType.value as AccountType, balance: num(aBal) }); });
      aName.value = ""; aBal.value = "";
    }, "mn-add"));
    form.append(formRow);
    panel.append(totals, chart, snapRow, snapNote, snapList, mk("h3", undefined, "Accounts"), list, form);

    redraws.set("networth", () => {
      const d = store.get();
      const nw = netWorth(d.accounts);
      totals.textContent = "";
      totals.append(stats([[fmtAud(nw.net, true), "net worth"], [fmtAud(nw.assets, true), "assets"], [fmtAud(nw.liabilities, true), "liabilities"], [String(d.snapshots.length), "snapshots"]]));
      drawLineChart(chart, [
        { label: "Net", values: d.snapshots.map((s) => s.net) },
        { label: "Assets", values: d.snapshots.map((s) => s.assets), dashed: true },
        { label: "Liabilities", values: d.snapshots.map((s) => s.liabilities), dashed: true },
      ], { xLabels: d.snapshots.map((s) => s.month.slice(2).replace("-", "/")), yFormat: (v) => fmtAud(v, true), zeroLine: true, fill: true });
      snapBody.textContent = "";
      for (const s of [...d.snapshots].reverse()) {
        const row = mk("div", "money-row-foot");
        row.append(mk("span", "rec-meta", `${fmtMonth(s.month)} · net ${fmtAud(s.net)} · assets ${fmtAud(s.assets, true)} · liabilities ${fmtAud(s.liabilities, true)}`),
          btn("✕", "btn btn-ghost btn-sm", () => store.update((dd) => { dd.snapshots = dd.snapshots.filter((x) => x.month !== s.month); })));
        snapBody.append(row);
      }
      list.textContent = "";
      if (!d.accounts.length) list.append(mk("p", "calc-blurb", "No accounts yet — add your bank, super, loans and cards below."));
      for (const a of d.accounts) {
        const card = mk("div", "rec-card mn-row");
        const head = mk("div", "rec-card-head");
        head.append(mk("span", "rec-title", a.name), mk("span", "rec-chip", ACCOUNT_TYPES.find((t) => t.id === a.type)?.label ?? a.type));
        const foot = mk("div", "money-row-foot");
        const bal = input("number", undefined, { step: "0.01", "aria-label": `${a.name} balance` });
        bal.className = "money-inline"; bal.value = String(a.balance);
        bal.addEventListener("change", () => store.update((dd) => { const x = dd.accounts.find((y) => y.id === a.id); if (x) x.balance = num(bal); }));
        foot.append(bal, btn("Delete", "btn btn-ghost btn-sm", () => store.update((dd) => { dd.accounts = dd.accounts.filter((x) => x.id !== a.id); })));
        card.append(head, foot);
        list.append(card);
      }
    });
  }

  // ════════ Investments ════════
  {
    const panel = panels.get("investments")!;
    panel.append(mk("h2", undefined, "Investments"));
    panel.append(mk("p", "calc-blurb", "Prices are entered by hand — no live feeds. Note the date you looked them up."));
    const totals = mk("div");
    const tableWrap = mk("div", "money-table-wrap");
    const form = mk("div", "calc");
    let editing: string | null = null;
    form.append(mk("h3", undefined, "Add holding"));
    const hName = input("text", "mi-name", { placeholder: "VAS / Vanguard AU shares" });
    const hUnits = input("number", "mi-units", { step: "0.0001", min: "0" });
    const hCost = input("number", "mi-cost", { step: "0.01", min: "0", placeholder: "avg cost / unit" });
    const hPrice = input("number", "mi-price", { step: "0.01", min: "0", placeholder: "current price" });
    const hAt = input("date", "mi-at"); hAt.value = todayIso();
    const hCur = input("text", "mi-cur", { maxlength: "3" }); hCur.value = "AUD";
    form.append(fields(field("Ticker / name", hName), field("Units", hUnits), field("Avg cost per unit", hCost), field("Current price", hPrice), field("Price as at", hAt), field("Currency", hCur)));
    const formRow = mk("div", "btn-row");
    const saveBtn = btn("Add holding", "btn", () => {
      if (!hName.value.trim()) return;
      const h = { id: editing ?? uid(), name: hName.value.trim(), units: num(hUnits), avgCost: num(hCost), price: num(hPrice), priceAt: hAt.value || todayIso(), currency: (hCur.value.trim().toUpperCase() || "AUD") };
      store.update((d) => { d.holdings = editing ? d.holdings.map((x) => (x.id === editing ? h : x)) : [...d.holdings, h]; });
      editing = null; saveBtn.textContent = "Add holding"; hName.value = ""; hUnits.value = ""; hCost.value = ""; hPrice.value = "";
    }, "mi-add");
    formRow.append(saveBtn);
    form.append(formRow);
    panel.append(totals, tableWrap, form);
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

    redraws.set("investments", () => {
      const d = store.get();
      const s = holdingsSummary(d.holdings);
      totals.textContent = "";
      totals.append(stats([[fmtAud(s.value), "market value"], [fmtAud(s.cost), "cost base"], [signed(s.gain), `unrealised (${pct(s.gainPct)})`, s.gain < 0 ? "over" : undefined]]));
      tableWrap.textContent = "";
      if (!d.holdings.length) { tableWrap.append(mk("p", "calc-blurb", "No holdings yet.")); return; }
      const table = mk("table", "money-table");
      const thead = mk("thead"); const hr = mk("tr");
      for (const h of ["Holding", "Units", "Avg cost", "Price", "Value", "Gain", "Weight", ""]) hr.append(mk("th", undefined, h));
      thead.append(hr); table.append(thead);
      const tb = mk("tbody");
      for (const l of s.lines) {
        const tr = mk("tr"); tr.className = "mi-row";
        const nameCell = mk("td"); nameCell.append(mk("div", "rec-title", l.holding.name), mk("div", "rec-meta", `${l.holding.currency} · as at ${fmtDateAu(l.holding.priceAt)}`));
        tr.append(nameCell, mk("td", "money-mono", String(l.holding.units)), mk("td", "money-mono", fmtAud(l.holding.avgCost)), mk("td", "money-mono", fmtAud(l.holding.price)),
          mk("td", "money-mono", fmtAud(l.value)), mk("td", "money-mono " + (l.gain < 0 ? "neg" : "pos"), `${signed(l.gain)} (${pct(l.gainPct)})`), mk("td", "money-mono", pct(l.weight)));
        const act = mk("td");
        act.append(btn("Edit", "btn btn-ghost btn-sm", () => {
          editing = l.holding.id; saveBtn.textContent = "Save";
          hName.value = l.holding.name; hUnits.value = String(l.holding.units); hCost.value = String(l.holding.avgCost); hPrice.value = String(l.holding.price); hAt.value = l.holding.priceAt; hCur.value = l.holding.currency;
          form.scrollIntoView({ behavior: "smooth", block: "center" });
        }), btn("✕", "btn btn-ghost btn-sm", () => store.update((dd) => { dd.holdings = dd.holdings.filter((x) => x.id !== l.holding.id); })));
        tr.append(act); tb.append(tr);
      }
      table.append(tb); tableWrap.append(table);
    });
  }

  // ════════ Debts ════════
  {
    const panel = panels.get("debts")!;
    panel.append(mk("h2", undefined, "Debts"));
    const list = mk("div");
    const form = mk("div", "calc");
    form.append(mk("h3", undefined, "Add debt"));
    const dName = input("text", "md-name", { placeholder: "Credit card, car loan…" });
    const dBal = input("number", "md-balance", { step: "0.01", min: "0" });
    const dApr = input("number", "md-apr", { step: "0.01", min: "0", placeholder: "e.g. 19.99" });
    const dMin = input("number", "md-min", { step: "0.01", min: "0", placeholder: "per month" });
    form.append(fields(field("Name", dName), field("Balance (AUD)", dBal), field("APR %", dApr), field("Minimum repayment / month", dMin)));
    const formRow = mk("div", "btn-row");
    formRow.append(btn("Add debt", "btn", () => {
      if (!dName.value.trim()) return;
      store.update((d) => { d.debts.push({ id: uid(), name: dName.value.trim(), balance: num(dBal), apr: num(dApr), minimum: num(dMin) }); });
      dName.value = ""; dBal.value = ""; dApr.value = ""; dMin.value = "";
    }, "md-add"));
    form.append(formRow);

    const planner = mk("div", "calc");
    planner.append(mk("h3", undefined, "Payoff planner"));
    planner.append(mk("p", "calc-blurb", "Snowball clears the smallest balance first (quick wins); avalanche clears the highest rate first (least interest). Freed-up minimums roll onto the next debt."));
    const extra = input("number", "md-extra", { step: "10", min: "0" });
    extra.value = String(store.get().settings.extra ?? 0);
    const stratSel = select([["avalanche", "Avalanche (highest rate first)"], ["snowball", "Snowball (smallest balance first)"]], "md-strategy");
    stratSel.value = store.get().settings.strategy ?? "avalanche";
    planner.append(fields(field("Extra per month on top of minimums", extra), field("Preferred strategy (overview)", stratSel)));
    extra.addEventListener("change", () => store.update((d) => { d.settings.extra = Math.max(0, num(extra)); }));
    stratSel.addEventListener("change", () => store.update((d) => { d.settings.strategy = stratSel.value as Strategy; }));
    const compare = mk("div");
    const chart = chartCanvas("money-debt-chart");
    const tables = mk("div");
    planner.append(compare, chart, tables);
    panel.append(list, form, planner);

    redraws.set("debts", () => {
      const d = store.get();
      list.textContent = "";
      if (!d.debts.length) list.append(mk("p", "calc-blurb", "No debts recorded. Add one below to plan a payoff."));
      for (const x of d.debts) {
        const card = mk("div", "rec-card md-row");
        const head = mk("div", "rec-card-head");
        head.append(mk("span", "rec-title", x.name), mk("span", "money-mono", fmtAud(x.balance)));
        const foot = mk("div", "money-row-foot");
        foot.append(mk("span", "rec-meta", `${x.apr}% APR · min ${fmtAud(x.minimum)}/mo`), btn("Delete", "btn btn-ghost btn-sm", () => store.update((dd) => { dd.debts = dd.debts.filter((y) => y.id !== x.id); })));
        card.append(head, foot);
        list.append(card);
      }
      const debts = d.debts.filter((x) => x.balance > 0);
      compare.textContent = ""; tables.textContent = "";
      if (!debts.length) { drawLineChart(chart, [], {}); return; }
      const ex = d.settings.extra ?? 0;
      const snow = payoffPlan(debts, ex, "snowball");
      const aval = payoffPlan(debts, ex, "avalanche");
      const when = (p: typeof snow) => (p.capped ? "never" : fmtDateAu(addMonths(todayIso(), p.months)));
      const grid = mk("div", "money-compare");
      for (const p of [snow, aval]) {
        const col = mk("div", "money-compare-col");
        col.append(mk("h4", undefined, p.strategy === "snowball" ? "Snowball" : "Avalanche"));
        const monthsStat = stats([[p.capped ? "∞" : String(p.months), "months"], [when(p), "debt-free"], [fmtAud(p.totalInterest, true), "total interest"]]);
        monthsStat.querySelector(".n")!.id = p.strategy === "snowball" ? "md-snow-months" : "md-aval-months";
        col.append(monthsStat);
        const ol = mk("ol", "money-order");
        for (const o of p.order) ol.append(mk("li", undefined, `${o.name} — month ${o.paidOffMonth}`));
        col.append(ol);
        const det = mk("details", "money-details");
        det.append(mk("summary", undefined, "Month by month"));
        const wrap = mk("div", "money-table-wrap");
        const table = mk("table", "money-table");
        const thead = mk("thead"); const hr = mk("tr");
        for (const h of ["Mo", ...debts.map((x) => x.name), "Interest", "Paid", "Total"]) hr.append(mk("th", undefined, h));
        thead.append(hr); table.append(thead);
        const tb = mk("tbody");
        for (const r of p.rows) {
          const tr = mk("tr");
          tr.append(mk("td", "money-mono", String(r.month)));
          for (const b of r.balances) tr.append(mk("td", "money-mono", fmtAud(b, true)));
          tr.append(mk("td", "money-mono", fmtAud(r.interest)), mk("td", "money-mono", fmtAud(r.paid)), mk("td", "money-mono", fmtAud(r.total, true)));
          tb.append(tr);
        }
        table.append(tb); wrap.append(table); det.append(wrap); col.append(det);
        grid.append(col);
      }
      compare.append(grid);
      const diff = round2(snow.totalInterest - aval.totalInterest);
      compare.append(mk("p", "calc-blurb", diff > 0 ? `Avalanche saves ${fmtAud(diff)} in interest${snow.months !== aval.months ? ` and ${snow.months - aval.months} month(s)` : ""}. Snowball gives the first payoff sooner if motivation matters more.` : "Both strategies cost the same here."));
      if (snow.capped || aval.capped) compare.append(mk("p", "warn", "At least one debt never clears: its minimum repayment doesn't cover the interest. Raise the minimum or the extra amount."));
      const n = Math.max(snow.totalSeries.length, aval.totalSeries.length);
      const padTo = (s: number[]) => [...s, ...Array(n - s.length).fill(0)];
      const labels = Array.from({ length: n }, (_, i) => (i % 12 === 0 ? `${i / 12}y` : ""));
      drawLineChart(chart, [{ label: "Avalanche", values: padTo(aval.totalSeries) }, { label: "Snowball", values: padTo(snow.totalSeries), dashed: true }], { xLabels: labels, yFormat: (v) => fmtAud(v, true), zeroLine: true });
    });
  }

  // ════════ Projections ════════
  {
    const panel = panels.get("projections")!;
    panel.append(mk("h2", undefined, "Projections"));
    const growth = mk("div", "calc");
    growth.append(mk("h3", undefined, "Compound growth"));
    const gStart = input("number", "mp-start", { step: "100" }); gStart.value = "10000";
    const gMonthly = input("number", "mp-monthly", { step: "50" }); gMonthly.value = "500";
    const gReturn = input("number", "mp-return", { step: "0.1" }); gReturn.value = "7";
    const gYears = input("number", "mp-years", { step: "1", min: "1", max: "60" }); gYears.value = "20";
    const gFee = input("number", "mp-fee", { step: "0.05", min: "0" }); gFee.value = "0.5";
    growth.append(fields(field("Starting amount", gStart), field("Monthly contribution", gMonthly), field("Annual return %", gReturn), field("Years", gYears), field("Annual fees %", gFee)));
    const gOut = mk("div");
    const gChart = chartCanvas("money-growth-chart");
    growth.append(gOut, gChart);

    const goal = mk("div", "calc");
    goal.append(mk("h3", undefined, "Savings goal"));
    const sTarget = input("number", "mp-target", { step: "100" }); sTarget.value = "20000";
    const sCurrent = input("number", "mp-current", { step: "100" }); sCurrent.value = "0";
    const sDate = input("date", "mp-date"); sDate.value = addMonths(todayIso(), 24);
    const sReturn = input("number", "mp-goal-return", { step: "0.1" }); sReturn.value = "4";
    goal.append(fields(field("Target", sTarget), field("Already saved", sCurrent), field("By date", sDate), field("Interest % p.a.", sReturn)));
    const sOut = mk("div");
    goal.append(sOut);
    panel.append(growth, goal);

    const renderGrowth = () => {
      const r = compoundProjection({ start: num(gStart), monthly: num(gMonthly), annualReturnPct: num(gReturn), years: Math.max(0, num(gYears)), feePct: num(gFee) });
      gOut.textContent = "";
      gOut.append(stats([[fmtAud(r.final, true), `after ${num(gYears)} years (net of fees)`], [fmtAud(r.finalNoFee, true), "without fees"], [fmtAud(r.finalNoFee - r.final, true), "fee drag"], [fmtAud(r.contributed, true), "contributed"], [fmtAud(r.growth, true), "growth"]]));
      const yearly = (s: number[]) => s.filter((_, i) => i % 12 === 0);
      const labels = yearly(r.series).map((_, i) => `${i}y`);
      drawLineChart(gChart, [{ label: "Net of fees", values: yearly(r.series) }, { label: "No fees", values: yearly(r.seriesNoFee), dashed: true }], { xLabels: labels, yFormat: (v) => fmtAud(v, true), fill: true });
    };
    const renderGoal = () => {
      const months = sDate.value ? monthsBetween(todayIso(), sDate.value) : 0;
      const need = savingsGoal(num(sTarget), num(sCurrent), months, num(sReturn));
      sOut.textContent = "";
      sOut.append(stats([[need === null ? "—" : fmtAud(need), "required per month"], [String(Math.max(0, months)), "months"], [fmtAud(Math.max(0, num(sTarget) - num(sCurrent)), true), "gap today"]]));
      if (need === null) sOut.append(mk("p", "warn", "Pick a date in the future."));
    };
    for (const el of [gStart, gMonthly, gReturn, gYears, gFee]) el.addEventListener("input", renderGrowth);
    for (const el of [sTarget, sCurrent, sDate, sReturn]) el.addEventListener("input", renderGoal);
    redraws.set("projections", () => { renderGrowth(); renderGoal(); });
  }

  if (controlsHost) mountStoreControls(controlsHost, store, { filename: "money.json", onImport: () => redraws.get(active)?.() });
  store.subscribe(() => redraws.get(active)?.());
  watchTheme(() => redraws.get(active)?.(), Array.from(root.querySelectorAll<HTMLCanvasElement>("canvas.money-chart")));
  show(active);
}
