// Chord + scale lab: pick a key, hear its diatonic chords, build a progression,
// export it as MIDI. Sound is a small poly synth on the page's own AudioContext.
import { download } from "../calc";
import { PPQ, encodeMidi } from "./smf";
import type { MidiTrack } from "./smf";
import { NOTE_NAMES, PROGRESSIONS, SCALES, camelot, diatonicChord, invert, midiName, nameChord, pc, relativeKey, romanNumeral, scaleById, scalePitchClasses, voice } from "./theory";
import type { Voicing } from "./theory";

interface Slot { degree: number; inversion: number; bars: number }
interface LabState { root: number; scale: string; octave: number; bpm: number; size: 3 | 4; voicing: Voicing; slots: Slot[] }

const STORE = "vv_audio_chords_v1";
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export function initChordLab(): void {
  const rootSel = $<HTMLSelectElement>("ch-root"), scaleSel = $<HTMLSelectElement>("ch-scale"), octSel = $<HTMLSelectElement>("ch-octave");
  const bpmIn = $<HTMLInputElement>("ch-bpm"), sizeSel = $<HTMLSelectElement>("ch-size"), voicingSel = $<HTMLSelectElement>("ch-voicing");
  if (!rootSel || !scaleSel) return;

  const state: LabState = { root: 0, scale: "major", octave: 4, bpm: 120, size: 3, voicing: "close", slots: [] };
  try { Object.assign(state, JSON.parse(localStorage.getItem(STORE) || "{}")); } catch { /* fresh start */ }
  const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode */ } };

  NOTE_NAMES.forEach((n, i) => rootSel.add(new Option(n, String(i))));
  SCALES.forEach((s) => scaleSel.add(new Option(s.name, s.id)));
  [2, 3, 4, 5].forEach((o) => octSel.add(new Option(`Octave ${o}`, String(o))));
  const presetSel = $<HTMLSelectElement>("ch-preset");
  presetSel.add(new Option("Presets…", ""));
  PROGRESSIONS.forEach((p, i) => presetSel.add(new Option(p.name, String(i))));
  rootSel.value = String(state.root); scaleSel.value = state.scale; octSel.value = String(state.octave); bpmIn.value = String(state.bpm); sizeSel.value = String(state.size); voicingSel.value = state.voicing;

  // ── sound ──
  let ctx: AudioContext | null = null, master: GainNode | null = null;
  const audio = (): AudioContext => {
    if (!ctx) {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.5;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  };
  const playChord = (notes: number[], when: number, seconds: number, gain = 0.22): void => {
    const a = audio();
    notes.forEach((n) => {
      const f = 440 * Math.pow(2, (n - 69) / 12);
      const env = a.createGain(), filt = a.createBiquadFilter();
      filt.type = "lowpass"; filt.frequency.setValueAtTime(Math.min(9000, f * 6), when); filt.frequency.exponentialRampToValueAtTime(Math.min(4000, f * 2.5), when + seconds); filt.Q.value = 0.6;
      env.gain.setValueAtTime(0, when); env.gain.linearRampToValueAtTime(gain / Math.sqrt(notes.length), when + 0.012);
      env.gain.setValueAtTime(gain / Math.sqrt(notes.length), when + Math.max(0.02, seconds - 0.08)); env.gain.linearRampToValueAtTime(0, when + seconds);
      [0, -7, 7].forEach((cents) => {
        const o = a.createOscillator(); o.type = cents ? "sawtooth" : "triangle"; o.frequency.value = f; o.detune.value = cents;
        const g = a.createGain(); g.gain.value = cents ? 0.35 : 0.6;
        o.connect(g).connect(filt); o.start(when); o.stop(when + seconds + 0.05);
      });
      filt.connect(env).connect(master as GainNode);
    });
  };

  // ── derived data ──
  const scale = () => scaleById(state.scale);
  const chordFor = (slot: Pick<Slot, "degree" | "inversion">, size = state.size): number[] => voice(invert(diatonicChord(state.root, state.scale, slot.degree, size, state.octave), slot.inversion), state.voicing);
  const label = (degree: number, size = state.size) => { const notes = diatonicChord(state.root, state.scale, degree, size, state.octave); const name = nameChord(notes); return { notes, name, numeral: romanNumeral(degree, name.quality) }; };

  // ── render ──
  function renderScale(): void {
    const s = scale(), pcs = scalePitchClasses(state.root, state.scale);
    $("ch-scale-notes").textContent = pcs.map((p) => NOTE_NAMES[p]).join("  ");
    const mode = s.mode;
    const rel = mode ? relativeKey(state.root, mode) : null;
    $("ch-key-meta").textContent = mode
      ? `${NOTE_NAMES[state.root]} ${s.name.toLowerCase()} · Camelot ${camelot(state.root, mode)} · relative ${rel ? `${NOTE_NAMES[rel.root]} ${rel.mode}` : ""} (${rel ? camelot(rel.root, rel.mode) : ""})`
      : `${NOTE_NAMES[state.root]} ${s.name.toLowerCase()} · ${s.steps.length} notes per octave`;
    drawKeyboard(pcs);
  }

  function drawKeyboard(pcs: number[]): void {
    const svg = $<HTMLElement>("ch-keys"); svg.replaceChildren();
    const ns = "http://www.w3.org/2000/svg", startMidi = (state.octave + 1) * 12, count = 24;
    const whiteW = 100 / 14, whites: number[] = [], blacks: number[] = [];
    for (let i = 0; i < count; i++) ([1, 3, 6, 8, 10].includes(i % 12) ? blacks : whites).push(startMidi + i);
    const xOfWhite = new Map<number, number>();
    whites.forEach((m, i) => xOfWhite.set(m, i * whiteW));
    const key = (m: number, x: number, w: number, h: number, black: boolean) => {
      const r = document.createElementNS(ns, "rect");
      const on = pcs.includes(pc(m)), root = pc(m) === state.root;
      r.setAttribute("x", String(x)); r.setAttribute("y", "0"); r.setAttribute("width", String(w)); r.setAttribute("height", String(h)); r.setAttribute("rx", "0.6");
      r.setAttribute("class", `ch-key ${black ? "black" : "white"}${on ? " on" : ""}${root ? " root" : ""}`);
      r.setAttribute("data-midi", String(m));
      const t = document.createElementNS(ns, "title"); t.textContent = midiName(m); r.append(t);
      r.addEventListener("pointerdown", () => { playChord([m], audio().currentTime, 0.6, 0.3); });
      svg.append(r);
    };
    whites.forEach((m) => key(m, xOfWhite.get(m) as number, whiteW - 0.35, 40, false));
    blacks.forEach((m) => { const left = xOfWhite.get(m - 1) as number; key(m, left + whiteW * 0.66, whiteW * 0.68, 25, true); });
  }

  function renderChords(): void {
    const tbody = $("ch-chords"); tbody.replaceChildren();
    scale().steps.forEach((_, degree) => {
      const { notes, name, numeral } = label(degree);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="ch-numeral">${numeral}</td><td class="ch-symbol">${name.symbol}</td><td class="ch-notes">${notes.map((n) => midiName(n)).join(" ")}</td><td class="ch-actions"></td>`;
      const play = document.createElement("button"); play.type = "button"; play.className = "btn btn-ghost btn-sm"; play.textContent = "▶";
      play.setAttribute("aria-label", `Play ${name.symbol}`);
      play.addEventListener("click", () => playChord(chordFor({ degree, inversion: 0 }), audio().currentTime, 1.2));
      const add = document.createElement("button"); add.type = "button"; add.className = "btn btn-sm"; add.textContent = "＋";
      add.setAttribute("aria-label", `Add ${name.symbol} to the progression`);
      add.addEventListener("click", () => { state.slots.push({ degree, inversion: 0, bars: 1 }); persist(); renderProgression(); });
      tr.querySelector(".ch-actions")?.append(play, add);
      tbody.append(tr);
    });
  }

  function renderProgression(): void {
    const host = $("ch-slots"); host.replaceChildren();
    state.slots.forEach((slot, i) => {
      const { name, numeral } = label(slot.degree);
      const chip = document.createElement("div"); chip.className = "ch-slot"; chip.dataset.index = String(i);
      chip.innerHTML = `<span class="ch-slot-name"><strong>${name.symbol}</strong><small>${numeral}</small></span>`;
      const inv = document.createElement("select"); inv.setAttribute("aria-label", "Inversion");
      ["Root", "1st", "2nd", "3rd"].slice(0, state.size).forEach((l, v) => inv.add(new Option(l, String(v))));
      inv.value = String(Math.min(slot.inversion, state.size - 1));
      inv.addEventListener("change", () => { slot.inversion = Number(inv.value); persist(); });
      const bars = document.createElement("select"); bars.setAttribute("aria-label", "Bars");
      [0.5, 1, 2, 4].forEach((b) => bars.add(new Option(`${b} bar${b === 1 ? "" : "s"}`, String(b))));
      bars.value = String(slot.bars);
      bars.addEventListener("change", () => { slot.bars = Number(bars.value); persist(); });
      const del = document.createElement("button"); del.type = "button"; del.className = "ch-slot-x"; del.textContent = "×"; del.setAttribute("aria-label", `Remove ${name.symbol}`);
      del.addEventListener("click", () => { state.slots.splice(i, 1); persist(); renderProgression(); });
      chip.append(inv, bars, del);
      host.append(chip);
    });
    $("ch-empty").hidden = state.slots.length > 0;
    $("ch-progression-text").textContent = state.slots.map((s) => label(s.degree).name.symbol).join(" – ");
  }

  // ── playback ──
  let playing = false, timer = 0, nextTime = 0, slotIndex = 0;
  const playBtn = $<HTMLButtonElement>("ch-play");
  function stop(): void {
    playing = false; window.clearTimeout(timer); playBtn.textContent = "▶ Play"; playBtn.setAttribute("aria-pressed", "false");
    document.querySelectorAll(".ch-slot.playing").forEach((n) => n.classList.remove("playing"));
  }
  function tick(): void {
    if (!playing) return;
    const a = audio(), beat = 60 / state.bpm;
    while (nextTime < a.currentTime + 0.4 && state.slots.length) {
      const slot = state.slots[slotIndex % state.slots.length], seconds = slot.bars * 4 * beat;
      playChord(chordFor(slot), nextTime, seconds * 0.96);
      playChord([diatonicChord(state.root, state.scale, slot.degree, 3, state.octave - 1)[0]], nextTime, seconds * 0.9, 0.28);
      const idx = slotIndex % state.slots.length, at = nextTime;
      window.setTimeout(() => { if (!playing) return; document.querySelectorAll(".ch-slot").forEach((n, i) => n.classList.toggle("playing", i === idx)); }, Math.max(0, (at - a.currentTime) * 1000));
      nextTime += seconds; slotIndex++;
    }
    timer = window.setTimeout(tick, 100);
  }
  playBtn.addEventListener("click", () => {
    if (playing) { stop(); return; }
    if (!state.slots.length) return;
    playing = true; slotIndex = 0; nextTime = audio().currentTime + 0.05; playBtn.textContent = "■ Stop"; playBtn.setAttribute("aria-pressed", "true"); tick();
  });
  $("ch-play-scale").addEventListener("click", () => {
    const a = audio(), notes = [...scale().steps, 12].map((s) => (state.octave + 1) * 12 + state.root + s);
    notes.forEach((n, i) => playChord([n], a.currentTime + i * 0.22, 0.3, 0.3));
  });

  // ── export ──
  function buildMidi(): Uint8Array {
    const chords: MidiTrack = { name: "Chords", events: [] }, bass: MidiTrack = { name: "Bass", events: [] };
    let tick = 0, order = 0;
    const note = (t: MidiTrack, ch: number, key: number, start: number, len: number, vel: number) => {
      t.events.push({ tick: start, order: order++, bytes: [0x90 | ch, key, vel] });
      t.events.push({ tick: start + len, order: -1, bytes: [0x80 | ch, key, 0] });
    };
    state.slots.forEach((slot) => {
      const len = Math.round(slot.bars * 4 * PPQ);
      chordFor(slot).forEach((n) => note(chords, 0, n, tick, len - 10, 96));
      note(bass, 1, diatonicChord(state.root, state.scale, slot.degree, 3, state.octave - 1)[0], tick, len - 10, 100);
      tick += len;
    });
    return encodeMidi([chords, bass], state.bpm, `${NOTE_NAMES[state.root]} ${scale().name}`);
  }
  $("ch-midi").addEventListener("click", () => {
    if (!state.slots.length) return;
    download(`${NOTE_NAMES[state.root].replace("♯", "sharp").replace("♭", "flat")}-${state.scale}-${state.bpm}bpm.mid`, URL.createObjectURL(new Blob([buildMidi() as BlobPart], { type: "audio/midi" })));
  });
  $("ch-copy").addEventListener("click", async () => {
    const lines = [`${NOTE_NAMES[state.root]} ${scale().name} · ${state.bpm} BPM`, ...state.slots.map((s) => { const l = label(s.degree); return `${l.numeral}  ${l.name.symbol}  (${chordFor(s).map((n) => midiName(n)).join(" ")})  ${s.bars} bar${s.bars === 1 ? "" : "s"}`; })];
    try { await navigator.clipboard.writeText(lines.join("\n")); $("ch-copy").textContent = "Copied"; setTimeout(() => { $("ch-copy").textContent = "Copy as text"; }, 1500); } catch { /* clipboard blocked */ }
  });

  // ── wiring ──
  const refresh = () => { renderScale(); renderChords(); renderProgression(); persist(); };
  rootSel.addEventListener("change", () => { state.root = Number(rootSel.value); refresh(); });
  scaleSel.addEventListener("change", () => { state.scale = scaleSel.value; state.slots = state.slots.filter((s) => s.degree < scale().steps.length); refresh(); });
  octSel.addEventListener("change", () => { state.octave = Number(octSel.value); refresh(); });
  bpmIn.addEventListener("change", () => { state.bpm = Math.max(40, Math.min(240, Number(bpmIn.value) || 120)); bpmIn.value = String(state.bpm); persist(); });
  sizeSel.addEventListener("change", () => { state.size = Number(sizeSel.value) as 3 | 4; refresh(); });
  voicingSel.addEventListener("change", () => { state.voicing = voicingSel.value as Voicing; persist(); });
  presetSel.addEventListener("change", () => {
    const p = PROGRESSIONS[Number(presetSel.value)]; if (!p) return;
    if (p.mode && scale().mode !== p.mode) { state.scale = p.mode; scaleSel.value = p.mode; }
    state.slots = p.degrees.map((d) => ({ degree: (d - 1) % scale().steps.length, inversion: 0, bars: 1 }));
    presetSel.value = ""; refresh();
  });
  $("ch-clear").addEventListener("click", () => { stop(); state.slots = []; refresh(); });
  refresh();
}
