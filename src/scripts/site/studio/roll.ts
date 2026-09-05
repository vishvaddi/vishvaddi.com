// Piano roll v2 — a Cubase-Key-Editor-style canvas editor (Studio v2 C3).
// One canvas for the note grid (key column drawn in), a velocity lane below,
// and a DOM playhead overlay so playback.ts keeps its existing contract.
// Unquantized by default: positions/lengths are float steps; snapping applies
// only when the transport Grid selector is set (transport.quantizeGrid > 0).
// Studio v5 (P3): tool palette (draw / select / erase) on a foot toolbar, a
// real black/white key column, notes in the lane's track colour, and rows
// that scale so the grid fills its aperture instead of stopping short.
import { el, btn, help } from "./helpers";
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

const GUTTER = 48;
const ROW_MIN = 14;
const ROW_MAX = 22;
const VEL_H = 72;
const EDGE_PX = 6;
const MIN_LEN_FREE = 0.25;
const NAMED_TRACKS = new Set(["drums", "pads", "bass", "lead", "harmony", "audio"]);

/** Track identity for a synth lane. The six named tracks resolve through
 *  tokens.css; extra MIDI lanes cycle the eight-colour palette by index. */
export function laneIdentity(node: HTMLElement, lane: string): void {
  if (NAMED_TRACKS.has(lane)) { node.dataset.track = lane; node.style.removeProperty("--track-colour"); return; }
  delete node.dataset.track;
  node.style.setProperty("--track-colour", `var(--wa-track-${(Math.max(0, SYNTH_LANES.indexOf(lane)) % 8) + 1})`);
}

/** Canvases cannot read CSS custom properties per fill, so each paint reads
 *  the token set once from the roll's computed style. */
function rgba(colour: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (!hex) return colour;
  const n = parseInt(hex[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

type Tool = "draw" | "select" | "erase";
const CURSORS: Record<Tool, string> = { draw: "cell", select: "crosshair", erase: "pointer" };

type Drag =
  | { kind: "create"; note: VNote }
  | { kind: "move"; note: VNote; origStep: number; origRow: number; grabOffset: number }
  | { kind: "resize-l"; note: VNote; origStep: number; origLen: number }
  | { kind: "resize-r"; note: VNote; origLen: number }
  | { kind: "marquee"; startStep: number; startRow: number; step: number; row: number }
  | { kind: "erase" }
  | null;

export function buildRoll(deps: RollDeps): Roll {
  const pianoRoll = el("div", "wa-piano-roll wa-roll2");
  const head = el("div", "wa-roll-toolbar wa-roll-head");
  const foot = el("div", "wa-roll-toolbar wa-roll-foot");
  const laneGroup = el("div", "wa-subtabs wa-roll-lanes");
  const laneButtons = new Map<SynthLane, HTMLButtonElement>();
  const paintIdentity = (): void => {
    laneIdentity(pianoRoll, activeSynth.lane);
    laneButtons.forEach((item, id) => item.classList.toggle("active", id === activeSynth.lane));
  };
  const buildLaneButtons = (): void => {
    laneButtons.clear(); laneGroup.replaceChildren();
    SYNTH_LANES.forEach((lane) => {
      const button = btn(SYNTH_LANE_LABELS[lane], "wa-subtab wa-roll-lane") as HTMLButtonElement;
      laneIdentity(button, lane);
      button.addEventListener("click", () => {
        activeSynth.lane = lane; selected = null; selection.clear();
        paintIdentity();
        window.dispatchEvent(new CustomEvent("vv-synth-lane-change", { detail: lane })); paintRoll();
      });
      laneButtons.set(lane, button); laneGroup.append(button);
    });
    paintIdentity();
  };
  buildLaneButtons();
  window.addEventListener("vv-studio-tracks-change", () => { buildLaneButtons(); paintRoll(); });
  const patternBar = buildPatternBar({ compact: true, onChange: () => paintRoll() });
  // Roll range (CV-80 RANGE + octave keys): the canvas shows three octaves;
  // these shift which three, so notes outside C3–B5 are reachable.
  let rollOct = Math.max(-3, Math.min(3, Number(localStorage.getItem("vv_studio_rolloct") || 0)));
  let rollNotes = ROLL_NOTES.map((n) => midiToNote(noteToMidi(n) + rollOct * 12));
  const rangeLabel = el("span", "wa-roll-range", "");
  const octDown = btn("Oct −", "wa-btn-sm"), octUp = btn("Oct +", "wa-btn-sm");
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

  // Tool palette — each tool is a mode over the behaviours the canvas already
  // had: draw (create / move / resize), select (marquee), erase (delete).
  const tools = el("div", "wa-subtabs wa-roll-tools");
  const toolButtons = new Map<Tool, HTMLButtonElement>();
  let tool: Tool = "draw";
  const setTool = (next: Tool): void => {
    tool = next;
    toolButtons.forEach((button, id) => { button.classList.toggle("active", id === next); button.setAttribute("aria-pressed", String(id === next)); });
    canvas.style.cursor = CURSORS[next];
  };
  ([
    ["draw", "Draw", "Draw: click to add a note and drag its length; drag a note to move it, drag an edge to resize."],
    ["select", "Select", "Select: drag a marquee around notes; shift-click adds to the selection."],
    ["erase", "Erase", "Erase: click or drag across notes to delete them."],
  ] as const).forEach(([id, label, tip]) => {
    const button = btn(label, "wa-subtab wa-roll-tool") as HTMLButtonElement;
    help(button, tip);
    button.addEventListener("click", () => setTool(id));
    toolButtons.set(id, button); tools.append(button);
  });
  const accentBtn = btn("Accent", "wa-btn-sm wa-note-expression") as HTMLButtonElement;
  const slideBtn = btn("Slide", "wa-btn-sm wa-note-expression") as HTMLButtonElement;
  const selectAllBtn = btn("All", "wa-btn-sm") as HTMLButtonElement;
  const copyBtn = btn("Copy", "wa-btn-sm") as HTMLButtonElement;
  const pasteBtn = btn("Paste", "wa-btn-sm") as HTMLButtonElement;
  help(accentBtn, "Toggle an accented note. Accents play louder and brighter.");
  help(slideBtn, "Glide into this note from the previous note in the lane.");
  help(selectAllBtn, "Select every note in this lane's pattern.");
  accentBtn.addEventListener("click", () => { if (selection.size) { const on = !Array.from(selection).every((note) => note.accent); selection.forEach((note) => { note.accent = on; }); deps.saveAll(); paintRoll(); } });
  slideBtn.addEventListener("click", () => { if (selection.size) { const on = !Array.from(selection).every((note) => note.slide); selection.forEach((note) => { note.slide = on; }); deps.saveAll(); paintRoll(); } });
  head.append(laneGroup, el("span", "wa-roll-spacer"), patternBar.root, octDown, rangeLabel, octUp);
  foot.append(tools, el("span", "wa-roll-spacer"), selectAllBtn, copyBtn, pasteBtn, el("span", "wa-sep"), accentBtn, slideBtn);
  const scrollWrap = el("div", "wa-roll2-scroll");
  const canvas = document.createElement("canvas");
  canvas.className = "wa-roll2-canvas";
  const rollPlayhead = el("div", "wa-roll-playhead");
  rollPlayhead.style.left = `${GUTTER}px`;
  const rollPlayheadBar = el("div", "wa-roll-playhead-bar");
  rollPlayhead.append(rollPlayheadBar);
  scrollWrap.append(canvas, rollPlayhead);
  const velCanvas = document.createElement("canvas");
  velCanvas.className = "wa-roll2-vel";
  pianoRoll.append(head, scrollWrap, velCanvas, foot);
  setTool("draw");

  let selected: VNote | null = null;
  const selection = new Set<VNote>();
  let noteClipboard: VNote[] = [];
  let drag: Drag = null;
  let lastLen = 1;
  let rowH = 16;

  const notes = (): VNote[] => activeSynthNotes();
  const steps = (): number => patternLengths[clip.sel];
  const grid = (): number => (transport.quantizeGrid ? steps() / transport.quantizeGrid : 0);
  const snap = (v: number): number => { const g = grid(); return g ? Math.round(v / g) * g : v; };
  const minLen = (): number => grid() || MIN_LEN_FREE;
  const rowOf = (n: VNote): number => rollNotes.indexOf(n.note);
  const isBlack = (note: string): boolean => note.includes("#");
  const isC = (note: string): boolean => note.startsWith("C") && !isBlack(note);

  const geom = () => {
    const w = scrollWrap.clientWidth || 720;
    const h = scrollWrap.clientHeight || 400;
    rowH = Math.max(ROW_MIN, Math.min(ROW_MAX, Math.floor(h / rollNotes.length)));
    return { w, stepW: (w - GUTTER) / steps() };
  };
  const theme = () => {
    const style = getComputedStyle(pianoRoll);
    const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
    return {
      track: read("--track-colour", "#ff914d"),
      accent: read("--wa-accent", "#ff914d"),
      screen: read("--wa-screen", "#05070a"),
      surface: read("--wa-surface", "#0d1118"),
      canvas: read("--wa-canvas", "#07090d"),
      border: read("--wa-border", "#293445"),
      borderSoft: read("--wa-border-soft", "#1a2330"),
      text: read("--wa-text", "#e8edf5"),
      faint: read("--wa-faint", "#536075"),
      mono: read("--wa-mono", "ui-monospace, monospace"),
    };
  };

  function paintRoll(): void {
    const { w, stepW } = geom();
    const t = theme();
    const h = rollNotes.length * rowH;
    const scale = window.devicePixelRatio || 1;
    canvas.style.height = `${h}px`;
    rollPlayhead.style.height = `${h}px`;
    canvas.width = Math.floor(w * scale); canvas.height = Math.floor(h * scale);
    const g = canvas.getContext("2d"); if (!g) return;
    g.scale(scale, scale);
    g.fillStyle = t.screen; g.fillRect(0, 0, w, h);

    // row stripes: black-key rows lifted, octave boundaries ruled
    rollNotes.forEach((note, r) => {
      const y = r * rowH;
      if (isBlack(note)) { g.fillStyle = "rgba(255,255,255,0.03)"; g.fillRect(GUTTER, y, w - GUTTER, rowH); }
      if (isC(note)) {
        g.strokeStyle = t.border; g.lineWidth = 1;
        g.beginPath(); g.moveTo(GUTTER, y + rowH + 0.5); g.lineTo(w, y + rowH + 0.5); g.stroke();
      }
    });
    // vertical lines: bars strongest, beats next, steps faint
    const perBeat = patternDivisions[clip.sel] || 4;
    for (let s = 0; s <= steps(); s++) {
      const x = GUTTER + s * stepW;
      const bar = s % (perBeat * 4) === 0, beat = s % perBeat === 0;
      g.strokeStyle = bar ? t.border : beat ? rgba(t.border, 0.7) : t.borderSoft;
      g.lineWidth = bar ? 1.5 : 1;
      g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke();
    }
    // notes — lane colour, brightness by velocity, accent ring when selected
    notes().forEach((n) => {
      const r = rowOf(n); if (r < 0) return;
      const x = GUTTER + n.step * stepW, y = r * rowH + 1.5;
      const nw = Math.max(3, n.len * stepW - 1), nh = rowH - 3;
      const sel = selection.has(n);
      g.fillStyle = rgba(t.track, 0.45 + 0.55 * (n.vel / 127));
      g.beginPath(); g.roundRect(x, y, nw, nh, 3); g.fill();
      if (n.accent || n.slide) {
        g.fillStyle = "rgba(0,0,0,0.85)"; g.font = `700 8px ${t.mono}`;
        g.fillText(`${n.accent ? "A" : ""}${n.slide ? "↗" : ""}`, x + 3, y + nh / 2 + 3);
      }
      g.strokeStyle = sel ? t.accent : "rgba(0,0,0,0.55)";
      g.lineWidth = sel ? 1.5 : 1;
      g.beginPath(); g.roundRect(x, y, nw, nh, 3); g.stroke();
    });
    if (drag?.kind === "marquee") {
      const left = GUTTER + Math.min(drag.startStep, drag.step) * stepW;
      const top = Math.min(drag.startRow, drag.row) * rowH;
      const width = Math.abs(drag.step - drag.startStep) * stepW;
      const height = (Math.abs(drag.row - drag.startRow) + 1) * rowH;
      g.fillStyle = rgba(t.accent, 0.14); g.fillRect(left, top, width, height);
      g.strokeStyle = t.accent; g.lineWidth = 1; g.strokeRect(left + 0.5, top + 0.5, width, height);
    }
    // key column: white keys span the gutter, black keys sit short and dark
    // on top; separators only where two white keys meet (E|F, B|C)
    const blackW = Math.round(GUTTER * 0.58);
    g.fillStyle = t.text; g.fillRect(0, 0, GUTTER, h);
    rollNotes.forEach((note, r) => {
      const y = r * rowH;
      if (isBlack(note)) {
        g.fillStyle = t.canvas; g.fillRect(0, y, blackW, rowH);
        g.fillStyle = "rgba(255,255,255,0.10)"; g.fillRect(0, y + rowH - 1, blackW, 1);
      } else if (r + 1 < rollNotes.length && !isBlack(rollNotes[r + 1])) {
        g.fillStyle = t.border; g.fillRect(0, y + rowH - 1, GUTTER, 1);
      }
      if (isC(note)) {
        g.fillStyle = t.faint; g.font = `600 9px ${t.mono}`; g.textAlign = "right";
        g.fillText(note, GUTTER - 4, y + rowH - Math.max(2, (rowH - 9) / 2));
        g.textAlign = "left";
      }
    });
    g.fillStyle = t.border; g.fillRect(GUTTER - 1, 0, 1, h);
    paintVel();
    paintIdentity();
    patternBar.sync();
    accentBtn.classList.toggle("active", selection.size > 0 && Array.from(selection).every((note) => note.accent));
    slideBtn.classList.toggle("active", selection.size > 0 && Array.from(selection).every((note) => note.slide));
    accentBtn.disabled = selection.size === 0; slideBtn.disabled = selection.size === 0; copyBtn.disabled = selection.size === 0; pasteBtn.disabled = noteClipboard.length === 0;
    rangeLabel.textContent = `${rollNotes[rollNotes.length - 1]}–${rollNotes[0]}`;
  }

  function paintVel(): void {
    const { w, stepW } = geom();
    const t = theme();
    const scale = window.devicePixelRatio || 1;
    velCanvas.width = Math.floor(w * scale); velCanvas.height = Math.floor(VEL_H * scale);
    const g = velCanvas.getContext("2d"); if (!g) return;
    g.scale(scale, scale);
    g.fillStyle = t.screen; g.fillRect(0, 0, w, VEL_H);
    g.fillStyle = t.surface; g.fillRect(0, 0, GUTTER, VEL_H);
    g.fillStyle = t.border; g.fillRect(GUTTER - 1, 0, 1, VEL_H);
    g.fillStyle = t.faint; g.font = `600 9px ${t.mono}`; g.fillText("VEL", 6, VEL_H / 2 + 3);
    const perBeat = patternDivisions[clip.sel] || 4;
    for (let s = 0; s <= steps(); s += perBeat) {
      const x = GUTTER + s * stepW;
      g.strokeStyle = s % (perBeat * 4) === 0 ? t.border : t.borderSoft;
      g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, VEL_H); g.stroke();
    }
    notes().forEach((n) => {
      const x = GUTTER + n.step * stepW;
      const bh = Math.max(2, (n.vel / 127) * (VEL_H - 8));
      const sel = selection.has(n);
      g.fillStyle = sel ? t.accent : rgba(t.track, 0.45 + 0.55 * (n.vel / 127));
      g.fillRect(x, VEL_H - 4 - bh, 5, bh);
    });
  }

  // ── hit testing ──
  const pos = (ev: PointerEvent | MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const { stepW } = geom();
    return {
      step: (ev.clientX - rect.left - GUTTER) / stepW,
      row: Math.floor((ev.clientY - rect.top) / rowH),
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
  const deleteNote = (target: VNote): void => {
    synthLaneNotes[activeSynth.lane][clip.sel] = notes().filter((n) => n !== target);
    selection.delete(target); if (selected === target) selected = null;
  };

  canvas.addEventListener("pointermove", (ev) => {
    if (drag) return;
    if (tool !== "draw") { canvas.style.cursor = CURSORS[tool]; return; }
    const found = hit(ev);
    canvas.style.cursor = !found ? "cell" : found.zone === "body" ? "move" : "ew-resize";
  });

  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const found = hit(ev);
    const { step, row } = pos(ev);
    if (tool === "erase") {
      if (!found) return;
      ctx.checkpoint(); deleteNote(found.note);
      drag = { kind: "erase" };
      canvas.setPointerCapture(ev.pointerId);
      paintRoll(); ctx.paintSession(); return;
    }
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
      if (tool === "select") {
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
    if (drag.kind === "erase") {
      const found = hit(ev);
      if (found) { deleteNote(found.note); paintRoll(); ctx.paintSession(); }
      return;
    }
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
    deleteNote(found.note);
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
    n.vel = Math.max(1, Math.min(127, Math.round(127 * (1 - (ev.clientY - rect.top - 4) / (VEL_H - 8)))));
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
  requestAnimationFrame(() => { geom(); scrollWrap.scrollTop = Math.max(0, rollNotes.length * rowH * 0.4 - scrollWrap.clientHeight / 2); });

  return { pianoRoll, rollPlayheadBar, paintRoll };
}
