// BPM maths: note-value times for delays and LFOs, reverb starting points,
// bars ↔ seconds ↔ samples, Hz ↔ note ↔ MIDI. Pure arithmetic on the page.
import { nearestNote } from "./pitch";

const STORE = "vv_audio_tempo";
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const fmt = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d) : "—");

export function initBpmMaths(): void {
  const bpmIn = $<HTMLInputElement>("bm-bpm"), sigSel = $<HTMLSelectElement>("bm-sig"), rateSel = $<HTMLSelectElement>("bm-rate");
  if (!bpmIn) return;
  try { const saved = Number(localStorage.getItem(STORE)); if (saved >= 40 && saved <= 300) bpmIn.value = String(saved); } catch { /* ignore */ }

  const bpm = (): number => Math.max(20, Math.min(400, Number(bpmIn.value) || 120));
  const beatsPerBar = (): number => { const [n, d] = sigSel.value.split("/").map(Number); return n * (4 / d); };
  const beatSeconds = (): number => 60 / bpm();
  const barSeconds = (): number => beatSeconds() * beatsPerBar();

  function renderNotes(): void {
    const tbody = $("bm-notes"); tbody.replaceChildren();
    const beat = beatSeconds();
    [["1/1", 4], ["1/2", 2], ["1/4", 1], ["1/8", 0.5], ["1/16", 0.25], ["1/32", 0.125], ["1/64", 0.0625]].forEach(([label, beats]) => {
      const straight = beat * (beats as number), dotted = straight * 1.5, triplet = straight * (2 / 3);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${label}</td><td>${fmt(straight * 1000)} ms</td><td>${fmt(dotted * 1000)} ms</td><td>${fmt(triplet * 1000)} ms</td><td class="bm-hz">${fmt(1 / straight, 3)} Hz</td>`;
      tbody.append(tr);
    });
  }
  function renderReverb(): void {
    const bar = barSeconds(), beat = beatSeconds();
    // Working conventions, not physics: pre-delay a 1/64–1/128 so the transient stays ahead of the wash;
    // decay in bars so the tail lands on the grid. Producers tune from here by ear.
    const rows: [string, number, number][] = [["Tight room", beat / 16, beat * 1], ["Small plate", beat / 8, bar * 0.5], ["Hall", beat / 4, bar * 1], ["Big wash", beat / 2, bar * 2]];
    const tbody = $("bm-reverb"); tbody.replaceChildren();
    rows.forEach(([name, pre, decay]) => { const tr = document.createElement("tr"); tr.innerHTML = `<td>${name}</td><td>${fmt(pre * 1000)} ms</td><td>${fmt(decay, 2)} s</td>`; tbody.append(tr); });
  }
  function renderBars(): void {
    const bars = Number($<HTMLInputElement>("bm-bars").value) || 0, rate = Number(rateSel.value);
    const seconds = bars * barSeconds();
    $("bm-bars-out").textContent = `${fmt(seconds, 2)} s · ${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")} · ${Math.round(seconds * rate).toLocaleString()} samples at ${rate / 1000} kHz`;
    const secs = Number($<HTMLInputElement>("bm-seconds").value) || 0;
    $("bm-seconds-out").textContent = `${fmt(secs / barSeconds(), 2)} bars · ${fmt(secs / beatSeconds(), 2)} beats`;
    const samples = Number($<HTMLInputElement>("bm-samples").value) || 0;
    $("bm-samples-out").textContent = `${fmt(samples / rate, 3)} s · ${fmt(samples / rate / beatSeconds(), 2)} beats`;
  }
  function renderPitch(): void {
    const raw = $<HTMLInputElement>("bm-pitch").value.trim();
    const out = $("bm-pitch-out");
    if (!raw) { out.textContent = ""; return; }
    let hz = NaN;
    const asNumber = Number(raw);
    const noteMatch = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(raw);
    if (noteMatch) {
      const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[noteMatch[1].toUpperCase() as "C"] ?? 0;
      const acc = /[#♯]/.test(noteMatch[2]) ? 1 : /[b♭]/.test(noteMatch[2]) ? -1 : 0;
      const midi = base + acc + (parseInt(noteMatch[3], 10) + 1) * 12;
      hz = 440 * Math.pow(2, (midi - 69) / 12);
    } else if (Number.isFinite(asNumber)) {
      hz = asNumber >= 0 && asNumber <= 127 && Number.isInteger(asNumber) && !/\./.test(raw) && asNumber < 20 ? 440 * Math.pow(2, (asNumber - 69) / 12) : asNumber;
      if (/^m/i.test(raw)) hz = 440 * Math.pow(2, (Number(raw.slice(1)) - 69) / 12);
    } else if (/^m(idi)?\s*(\d+)$/i.test(raw)) {
      hz = 440 * Math.pow(2, (Number(/(\d+)$/.exec(raw)?.[1]) - 69) / 12);
    }
    if (!Number.isFinite(hz) || hz <= 0) { out.textContent = "Enter Hz (e.g. 55), a note (A1, F#3) or MIDI (m45)."; return; }
    const n = nearestNote(hz);
    const period = 1000 / hz;
    out.textContent = `${fmt(hz, 2)} Hz · ${n.name}${n.octave} ${n.cents >= 0 ? "+" : ""}${fmt(n.cents, 0)} ¢ · MIDI ${n.midi} · period ${fmt(period, 3)} ms · wavelength ${fmt(343 / hz, 2)} m`;
  }
  const renderAll = (): void => { renderNotes(); renderReverb(); renderBars(); try { localStorage.setItem(STORE, String(bpm())); } catch { /* ignore */ } };

  // tap tempo: mean interval of the last eight taps, reset after a two-second gap
  const taps: number[] = [];
  $("bm-tap").addEventListener("click", () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now); if (taps.length > 8) taps.shift();
    if (taps.length >= 2) {
      const mean = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      bpmIn.value = String(Math.round((60000 / mean) * 10) / 10); renderAll();
    }
    $("bm-tap-count").textContent = taps.length < 2 ? "tap again…" : `${taps.length} taps`;
  });
  [bpmIn, sigSel, rateSel].forEach((n) => n.addEventListener("input", renderAll));
  ["bm-bars", "bm-seconds", "bm-samples"].forEach((id) => $(id).addEventListener("input", renderBars));
  $("bm-pitch").addEventListener("input", renderPitch);
  $("bm-half").addEventListener("click", () => { bpmIn.value = String(Math.round(bpm() / 2 * 10) / 10); renderAll(); });
  $("bm-double").addEventListener("click", () => { bpmIn.value = String(Math.round(bpm() * 2 * 10) / 10); renderAll(); });
  renderAll(); renderPitch();
}
