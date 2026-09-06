// Tuner + metronome. The metronome schedules clicks ahead on the audio clock
// (never on setTimeout alone); the tuner runs the pitch detector on a mic tap.
import { detectPitch, nearestNote } from "./pitch";

const STORE = "vv_audio_tempo";
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export function initMetronome(): void {
  const bpmIn = $<HTMLInputElement>("mt-bpm"), beatsSel = $<HTMLSelectElement>("mt-beats"), subSel = $<HTMLSelectElement>("mt-sub"), polySel = $<HTMLSelectElement>("mt-poly");
  const playBtn = $<HTMLButtonElement>("mt-play"), dots = $("mt-dots"), volIn = $<HTMLInputElement>("mt-vol");
  if (!bpmIn || !playBtn) return;
  try { const saved = Number(localStorage.getItem(STORE)); if (saved >= 40 && saved <= 300) bpmIn.value = String(saved); } catch { /* ignore */ }

  let ctx: AudioContext | null = null;
  const audio = (): AudioContext => {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  };
  const bpm = (): number => Math.max(20, Math.min(400, Number(bpmIn.value) || 120));
  const click = (when: number, hz: number, level: number, length = 0.03): void => {
    const a = audio(), o = a.createOscillator(), g = a.createGain();
    o.type = "square"; o.frequency.value = hz;
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(level * Number(volIn.value), when + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, when + length);
    o.connect(g).connect(a.destination); o.start(when); o.stop(when + length + 0.01);
  };

  // ── metronome scheduler ──
  let playing = false, timer = 0, nextBeat = 0, beatIndex = 0;
  function paintDots(): void {
    const beats = Number(beatsSel.value);
    dots.replaceChildren();
    for (let i = 0; i < beats; i++) { const d = document.createElement("span"); d.className = "mt-dot" + (i === 0 ? " accent" : ""); dots.append(d); }
  }
  function schedule(): void {
    if (!playing) return;
    const a = audio(), beat = 60 / bpm(), beats = Number(beatsSel.value), sub = Number(subSel.value), poly = Number(polySel.value);
    while (nextBeat < a.currentTime + 0.25) {
      const inBar = beatIndex % beats;
      click(nextBeat, inBar === 0 ? 1600 : 1000, inBar === 0 ? 0.9 : 0.6);
      for (let s = 1; s < sub; s++) click(nextBeat + (beat * s) / sub, 2200, 0.25, 0.015);
      // polyrhythm: N evenly spaced hits per bar on a lower voice, laid out once at the bar start
      if (poly > 0 && inBar === 0) { const bar = beat * beats; for (let p = 0; p < poly; p++) click(nextBeat + (bar * p) / poly, 520, 0.7, 0.05); }
      const at = nextBeat, idx = inBar;
      window.setTimeout(() => { if (!playing) return; dots.querySelectorAll(".mt-dot").forEach((d, i) => d.classList.toggle("on", i === idx)); }, Math.max(0, (at - a.currentTime) * 1000));
      nextBeat += beat; beatIndex++;
    }
    timer = window.setTimeout(schedule, 60);
  }
  function stop(): void { playing = false; window.clearTimeout(timer); playBtn.textContent = "▶ Start"; playBtn.setAttribute("aria-pressed", "false"); dots.querySelectorAll(".mt-dot").forEach((d) => d.classList.remove("on")); }
  playBtn.addEventListener("click", () => {
    if (playing) { stop(); return; }
    playing = true; beatIndex = 0; nextBeat = audio().currentTime + 0.05; playBtn.textContent = "■ Stop"; playBtn.setAttribute("aria-pressed", "true"); schedule();
  });
  beatsSel.addEventListener("change", paintDots);
  bpmIn.addEventListener("input", () => { try { localStorage.setItem(STORE, String(bpm())); } catch { /* ignore */ } });
  const taps: number[] = [];
  $("mt-tap").addEventListener("click", () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now); if (taps.length > 8) taps.shift();
    if (taps.length >= 2) { bpmIn.value = String(Math.round(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)))); bpmIn.dispatchEvent(new Event("input")); }
  });
  paintDots();

  // ── tuner ──
  const micBtn = $<HTMLButtonElement>("tn-enable"), status = $("tn-status"), noteOut = $("tn-note"), centsOut = $("tn-cents"), needle = $("tn-needle"), hzOut = $("tn-hz"), refIn = $<HTMLInputElement>("tn-ref");
  let stream: MediaStream | null = null, analyser: AnalyserNode | null = null, raf = 0, held: ReturnType<typeof nearestNote> | null = null, holdUntil = 0;
  const frame = new Float32Array(4096);
  function tick(): void {
    if (!analyser || !ctx) return;
    analyser.getFloatTimeDomainData(frame);
    const p = detectPitch(frame, ctx.sampleRate, 30, 1500);
    const now = performance.now();
    if (p && p.clarity > 0.85) { held = nearestNote(p.hz, Number(refIn.value) || 440); holdUntil = now + 900; hzOut.textContent = `${p.hz.toFixed(1)} Hz`; }
    if (held && now < holdUntil) {
      noteOut.textContent = `${held.name}${held.octave}`;
      centsOut.textContent = `${held.cents >= 0 ? "+" : ""}${held.cents.toFixed(0)} ¢`;
      needle.style.transform = `translateX(-50%) rotate(${Math.max(-50, Math.min(50, held.cents))}deg)`;
      needle.parentElement?.classList.toggle("in-tune", Math.abs(held.cents) < 5);
    } else { noteOut.textContent = "—"; centsOut.textContent = ""; needle.parentElement?.classList.remove("in-tune"); }
    raf = requestAnimationFrame(tick);
  }
  micBtn.addEventListener("click", async () => {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; cancelAnimationFrame(raf); micBtn.textContent = "Enable microphone"; status.textContent = "Off"; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const a = audio(), src = a.createMediaStreamSource(stream);
      analyser = a.createAnalyser(); analyser.fftSize = 4096; src.connect(analyser);
      micBtn.textContent = "Disable microphone"; status.textContent = "Listening — play one note at a time";
      tick();
    } catch (err) { status.textContent = `Microphone unavailable (${(err as Error).message || "permission denied"})`; }
  });
  $("tn-play-ref").addEventListener("click", () => {
    const a = audio(), hz = held?.targetHz ?? Number(refIn.value) ?? 440, o = a.createOscillator(), g = a.createGain();
    o.type = "sine"; o.frequency.value = hz; g.gain.setValueAtTime(0.25, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 1.5);
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 1.6);
  });
}
