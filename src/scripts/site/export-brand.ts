// Client-facing exports (docs/PRO_PLAN.md): free for everyone. Free copies carry
// a small "Made free at vishvaddi.com" footer; Pro copies are clean. (A Pro
// "your brand on exports" option existed until 16/09/26 — see git history.)
import type { PDFDocument, PDFPage } from "pdf-lib";
import { proState, track } from "./pro";

export type Stamp = { kind: "footer" } | { kind: "none" };

export const FREE_FOOTER = "Made free at vishvaddi.com";

export function exportStamp(pro = proState().pro): Stamp {
  return pro ? { kind: "none" } : { kind: "footer" };
}

function stampPrint(stamp: Stamp): void {
  document.querySelectorAll(".vv-export-brand").forEach((el) => el.remove());
  if (stamp.kind === "none") return;
  const holder = document.createElement("div");
  // Fixed-position under print media, so it repeats on every printed page.
  holder.className = "vv-export-brand vv-export-brand--footer";
  holder.setAttribute("aria-hidden", "true");
  holder.textContent = FREE_FOOTER;
  document.body.append(holder);
  window.addEventListener("afterprint", () => holder.remove(), { once: true });
}

// Ctrl+P and the browser menu print without touching an export button; stamp those too.
window.addEventListener("beforeprint", () => {
  if (!document.querySelector(".vv-export-brand")) stampPrint(exportStamp());
});

let hinted = false;

function showHint(feature: string, anchor: HTMLElement): void {
  if (hinted) return;
  hinted = true;
  const hint = document.createElement("p");
  hint.className = "vv-export-hint no-print";
  hint.dataset.feature = feature;
  hint.setAttribute("role", "note");
  const text = document.createElement("span");
  text.textContent = "Exported with the free footer — Pro exports are clean. ";
  const link = document.createElement("a");
  link.href = "/pro";
  link.textContent = "See Pro";
  text.append(link);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "vv-export-hint-dismiss";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";
  close.addEventListener("click", () => hint.remove());
  hint.append(text, close);
  anchor.insertAdjacentElement("afterend", hint);
}

/**
 * Runs a client-facing export for everyone. `print` injects the print-only
 * footer before `run` (which calls window.print()); pdf-lib and canvas
 * exports stamp themselves inside `run` via stampPdf/stampCanvas.
 */
export function brandedExport(feature: string, run: () => void, options: { anchor?: HTMLElement; print?: boolean } = {}): void {
  const pro = proState().pro;
  track(pro ? "export_pro" : "export_free");
  if (options.print) stampPrint(exportStamp(pro));
  run();
  if (!pro && options.anchor) showHint(feature, options.anchor);
}

type PdfLib = typeof import("pdf-lib");

// Maps an offset from the page's *visible* bottom-left (after crop box and
// /Rotate) to page space, so the footer sits on the edge a reader sees.
function visibleFrame(L: PdfLib, page: PDFPage) {
  const box = page.getCropBox();
  const angle = (((page.getRotation().angle || 0) % 360) + 360) % 360;
  const at = (u: number, v: number) => {
    const rotate = L.degrees(angle);
    if (angle === 90) return { x: box.x + box.width - v, y: box.y + u, rotate };
    if (angle === 180) return { x: box.x + box.width - u, y: box.y + box.height - v, rotate };
    if (angle === 270) return { x: box.x + v, y: box.y + box.height - u, rotate };
    return { x: box.x + u, y: box.y + v, rotate };
  };
  return { at };
}

/** Draws the free footer on every page; Pro exports are left untouched. */
export async function stampPdf(doc: PDFDocument, stamp: Stamp = exportStamp()): Promise<void> {
  if (stamp.kind === "none") return;
  const L = await import("pdf-lib");
  const regular = await doc.embedFont(L.StandardFonts.Helvetica);
  const grey = L.rgb(0.4, 0.4, 0.4);
  for (const page of doc.getPages()) {
    page.drawText(FREE_FOOTER, { ...visibleFrame(L, page).at(30, 5), size: 7, font: regular, color: grey });
  }
}

const BAND = 28;

/** A copy of `source` with a 28 px footer band below it; `source` itself for Pro. */
export async function stampCanvas(source: HTMLCanvasElement, stamp: Stamp = exportStamp()): Promise<HTMLCanvasElement> {
  if (stamp.kind === "none") return source;
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height + BAND;
  const ctx = out.getContext("2d")!;
  // Match the band to the image's own background so a dark export stays dark.
  const [r, g, b] = source.getContext("2d")?.getImageData(0, source.height - 1, 1, 1).data ?? [255, 255, 255];
  const dark = 0.299 * r + 0.587 * g + 0.114 * b < 128;
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, 0, 0);
  ctx.textBaseline = "middle";
  ctx.fillStyle = dark ? "#a0a0a0" : "#666666";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(FREE_FOOTER, 12, source.height + BAND / 2);
  return out;
}
