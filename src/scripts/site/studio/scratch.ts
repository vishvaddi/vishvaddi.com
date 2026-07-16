// Vinyl scratchpad — drag the platter to scratch the selected pad's sample
// (or the loaded break) over whatever's playing. Forward drags play the buffer
// forwards; backward drags play a reversed copy. Rate tracks hand speed.
// Extracted verbatim from index.ts (Phase 0 split); the chop-tab buffer comes
// in through a getter because it lives in the chop module's closure.
import { mpc, sampleBuffers } from "./state";
import { ac, ensureNodes, reversedBuffer } from "./engine";
import * as engine from "./engine";
import { el } from "./helpers";

export function buildScratchpad(getExtraBuffer: () => AudioBuffer | null): HTMLElement {
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
  const scBuffer = (): AudioBuffer | null => sampleBuffers[mpc.selectedPad] || getExtraBuffer() || null;
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

  return scratchPanel;
}
