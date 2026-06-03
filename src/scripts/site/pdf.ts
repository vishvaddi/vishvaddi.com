import { download } from "./calc";

// Client-side PDF editor (pdf-lib). Loaded files are read into memory and never
// uploaded. pdf-lib is imported lazily on first use to keep the page light.
interface Src { name: string }
interface PageRef { src: number; page: number; rot: number }

export function initPdf() {
  const fileIn = document.getElementById("pdf-file") as HTMLInputElement | null;
  const listEl = document.getElementById("pdf-pages");
  const exportBtn = document.getElementById("pdf-export") as HTMLButtonElement | null;
  const footerIn = document.getElementById("pdf-footer") as HTMLInputElement | null;
  const stampIn = document.getElementById("pdf-stamp") as HTMLInputElement | null;
  const numChk = document.getElementById("pdf-num") as HTMLInputElement | null;
  const statusEl = document.getElementById("pdf-status");
  if (!fileIn || !listEl || !exportBtn) return;

  const srcs: Src[] = [];
  const loaded: Record<number, any> = {}; // PDFDocument per source
  let pages: PageRef[] = [];
  let PL: any = null;
  const lib = async () => (PL ||= await import("pdf-lib"));
  const setStatus = (t: string) => { if (statusEl) statusEl.textContent = t; };

  function render() {
    listEl!.textContent = "";
    pages.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "pdf-row";
      const label = document.createElement("span");
      label.className = "pdf-label";
      label.textContent = `${i + 1}. ${srcs[p.src].name} — p${p.page + 1}${p.rot ? ` · ${p.rot}°` : ""}`;
      const ctrls = document.createElement("span");
      ctrls.className = "pdf-ctrls no-print";
      const mk = (txt: string, aria: string, fn: () => void) => {
        const b = document.createElement("button");
        b.className = "btn btn-ghost btn-sm";
        b.textContent = txt;
        b.setAttribute("aria-label", aria);
        b.addEventListener("click", fn);
        return b;
      };
      ctrls.append(
        mk("↑", "Move up", () => { if (i > 0) { [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; render(); } }),
        mk("↓", "Move down", () => { if (i < pages.length - 1) { [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; render(); } }),
        mk("⟳", "Rotate 90°", () => { p.rot = (p.rot + 90) % 360; render(); }),
        mk("✕", "Delete page", () => { pages.splice(i, 1); render(); }),
      );
      row.append(label, ctrls);
      listEl!.append(row);
    });
    exportBtn!.disabled = pages.length === 0;
  }

  fileIn.addEventListener("change", async () => {
    const files = Array.from(fileIn.files || []);
    if (!files.length) return;
    setStatus("Reading…");
    const L = await lib();
    for (const f of files) {
      const bytes = await f.arrayBuffer();
      const idx = srcs.length;
      try {
        loaded[idx] = await L.PDFDocument.load(bytes, { ignoreEncryption: true });
        srcs.push({ name: f.name });
        const n = loaded[idx].getPageCount();
        for (let p = 0; p < n; p++) pages.push({ src: idx, page: p, rot: 0 });
      } catch {
        setStatus(`Couldn't read ${f.name} (encrypted or not a PDF).`);
      }
    }
    fileIn.value = "";
    setStatus(`${pages.length} page(s) loaded.`);
    render();
  });

  exportBtn.addEventListener("click", async () => {
    if (!pages.length) return;
    setStatus("Building PDF…");
    exportBtn.disabled = true;
    try {
      const L = await lib();
      const out = await L.PDFDocument.create();
      const font = await out.embedFont(L.StandardFonts.Helvetica);
      for (const ref of pages) {
        const [copied] = await out.copyPages(loaded[ref.src], [ref.page]);
        if (ref.rot) copied.setRotation(L.degrees(((copied.getRotation().angle || 0) + ref.rot) % 360));
        out.addPage(copied);
      }
      const footer = footerIn?.value.trim() || "";
      const stamp = stampIn?.value.trim() || "";
      const num = !!numChk?.checked;
      const total = out.getPageCount();
      out.getPages().forEach((pg: any, i: number) => {
        const { width, height } = pg.getSize();
        if (footer) pg.drawText(footer, { x: 36, y: 22, size: 9, font, color: L.rgb(0.3, 0.3, 0.3) });
        if (num) {
          const t = `${i + 1} / ${total}`;
          pg.drawText(t, { x: width - 36 - font.widthOfTextAtSize(t, 9), y: 22, size: 9, font, color: L.rgb(0.3, 0.3, 0.3) });
        }
        if (stamp) {
          pg.drawText(stamp, {
            x: width / 2 - font.widthOfTextAtSize(stamp, 48) / 2,
            y: height / 2,
            size: 48, font, color: L.rgb(0.85, 0.1, 0.1), opacity: 0.16, rotate: L.degrees(30),
          });
        }
      });
      const data = await out.save();
      download(`edited-${new Date().toISOString().slice(0, 10)}.pdf`, URL.createObjectURL(new Blob([data], { type: "application/pdf" })));
      setStatus(`Exported ${total} page(s).`);
    } catch (e) {
      setStatus("Export failed: " + (e as Error).message);
    } finally {
      exportBtn.disabled = pages.length === 0;
    }
  });

  render();
}
