import { download } from "./calc";

// Canvas sketchpad. Pointer (mouse/touch/stylus) drawing, fully client-side.
export function initSketch() {
  const canvas = document.getElementById("pad") as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let color = "#1a1a1a";
  let size = 3;
  let erasing = false;
  let drawing = false;
  let lastX = 0, lastY = 0;

  function paintWhite() {
    const r = canvas!.getBoundingClientRect();
    ctx!.fillStyle = "#ffffff";
    ctx!.fillRect(0, 0, r.width, r.height);
  }
  function fit() {
    const r = canvas!.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas!.width = Math.max(1, Math.round(r.width * dpr));
    canvas!.height = Math.max(1, Math.round(r.height * dpr));
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.lineCap = "round";
    ctx!.lineJoin = "round";
    paintWhite();
  }
  const pos = (e: PointerEvent) => {
    const r = canvas!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener("pointerdown", (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    lastX = p.x; lastY = p.y;
    ctx.beginPath();
    ctx.fillStyle = erasing ? "#ffffff" : color;
    ctx.arc(p.x, p.y, (erasing ? size * 3 : size) / 2, 0, Math.PI * 2);
    ctx.fill();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.strokeStyle = erasing ? "#ffffff" : color;
    ctx.lineWidth = erasing ? size * 3 : size;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x; lastY = p.y;
  });
  const end = () => { drawing = false; };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  const setEraser = (on: boolean) => {
    erasing = on;
    document.getElementById("eraser")?.classList.toggle("active", on);
    if (on) document.querySelectorAll(".swatch").forEach((s) => s.classList.remove("active"));
  };
  document.querySelectorAll<HTMLButtonElement>(".swatch").forEach((b) => {
    b.addEventListener("click", () => {
      color = b.dataset.color || "#1a1a1a";
      setEraser(false);
      document.querySelectorAll(".swatch").forEach((s) => s.classList.remove("active"));
      b.classList.add("active");
    });
  });
  const brush = document.getElementById("brush") as HTMLInputElement | null;
  brush?.addEventListener("input", () => { size = parseInt(brush.value, 10) || 3; });
  document.getElementById("eraser")?.addEventListener("click", () => setEraser(!erasing));
  document.getElementById("clear")?.addEventListener("click", () => { if (confirm("Clear the sketch?")) fit(); });
  document.getElementById("png")?.addEventListener("click", () => {
    canvas.toBlob((blob) => {
      if (blob) download(`sketch-${new Date().toISOString().slice(0, 10)}.png`, URL.createObjectURL(blob));
    }, "image/png");
  });
  document.getElementById("pdf")?.addEventListener("click", () => {
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const L = await import("pdf-lib");
      const doc = await L.PDFDocument.create();
      const png = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
      const maxW = 1000;
      const scale = png.width > maxW ? maxW / png.width : 1;
      const w = png.width * scale, h = png.height * scale;
      const page = doc.addPage([w, h]);
      page.drawImage(png, { x: 0, y: 0, width: w, height: h });
      const out = await doc.save();
      download(`sketch-${new Date().toISOString().slice(0, 10)}.pdf`, URL.createObjectURL(new Blob([new Uint8Array(out).buffer], { type: "application/pdf" })));
    }, "image/png");
  });

  fit();
}
