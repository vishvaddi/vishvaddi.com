// Calculation Notepad UI: a textarea with a decorative overlay rendering
// syntax colour and inline results, backed by calc-engine's evaluatePad().
// The overlay sits behind a text-transparent textarea (the classic
// highlighted-textarea trick) so the real caret/selection stay native while
// the coloured text shows through. Everything is built with textContent —
// never innerHTML — since line text is user input.
import { evaluatePad, type PadLine } from "./calc-engine";
import { brandedExport } from "./export-brand";

const STORE_KEY = "site-calc-notepad";
const SAVED_KEY = "site-calc-notepad-saved";

interface SavedPad { name: string; text: string; updated: number }

const STARTER = `# Feature wall
sheets = 12
sheet area = 2.88 m2
wall area = sheets * sheet area
waste = wall area * 10%
supply = wall area @ $48
labour = 6 hrs @ $85
total
quote = ans + gst`;

const TEMPLATE_LABOUR_DAY_RATE = `# Labour day rate
wage = $45
super = wage * 12%
overhead = wage * 18%
cost = wage + super + overhead
margin = cost * 15%
rate per hour = cost + margin
day rate = rate per hour * 8 hrs`;

const TEMPLATE_GST_CHECK = `# GST check
price = $1000
inc = price + gst
back = inc ex gst`;

const TEMPLATE_PROGRAMME_DATES = `# Programme dates
possession = 5/10/2026
mobilisation = possession + 5 wd
fitout complete = mobilisation + 20 wd
handover = fitout complete + 45 wd
handover - possession`;

interface PadTemplate { label: string; text: string }
const TEMPLATES: PadTemplate[] = [
  { label: "Feature wall", text: STARTER },
  { label: "Labour day rate", text: TEMPLATE_LABOUR_DAY_RATE },
  { label: "GST check", text: TEMPLATE_GST_CHECK },
  { label: "Programme dates", text: TEMPLATE_PROGRAMME_DATES },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function commentIndex(line: string): number {
  const hashIdx = line.indexOf("#");
  const slashIdx = line.indexOf("//");
  const idxs = [hashIdx, slashIdx].filter((n) => n >= 0);
  return idxs.length ? Math.min(...idxs) : -1;
}

// Best-effort variable-name scan for highlighting and Tab-complete — the
// authoritative parse (with error handling) lives in evaluatePad().
function collectVarNames(text: string): string[] {
  const names: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const cIdx = commentIndex(trimmed);
    const content = (cIdx === -1 ? trimmed : trimmed.slice(0, cIdx)).trim();
    if (!content) continue;
    const eq = content.indexOf("=");
    if (eq > 0) {
      const name = content.slice(0, eq).trim();
      if (/^[a-zA-Z][a-zA-Z0-9 _]*$/.test(name) && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

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

function loadSaved(): SavedPad[] {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]"); } catch { return []; }
}
function writeSaved(list: SavedPad[]): void {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* storage is optional */ }
}

export function initNotepad(): void {
  const g = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const input = g<HTMLTextAreaElement>("pad-input");
  const overlay = g<HTMLDivElement>("pad-overlay");
  if (!input || !overlay) return;

  const savedSelect = g<HTMLSelectElement>("pad-saved");
  const saveAsBtn = g<HTMLButtonElement>("pad-save-as");
  const loadBtn = g<HTMLButtonElement>("pad-load");
  const deleteBtn = g<HTMLButtonElement>("pad-delete");
  const copyResultsBtn = g<HTMLButtonElement>("pad-copy-results");
  const copyTableBtn = g<HTMLButtonElement>("pad-copy-table");
  const copyLinkBtn = g<HTMLButtonElement>("pad-copy-link");
  const clearBtn = g<HTMLButtonElement>("pad-clear");
  const printBtn = g<HTMLButtonElement>("pad-print");
  const btnRow = g<HTMLDivElement>("pad-actions");
  const templateSelect = g<HTMLSelectElement>("pad-template");
  const wrap = input.closest(".np-wrap") as HTMLElement | null;
  const confirmBar = g<HTMLDivElement>("pad-confirm");
  const confirmText = g<HTMLSpanElement>("pad-confirm-text");
  const confirmYes = g<HTMLButtonElement>("pad-confirm-yes");
  const confirmNo = g<HTMLButtonElement>("pad-confirm-no");

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

  // Results line up in a fixed-width right column — sized to the longest
  // result/error this render produces (monospace font, so 1ch is exact) and
  // shared via a CSS var so the textarea's own right padding keeps typing
  // clear of it (see the "Calculator notepad" block in site.css).
  const updateResultColumnWidth = (lines: PadLine[]): void => {
    let maxChars = 0;
    for (const pl of lines) {
      if (!pl) continue;
      if ((pl.kind === "result" || pl.kind === "total") && pl.display) maxChars = Math.max(maxChars, pl.display.length);
      else if (pl.kind === "error" && pl.error) maxChars = Math.max(maxChars, pl.error.length + 2);
    }
    (wrap ?? overlay).style.setProperty("--np-res-w", `max(9rem, calc(${maxChars + 1}ch + 0.9rem))`);
  };

  const renderOverlay = (text: string, lines: PadLine[]): void => {
    const names = collectVarNames(text).sort((a, b) => b.length - a.length);
    const namePart = names.length ? names.map(escapeRegex).join("|") : "(?!x)x";
    const tokenRe = new RegExp(
      `(\\b(?:${namePart})\\b)|((?<=[0-9])\\s?(?:sqm|cum|m²|m³|mm|cm|km|lm|kg|hrs|hr|min|m2|m3|ea|days|wd|t|m|L|l)\\b)`,
      "gi",
    );
    updateResultColumnWidth(lines);
    overlay.textContent = "";
    const rawLines = text.split(/\r?\n/);
    rawLines.forEach((raw, i) => {
      const row = document.createElement("div");
      row.className = "np-row";
      const padLine = lines[i];

      const num = document.createElement("span");
      num.className = "np-linenum";
      num.textContent = String(i + 1);
      row.append(num);

      const code = document.createElement("span");
      code.className = "np-code";

      const cIdx = commentIndex(raw);
      const codePart = cIdx === -1 ? raw : raw.slice(0, cIdx);
      const commentPart = cIdx === -1 ? "" : raw.slice(cIdx);

      let last = 0;
      tokenRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = tokenRe.exec(codePart))) {
        if (m.index > last) code.append(document.createTextNode(codePart.slice(last, m.index)));
        const span = document.createElement("span");
        span.className = m[1] ? "tok-var" : "tok-unit";
        span.textContent = m[0];
        code.append(span);
        last = m.index + m[0].length;
      }
      if (last < codePart.length) code.append(document.createTextNode(codePart.slice(last)));

      if (commentPart) {
        const c = document.createElement("span");
        c.className = "tok-comment";
        c.textContent = commentPart;
        code.append(c);
      }
      if (!code.childNodes.length) code.append(document.createTextNode(" "));
      row.append(code);

      if (padLine && (padLine.kind === "result" || padLine.kind === "total") && padLine.display) {
        const r = document.createElement("span");
        r.className = padLine.kind === "total" ? "pad-result pad-total" : "pad-result";
        r.textContent = padLine.display;
        row.append(r);
      } else if (padLine && padLine.kind === "error") {
        const r = document.createElement("span");
        r.className = "pad-result pad-error";
        r.textContent = "⚠ " + padLine.error;
        row.append(r);
      }

      overlay.append(row);
    });
    overlay.scrollTop = input.scrollTop;
    overlay.scrollLeft = input.scrollLeft;
  };

  const evaluate = (): void => {
    const text = input.value;
    const lines = evaluatePad(text);
    renderOverlay(text, lines);
    try { localStorage.setItem(STORE_KEY, text); } catch { /* storage is optional */ }
  };

  input.addEventListener("input", evaluate);
  input.addEventListener("scroll", () => {
    overlay.scrollTop = input.scrollTop;
    overlay.scrollLeft = input.scrollLeft;
  });

  // Alt+click a line to insert "line N" at the caret — the overlay's result
  // text is pointer-events:none so it can't be clicked directly. Geometry
  // (not the post-click caret) gives the clicked line, so this can run on
  // mousedown with preventDefault and leave the user's real caret untouched.
  input.addEventListener("mousedown", (e) => {
    if (!e.altKey) return;
    e.preventDefault();
    const style = getComputedStyle(input);
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const lineHeightPx = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6;
    const rect = input.getBoundingClientRect();
    const y = e.clientY - rect.top - paddingTop + input.scrollTop;
    const totalLines = input.value.split(/\r?\n/).length;
    const lineNo = Math.min(Math.max(0, Math.floor(y / lineHeightPx)), totalLines - 1) + 1;
    const pos = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, pos);
    const after = input.value.slice(pos);
    const insertion = `line ${lineNo}`;
    input.value = before + insertion + after;
    const newPos = pos + insertion.length;
    input.focus();
    input.setSelectionRange(newPos, newPos);
    evaluate();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const pos = input.selectionStart ?? input.value.length;
      const value = input.value;
      const before = value.slice(0, pos);
      const after = value.slice(pos);
      const wordMatch = /[a-zA-Z][a-zA-Z0-9 _]*$/.exec(before);
      const partial = wordMatch ? wordMatch[0] : "";
      const names = collectVarNames(value);
      const matches = partial
        ? names.filter((n) => n.toLowerCase().startsWith(partial.toLowerCase()) && n.toLowerCase() !== partial.toLowerCase())
        : [];
      if (partial && matches.length === 1) {
        const completion = matches[0].slice(partial.length);
        input.value = before + completion + after;
        const newPos = pos + completion.length;
        input.setSelectionRange(newPos, newPos);
      } else {
        input.value = before + "  " + after;
        input.setSelectionRange(pos + 2, pos + 2);
      }
      evaluate();
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const pos = input.selectionStart ?? input.value.length;
      const before = input.value.slice(0, pos);
      const after = input.value.slice(pos);
      const insertion = (before.length && !before.endsWith("\n") ? "\n" : "") + "total\n";
      input.value = before + insertion + after;
      const newPos = pos + insertion.length;
      input.setSelectionRange(newPos, newPos);
      evaluate();
    }
  });

  function refreshSavedSelect(): void {
    if (!savedSelect) return;
    const list = loadSaved();
    savedSelect.textContent = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = list.length ? "Saved pads…" : "No saved pads";
    savedSelect.append(placeholder);
    list.forEach((p, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = p.name;
      savedSelect.append(opt);
    });
  }

  const saveName = g<HTMLInputElement>("pad-save-name");
  saveName?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveAsBtn?.click(); } });
  saveAsBtn?.addEventListener("click", () => {
    const name = saveName?.value.trim();
    if (!name) { saveName?.focus(); return; }
    if (saveName) saveName.value = "";
    const list = loadSaved();
    const idx = list.findIndex((p) => p.name === name);
    const entry: SavedPad = { name, text: input.value, updated: Date.now() };
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    writeSaved(list);
    refreshSavedSelect();
    if (savedSelect) savedSelect.value = String(idx >= 0 ? idx : list.length - 1);
  });
  loadBtn?.addEventListener("click", () => {
    const list = loadSaved();
    const idx = savedSelect?.value ? parseInt(savedSelect.value, 10) : -1;
    if (idx < 0 || !list[idx]) return;
    const text = list[idx].text;
    askConfirm(`Replace the current pad with "${list[idx].name}"?`, () => {
      input.value = text;
      evaluate();
    });
  });
  deleteBtn?.addEventListener("click", () => {
    const list = loadSaved();
    const idx = savedSelect?.value ? parseInt(savedSelect.value, 10) : -1;
    if (idx < 0 || !list[idx]) return;
    askConfirm(`Delete the saved pad "${list[idx].name}"?`, () => {
      list.splice(idx, 1);
      writeSaved(list);
      refreshSavedSelect();
    });
  });

  copyResultsBtn?.addEventListener("click", async () => {
    const lines = evaluatePad(input.value);
    const rawLines = input.value.split(/\r?\n/);
    const text = rawLines
      .map((raw, i) => {
        const pl = lines[i];
        return pl && pl.display ? `${raw} = ${pl.display}` : raw;
      })
      .join("\n");
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard is optional */ }
  });

  copyTableBtn?.addEventListener("click", async () => {
    const lines = evaluatePad(input.value);
    const rawLines = input.value.split(/\r?\n/);
    const tsv = rawLines.map((raw, i) => `${raw}\t${lines[i]?.display ?? ""}`).join("\n");
    try { await navigator.clipboard.writeText(tsv); } catch { /* clipboard is optional */ }
  });

  copyLinkBtn?.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}#${toBase64Url(input.value)}`;
    try { await navigator.clipboard.writeText(url); } catch { /* clipboard is optional */ }
  });

  clearBtn?.addEventListener("click", () => {
    if (!input.value.trim()) return;
    askConfirm("Clear the notepad?", () => {
      input.value = "";
      evaluate();
      input.focus();
    });
  });

  const tallBtn = g<HTMLButtonElement>("pad-tall");
  tallBtn?.addEventListener("click", () => {
    const tall = wrap?.classList.toggle("tall") ?? false;
    tallBtn.setAttribute("aria-pressed", String(tall));
    tallBtn.textContent = tall ? "Shorter" : "Taller";
  });

  if (templateSelect) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Start from…";
    templateSelect.append(placeholder);
    TEMPLATES.forEach((tpl, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = tpl.label;
      templateSelect.append(opt);
    });
    templateSelect.addEventListener("change", () => {
      const idx = templateSelect.value ? parseInt(templateSelect.value, 10) : -1;
      templateSelect.value = "";
      const tpl = TEMPLATES[idx];
      if (!tpl) return;
      const apply = () => { input.value = tpl.text; evaluate(); };
      if (input.value.trim()) askConfirm(`Replace the current pad with the "${tpl.label}" template?`, apply);
      else apply();
    });
  }

  printBtn?.addEventListener("click", () => {
    brandedExport("notepad-print", () => window.print(), { anchor: btnRow ?? printBtn, print: true });
  });

  const applyHash = (): void => {
    const hash = location.hash.slice(1);
    if (!hash) return;
    let decoded: string;
    try { decoded = fromBase64Url(hash); } catch { return; }
    const current = input.value.trim();
    if (current && current !== decoded.trim()) {
      askConfirm("Replace your current pad with the one from this link?", () => {
        input.value = decoded;
        evaluate();
      });
    } else {
      input.value = decoded;
    }
  };

  let initial = "";
  try { initial = localStorage.getItem(STORE_KEY) || ""; } catch { /* storage is optional */ }
  input.value = initial || STARTER;
  applyHash();
  refreshSavedSelect();
  evaluate();
}
