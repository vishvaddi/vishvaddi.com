// Piano roll v2 — a Cubase-Key-Editor-style canvas editor (Studio v2 C3).
// One canvas for the note grid (key gutter drawn in), a velocity lane below,
// and a DOM playhead overlay so playback.ts keeps its existing contract.
// Unquantized by default: positions/lengths are float steps; snapping applies
// only when the transport Grid selector is set (transport.quantizeGrid > 0).
import { el, btn, help } from "./helpers";
import { SCREEN_BG, SCREEN_FG, screenRgba } from "./helpers";
import { ROLL_NOTES, clip, transport, activeSynth, activeSynthNotes, SYNTH_LANES, SYNTH_LANE_LABELS, synthLaneNotes, patternLengths, patternDivisions } from "./state";
import type { VNote, SynthLane } from "./state";
import { ctx, gridRepainters } from "./ctx";
import { showVelocityPopup } from "./velpopup";
import { buildPatternBar } from "./patternbar";
import { midiToNote, noteToMidi } from "./vsynth";

export interface RollDeps {
  audition: (note: string, vel?: number, lenSteps?: number) => void;
  saveAll: () => void;
}

export interface Roll {
  pianoRoll: HTMLElement;
  rollPlayheadBar: HTMLElement;
  paintRoll: () => void;
}

const GUTTER = 37;
const ROW_H = 16;
const VEL_H = 52;
const EDGE_PX = 6;
const MIN_LEN_FREE = 0.25;

type Drag =
  | { kind: "create"; note: VNote }
  | { kind: "move"; note: VNote; origStep: number; origRow: number; grabOffset: number }
  | { kind: "resize-l"; note: VNote; origStep: number; origLen: number }
  | { kind: "resize-r"; note: VNote; origLen: number }
  | { kind: "marquee"; startStep: number; startRow: number; step: number; row: number }
  | null;

export function buildRoll(deps: RollDeps): Roll {
  const pianoRoll = el("div", "wa-piano-roll wa-roll2");
  const toolbar = el("div", "wa-roll-toolbar");
  const laneGroup = el("div", "wa-roll-lanes");
  const laneButtons = new Map<SynthLane, HTMLButtonElement>();
  const buildLaneButtons = (): void => {
    laneButtons.clear(); laneGroup.replaceChildren();
    SYNTH_LANES.forEach((lane) => {
      const button = btn(SYNTH_LANE_LABELS[lane], "wa-btn-sm wa-roll-lane") as HTMLButtonElement;
      button.addEventListener("click", () => {
        activeSynth.lane = lane; selected = null; selection.clear();
        laneButtons.forEach((item, id) => item.classList.toggle("active", id === lane));
        window.dispatchEvent(new CustomEvent("vv-synth-lane-change", { detail: lane })); paintRoll();
      });
      laneButtons.set(lane, button); laneGroup.append(button);
    });
  };
  buildLaneButtons();
  window.addEventListener("vv-studio-tracks-change", () => { buildLaneButtons(); paintRoll(); });
  const patternBar = buildPatternBar({ compact: true, onChange: () => paintRoll() });
  // Roll range (CV-80 RANGE + octave keys): the canvas shows three octaves;
  // these shift which three, so notes outside C3–B5 are reachable.
  let rollOct = Math.max(-3, Math.min(3, Number(localStorage.getItem("vv_studio_rolloct") || 0)));
  let rollNotes = ROLL_NOTES.map((n) => midiToNote(noteToMidi(n) + rollOct * 12));
  const rangeLabel = el("span", "wa-roll-range", "");
  const octDown = btn("OCT −", "wa-btn-sm"), octUp = btn("OCT ＋", "wa-btn-sm");
  help(octDown, "Shift the visible three octaves down.");
  help(octUp, "Shift the visible three octaves up.");
  const setRollOct = (next: number): void => {
    rollOct = Math.max(-3, Math.min(3, next));
    rollNotes = ROLL_NOTES.map((n) => midiToNote(noteToMidi(n) + rollOct * 12));
    localStorage.setItem("vv_studio_rolloct", String(rollOct));
    paintRoll();
  };
  octDown.addEventListener("click", () => setRollOct(rollOct - 1));
  octUp.addEventListener("click", () => setRollOct(rollOct + 1));
  const accentBtn = btn("Note Accent", "wa-btn-sm wa-note-expression") as HTMLButtonElement;
  const slideBtn = btn("Note Slide", "wa-btn-sm wa-note-expression") as HTMLButtonElement;
  const selectBtn = btn("Select", "wa-btn-sm wa-toggle") as HTMLButtonElement;
  const selectAllBtn = btn("All", "wa-btn-sm") as HTMLButtonElement;
  const copyBtn = btn("Copy", "wa-btn-sm") as HTMLButtonElement;
  const pasteBtn = btn("Paste", "wa-btn-sm") as HTMLButtonElement;
  let selectMode = false;
  help(accentBtn, "Toggle an accented note. Accents play louder and brighter.");
  help(slideBtn, "Glide into this note from the previous note in the lane.");
  accentBtn.addEventListener("click", () => { if (selection.size) { const on = !Array.from(selection).every((note) => note.accent); selection.forEach((note) => { note.accent = on; }); deps.saveAll(); paintRoll(); } });
  slideBtn.addEventListener("click", () => { if (selection.size) { const on = !Array.from(selection).every((note) => note.slide); selection.forEach((note) => { note.slide = on; }); deps.saveAll(); paintRoll(); } });
  selectBtn.addEventListener("click", () => { selectMode = !selectMode; selectBtn.classList.toggle("active", selectMode); canvas.style.cursor = selectMode ? "crosshair" : "cell"; });
  toolbar.append(laneGroup, el("span", "wa-roll-spacer"), patternBar.root, octDown, rangeLabel, octUp, selectBtn, selectAllBtn, copyBtn, pasteBtn, accentBtn, slideBtn);
  const scrollWrap = el("div", "wa-roll2-scroll");
  const canvas = document.createElement("canvas");
  canvas.className = "wa-roll2-canvas";
  const rollPlayhead = el("div", "wa-roll-playhead");
  const rollPlayheadBar = el("div", "wa-roll-playhead-bar");
  rollPlayhead.append(rollPlayheadBar);
  scrollWrap.append(canvas, rollPlayhead);
  const velCanvas = document.createElement("canvas");
  velCanvas.className = "wa-roll2-vel";
  pianoRoll.append(toolbar, scrollWrap, velCanvas);

  let selected: VNote | null = null;
  const selection = new Set<VNote>();
  let noteClipboard: VNote[] = [];
  let drag: Drag = null;
  let lastLen = 1;

  const notes = (): VNote[] => activeSynthNotes();
  const steps = (): number => patternLengths[clip.sel];
  const grid = (): number => (transport.quantizeGrid ? steps() / transport.quantizeGrid : 0);
  const snap = (v: number): number => { const g = grid(); return g ? Math.round(v / g) * g : v; };
  const minLen = (): number => grid() || MIN_LEN_FREE;
  const rowOf = (n: VNote): number => rollNotes.indexOf(n.note);

  const geom = () => {
    const w = scrollWrap.clientWidth || 720;
    return { w, stepW: (w - GUTTER) / steps() };
  };

  function paintRoll(): void {
    const { w, stepW } = geom();
    const h = rollNotes.length * ROW_H;
    const scale = window.devicePixelRatio || 1;
    canvas.style.height = `${h}px`;
    rollPlayhead.style.height = `${h}px`;
    canvas.width = Math.floor(w * scale); canvas.height = Math.floor(h * scale);
    const g = canvas.getContext("2d"); if (!g) return;
    g.scale(scale, scale);
    g.fillStyle = SCREEN_BG; g.fillRect(0, 0, w, h);

    // row stripes: black-key rows darker, octave boundaries ruled
    rollNotes.forEach((note, r) => {
      const y = r * ROW_H;
      if (note.includes("#")) { g.fillStyle = "rgba(255,255,255,0.025)"; g.fillRect(GUTTER, y, w - GUTTER, ROW_H); }
      if (note.startsWith("C") && !note.startsWith("C#")) {
        g.strokeStyle = screenRgba(0.18); g.lineWidth = 1;
        g.beginPath(); g.moveTo(GUTTER, y + ROW_H + 0.5); g.lineTo(w, y + ROW_H + 0.5); g.stroke();
      }
    });
    // vertical lines: quarters bright, grid (or 16ths) faint
    for (let s = 0; s <= steps(); s++) {
      const x = GUTTER + s * stepW;
      const quarter = s % 4 === 0;
      g.strokeStyle = quarter ? screenRgba(0.22) : screenRgba(0.07);
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke();
    }
    // notes
    notes().forEach((n) => {
      const r = rowOf(n); if (r < 0) return;
      const x = GUTTER + n.step * stepW, y = r * ROW_H + 1.5;
      const nw = Math.max(3, n.len * stepW - 1), nh = ROW_H - 3;
      const sel = selection.has(n);
      g.shadowBlur = sel ? 8 : 0; g.shadowColor = SCREEN_FG;
      g.fillStyle = screenRgba(0.35 + 0.55 * (n.vel / 127));
      g.beginPath(); g.roundRect(x, y, nw, nh, 3); g.fill();
      if (n.accent || n.slide) {
        g.fillStyle = "rgba(255,255,255,.92)"; g.font = "8px monospace";
        g.fillText(`${n.accent ? "A" : ""}${n.slide ? "↗" : ""}`, x + 3, y + 9);
      }
      g.shadowBlur = 0;
      g.strokeStyle = sel ? "#ffffff" : "rgba(0,0,0,0.55)";
      g.lineWidth = sel ? 1.4 : 1;
      g.beginPath(); g.roundRect(x, y, nw, nh, 3); g.stroke();
    });
    if (drag?.kind === "marquee") {
      const left = GUTTER + Math.min(drag.startStep, drag.step) * stepW;
      const top = Math.min(drag.startRow, drag.row) * ROW_H;
      const width = Math.abs(drag.step - drag.startStep) * stepW;
      const height = (Math.abs(drag.row - drag.startRow) + 1) * ROW_H;
      g.fillStyle = "rgba(95,217,217,.12)"; g.fillRect(left, top, width, height);
      g.strokeStyle = "rgba(95,217,217,.9)"; g.strokeRect(left + .5, top + .5, width, height);
    }
    // key gutter on top
    g.fillStyle = "#0a0f13"; g.fillRect(0, 0, GUTTER, h);
    rollNotes.forEach((note, r) => {
      const y = r * ROW_H;
      const black = note.includes("#");
      g.fillStyle = black ? "#11161b" : "#e8ecef";
      g.fillRect(0, y + 1, GUTTER - 6, ROW_H - 2);
      if (note.startsWith("C") && !note.startsWith("C#")) {
        g.fillStyle = black ? "#9aa5ad" : "#41505b"; g.font = "9px monospace";
        g.fillText(note, 3, y + ROW_H - 5);
      }
    });
    paintVel();
    laneButtons.forEach((item, id) => item.classList.toggle("active", id === activeSynth.lane));
    patternBar.sync();
    accentBtn.classList.toggle("active", selection.size > 0 && Array.from(selection).every((note) => note.accent));
    slideBtn.classList.toggle("active", selection.size > 0 && Array.from(selection).every((note) => note.slide));
    accentBtn.disabled = selection.size === 0; slideBtn.disabled = selection.size === 0; copyBtn.disabled = selection.size === 0; pasteBtn.disabled = noteClipboard.length === 0;
    rangeLabel.textContent = `${rollNotes[rollNotes.length - 1]}–${rollNotes[0]}`;
  }

  function paintVel(): void {
    const { w, stepW } = geom();
    const scale = window.devicePixelRatio || 1;
    velCanvas.width = Math.floor(w * scale); velCanvas.height = Math.floor(VEL_H * scale);
    const g = velCanvas.getContext("2d"); if (!g) return;
    g.scale(scale, scale);
    g.fillStyle = SCREEN_BG; g.fillRect(0, 0, w, VEL_H);
    g.fillStyle = "#0a0f13"; g.fillRect(0, 0, GUTTER, VEL_H);
    g.fillStyle = "#41505b"; g.font = "8px monospace"; g.fillText("VEL", 6, VEL_H / 2 + 3);
    for (let s = 0; s <= steps(); s += 4) {
      const x = GUTTER + s * stepW;
      g.strokeStyle = screenRgba(0.12);
      g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, VEL_H); g.stroke();
    }
    notes().forEach((n) => {
      const x = GUTTER + n.step * stepW;
      const bh = Math.max(2, (n.vel / 127) * (VEL_H - 6));
      const sel = selection.has(n);
      g.fillStyle = sel ? "#ffffff" : screenRgba(0.4 + 0.5 * (n.vel / 127));
      g.fillRect(x, VEL_H - 3 - bh, 5, bh);
    });
  }

  // ── hit testing ──
  const pos = (ev: PointerEvent | MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const { stepW } = geom();
    return {
      step: (ev.clientX - rect.left - GUTTER) / stepW,
      row: Math.floor((ev.clientY - rect.top) / ROW_H),
      px: ev.clientX - rect.left,
    };
  };
  type Hit = { note: VNote; zone: "body" | "l" | "r" } | null;
  const hit = (ev: PointerEvent | MouseEvent): Hit => {
    const { step, row, px } = pos(ev);
    if (px < GUTTER) return null;
    const { stepW } = geom();
    const list = notes();
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (rowOf(n) !== row) continue;
      if (step < n.step || step > n.step + n.len) continue;
      const inPx = (step - n.step) * stepW, wPx = n.len * stepW;
      const edge = Math.min(EDGE_PX, wPx / 3);
      if (inPx < edge) return { note: n, zone: "l" };
      if (wPx - inPx < edge) return { note: n, zone: "r" };
      return { note: n, zone: "body" };
    }
    return null;
  };

  canvas.addEventListener("pointermove", (ev) => {
    if (drag) return;
    if (selectMode) { canvas.style.cursor = "crosshair"; return; }
    const found = hit(ev);
    canvas.style.cursor = !found ? "cell" : found.zone === "body" ? "move" : "ew-resize";
  });

  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const found = hit(ev);
    const { step, row } = pos(ev);
    if (found) {
      selected = found.note;
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
        if (selection.has(found.note)) selection.delete(found.note); else selection.add(found.note);
      } else if (!selection.has(found.note)) {
        selection.clear(); selection.add(found.note);
      }
      ctx.checkpoint();
      if (found.zone === "body") drag = { kind: "move", note: found.note, origStep: found.note.step, origRow: rowOf(found.note), grabOffset: step - found.note.step };
      else if (found.zone === "l") drag = { kind: "resize-l", note: found.note, origStep: found.note.step, origLen: found.note.len };
      else drag = { kind: "resize-r", note: found.note, origLen: found.note.len };
    } else {
      if (row < 0 || row >= rollNotes.length || step < 0 || step >= steps()) return;
      if (selectMode) {
        if (!ev.shiftKey) selection.clear();
        selected = null;
        drag = { kind: "marquee", startStep: step, startRow: row, step, row };
        canvas.setPointerCapture(ev.pointerId); paintRoll(); return;
      }
      ctx.checkpoint();
      const start = Math.max(0, Math.min(steps() - minLen(), snap(step)));
      const fresh: VNote = { note: rollNotes[row], step: start, len: Math.min(lastLen, steps() - start), vel: 100 };
      notes().push(fresh);
      selected = fresh; selection.clear(); selection.add(fresh);
      drag = { kind: "create", note: fresh };
      deps.audition(fresh.note, 100, 1);
    }
    canvas.setPointerCapture(ev.pointerId);
    paintRoll(); ctx.paintSession();
  });

  canvas.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const { step, row } = pos(ev);
    if (drag.kind === "marquee") {
      drag.step = Math.max(0, Math.min(steps(), step)); drag.row = Math.max(0, Math.min(rollNotes.length - 1, row));
      const minStep = Math.min(drag.startStep, drag.step), maxStep = Math.max(drag.startStep, drag.step);
      const minRow = Math.min(drag.startRow, drag.row), maxRow = Math.max(drag.startRow, drag.row);
      selection.clear();
      notes().forEach((note) => { const noteRow = rowOf(note); if (note.step + note.len >= minStep && note.step <= maxStep && noteRow >= minRow && noteRow <= maxRow) selection.add(note); });
      selected = selection.values().next().value ?? null; paintRoll(); return;
    }
    const n = drag.note;
    if (drag.kind === "create" || drag.kind === "resize-r") {
      n.len = Math.max(minLen(), Math.min(steps() - n.step, (grid() ? snap(step) : step) - n.step));
      if (drag.kind === "create") lastLen = n.len;
    } else if (drag.kind === "resize-l") {
      const origEnd = drag.origStep + drag.origLen;
      const ns = Math.max(0, Math.min(origEnd - minLen(), grid() ? snap(step) : step));
      n.step = ns; n.len = origEnd - ns;
    } else {
      const ns = Math.max(0, Math.min(steps() - n.len, (grid() ? snap(step - drag.grabOffset) : step - drag.grabOffset)));
      n.step = ns;
      const newRow = Math.max(0, Math.min(rollNotes.length - 1, row));
      if (rollNotes[newRow] !== n.note) { n.note = rollNotes[newRow]; deps.audition(n.note, n.vel, 1); }
    }
    paintRoll();
  });

  const endDrag = () => {
    if (!drag) return;
    if (drag.kind === "marquee") { drag = null; paintRoll(); return; }
    if (drag.kind === "create") lastLen = drag.note.len;
    drag = null;
    ctx.paintSession(); deps.saveAll(); paintRoll();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  canvas.addEventListener("dblclick", (ev) => {
    const found = hit(ev);
    if (!found) return;
    ctx.checkpoint();
    synthLaneNotes[activeSynth.lane][clip.sel] = notes().filter((n) => n !== found.note);
    selection.delete(found.note); if (selected === found.note) selected = null;
    paintRoll(); ctx.paintSession(); deps.saveAll();
  });

  canvas.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    const found = hit(ev);
    if (!found) return;
    selected = found.note; selection.clear(); selection.add(found.note);
    showVelocityPopup(found.note.vel, ev.clientX, ev.clientY, (v) => {
      found.note.vel = v; deps.saveAll(); paintRoll();
    });
  });

  const selectAll = (): void => { selection.clear(); notes().forEach((note) => selection.add(note)); selected = notes()[0] ?? null; paintRoll(); };
  const copySelection = (): void => {
    if (!selection.size) return;
    const first = Math.min(...Array.from(selection, (note) => note.step));
    noteClipboard = Array.from(selection, (note) => ({ ...note, step: note.step - first }));
    pasteBtn.disabled = false;
  };
  const pasteSelection = (): void => {
    if (!noteClipboard.length) return;
    const span = Math.max(...noteClipboard.map((note) => note.step + note.len));
    const after = selection.size ? Math.max(...Array.from(selection, (note) => note.step + note.len)) : 0;
    const start = Math.max(0, Math.min(steps() - span, snap(after)));
    ctx.checkpoint(); selection.clear();
    noteClipboard.forEach((source) => { const note = { ...source, step: start + source.step }; notes().push(note); selection.add(note); });
    selected = selection.values().next().value ?? null; deps.saveAll(); ctx.paintSession(); paintRoll();
  };
  selectAllBtn.addEventListener("click", selectAll); copyBtn.addEventListener("click", copySelection); pasteBtn.addEventListener("click", pasteSelection);
  window.addEventListener("vv-insert-chord", (event) => {
    if (!pianoRoll.offsetParent) return;
    const chord = (event as CustomEvent<{ notes?: string[] }>).detail?.notes ?? [];
    if (!chord.length) return;
    const start = Math.max(0, Math.min(steps() - 1, selection.size ? Math.max(...Array.from(selection, (note) => note.step + note.len)) : 0));
    ctx.checkpoint(); selection.clear();
    chord.forEach((noteName) => { const note: VNote = { note: noteName, step: start, len: Math.min(4, steps() - start), vel: 100 }; notes().push(note); selection.add(note); deps.audition(noteName, 90, 2); });
    selected = selection.values().next().value ?? null; deps.saveAll(); ctx.paintSession(); paintRoll();
  });

  window.addEventListener("keydown", (ev) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;
    if (!pianoRoll.offsetParent) return;
    const command = ev.ctrlKey || ev.metaKey;
    if (command && ev.key.toLowerCase() === "a") { ev.preventDefault(); selectAll(); return; }
    if (command && ev.key.toLowerCase() === "c") { ev.preventDefault(); copySelection(); return; }
    if (command && ev.key.toLowerCase() === "v") { ev.preventDefault(); pasteSelection(); return; }
    if (ev.key !== "Delete" && ev.key !== "Backspace") return;
    if (!selection.size) return;
    ev.preventDefault();
    ctx.checkpoint();
    synthLaneNotes[activeSynth.lane][clip.sel] = notes().filter((n) => !selection.has(n));
    selected = null; selection.clear();
    paintRoll(); ctx.paintSession(); deps.saveAll();
  });

  // velocity lane: drag to set the velocity of the note whose start is nearest
  const velAt = (ev: PointerEvent): VNote | null => {
    const rect = velCanvas.getBoundingClientRect();
    const { stepW } = geom();
    const px = ev.clientX - rect.left;
    let best: VNote | null = null, bestDist = 12;
    notes().forEach((n) => {
      const d = Math.abs(GUTTER + n.step * stepW + 2.5 - px);
      if (d < bestDist) { bestDist = d; best = n; }
    });
    return best;
  };
  let velDragging = false;
  const applyVel = (ev: PointerEvent) => {
    const n = velAt(ev); if (!n) return;
    const rect = velCanvas.getBoundingClientRect();
    n.vel = Math.max(1, Math.min(127, Math.round(127 * (1 - (ev.clientY - rect.top - 3) / (VEL_H - 6)))));
    selected = n;
    paintRoll();
  };
  velCanvas.addEventListener("pointerdown", (ev) => {
    ev.preventDefault(); velDragging = true; ctx.checkpoint(); applyVel(ev);
    velCanvas.setPointerCapture(ev.pointerId);
  });
  velCanvas.addEventListener("pointermove", (ev) => { if (velDragging) applyVel(ev); });
  velCanvas.addEventListener("pointerup", () => { velDragging = false; deps.saveAll(); });

  new ResizeObserver(() => paintRoll()).observe(scrollWrap);
  gridRepainters.push(paintRoll);
  // start the scroll centred on the melodic middle rather than B5
  requestAnimationFrame(() => { scrollWrap.scrollTop = Math.max(0, rollNotes.length * ROW_H * 0.4 - scrollWrap.clientHeight / 2); });

  return { pianoRoll, rollPlayheadBar, paintRoll };
}
