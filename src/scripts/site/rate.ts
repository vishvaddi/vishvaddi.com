import { auFmt } from "./calc";
import { tickText } from "./tick";

// Line-item rate build-up. Add as many lines as you like; pick each line's type
// from a dropdown. No proprietary rates ship here; saved rates live only in
// THIS browser (localStorage).
const KEY = "vv_rates";
const TYPES = ["Material", "Labour", "Plant", "Subcontract", "Other"];
interface Saved { d: string; rate: number }
interface ShareLine { type: string; desc: string; qty: number; cost: number }
interface ShareState { v: 1; name: string; margin: number; lines: ShareLine[] }

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(encoded: string): string {
  const bin = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function initRate() {
  const linesEl = document.getElementById("r-lines");
  const out = document.getElementById("r-out");
  const savedEl = document.getElementById("r-saved");
  const marginEl = document.getElementById("r-margin") as HTMLInputElement | null;
  const descEl = document.getElementById("r-desc") as HTMLInputElement | null;
  if (!linesEl || !out || !savedEl || !marginEl) return;

  const copyLinkBtn = document.getElementById("r-copy-link");
  const copiedEl = document.getElementById("r-copied");
  const confirmBar = document.getElementById("r-confirm");
  const confirmText = document.getElementById("r-confirm-text");
  const confirmYes = document.getElementById("r-confirm-yes");
  const confirmNo = document.getElementById("r-confirm-no");

  let pendingAction: (() => void) | null = null;
  function askConfirm(message: string, action: () => void): void {
    pendingAction = action;
    if (confirmText) confirmText.textContent = message;
    if (confirmBar) confirmBar.hidden = false;
  }
  confirmYes?.addEventListener("click", () => {
    if (confirmBar) confirmBar.hidden = true;
    const action = pendingAction;
    pendingAction = null;
    action?.();
  });
  confirmNo?.addEventListener("click", () => {
    if (confirmBar) confirmBar.hidden = true;
    pendingAction = null;
  });

  const num = (el: Element | null) => {
    const v = parseFloat((el as HTMLInputElement)?.value ?? "");
    return Number.isFinite(v) ? v : 0;
  };
  const toNum = (v: unknown): number => {
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : 0;
  };
  const field = (label: string, el: HTMLElement) => {
    const f = document.createElement("div");
    f.className = "field";
    const l = document.createElement("label");
    l.textContent = label;
    f.append(l, el);
    return f;
  };
  const mkInput = (type: string, cls: string, ph = "", attrs: Record<string, string> = {}) => {
    const i = document.createElement("input");
    i.type = type;
    i.className = cls;
    if (ph) i.placeholder = ph;
    if (type === "number") i.inputMode = "decimal";
    for (const k in attrs) i.setAttribute(k, attrs[k]);
    return i;
  };

  function addLine(type = "Material", desc = "", qty = "1", cost = "0") {
    const row = document.createElement("div");
    row.className = "row-grid";
    row.style.gridTemplateColumns = "auto 1.3fr 0.8fr 0.9fr auto";

    const sel = document.createElement("select");
    sel.className = "r-type";
    TYPES.forEach((t) => { const o = document.createElement("option"); o.value = t; o.textContent = t; sel.append(o); });
    sel.value = type;

    const d = mkInput("text", "r-d", "Detail"); d.value = desc;
    const q = mkInput("number", "r-qty", "", { min: "0", step: "0.25" }); q.value = qty;
    const c = mkInput("number", "r-cost", "", { min: "0", step: "0.01" }); c.value = cost;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-ghost btn-sm no-print";
    del.textContent = "✕";
    del.setAttribute("aria-label", "Remove line");
    del.addEventListener("click", () => { row.remove(); render(); });

    row.append(field("Type", sel), field("Description", d), field("Qty / hrs", q), field("Unit $", c), del);
    row.addEventListener("input", render);
    linesEl!.append(row);
  }

  function readLines() {
    return [...linesEl!.querySelectorAll(".row-grid")].map((r) => ({
      qty: num(r.querySelector(".r-qty")),
      cost: num(r.querySelector(".r-cost")),
    }));
  }
  function readLinesFull(): ShareLine[] {
    return [...linesEl!.querySelectorAll(".row-grid")].map((r) => ({
      type: (r.querySelector(".r-type") as HTMLSelectElement | null)?.value || "Material",
      desc: (r.querySelector(".r-d") as HTMLInputElement | null)?.value || "",
      qty: num(r.querySelector(".r-qty")),
      cost: num(r.querySelector(".r-cost")),
    }));
  }
  function buildState(): ShareState {
    return { v: 1, name: descEl?.value.trim() ?? "", margin: num(marginEl), lines: readLinesFull() };
  }
  function normalizeShared(raw: any): ShareState {
    const lines: ShareLine[] = Array.isArray(raw?.lines)
      ? raw.lines.map((l: any) => ({
          type: TYPES.includes(l?.type) ? l.type : "Material",
          desc: String(l?.desc ?? "").slice(0, 120),
          qty: toNum(l?.qty),
          cost: toNum(l?.cost),
        }))
      : [];
    return { v: 1, name: String(raw?.name ?? "").slice(0, 60), margin: toNum(raw?.margin ?? 15), lines };
  }
  function applyShared(state: ShareState): void {
    if (descEl) descEl.value = state.name;
    marginEl!.value = String(state.margin);
    linesEl!.textContent = "";
    if (state.lines.length) {
      state.lines.forEach((l) => addLine(l.type, l.desc, String(l.qty), String(l.cost)));
    } else {
      addLine("Material", "", "1", "40");
      addLine("Labour", "", "1.5", "65");
    }
    render();
  }
  function applyHash(): void {
    const hash = location.hash.slice(1);
    if (!hash) return;
    let raw: any;
    try { raw = JSON.parse(fromBase64Url(hash)); } catch { return; }
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.lines)) return;
    const incoming = normalizeShared(raw);
    const current = JSON.stringify(buildState());
    if (current !== JSON.stringify(incoming)) {
      askConfirm("Replace the current build-up with the one from this link?", () => applyShared(incoming));
    } else {
      applyShared(incoming);
    }
  }
  function calc() {
    const sub = readLines().reduce((s, l) => s + l.qty * l.cost, 0);
    const m = num(marginEl);
    return { sub, m, rate: sub * (1 + m / 100) };
  }
  const stat = (label: string) => {
    const d = document.createElement("div");
    d.className = "stat";
    const a = document.createElement("div"); a.className = "n";
    const b = document.createElement("div"); b.className = "l"; b.textContent = label;
    d.append(a, b);
    return { el: d, n: a };
  };
  // Tiles persist across renders (fixed set of three) so a changed value ticks
  // in place instead of the whole grid being torn down and rebuilt.
  let tiles: { sub: HTMLDivElement; margin: HTMLDivElement; rate: HTMLDivElement } | null = null;
  function render() {
    const { sub, m, rate } = calc();
    if (!tiles) {
      out!.textContent = "";
      const subTile = stat("subtotal");
      const marginTile = stat("margin");
      const rateTile = stat("unit rate");
      const grid = document.createElement("div");
      grid.className = "stat-grid";
      grid.append(subTile.el, marginTile.el, rateTile.el);
      out!.append(grid);
      tiles = { sub: subTile.n, margin: marginTile.n, rate: rateTile.n };
    }
    tickText(tiles.sub, "$" + auFmt(sub));
    tickText(tiles.margin, auFmt(m) + "%");
    tickText(tiles.rate, "$" + auFmt(rate));
  }

  const load = (): Saved[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
  const save = (l: Saved[]) => localStorage.setItem(KEY, JSON.stringify(l.slice(0, 300)));
  function renderSaved() {
    const list = load();
    savedEl!.textContent = "";
    if (!list.length) { savedEl!.textContent = "No saved rates yet."; savedEl!.style.color = "var(--muted)"; return; }
    savedEl!.style.color = "";
    list.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "saved-row";
      const t = document.createElement("span"); t.textContent = `${s.d} — $${auFmt(s.rate)}`;
      const del = document.createElement("button");
      del.className = "btn btn-ghost btn-sm no-print"; del.textContent = "✕"; del.setAttribute("aria-label", "Delete");
      del.addEventListener("click", () => { const l = load(); l.splice(i, 1); save(l); renderSaved(); });
      row.append(t, del);
      savedEl!.append(row);
    });
  }

  document.getElementById("r-addline")?.addEventListener("click", () => { addLine(); render(); });
  document.getElementById("r-save")?.addEventListener("click", () => {
    const { rate } = calc();
    if (rate <= 0) return;
    const d = (descEl?.value || "Rate").trim().slice(0, 60);
    const l = load(); l.unshift({ d, rate }); save(l); renderSaved();
  });
  const exportBtn = document.getElementById("r-export");
  exportBtn?.addEventListener("click", () => {
    const body = ["My rates — vishvaddi.com/site/rate", "", ...load().map((s) => `${s.d}: $${auFmt(s.rate)}`)].join("\n");
    location.href = `mailto:?subject=${encodeURIComponent("My rates")}&body=${encodeURIComponent(body)}`;
  });
  document.getElementById("r-clear")?.addEventListener("click", () => {
    if (confirm("Delete all saved rates from this device?")) { save([]); renderSaved(); }
  });
  copyLinkBtn?.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}#${toBase64Url(JSON.stringify(buildState()))}`;
    try {
      await navigator.clipboard.writeText(url);
      if (copiedEl) { copiedEl.hidden = false; setTimeout(() => { copiedEl.hidden = true; }, 1800); }
    } catch { /* clipboard is optional */ }
  });
  marginEl.addEventListener("input", render);

  // sensible starting lines
  addLine("Material", "", "1", "40");
  addLine("Labour", "", "1.5", "65");
  render();
  renderSaved();
  applyHash();
}
