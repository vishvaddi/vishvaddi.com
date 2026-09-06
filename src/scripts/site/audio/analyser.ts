// Track Analyser page: decode a local file, run the dsp.ts passes, render
// numbers, canvases and streaming-target verdicts. Nothing is uploaded — the
// AudioContext only ever sees an ArrayBuffer from the user's own file.
import { download } from "../calc";
import { bandShares, key, loudness, monoMix, peaks, spectral, spectralTilt, stereo, tempo, testSignal, toDb } from "./dsp";
import type { Key, Loudness, Stereo, Tempo } from "./dsp";

interface Report {
  file: string; duration: number; sampleRate: number; channels: number;
  tempo: Tempo; key: Key; loudness: Loudness; truePeakDb: number; samplePeakDb: number; clippedRuns: number;
  stereo: Stereo; bands: { name: string; share: number }[]; tiltDbPerOct: number; centroidHz: number;
}

// Targets are the platforms' published normalisation references (loudness) and
// the usual delivery ceiling (true peak). Club values are convention, not a spec.
const TARGETS: { name: string; lufs: number; tp: number; note?: string }[] = [
  { name: "Spotify", lufs: -14, tp: -1 },
  { name: "Apple Music", lufs: -16, tp: -1 },
  { name: "YouTube", lufs: -14, tp: -1 },
  { name: "Amazon Music", lufs: -14, tp: -2 },
  { name: "Tidal", lufs: -14, tp: -1 },
  { name: "Club master", lufs: -7, tp: -0.5, note: "convention: −8 to −6 LUFS" },
];

const fmt = (v: number, d = 1, unit = ""): string => (Number.isFinite(v) ? `${v.toFixed(d)}${unit}` : "—");
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export function initAnalyser(): void {
  const drop = $("au-drop"), input = $<HTMLInputElement>("au-file-input"), demo = $<HTMLButtonElement>("au-demo");
  const progress = $("au-progress"), bar = $("au-progress-bar"), status = $("au-status"), results = $("au-results");
  if (!drop || !input || !results) return;
  let busy = false, last: Report | null = null, lastChannels: Float32Array[] | null = null, lastSpectrum: Float32Array | null = null, lastBinHz = 0;

  const setProgress = (f: number, stage: string) => { bar.style.width = `${Math.round(f * 100)}%`; status.textContent = stage; };

  async function decode(file: File): Promise<AudioBuffer> {
    const bytes = await file.arrayBuffer();
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    try { return await ctx.decodeAudioData(bytes); } finally { void ctx.close(); }
  }

  async function analyse(name: string, channels: Float32Array[], fs: number): Promise<void> {
    if (busy) return; busy = true;
    results.hidden = true; progress.hidden = false; setProgress(0, "reading");
    try {
      await new Promise((r) => setTimeout(r, 0));
      setProgress(0.05, "loudness");
      const loud = loudness(channels, fs);
      await new Promise((r) => setTimeout(r, 0));
      setProgress(0.25, "true peak");
      const pk = peaks(channels);
      await new Promise((r) => setTimeout(r, 0));
      setProgress(0.35, "stereo");
      const st = stereo(channels);
      const mono = monoMix(channels);
      const spec = await spectral(mono, fs, (f, stage) => setProgress(0.4 + f * 0.55, stage));
      setProgress(0.97, "tempo and key");
      const tp = tempo(spec.onset, spec.fps);
      const k = key(spec.chroma);
      last = {
        file: name, duration: channels[0].length / fs, sampleRate: fs, channels: channels.length,
        tempo: tp, key: k, loudness: loud, truePeakDb: toDb(pk.truePeak), samplePeakDb: toDb(pk.samplePeak), clippedRuns: pk.clippedRuns,
        stereo: st, bands: bandShares(spec.spectrum, spec.binHz), tiltDbPerOct: spectralTilt(spec.spectrum, spec.binHz), centroidHz: spec.centroidHz,
      };
      lastChannels = channels; lastSpectrum = spec.spectrum; lastBinHz = spec.binHz;
      render(last);
      setProgress(1, "done");
    } catch (err) {
      status.textContent = `Could not analyse this file: ${(err as Error).message || err}`;
      bar.style.width = "0%";
    } finally {
      busy = false;
      if (last) setTimeout(() => { progress.hidden = true; }, 600);
    }
  }

  async function analyseFile(file: File): Promise<void> {
    progress.hidden = false; setProgress(0, "decoding");
    try {
      const buffer = await decode(file);
      const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
      await analyse(file.name, channels, buffer.sampleRate);
    } catch (err) {
      status.textContent = `This browser could not decode ${file.name} (${(err as Error).message || "unsupported format"}).`;
    }
  }

  function render(r: Report): void {
    // Browsers resample on decode, so this is the analysis rate, not the file's.
    $("au-file").textContent = `${r.file} · ${fmt(r.duration, 1, " s")} · decoded at ${r.sampleRate} Hz · ${r.channels === 1 ? "mono" : "stereo"}`;
    const set = (id: string, value: string, sub = "") => { $(id).textContent = value; const s = $(`${id}-sub`); if (s) s.textContent = sub; };
    set("au-bpm", r.tempo.bpm ? fmt(r.tempo.bpm, 1) : "—", r.tempo.alternatives.length ? `or ${r.tempo.alternatives.slice(0, 2).map((a) => a.bpm).join(" / ")}` : "");
    set("au-key", r.key.best.name, `${Math.round(r.key.confidence * 100)}% sure · next ${r.key.candidates[1].name}`);
    set("au-camelot", r.key.best.camelot, `mix with ${r.key.compatible.join(", ")}`);
    set("au-lufs", fmt(r.loudness.integrated), "integrated");
    set("au-tp", fmt(r.truePeakDb), `sample ${fmt(r.samplePeakDb)} dBFS`);
    set("au-lra", fmt(r.loudness.range), "LU");
    set("au-st", fmt(r.loudness.shortTermMax), "3 s max");
    set("au-mom", fmt(r.loudness.momentaryMax), "400 ms max");
    set("au-corr", r.stereo.mono ? "mono" : fmt(r.stereo.correlation, 2), r.stereo.mono ? "" : r.stereo.correlation < 0.2 ? "phase risk" : "");
    set("au-width", r.stereo.mono ? "—" : fmt(r.stereo.widthDb, 1, " dB"), r.stereo.mono ? "" : `balance ${r.stereo.balanceDb >= 0 ? "R" : "L"} ${fmt(Math.abs(r.stereo.balanceDb), 1)} dB`);
    set("au-tilt", fmt(r.tiltDbPerOct, 1, " dB/oct"), `centroid ${Math.round(r.centroidHz)} Hz`);

    const tbody = $("au-targets"); tbody.replaceChildren();
    for (const t of TARGETS) {
      const gain = t.lufs - r.loudness.integrated;
      const tpAfter = r.truePeakDb + gain;
      const tr = document.createElement("tr");
      const verdict = !Number.isFinite(gain) ? "no signal" : Math.abs(gain) <= 1 && r.truePeakDb <= t.tp ? "ready" : gain < -1 ? `platform turns it down ${fmt(-gain)} dB` : tpAfter > t.tp ? `needs ${fmt(gain)} dB and a limiter (peak would hit ${fmt(tpAfter)} dBTP)` : `add ${fmt(gain)} dB`;
      tr.innerHTML = `<td>${t.name}</td><td>${t.lufs} LUFS</td><td>${t.tp} dBTP</td><td>${Number.isFinite(gain) ? (gain >= 0 ? "+" : "") + fmt(gain) : "—"} dB</td><td class="${verdict === "ready" ? "au-ok" : ""}">${verdict}${t.note ? ` <small>(${t.note})</small>` : ""}</td>`;
      tbody.append(tr);
    }

    const bands = $("au-bands"); bands.replaceChildren();
    const maxShare = Math.max(...r.bands.map((b) => b.share), 0.01);
    for (const b of r.bands) {
      const row = document.createElement("div"); row.className = "au-band";
      row.innerHTML = `<span class="au-band-name">${b.name}</span><span class="au-band-bar"><span style="width:${(b.share / maxShare) * 100}%"></span></span><span class="au-band-pct">${(b.share * 100).toFixed(1)}%</span>`;
      bands.append(row);
    }

    const notes: string[] = [];
    if (r.clippedRuns) notes.push(`${r.clippedRuns} clipped run${r.clippedRuns === 1 ? "" : "s"} (3+ consecutive samples at full scale). Lower the input or the limiter ceiling.`);
    if (r.truePeakDb > -1) notes.push(`True peak ${fmt(r.truePeakDb)} dBTP is above the usual −1 dBTP delivery ceiling; lossy encoders can overshoot.`);
    if (!r.stereo.mono && r.stereo.correlation < 0.2) notes.push("Low stereo correlation: check the mix in mono, low end may cancel.");
    if (!r.stereo.mono && Math.abs(r.stereo.balanceDb) > 1.5) notes.push(`Stereo balance leans ${r.stereo.balanceDb > 0 ? "right" : "left"} by ${fmt(Math.abs(r.stereo.balanceDb))} dB.`);
    if (Math.abs(r.stereo.dcOffset) > 0.005) notes.push(`DC offset ${r.stereo.dcOffset.toFixed(4)}: add a high-pass at 20 Hz.`);
    if (r.tempo.confidence < 0.25) notes.push("Tempo confidence is low. Ambient or rubato material has no steady pulse to lock to; treat the BPM as a guess.");
    if (r.key.confidence < 0.15) notes.push("Key confidence is low. The top candidates are close; trust your ears over the label.");
    if (r.loudness.range > 15) notes.push(`Loudness range ${fmt(r.loudness.range)} LU is wide for streaming; quiet passages may get lost on phones.`);
    if (Number.isFinite(r.loudness.integrated) && r.loudness.integrated > -8) notes.push("Very loud master. Streaming platforms will turn it down, and the limiting may be audible.");
    const ul = $("au-notes"); ul.replaceChildren();
    for (const n of notes) { const li = document.createElement("li"); li.textContent = n; ul.append(li); }
    $("au-notes-wrap").hidden = notes.length === 0;

    results.hidden = false;
    drawWaveform(); drawSpectrum();
  }

  function drawWaveform(): void {
    const canvas = $<HTMLCanvasElement>("au-wave"); if (!canvas || !lastChannels || !last) return;
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 120, scale = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * scale); canvas.height = Math.floor(h * scale);
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.scale(scale, scale);
    const style = getComputedStyle(canvas);
    const accent = style.getPropertyValue("--site-accent").trim() || "#2c63d6", muted = style.getPropertyValue("--muted").trim() || "#888";
    ctx.clearRect(0, 0, w, h);
    const mono = lastChannels[0], stride = Math.max(1, Math.floor(mono.length / w));
    ctx.fillStyle = accent;
    for (let x = 0; x < w; x++) {
      let peak = 0;
      const start = x * stride, end = Math.min(mono.length, start + stride);
      for (let i = start; i < end; i += 4) { const a = Math.abs(mono[i]); if (a > peak) peak = a; }
      const y = peak * (h / 2 - 2);
      ctx.fillRect(x, h / 2 - y, 1, Math.max(1, y * 2));
    }
    // short-term loudness trace, −40…0 LUFS mapped to the canvas height
    const st = last.loudness.shortTerm;
    if (st.length > 1) {
      ctx.strokeStyle = muted; ctx.lineWidth = 1.5; ctx.beginPath();
      st.forEach((v, i) => {
        const x = (i / (st.length - 1)) * w, y = h - Math.max(0, Math.min(1, (v + 40) / 40)) * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }

  function drawSpectrum(): void {
    const canvas = $<HTMLCanvasElement>("au-spectrum"); if (!canvas || !lastSpectrum) return;
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 160, scale = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * scale); canvas.height = Math.floor(h * scale);
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.scale(scale, scale);
    const style = getComputedStyle(canvas);
    const accent = style.getPropertyValue("--site-accent").trim() || "#2c63d6", muted = style.getPropertyValue("--muted").trim() || "#888";
    ctx.clearRect(0, 0, w, h);
    const fMin = 20, fMax = 20000, xOf = (f: number) => (Math.log10(f / fMin) / Math.log10(fMax / fMin)) * w;
    ctx.strokeStyle = muted; ctx.globalAlpha = 0.25; ctx.lineWidth = 1; ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = muted;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = xOf(f); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 2, h - 3); }
    ctx.globalAlpha = 1;
    let maxDb = -Infinity;
    const dbs = new Float32Array(lastSpectrum.length);
    for (let k = 1; k < lastSpectrum.length; k++) { dbs[k] = 10 * Math.log10(lastSpectrum[k] + 1e-12); if (dbs[k] > maxDb) maxDb = dbs[k]; }
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.beginPath();
    let started = false;
    for (let k = 1; k < lastSpectrum.length; k++) {
      const f = k * lastBinHz; if (f < fMin || f > fMax) continue;
      const y = h - Math.max(0, Math.min(1, (dbs[k] - (maxDb - 70)) / 70)) * (h - 14);
      if (!started) { ctx.moveTo(xOf(f), y); started = true; } else ctx.lineTo(xOf(f), y);
    }
    ctx.stroke();
  }

  function reportText(r: Report): string {
    const lines = [
      `# Track analysis — ${r.file}`, "",
      `Duration ${fmt(r.duration, 1)} s · ${r.sampleRate} Hz · ${r.channels === 1 ? "mono" : "stereo"}`,
      `Tempo ${fmt(r.tempo.bpm, 1)} BPM (confidence ${Math.round(r.tempo.confidence * 100)}%${r.tempo.alternatives.length ? `, alternatives ${r.tempo.alternatives.map((a) => a.bpm).join(" / ")}` : ""})`,
      `Key ${r.key.best.name} · Camelot ${r.key.best.camelot} (confidence ${Math.round(r.key.confidence * 100)}%, mixes with ${r.key.compatible.join(", ")})`,
      `Loudness ${fmt(r.loudness.integrated)} LUFS integrated · short-term max ${fmt(r.loudness.shortTermMax)} · momentary max ${fmt(r.loudness.momentaryMax)} · LRA ${fmt(r.loudness.range)} LU`,
      `Peaks ${fmt(r.truePeakDb)} dBTP true · ${fmt(r.samplePeakDb)} dBFS sample · clipped runs ${r.clippedRuns}`,
      r.stereo.mono ? "Mono file" : `Stereo correlation ${fmt(r.stereo.correlation, 2)} · width ${fmt(r.stereo.widthDb)} dB (S/M) · balance ${fmt(r.stereo.balanceDb)} dB`,
      `Tonal balance ${r.bands.map((b) => `${b.name} ${(b.share * 100).toFixed(1)}%`).join(", ")} · tilt ${fmt(r.tiltDbPerOct)} dB/oct · centroid ${Math.round(r.centroidHz)} Hz`, "",
      "Targets:",
      ...TARGETS.map((t) => `- ${t.name}: ${t.lufs} LUFS / ${t.tp} dBTP → gain ${fmt(t.lufs - r.loudness.integrated)} dB`),
    ];
    return lines.join("\n");
  }

  // ── wiring ──
  input.addEventListener("change", () => { const f = input.files?.[0]; if (f) void analyseFile(f); input.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const f = (e as DragEvent).dataTransfer?.files?.[0]; if (f) void analyseFile(f); });
  demo?.addEventListener("click", () => { void analyse("test tone (128 BPM, A minor)", testSignal(44100, 20, 128, 57), 44100); });
  $("au-copy")?.addEventListener("click", async () => {
    if (!last) return;
    try { await navigator.clipboard.writeText(reportText(last)); $("au-copy").textContent = "Copied"; setTimeout(() => { $("au-copy").textContent = "Copy report"; }, 1500); } catch { /* clipboard blocked; the JSON download still works */ }
  });
  $("au-json")?.addEventListener("click", () => {
    if (!last) return;
    const { loudness: l, ...rest } = last;
    const slim = { ...rest, loudness: { integrated: l.integrated, shortTermMax: l.shortTermMax, momentaryMax: l.momentaryMax, range: l.range } };
    download(`${last.file.replace(/\.[^.]+$/, "")}-analysis.json`, URL.createObjectURL(new Blob([JSON.stringify(slim, null, 2)], { type: "application/json" })));
  });
  window.addEventListener("resize", () => { if (!results.hidden) { drawWaveform(); drawSpectrum(); } });
}
