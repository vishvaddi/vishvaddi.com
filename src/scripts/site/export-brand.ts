// Client-facing exports (last addendum, docs/PRO_PLAN.md): free for everyone.
// Free copies carry a small "Made free at vishvaddi.com" footer; Pro copies
// carry the visitor's own brand from /pro, or nothing when none is saved.
// The brand lives only in this browser's localStorage.
import type { PDFDocument, PDFFont, PDFImage, PDFPage } from "pdf-lib";
import { onProChanged, proState, track } from "./pro";

export interface Brand {
  name: string;
  line: string;
  logo: string;
}
export type Stamp = { kind: "footer" } | { kind: "brand"; brand: Brand } | { kind: "none" };

export const BRAND_KEY = "vv_brand";
export const FREE_FOOTER = "Made free at vishvaddi.com";
const LOGO_RE = /^data:image\/(png|jpeg);base64,/;

export function cleanBrand(raw: Partial<Brand> | null | undefined): Brand | null {
  if (!raw || typeof raw !== "object") return null;
  const brand: Brand = {
    name: String(raw.name ?? "").trim().slice(0, 80),
    line: String(raw.line ?? "").trim().slice(0, 120),
    logo: typeof raw.logo === "string" && LOGO_RE.test(raw.logo) ? raw.logo : "",
  };
  return brand.name || brand.line || brand.logo ? brand : null;
}

export function loadBrand(): Brand | null {
  try {
    return cleanBrand(JSON.parse(localStorage.getItem(BRAND_KEY) ?? "null") as Partial<Brand> | null);
  } catch {
    return null;
  }
}

/** False when storage refused it (quota, private mode). */
export function saveBrand(brand: Brand | null): boolean {
  try {
    if (brand) localStorage.setItem(BRAND_KEY, JSON.stringify(brand));
    else localStorage.removeItem(BRAND_KEY);
    return true;
  } catch {
    return false;
  }
}

export function exportStamp(pro = proState().pro, brand = loadBrand()): Stamp {
  if (!pro) return { kind: "footer" };
  return brand ? { kind: "brand", brand } : { kind: "none" };
}

/** Screen/print markup for a stamp — shared by print injection and the /pro preview. */
export function stampMark(stamp: Stamp): HTMLElement | null {
  if (stamp.kind === "none") return null;
  const mark = document.createElement("div");
  mark.className = `vv-brand-mark vv-brand-mark--${stamp.kind}`;
  if (stamp.kind === "footer") {
    mark.textContent = FREE_FOOTER;
    return mark;
  }
  const { name, line, logo } = stamp.brand;
  if (logo) {
    const img = document.createElement("img");
    img.className = "vv-brand-logo";
    img.src = logo;
    img.alt = "";
    mark.append(img);
  }
  const text = document.createElement("div");
  text.className = "vv-brand-text";
  if (name) {
    const strong = document.createElement("strong");
    strong.textContent = name;
    text.append(strong);
  }
  if (line) {
    const span = document.createElement("span");
    span.textContent = line;
    text.append(span);
  }
  mark.append(text);
  return mark;
}

function stampPrint(stamp: Stamp): void {
  document.querySelectorAll(".vv-export-brand").forEach((el) => el.remove());
  const mark = stampMark(stamp);
  if (!mark) return;
  const holder = document.createElement("div");
  holder.className = `vv-export-brand vv-export-brand--${stamp.kind}`;
  holder.setAttribute("aria-hidden", "true");
  holder.append(mark);
  // The footer is position:fixed so print repeats it on every page; the brand
  // is a header block, so it has to sit at the top of the printed flow.
  if (stamp.kind === "brand") (document.querySelector("main") ?? document.body).prepend(holder);
  else document.body.append(holder);
  window.addEventListener("afterprint", () => holder.remove(), { once: true });
}

let hinted = false;

function showHint(feature: string, anchor: HTMLElement): void {
  if (hinted) return;
  hinted = true;
  const hint = document.createElement("p");
  hint.className = "vv-export-hint no-print";
  hint.dataset.feature = feature;
  hint.setAttribute("role", "note");
  const text = document.createElement("span");
  text.textContent = "Exported with the free footer — Pro puts your business name on it instead. ";
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
 * footer/brand before `run` (which calls window.print()); pdf-lib and canvas
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
// /Rotate) to page space, so the stamp sits on the edge a reader sees.
function visibleFrame(L: PdfLib, page: PDFPage) {
  const box = page.getCropBox();
  const angle = (((page.getRotation().angle || 0) % 360) + 360) % 360;
  const sideways = angle === 90 || angle === 270;
  const width = sideways ? box.height : box.width;
  const height = sideways ? box.width : box.height;
  const at = (u: number, v: number) => {
    const rotate = L.degrees(angle);
    if (angle === 90) return { x: box.x + box.width - v, y: box.y + u, rotate };
    if (angle === 180) return { x: box.x + box.width - u, y: box.y + box.height - v, rotate };
    if (angle === 270) return { x: box.x + v, y: box.y + box.height - u, rotate };
    return { x: box.x + u, y: box.y + v, rotate };
  };
  return { width, height, at };
}

function encodable(font: PDFFont, text: string): string {
  try {
    font.widthOfTextAtSize(text, 8);
    return text;
  } catch {
    // Standard PDF fonts are WinAnsi only; drop what they can't draw rather than fail the export.
    return text.replace(/[^\x20-\x7e\xa0-\xff]/g, "");
  }
}

/** Draws the footer (free) or brand header (Pro with a brand) on every page. */
export async function stampPdf(doc: PDFDocument, stamp: Stamp = exportStamp()): Promise<void> {
  if (stamp.kind === "none") return;
  const L = await import("pdf-lib");
  const regular = await doc.embedFont(L.StandardFonts.Helvetica);
  const margin = 30;

  if (stamp.kind === "footer") {
    const grey = L.rgb(0.4, 0.4, 0.4);
    for (const page of doc.getPages()) {
      const frame = visibleFrame(L, page);
      page.drawText(FREE_FOOTER, { ...frame.at(margin, 5), size: 7, font: regular, color: grey });
    }
    return;
  }

  const bold = await doc.embedFont(L.StandardFonts.HelveticaBold);
  const name = encodable(bold, stamp.brand.name);
  const line = encodable(regular, stamp.brand.line);
  let logo: PDFImage | null = null;
  if (stamp.brand.logo) {
    try {
      logo = stamp.brand.logo.startsWith("data:image/png") ? await doc.embedPng(stamp.brand.logo) : await doc.embedJpg(stamp.brand.logo);
    } catch {
      logo = null;
    }
  }
  const logoScale = logo ? Math.min(10 / logo.height, 60 / logo.width) : 0;
  const logoW = logo ? logo.width * logoScale : 0;
  const logoH = logo ? logo.height * logoScale : 0;
  for (const page of doc.getPages()) {
    const frame = visibleFrame(L, page);
    const top = frame.height;
    let u = margin;
    if (logo) {
      page.drawImage(logo, { ...frame.at(u, top - 2.5 - logoH), width: logoW, height: logoH });
      u += logoW + 5;
    }
    if (name) {
      page.drawText(name, { ...frame.at(u, top - 10), size: 8, font: bold, color: L.rgb(0.2, 0.2, 0.2) });
      u += bold.widthOfTextAtSize(name, 8) + 6;
    }
    if (line) page.drawText(line, { ...frame.at(u, top - 10), size: 7, font: regular, color: L.rgb(0.4, 0.4, 0.4) });
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const BAND = 28;

/** A copy of `source` with a 28 px footer/brand band below it; `source` itself when there's nothing to add. */
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
  const mid = source.height + BAND / 2;
  const grey = dark ? "#a0a0a0" : "#666666";
  let x = 12;

  if (stamp.kind === "footer") {
    ctx.fillStyle = grey;
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(FREE_FOOTER, x, mid);
    return out;
  }

  const { name, line, logo } = stamp.brand;
  const img = logo ? await loadImage(logo) : null;
  if (img) {
    const scale = Math.min(20 / img.naturalHeight, 120 / img.naturalWidth);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, x, mid - h / 2, w, h);
    x += w + 8;
  }
  if (name) {
    ctx.fillStyle = dark ? "#f0f0f0" : "#222222";
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillText(name, x, mid);
    x += ctx.measureText(name).width + 10;
  }
  if (line) {
    ctx.fillStyle = grey;
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(line, x, mid);
  }
  return out;
}

const LOGO_MAX_WIDTH = 400;
const LOGO_MAX_BYTES = 200_000;

/** PNG/JPEG data URL ≤ 400 px wide and ≤ 200 KB, or throws. */
export async function downscaleLogo(file: File): Promise<string> {
  // createImageBitmap rather than an <img> on a blob: URL — the CSP's img-src allows data: but not blob:.
  const bitmap = await createImageBitmap(file);
  try {
    let width = Math.min(LOGO_MAX_WIDTH, bitmap.width);
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
      const ctx = canvas.getContext("2d")!;
      if (file.type === "image/png") {
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const png = canvas.toDataURL("image/png");
        if (png.length <= LOGO_MAX_BYTES) return png;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      // JPEG has no alpha, so flatten onto white (logos print on white paper).
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const jpeg = canvas.toDataURL("image/jpeg", 0.85);
      if (jpeg.length <= LOGO_MAX_BYTES) return jpeg;
      width = Math.max(1, Math.round(width * 0.7));
    }
    throw new Error("Logo is too detailed to fit in 200 KB.");
  } finally {
    bitmap.close();
  }
}

/** Wires the /pro "Your brand" editor: fields, logo upload, save, live preview. */
export function mountBrandEditor(form: HTMLFormElement, preview: HTMLElement, freeNote: HTMLElement): void {
  const nameEl = form.querySelector<HTMLInputElement>("#brand-name")!;
  const lineEl = form.querySelector<HTMLInputElement>("#brand-line")!;
  const logoEl = form.querySelector<HTMLInputElement>("#brand-logo")!;
  const clearLogo = form.querySelector<HTMLButtonElement>("#brand-logo-clear")!;
  const status = form.querySelector<HTMLElement>("#brand-status")!;
  const saved = loadBrand();
  let logo = saved?.logo ?? "";
  nameEl.value = saved?.name ?? "";
  lineEl.value = saved?.line ?? "";

  const draft = () => cleanBrand({ name: nameEl.value, line: lineEl.value, logo });

  const sheet = (caption: string, stamp: Stamp) => {
    const figure = document.createElement("figure");
    figure.className = "brand-sheet";
    const page = document.createElement("div");
    page.className = "brand-sheet-page";
    const mark = stampMark(stamp);
    if (mark && stamp.kind === "brand") page.append(mark);
    const body = document.createElement("div");
    body.className = "brand-sheet-body";
    for (let i = 0; i < 4; i++) body.append(document.createElement("i"));
    page.append(body);
    if (mark && stamp.kind === "footer") page.append(mark);
    if (!mark) {
      const empty = document.createElement("p");
      empty.className = "brand-sheet-empty";
      empty.textContent = "No brand saved — exports are clean.";
      page.append(empty);
    }
    const figcaption = document.createElement("figcaption");
    figcaption.textContent = caption;
    figure.append(page, figcaption);
    return figure;
  };

  const render = () => {
    const pro = proState().pro;
    const brand = draft();
    freeNote.hidden = pro;
    clearLogo.hidden = !logo;
    preview.replaceChildren(
      ...(pro
        ? [sheet("Your exports", exportStamp(true, brand))]
        : [sheet("Your exports now", exportStamp(false)), sheet("With Pro", brand ? exportStamp(true, brand) : { kind: "none" })]),
    );
  };

  nameEl.addEventListener("input", render);
  lineEl.addEventListener("input", render);
  logoEl.addEventListener("change", async () => {
    const file = logoEl.files?.[0];
    if (!file) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      status.textContent = "Logo must be a PNG or JPEG.";
      return;
    }
    status.textContent = "Resizing logo…";
    try {
      logo = await downscaleLogo(file);
      status.textContent = "";
    } catch (error) {
      status.textContent = error instanceof Error && error.message.startsWith("Logo") ? error.message : "Couldn't read that image.";
    }
    logoEl.value = "";
    render();
  });
  clearLogo.addEventListener("click", () => {
    logo = "";
    render();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!saveBrand(draft())) {
      status.textContent = "Couldn't save — your browser's storage is full or blocked.";
      return;
    }
    status.textContent = draft() ? "Saved in this browser." : "Brand cleared.";
    track("brand_saved");
  });
  onProChanged(render);
  render();
}
