// Ear-training page: renders questions from ear-core.ts on a staff, keyboard
// or fretboard (or plays them), grades answers, keeps per-exercise stats and
// shares settings through the URL hash so a link can act as a customiser.
import { CLEF_BASE_STEP, DEFAULT_SETTINGS, EXERCISES, EQ_LABELS, INTERVALS, CHORDS, PITCH_LABELS, TUNING, exerciseById, fretPositions, mulberry32, staffNote } from "./ear-core";
import type { Question, Rng, Settings, View } from "./ear-core";

const STATS_KEY = "vv_audio_ear_stats_v1";
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag: string, attrs: Record<string, string | number>): SVGElement => { const e = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, String(v))); return e; };

interface Stats { asked: number; correct: number; streak: number; best: number }

export function initEar(): void {
  const tabs = $("ear-tabs"), views = $("ear-views"), stage = $("ear-stage"), prompt = $("ear-prompt"), choices = $("ear-choices"), feedback = $("ear-feedback");
  if (!tabs || !stage) return;

  // ── settings + share link ──
  const settings: Settings = { ...DEFAULT_SETTINGS, intervals: [...DEFAULT_SETTINGS.intervals], chords: [...DEFAULT_SETTINGS.chords], eqBands: [...DEFAULT_SETTINGS.eqBands] };
  const params = new URLSearchParams(location.hash.slice(1));
  try { const shared = params.get("s"); if (shared) Object.assign(settings, JSON.parse(decodeURIComponent(escape(atob(shared))))); } catch { /* bad link, defaults stand */ }
  let exerciseId = params.get("x") && EXERCISES.some((e) => e.id === params.get("x")) ? (params.get("x") as string) : "note";
  let view: View = (params.get("v") as View) || exerciseById(exerciseId).views[0];
  const seedParam = Number(params.get("seed"));
  const rng: Rng = seedParam ? mulberry32(seedParam) : Math.random;
  const writeHash = () => {
    const p = new URLSearchParams();
    p.set("x", exerciseId); p.set("v", view); p.set("s", btoa(unescape(encodeURIComponent(JSON.stringify(settings)))));
    if (seedParam) p.set("seed", String(seedParam));
    history.replaceState(null, "", `#${p.toString()}`);
    $<HTMLInputElement>("ear-share").value = location.href;
  };

  // ── stats ──
  let stats: Record<string, Stats> = {};
  try { stats = JSON.parse(localStorage.getItem(STATS_KEY) || "{}"); } catch { /* fresh */ }
  const stat = (): Stats => (stats[exerciseId] ??= { asked: 0, correct: 0, streak: 0, best: 0 });
  const paintStats = () => {
    const s = stat();
    $("ear-stats").textContent = s.asked ? `${s.correct}/${s.asked} · ${Math.round((100 * s.correct) / s.asked)}% · streak ${s.streak} · best ${s.best}` : "No answers yet";
  };
  const saveStats = () => { try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* ignore */ } };

  // ── audio ──
  let ctx: AudioContext | null = null;
  const audio = (): AudioContext => { ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); if (ctx.state === "suspended") void ctx.resume(); return ctx; };
  const tone = (midi: number, when: number, seconds: number, level = 0.22) => {
    const a = audio(), o = a.createOscillator(), g = a.createGain(), f = 440 * Math.pow(2, (midi - 69) / 12);
    o.type = "triangle"; o.frequency.value = f;
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(level, when + 0.01); g.gain.setValueAtTime(level, when + seconds - 0.08); g.gain.linearRampToValueAtTime(0, when + seconds);
    o.connect(g).connect(a.destination); o.start(when); o.stop(when + seconds + 0.02);
  };
  let pinkBuffer: AudioBuffer | null = null;
  const pink = (a: AudioContext): AudioBuffer => {
    if (pinkBuffer && pinkBuffer.sampleRate === a.sampleRate) return pinkBuffer;
    const n = a.sampleRate * 2, buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.08; }
    return (pinkBuffer = buf);
  };
  const click = (when: number, hz: number, level: number) => { const a = audio(), o = a.createOscillator(), g = a.createGain(); o.type = "square"; o.frequency.value = hz; g.gain.setValueAtTime(level, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04); o.connect(g).connect(a.destination); o.start(when); o.stop(when + 0.05); };
  function playQuestion(q: Question): void {
    if (!q.audio) return;
    const a = audio(), t0 = a.currentTime + 0.05;
    if (q.audio.kind === "notes") {
      if (q.audio.mode === "harmonic") q.audio.notes.forEach((n) => tone(n, t0, 1.6));
      else { const gap = q.audio.gapMs / 1000; q.audio.notes.forEach((n, i) => tone(n, t0 + i * gap, 0.9)); }
    } else if (q.audio.kind === "eq") {
      const src = a.createBufferSource(); src.buffer = pink(a); src.loop = true;
      const eq = a.createBiquadFilter(); eq.type = "peaking"; eq.frequency.value = q.audio.band; eq.Q.value = 1.4; eq.gain.setValueAtTime(0, t0); eq.gain.setValueAtTime(q.audio.boostDb, t0 + 1.2);
      const g = a.createGain(); g.gain.setValueAtTime(1, t0); g.gain.setValueAtTime(0, t0 + 1.15); g.gain.setValueAtTime(1, t0 + 1.25); g.gain.setValueAtTime(0, t0 + 2.4);
      src.connect(eq).connect(g).connect(a.destination); src.start(t0); src.stop(t0 + 2.5);
    } else {
      const cell = q.audio.cellMs / 1000, beats = q.audio.cells.length === 16 ? 4 : 4, beatLen = (cell * q.audio.cells.length) / beats;
      for (let b = 0; b < beats; b++) click(t0 + b * beatLen, b === 0 ? 1500 : 1000, 0.35);          // count-in
      const barStart = t0 + beats * beatLen;
      for (let b = 0; b < beats; b++) click(barStart + b * beatLen, 900, 0.12);                        // quiet pulse under the bar
      q.audio.cells.forEach((on, i) => { if (on) tone(72, barStart + i * cell, Math.min(0.28, cell * 0.9), 0.3); });
    }
  }

  // ── renderers ──
  function drawStaff(notes: number[]): void {
    const w = 320, h = 150, gap = 10, top = 50, svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, class: "ear-svg ear-staff", role: "img" });
    for (let i = 0; i < 5; i++) svg.append(svgEl("line", { x1: 20, x2: w - 20, y1: top + i * gap, y2: top + i * gap, class: "ear-line" }));
    const clef = svgEl("text", { x: 26, y: settings.clef === "treble" ? top + 4 * gap + 8 : top + 3 * gap - 1, class: `ear-clef ear-clef-${settings.clef}` });
    clef.textContent = settings.clef === "treble" ? "𝄞" : "𝄢"; svg.append(clef);
    const label = svgEl("text", { x: 22, y: h - 8, class: "ear-clef-label" }); label.textContent = settings.clef === "treble" ? "treble" : "bass"; svg.append(label);
    const base = CLEF_BASE_STEP[settings.clef], bottomY = top + 4 * gap;
    const sorted = [...notes].sort((a, b) => a - b);
    let lastStep = -99, shifted = false;
    sorted.forEach((midi) => {
      const sn = staffNote(midi), pos = sn.step - base, y = bottomY - (pos * gap) / 2;
      shifted = pos - (lastStep - base) === 1 && !shifted; lastStep = sn.step;
      const x = 190 + (shifted ? 14 : 0);
      // ledger lines above/below the five lines
      for (let p = -2; p >= pos; p -= 2) svg.append(svgEl("line", { x1: x - 12, x2: x + 12, y1: bottomY - (p * gap) / 2, y2: bottomY - (p * gap) / 2, class: "ear-line" }));
      for (let p = 10; p <= pos; p += 2) svg.append(svgEl("line", { x1: x - 12, x2: x + 12, y1: bottomY - (p * gap) / 2, y2: bottomY - (p * gap) / 2, class: "ear-line" }));
      svg.append(svgEl("ellipse", { cx: x, cy: y, rx: 6.5, ry: 4.6, transform: `rotate(-18 ${x} ${y})`, class: "ear-notehead" }));
      if (sn.accidental) { const acc = svgEl("text", { x: x - 22, y: y + 4, class: "ear-accidental" }); acc.textContent = sn.accidental; svg.append(acc); }
    });
    stage.replaceChildren(svg);
  }
  function drawKeyboard(notes: number[]): void {
    const low = Math.max(36, Math.floor(Math.min(...notes) / 12) * 12 - (Math.min(...notes) % 12 < 5 ? 12 : 0)), count = 24;
    const svg = svgEl("svg", { viewBox: "0 0 100 40", preserveAspectRatio: "none", class: "ear-svg ear-keys", role: "img" });
    const whites: number[] = [], blacks: number[] = [];
    for (let i = 0; i < count; i++) ([1, 3, 6, 8, 10].includes(i % 12) ? blacks : whites).push(low + i);
    const ww = 100 / whites.length, xOf = new Map<number, number>();
    whites.forEach((m, i) => xOf.set(m, i * ww));
    whites.forEach((m) => svg.append(svgEl("rect", { x: xOf.get(m) as number, y: 0, width: ww - 0.35, height: 40, rx: 0.6, class: `ear-key white${notes.includes(m) ? " on" : ""}` })));
    blacks.forEach((m) => svg.append(svgEl("rect", { x: (xOf.get(m - 1) as number) + ww * 0.66, y: 0, width: ww * 0.68, height: 25, rx: 0.6, class: `ear-key black${notes.includes(m) ? " on" : ""}` })));
    const c4 = svgEl("text", { x: (xOf.get(60) ?? -10) + ww / 2, y: 38, class: "ear-key-label" }); if (xOf.has(60)) { c4.textContent = "C4"; svg.append(c4); }
    stage.replaceChildren(svg);
  }
  function drawFretboard(notes: number[]): void {
    const positions = fretPositions(notes, rng);
    const w = 420, h = 130, left = 30, top = 18, fretW = (w - left - 10) / 12, stringGap = (h - top - 16) / 5;
    const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, class: "ear-svg ear-fret", role: "img" });
    for (let f = 0; f <= 12; f++) svg.append(svgEl("line", { x1: left + f * fretW, x2: left + f * fretW, y1: top, y2: top + 5 * stringGap, class: f === 0 ? "ear-nut" : "ear-fretline" }));
    [3, 5, 7, 9].forEach((f) => svg.append(svgEl("circle", { cx: left + (f - 0.5) * fretW, cy: top + 2.5 * stringGap, r: 3, class: "ear-inlay" })));
    [1.5, 3.5].forEach((s) => svg.append(svgEl("circle", { cx: left + 11.5 * fretW, cy: top + s * stringGap, r: 3, class: "ear-inlay" })));
    for (let s = 0; s < 6; s++) { const y = top + (5 - s) * stringGap; svg.append(svgEl("line", { x1: left, x2: w - 10, y1: y, y2: y, class: "ear-string", "stroke-width": String(2.2 - s * 0.25) })); const t = svgEl("text", { x: 8, y: y + 4, class: "ear-string-label" }); t.textContent = ["E", "A", "D", "G", "B", "e"][s]; svg.append(t); }
    (positions ?? []).forEach((p) => { const y = top + (5 - p.string) * stringGap, x = p.fret === 0 ? left - 9 : left + (p.fret - 0.5) * fretW; svg.append(svgEl("circle", { cx: x, cy: y, r: 7, class: "ear-dot" })); });
    stage.replaceChildren(svg);
  }
  function drawEar(q: Question): void {
    const box = document.createElement("div"); box.className = "ear-earbox";
    const play = document.createElement("button"); play.type = "button"; play.className = "btn"; play.id = "ear-play"; play.textContent = "▶ Play"; play.addEventListener("click", () => playQuestion(q));
    box.append(play);
    if (q.rhythmChoices) { const hint = document.createElement("p"); hint.className = "au-muted"; hint.textContent = `${q.rhythmChoices[0].length === 16 ? "Sixteenth" : "Eighth"} grid · ● hit · dot rest · 100 BPM`; box.append(hint); }
    stage.replaceChildren(box);
  }

  // ── question flow ──
  let current: Question | null = null, answered = false;
  function next(): void {
    const ex = exerciseById(exerciseId);
    if (!ex.views.includes(view)) view = ex.views[0];
    current = ex.make(settings, view, rng); answered = false;
    prompt.textContent = current.prompt; feedback.textContent = ""; feedback.className = "ear-feedback";
    if (view === "staff") drawStaff(current.notes); else if (view === "keyboard") drawKeyboard(current.notes); else if (view === "fretboard") drawFretboard(current.notes); else drawEar(current);
    choices.replaceChildren();
    current.choices.forEach((c, i) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost ear-choice"; b.dataset.choice = c;
      b.innerHTML = current!.rhythmChoices ? `<span class="ear-rhythm">${c.split("").map((ch) => `<i class="${ch === "●" ? "on" : ""}"></i>`).join("")}</span>` : `${i < 9 ? `<small>${i + 1}</small>` : ""}${c}`;
      b.addEventListener("click", () => answer(c, b));
      choices.append(b);
    });
    $("ear-next").hidden = true;
    writeHash();
    if (current.audio && autoplay) playQuestion(current);
  }
  function answer(choice: string, button: HTMLButtonElement): void {
    if (!current || answered) return;
    answered = true;
    const s = stat(), ok = choice === current.answer;
    s.asked++; if (ok) { s.correct++; s.streak++; s.best = Math.max(s.best, s.streak); } else s.streak = 0;
    saveStats(); paintStats();
    feedback.textContent = ok ? `Correct — ${current.explain}` : `Not quite: it was ${current.answer}. ${current.explain}`;
    feedback.className = `ear-feedback ${ok ? "ok" : "bad"}`;
    button.classList.add(ok ? "right" : "wrong");
    if (!ok) choices.querySelectorAll<HTMLButtonElement>(".ear-choice").forEach((b) => { if (b.dataset.choice === current!.answer) b.classList.add("right"); });
    $("ear-next").hidden = false;
    if (ok) window.setTimeout(() => { if (answered && current) next(); }, 900);
  }
  let autoplay = true;

  // ── chrome ──
  EXERCISES.forEach((ex) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "ear-tab" + (ex.id === exerciseId ? " active" : ""); b.textContent = ex.name; b.dataset.exercise = ex.id;
    b.addEventListener("click", () => { exerciseId = ex.id; tabs.querySelectorAll(".ear-tab").forEach((t) => t.classList.toggle("active", t === b)); view = ex.views.includes(view) ? view : ex.views[0]; paintViews(); paintStats(); next(); });
    tabs.append(b);
  });
  function paintViews(): void {
    const ex = exerciseById(exerciseId);
    views.replaceChildren();
    views.hidden = ex.views.length < 2;
    ex.views.forEach((v) => { const b = document.createElement("button"); b.type = "button"; b.className = "ear-view" + (v === view ? " active" : ""); b.textContent = v[0].toUpperCase() + v.slice(1); b.dataset.view = v; b.addEventListener("click", () => { view = v; paintViews(); next(); }); views.append(b); });
  }
  $("ear-next").addEventListener("click", next);
  $("ear-replay").addEventListener("click", () => current && playQuestion(current));
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (answered) next(); else if (current?.audio) playQuestion(current); return; }
    if (e.key.toLowerCase() === "r" && current) { playQuestion(current); return; }
    const n = Number(e.key); if (n >= 1 && n <= 9) { const b = choices.querySelectorAll<HTMLButtonElement>(".ear-choice")[n - 1]; b?.click(); }
  });

  // settings drawer
  const clefSel = $<HTMLSelectElement>("ear-clef"), accChk = $<HTMLInputElement>("ear-acc"), invChk = $<HTMLInputElement>("ear-inv"), melSel = $<HTMLSelectElement>("ear-melodic"), boostIn = $<HTMLInputElement>("ear-boost"), densSel = $<HTMLSelectElement>("ear-density"), autoChk = $<HTMLInputElement>("ear-autoplay");
  const intervalBox = $("ear-intervals"), chordBox = $("ear-chords"), bandBox = $("ear-bands");
  Object.entries(INTERVALS).forEach(([n, [short]]) => { const l = document.createElement("label"); l.className = "ear-chk"; const c = document.createElement("input"); c.type = "checkbox"; c.value = n; c.checked = settings.intervals.includes(Number(n)); c.addEventListener("change", () => { settings.intervals = [...intervalBox.querySelectorAll<HTMLInputElement>("input:checked")].map((i) => Number(i.value)); next(); }); l.append(c, document.createTextNode(short)); intervalBox.append(l); });
  Object.entries(CHORDS).forEach(([id, def]) => { const l = document.createElement("label"); l.className = "ear-chk"; const c = document.createElement("input"); c.type = "checkbox"; c.value = id; c.checked = settings.chords.includes(id); c.addEventListener("change", () => { settings.chords = [...chordBox.querySelectorAll<HTMLInputElement>("input:checked")].map((i) => i.value); next(); }); l.append(c, document.createTextNode(def.label)); chordBox.append(l); });
  [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].forEach((hz) => { const l = document.createElement("label"); l.className = "ear-chk"; const c = document.createElement("input"); c.type = "checkbox"; c.value = String(hz); c.checked = settings.eqBands.includes(hz); c.addEventListener("change", () => { settings.eqBands = [...bandBox.querySelectorAll<HTMLInputElement>("input:checked")].map((i) => Number(i.value)); next(); }); l.append(c, document.createTextNode(EQ_LABELS(hz))); bandBox.append(l); });
  clefSel.value = settings.clef; accChk.checked = settings.accidentals; invChk.checked = settings.inversions; melSel.value = settings.melodic; boostIn.value = String(settings.eqBoostDb); densSel.value = String(settings.rhythmDensity);
  clefSel.addEventListener("change", () => { settings.clef = clefSel.value as Settings["clef"]; next(); });
  accChk.addEventListener("change", () => { settings.accidentals = accChk.checked; next(); });
  invChk.addEventListener("change", () => { settings.inversions = invChk.checked; next(); });
  melSel.addEventListener("change", () => { settings.melodic = melSel.value as Settings["melodic"]; next(); });
  boostIn.addEventListener("change", () => { settings.eqBoostDb = Math.max(2, Math.min(15, Number(boostIn.value) || 9)); boostIn.value = String(settings.eqBoostDb); next(); });
  densSel.addEventListener("change", () => { settings.rhythmDensity = Number(densSel.value) as Settings["rhythmDensity"]; next(); });
  autoChk.addEventListener("change", () => { autoplay = autoChk.checked; });
  $("ear-copy-link").addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.href); $("ear-copy-link").textContent = "Copied"; setTimeout(() => { $("ear-copy-link").textContent = "Copy link"; }, 1500); } catch { /* clipboard blocked */ } });
  $("ear-reset").addEventListener("click", () => { delete stats[exerciseId]; saveStats(); paintStats(); });

  // PITCH_LABELS is referenced so a tree-shaker keeps the shared table in one chunk
  void PITCH_LABELS;
  paintViews(); paintStats(); next();
}
