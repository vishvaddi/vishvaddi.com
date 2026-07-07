import { ROLL_NOTES, clip, clipLen, synthNotes } from "./state";
import type { VNote } from "./state";
import { saveAll } from "./persistence";
import { el, btn } from "./helpers";
import { ctx } from "./ctx";

export interface PianoRoll { pianoRoll: HTMLElement; synthCells: HTMLElement[][] }

export function buildPianoRoll(audition: (note: string, vel?: number, lenSteps?: number) => void): PianoRoll {
  const root = el("div", "wa-canvas-roll"), toolbar = el("div", "wa-roll-tools"), viewport = el("div", "wa-roll-viewport"), keys = el("div", "wa-roll-keys"), canvasStack = el("div", "wa-roll-canvases");
  const grid = document.createElement("canvas"), overlay = document.createElement("canvas"), velocity = document.createElement("canvas");
  grid.className = "wa-roll-grid"; overlay.className = "wa-roll-overlay"; velocity.className = "wa-roll-velocity"; grid.tabIndex = 0;
  canvasStack.append(grid, overlay, velocity); viewport.append(keys, canvasStack); root.append(toolbar, viewport);
  let stepWidth = 24, rowHeight = 18, playhead = -1, lastLength = 1, mode: "draw" | "select" | "erase" = "draw";
  const selected = new Set<VNote>();
  const modes = (["draw", "select", "erase"] as const).map((name) => { const button = btn(name.toUpperCase(), "wa-btn-sm"); button.addEventListener("click", () => { mode = name; modes.forEach((item) => item.classList.toggle("active", item === button)); }); toolbar.append(button); return button; }); modes[0].classList.add("active");
  const zoomOut = btn("−", "wa-btn-sm"), zoomIn = btn("+", "wa-btn-sm"), fit = btn("Fit", "wa-btn-sm"); toolbar.append(zoomOut, zoomIn, fit);
  ROLL_NOTES.forEach((note) => { const key = btn(note, "wa-roll-key"); key.addEventListener("pointerdown", () => audition(note)); keys.append(key); });
  const dimensions = (): { width: number; height: number } => ({ width: clipLen[clip.sel].synth * stepWidth, height: ROLL_NOTES.length * rowHeight });
  const resize = (): void => { const { width, height } = dimensions(); const dpr = window.devicePixelRatio || 1; [grid, overlay].forEach((canvas) => { canvas.width = width * dpr; canvas.height = height * dpr; canvas.style.width = `${width}px`; canvas.style.height = `${height}px`; }); velocity.width = width * dpr; velocity.height = 90 * dpr; velocity.style.width = `${width}px`; velocity.style.height = "90px"; draw(); };
  const context = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => { const value = canvas.getContext("2d")!; value.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0); return value; };
  const draw = (): void => {
    const { width, height } = dimensions(), g = context(grid); g.clearRect(0, 0, width, height); g.fillStyle = "#10141b"; g.fillRect(0, 0, width, height);
    for (let row = 0; row <= ROLL_NOTES.length; row++) { g.strokeStyle = row % 12 === 0 ? "#405063" : "#252f3b"; g.beginPath(); g.moveTo(0, row * rowHeight); g.lineTo(width, row * rowHeight); g.stroke(); }
    for (let step = 0; step <= clipLen[clip.sel].synth; step++) { g.strokeStyle = step % 16 === 0 ? "#40b98c" : step % 4 === 0 ? "#435264" : "#252f3b"; g.beginPath(); g.moveTo(step * stepWidth, 0); g.lineTo(step * stepWidth, height); g.stroke(); }
    synthNotes[clip.sel].forEach((note) => { const row = ROLL_NOTES.indexOf(note.note); if (row < 0 || note.step >= clipLen[clip.sel].synth) return; g.fillStyle = selected.has(note) ? "#ffc442" : "#2fe3a6"; g.fillRect(note.step * stepWidth + 1, row * rowHeight + 2, Math.max(3, note.len * stepWidth - 2), rowHeight - 4); });
    const v = context(velocity); v.clearRect(0, 0, width, 90); v.fillStyle = "#10141b"; v.fillRect(0, 0, width, 90); synthNotes[clip.sel].forEach((note) => { if (note.step >= clipLen[clip.sel].synth) return; v.fillStyle = selected.has(note) ? "#ffc442" : "#2fe3a6"; const h = note.vel / 127 * 82; v.fillRect(note.step * stepWidth + 2, 86 - h, Math.max(3, stepWidth - 4), h); });
    drawOverlay();
  };
  const drawOverlay = (): void => { const { width, height } = dimensions(), o = context(overlay); o.clearRect(0, 0, width, height); if (playhead >= 0) { o.strokeStyle = "#ff5d73"; o.lineWidth = 2; o.beginPath(); o.moveTo(playhead * stepWidth, 0); o.lineTo(playhead * stepWidth, height); o.stroke(); } };
  const point = (event: PointerEvent, canvas = grid) => { const rect = canvas.getBoundingClientRect(); return { step: Math.max(0, Math.min(clipLen[clip.sel].synth - 1, Math.floor((event.clientX - rect.left) / stepWidth))), row: Math.max(0, Math.min(ROLL_NOTES.length - 1, Math.floor((event.clientY - rect.top) / rowHeight))) }; };
  const hit = (step: number, row: number): VNote | undefined => synthNotes[clip.sel].find((note) => note.note === ROLL_NOTES[row] && step >= note.step && step < note.step + note.len);
  let drag: { note: VNote; startStep: number; startRow: number; originStep: number; originRow: number; resize: boolean } | null = null;
  grid.addEventListener("pointerdown", (event) => { event.preventDefault(); grid.focus(); ctx.checkpoint(); const p = point(event), note = hit(p.step, p.row); if (event.button === 2 || mode === "erase") { if (note) synthNotes[clip.sel] = synthNotes[clip.sel].filter((item) => item !== note); draw(); saveAll(); return; } if (note) { if (event.ctrlKey) selected.has(note) ? selected.delete(note) : selected.add(note); else { selected.clear(); selected.add(note); } drag = { note, startStep: p.step, startRow: p.row, originStep: note.step, originRow: ROLL_NOTES.indexOf(note.note), resize: p.step >= note.step + note.len - 1 }; } else if (mode === "draw") { const created = { note: ROLL_NOTES[p.row], step: p.step, len: Math.min(lastLength, clipLen[clip.sel].synth - p.step), vel: 100 }; synthNotes[clip.sel].push(created); selected.clear(); selected.add(created); drag = { note: created, startStep: p.step, startRow: p.row, originStep: p.step, originRow: p.row, resize: true }; audition(created.note); } draw(); grid.setPointerCapture(event.pointerId); });
  grid.addEventListener("pointermove", (event) => { if (!drag || !grid.hasPointerCapture(event.pointerId)) return; const p = point(event); if (drag.resize) { drag.note.len = Math.max(1, Math.min(clipLen[clip.sel].synth - drag.note.step, p.step - drag.note.step + 1)); lastLength = drag.note.len; } else { drag.note.step = Math.max(0, Math.min(clipLen[clip.sel].synth - drag.note.len, drag.originStep + p.step - drag.startStep)); const row = Math.max(0, Math.min(ROLL_NOTES.length - 1, drag.originRow + p.row - drag.startRow)); if (drag.note.note !== ROLL_NOTES[row]) { drag.note.note = ROLL_NOTES[row]; audition(drag.note.note); } } draw(); });
  grid.addEventListener("pointerup", () => { drag = null; saveAll(); }); grid.addEventListener("contextmenu", (event) => event.preventDefault());
  grid.addEventListener("keydown", (event) => { if (event.key === "Delete") { ctx.checkpoint(); synthNotes[clip.sel] = synthNotes[clip.sel].filter((note) => !selected.has(note)); selected.clear(); draw(); saveAll(); return; } const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0; if (delta) { event.preventDefault(); ctx.checkpoint(); selected.forEach((note) => { note.step = Math.max(0, Math.min(clipLen[clip.sel].synth - note.len, note.step + delta)); }); draw(); saveAll(); } });
  velocity.addEventListener("pointerdown", (event) => { const rect = velocity.getBoundingClientRect(), step = Math.floor((event.clientX - rect.left) / stepWidth), note = synthNotes[clip.sel].find((item) => item.step === step); if (!note) return; ctx.checkpoint(); note.vel = Math.max(1, Math.min(127, Math.round((1 - (event.clientY - rect.top) / rect.height) * 127))); draw(); saveAll(); });
  zoomOut.addEventListener("click", () => { stepWidth = Math.max(8, stepWidth / 2); resize(); }); zoomIn.addEventListener("click", () => { stepWidth = Math.min(64, stepWidth * 2); resize(); }); fit.addEventListener("click", () => { stepWidth = Math.max(8, (viewport.clientWidth - 54) / clipLen[clip.sel].synth); resize(); });
  ctx.paintRoll = resize; ctx.onStep = (step) => { playhead = step % clipLen[clip.sel].synth; drawOverlay(); };
  resize();
  return { pianoRoll: root, synthCells: [] };
}
