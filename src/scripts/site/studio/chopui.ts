// Chop / sample capture: load or record a break, slice it (equal / transient /
// manual), audition slices, sync project BPM to the break, assign slices to a
// pad bank and optionally write them as a pattern. Also the vinyl scratchpad,
// which falls back to the loaded break when the selected pad has no sample.

import {
  STEPS, SCENE_LABELS, PAD_BANK_SIZE, clip, transport,
  padEvents, sampleParams, sampleBuffers, sampleData, mpc,
} from "./state";
import { ac, ensureNodes, reversedBuffer } from "./engine";
import * as engine from "./engine";
import { saveAll } from "./persistence";
import {
  el, btn, help,
  dataUrlToBytes, readAsDataUrl, blobAsDataUrl,
  equalSlices, transientSlices, snapZero, drawWaveform, encodeWav,
} from "./helpers";
import { ctx } from "./ctx";

export interface ChopUI {
  chop: HTMLElement;
  waveform: HTMLCanvasElement;
  scratchPanel: HTMLElement;
}

export function buildChop(): ChopUI {
  const chop = el("div", "wa-panel");
  const chopToolbar = el("div", "wa-chop-toolbar");
  const chopInput = document.createElement("input"); chopInput.type = "file"; chopInput.accept = "audio/*"; chopInput.hidden = true;
  const loadBreakBtn = btn("Load break"), micBtn = btn("Record mic"), equalBtn = btn("Equal"), transientBtn = btn("Transient"), clearSlicesBtn = btn("Manual");
  const assignSlicesBtn = btn("Assign to bank"), patternBtn = btn("Assign + pattern"), normaliseBtn = btn("Normalise"), syncBpmBtn = btn("Sync BPM");
  const sliceCountSel = document.createElement("select");
  [4, 8, 12, 16].forEach((n) => { const o = document.createElement("option"); o.value = String(n); o.textContent = `${n} slices`; sliceCountSel.append(o); });
  sliceCountSel.value = "16";
  help(loadBreakBtn, "Load an audio file into the chop editor.");
  help(micBtn, "Record from the microphone, then chop the recording like any other sample.");
  help(sliceCountSel, "How many slices Equal and Transient aim for.");
  help(equalBtn, "Split the audio into equal-length slices.");
  help(transientBtn, "Detect strong attacks and use them as slice boundaries.");
  help(clearSlicesBtn, "Start with one region, then click the waveform to add slice markers.");
  help(normaliseBtn, "Raise the break to peak level without changing its relative dynamics.");
  help(syncBpmBtn, "Set the project tempo to the detected tempo of the loaded break.");
  help(assignSlicesBtn, "Map the current slices across all 16 pads in the selected bank.");
  help(patternBtn, "Assign the slices AND write them in order into this scene's pad sequence — instant break replay, ready to rearrange.");
  const chopStatus = el("span", "wa-status", "Select a pad or load a break");
  const waveform = document.createElement("canvas"); waveform.className = "wa-waveform";
  help(waveform, "Waveform chop editor. Click a slice to audition it; in Manual mode clicking also adds a marker.");
  let chopBuffer: AudioBuffer | null = null, chopData: string | null = null, chopName = "", slices: Array<[number, number]> = equalSlices(16);
  let chopBpm: number | null = null, chopManual = false, selectedSlice = -1;
  let slicePreview: AudioBufferSourceNode | null = null;
  ctx.chopBuffer = () => chopBuffer;
  const sliceCount = (): number => Number(sliceCountSel.value);
  function refreshWaveform(): void { if (chopBuffer) drawWaveform(waveform, chopBuffer, slices, selectedSlice); }
  // Assume a 4/4 break of 1–8 bars; among the plausible bar counts pick the
  // tempo nearest the current project BPM (jungle at 170 finds the 2-bar amen,
  // boom bap at 90 finds the 1-bar loop).
  function guessBreakBpm(duration: number): number | null {
    let best: number | null = null;
    for (const bars of [1, 2, 4, 8]) {
      const bpm = (bars * 4 * 60) / duration;
      if (bpm < 50 || bpm > 220) continue;
      if (best === null || Math.abs(bpm - transport.bpm) < Math.abs(best - transport.bpm)) best = bpm;
    }
    return best;
  }
  function playSlice(index: number): void {
    if (!chopBuffer || !slices[index]) return;
    ensureNodes();
    const [start, end] = slices[index];
    try { slicePreview?.stop(); } catch { /* not playing */ }
    const a = ac(), src = a.createBufferSource(), g = a.createGain();
    src.buffer = chopBuffer; g.gain.value = 0.9;
    src.connect(g); g.connect(engine.master!);
    src.start(a.currentTime, start * chopBuffer.duration, Math.max(0.02, (end - start) * chopBuffer.duration));
    slicePreview = src;
    selectedSlice = index; refreshWaveform();
  }
  async function setChopSource(data: string, name: string): Promise<void> {
    chopBuffer = await ac().decodeAudioData(dataUrlToBytes(data)); chopData = data; chopName = name; slices = equalSlices(sliceCount());
    chopBpm = guessBreakBpm(chopBuffer.duration); syncBpmBtn.disabled = chopBpm === null;
    chopManual = false; selectedSlice = -1;
    chopStatus.textContent = `${name} · ${chopBuffer.duration.toFixed(2)}s${chopBpm ? ` · ≈${Math.round(chopBpm)} BPM` : ""}`;
    refreshWaveform();
  }
  syncBpmBtn.disabled = true;
  syncBpmBtn.addEventListener("click", () => {
    if (chopBpm === null) return;
    ctx.setBpm(Math.round(chopBpm)); saveAll();
    chopStatus.textContent = `Project tempo set to ${Math.round(chopBpm)} BPM`;
  });
  loadBreakBtn.addEventListener("click", () => chopInput.click());
  chopInput.addEventListener("change", async () => {
    const file = chopInput.files?.[0]; if (!file) return;
    try { await setChopSource(await readAsDataUrl(file), file.name); } catch { chopStatus.textContent = "Could not decode audio"; }
  });
  micBtn.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { chopStatus.textContent = "Recording is not supported here"; return; }
    if (micBtn.classList.contains("active")) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [], recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType });
        try { await setChopSource(await blobAsDataUrl(blob), `mic-${Date.now()}.webm`); } catch { chopStatus.textContent = "Could not decode recording"; }
        micBtn.classList.remove("active"); micBtn.textContent = "Record mic";
      };
      recorder.start(); micBtn.classList.add("active"); micBtn.textContent = "Stop recording"; chopStatus.textContent = "Recording...";
      const stop = () => { if (recorder.state === "recording") recorder.stop(); micBtn.removeEventListener("click", stop); };
      micBtn.addEventListener("click", stop);
    } catch { chopStatus.textContent = "Microphone permission was not granted"; }
  });
  equalBtn.addEventListener("click", () => { chopManual = false; selectedSlice = -1; slices = equalSlices(sliceCount()); refreshWaveform(); });
  transientBtn.addEventListener("click", () => { if (chopBuffer) { chopManual = false; selectedSlice = -1; slices = transientSlices(chopBuffer, sliceCount()); refreshWaveform(); } });
  clearSlicesBtn.addEventListener("click", () => { chopManual = true; selectedSlice = -1; slices = [[0, 1]]; refreshWaveform(); chopStatus.textContent = "Click the waveform to add slice markers"; });
  waveform.addEventListener("click", (event) => {
    if (!chopBuffer) return;
    const rect = waveform.getBoundingClientRect(), position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    if (chopManual) {
      const starts = [...slices.map(([start]) => start), position].filter((value, i, all) => all.indexOf(value) === i).sort((a, b) => a - b).slice(0, 16);
      slices = starts.map((start, i) => [start, starts[i + 1] ?? 1]);
    }
    playSlice(slices.findIndex(([start, end]) => position >= start && position < end));
  });
  function assignSlices(): boolean {
    if (!chopData || !chopBuffer) { chopStatus.textContent = "Load a break first"; return false; }
    ctx.checkpoint();
    const bankStart = mpc.bank * PAD_BANK_SIZE;
    slices.slice(0, PAD_BANK_SIZE).forEach(([start, end], i) => {
      const pad = bankStart + i;
      const snappedStart = snapZero(chopBuffer!, start), snappedEnd = Math.max(snappedStart + 0.001, snapZero(chopBuffer!, end));
      sampleData[pad] = chopData; sampleBuffers[pad] = chopBuffer;
      Object.assign(sampleParams[pad], {
        name: `${chopName} ${i + 1}`, start: snappedStart, end: Math.min(1, snappedEnd),
        reverse: false, loop: false, sourceBpm: chopBpm ? Math.round(chopBpm) : transport.bpm,
      });
    });
    ctx.paintMpcPads(); saveAll(); chopStatus.textContent = `${Math.min(16, slices.length)} slices assigned to Bank ${"ABCD"[mpc.bank]}`;
    return true;
  }
  assignSlicesBtn.addEventListener("click", () => { assignSlices(); });
  patternBtn.addEventListener("click", () => {
    if (!assignSlices()) return;
    // Replay the break in slice order across the scene, ReCycle-style: each
    // slice lands on its grid position and rings until the next one.
    const bankStart = mpc.bank * PAD_BANK_SIZE;
    const count = Math.min(PAD_BANK_SIZE, slices.length);
    padEvents[clip.sel] = Array.from({ length: count }, (_, i) => ({
      pad: bankStart + i, step: Math.round((i * STEPS) / count) % STEPS,
      velocity: 110, offset: 0, probability: 100, ratchets: 1,
    }));
    if (clip.play.pads === null) clip.play.pads = clip.sel;
    ctx.paintEventLane(); ctx.paintSession(); saveAll();
    chopStatus.textContent = `Break assigned to Bank ${"ABCD"[mpc.bank]} and written to scene ${SCENE_LABELS[clip.sel]}`;
  });
  normaliseBtn.addEventListener("click", async () => {
    if (!chopBuffer) return;
    let peak = 0;
    for (let c = 0; c < chopBuffer.numberOfChannels; c++) {
      const data = chopBuffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    }
    if (peak <= 0 || peak >= 0.999) return;
    const normalised = ac().createBuffer(chopBuffer.numberOfChannels, chopBuffer.length, chopBuffer.sampleRate);
    for (let c = 0; c < chopBuffer.numberOfChannels; c++) {
      const source = chopBuffer.getChannelData(c), target = normalised.getChannelData(c);
      for (let i = 0; i < source.length; i++) target[i] = source[i] / peak;
    }
    chopBuffer = normalised; chopData = await blobAsDataUrl(encodeWav(normalised)); refreshWaveform(); chopStatus.textContent = "Normalised";
  });
  chopToolbar.append(loadBreakBtn, micBtn, sliceCountSel, equalBtn, transientBtn, clearSlicesBtn, normaliseBtn, syncBpmBtn, assignSlicesBtn, patternBtn, chopInput, chopStatus);
  chop.append(chopToolbar, waveform, el("p", "wa-help", "Chopping is non-destructive — click a slice to hear it. Sync BPM matches the project tempo to the break; Assign + pattern replays the chopped break on the pads, ready to rearrange in the Sequence lane."));

  // ── Vinyl scratchpad — drag the platter to scratch the selected pad's sample
  // (or the loaded break) over whatever's playing. Forward drags play the buffer
  // forwards; backward drags play a reversed copy. Rate tracks hand speed. ──
  const scratchPanel = el("div", "wa-panel");
  const platter = el("div", "wa-scratch");
  const disc = el("div", "wa-scratch-disc");
  disc.append(el("div", "wa-scratch-label", "VV"));
  platter.append(disc);
  scratchPanel.append(
    el("p", "wa-help", "Drag the record left/right to scratch the selected pad's sample over the beat. Forward and backward both sound. Release to stop."),
    platter,
  );

  let scGain: GainNode | null = null, scFwd: AudioBuffer | null = null, scRev: AudioBuffer | null = null;
  let scSrc: AudioBufferSourceNode | null = null, scDir = 1, scPos = 0, scStartT = 0, scStartPos = 0;
  let scDragging = false, scLastX = 0, scLastT = 0, scAngle = 0, scIdle = 0;
  const scBuffer = (): AudioBuffer | null => sampleBuffers[mpc.selectedPad] || chopBuffer || null;
  const scStop = (): void => { if (scSrc) { try { scSrc.stop(); } catch { /* already stopped */ } try { scSrc.disconnect(); } catch { /* noop */ } scSrc = null; } };
  const scNow = (a: AudioContext, dur: number): number => {
    if (!scSrc) return scPos;
    const elapsed = (a.currentTime - scStartT) * scSrc.playbackRate.value;
    return (((scStartPos + scDir * elapsed) % dur) + dur) % dur;
  };
  const scStart = (a: AudioContext, rate: number, dir: number, dur: number): void => {
    scStop();
    const b = dir > 0 ? scFwd : scRev; if (!b) return;
    const src = a.createBufferSource();
    src.buffer = b; src.loop = true; src.loopStart = 0; src.loopEnd = dur;
    src.playbackRate.value = Math.max(0.05, Math.min(8, Math.abs(rate)));
    if (!scGain) { scGain = a.createGain(); scGain.gain.value = 0.9; scGain.connect(engine.master!); }
    src.connect(scGain);
    const offset = dir > 0 ? scPos : dur - scPos;
    src.start(0, Math.max(0, Math.min(dur - 0.001, offset)));
    scSrc = src; scDir = dir; scStartT = a.currentTime; scStartPos = scPos;
  };
  const scBegin = (x: number): void => {
    const b = scBuffer(); if (!b) return;
    ensureNodes(); const a = ac(); if (a.state === "suspended") void a.resume();
    scFwd = b; scRev = reversedBuffer(a, b);
    scDragging = true; scLastX = x; scLastT = performance.now();
  };
  const scMove = (x: number): void => {
    if (!scDragging || !scFwd) return;
    const a = ac(), dur = scFwd.duration, now = performance.now();
    const dt = Math.max(8, now - scLastT), dx = x - scLastX;
    scLastX = x; scLastT = now;
    scAngle += dx * 0.6; disc.style.transform = `rotate(${scAngle}deg)`;
    const rate = (dx / dt) * 6;
    scPos = scNow(a, dur);
    const dir = rate >= 0 ? 1 : -1;
    // Sound only while the hand is moving — if no move fires for ~70ms, hold/stop.
    window.clearTimeout(scIdle);
    scIdle = window.setTimeout(() => { if (scFwd) scPos = scNow(ac(), scFwd.duration); scStop(); }, 70);
    if (Math.abs(rate) < 0.05) { scStop(); return; }
    if (!scSrc || dir !== scDir) scStart(a, rate, dir, dur);
    else scSrc.playbackRate.value = Math.min(8, Math.abs(rate));
  };
  const scEnd = (): void => {
    if (!scDragging) return;
    scDragging = false;
    window.clearTimeout(scIdle);
    if (scFwd) scPos = scNow(ac(), scFwd.duration);
    scStop();
  };
  platter.addEventListener("pointerdown", (e) => { e.preventDefault(); try { platter.setPointerCapture(e.pointerId); } catch { /* noop */ } scBegin(e.clientX); });
  platter.addEventListener("pointermove", (e) => scMove(e.clientX));
  platter.addEventListener("pointerup", scEnd);
  platter.addEventListener("pointercancel", scEnd);

  return { chop, waveform, scratchPanel };
}
