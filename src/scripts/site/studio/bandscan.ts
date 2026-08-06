// BAND SCAN — the studio's own spatial performance surface, replacing the
// bloom field that followed its reference too closely.
//
// The idea is a receiver sweeping a band rather than a walk through a meadow:
// X is carrier frequency, Y is bandwidth. Transmitters sit at fixed
// coordinates; as the reticle closes on one its signal strength rises and its
// note fades in, and several in range stack into a chord. Between stations you
// hear the noise floor, which is a real filtered noise source, not a graphic.
import { el, btn, help } from "./helpers";
import { ac, ensureNodes } from "./engine";
import * as engine from "./engine";
import { LiveVoices, midiToNote } from "./vsynth";
import { vsynthPatch } from "./state";

const BAND_LO = 5200, BAND_HI = 5800;          // nominal kHz, for the readout
const SCALE = [38, 41, 43, 45, 48, 50, 53, 55, 57, 60, 62, 65, 67, 69, 72];
const CALL = ["VK2", "VK3", "VK5", "VK6", "VK7", "ZL1", "ZL4", "9V1", "HS0", "YB0", "DU1", "P29", "FK8", "3D2", "A35"];

interface Station { x: number; y: number; midi: number; call: string; lock: number; held: boolean }

export interface BandScan { root: HTMLElement; setActive: (on: boolean) => void; silence: () => void }

export function buildBandScan(deps: { onReadout: (text: string) => void }): BandScan {
  const root = el("div", "wa-bandscan");
  const canvas = document.createElement("canvas"); canvas.className = "wa-bandscan-canvas";
  const rescanBtn = btn("RESCAN", "wa-btn-sm");
  help(rescanBtn, "Re-seed the band — a fresh spread of transmitters.");
  const tools = el("div", "wa-bandscan-tools"); tools.append(rescanBtn);
  root.append(canvas, tools);
  root.tabIndex = 0;

  const g = canvas.getContext("2d")!;
  const stations: Station[] = [];
  const voices = new LiveVoices();
  const keys: Record<string, boolean> = {};
  const tune = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
  const history: number[] = [];              // waterfall: recent best-signal
  let pointer: { x: number; y: number } | null = null;
  let W = 0, H = 0, DPR = 1, active = false, raf = 0, started = false;
  let noiseGain: GainNode | null = null;

  function seed(): void {
    stations.length = 0;
    for (let i = 0; i < 12; i++) {
      let x = 0, y = 0, ok = false, tries = 0;
      while (!ok && tries++ < 60) {
        x = 0.06 + Math.random() * 0.88; y = 0.12 + Math.random() * 0.76;
        ok = stations.every((s) => Math.hypot(s.x - x, (s.y - y) * 0.6) > 0.17);
      }
      stations.push({
        x, y, midi: SCALE[Math.floor(Math.random() * SCALE.length)],
        call: CALL[i % CALL.length], lock: 0, held: false,
      });
    }
  }
  const resize = (): void => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.width = Math.max(1, Math.floor(r.width * DPR));
    H = canvas.height = Math.max(1, Math.floor(r.height * DPR));
  };

  /** Signal strength 0–1 from reticle distance. Y is weighted less so the
   *  band reads as horizontal tuning rather than free roaming. */
  const strengthOf = (s: Station): number => {
    const d = Math.hypot(s.x - tune.x, (s.y - tune.y) * 0.65);
    return Math.max(0, 1 - d / 0.22);
  };

  function startAudio(): void {
    if (started) return;
    started = true;
    ensureNodes();
    const a = ac();
    // the band's noise floor — louder the further you sit from any carrier
    const buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = a.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.7;
    noiseGain = a.createGain(); noiseGain.gain.value = 0;
    src.connect(bp); bp.connect(noiseGain); noiseGain.connect(engine.synthGain!);
    src.start();
  }
  function silence(): void {
    stations.forEach((s) => { s.held = false; });
    if (engine.AC) voices.releaseAll(ac());
    if (noiseGain) noiseGain.gain.value = 0;
  }

  function step(): void {
    let ax = 0, ay = 0;
    if (keys.a || keys.arrowleft) ax -= 1;
    if (keys.d || keys.arrowright) ax += 1;
    if (keys.w || keys.arrowup) ay -= 1;
    if (keys.s || keys.arrowdown) ay += 1;
    if (pointer) {
      ax += (pointer.x - tune.x) * 6;
      ay += (pointer.y - tune.y) * 6;
    }
    // coarse across the band, fine vertically — tuning, not walking
    tune.vx = (tune.vx + ax * 0.0016) * 0.82;
    tune.vy = (tune.vy + ay * 0.0009) * 0.82;
    tune.x = Math.max(0, Math.min(1, tune.x + tune.vx));
    tune.y = Math.max(0, Math.min(1, tune.y + tune.vy));

    let best: Station | null = null, bestS = 0;
    stations.forEach((s) => {
      const strength = strengthOf(s);
      s.lock += (strength - s.lock) * 0.18;
      if (strength > bestS) { bestS = strength; best = s; }
      if (strength > 0.18 && !s.held) {
        s.held = true;
        if (started) voices.noteOn(ac(), engine.synthGain!, vsynthPatch, midiToNote(s.midi), 96);
      } else if (strength <= 0.12 && s.held) {
        s.held = false;
        if (engine.AC) voices.noteOff(ac(), midiToNote(s.midi));
      }
    });
    if (noiseGain && started) noiseGain.gain.value = Math.max(0, 0.05 * (1 - bestS));
    history.push(bestS);
    if (history.length > 160) history.shift();

    const khz = (BAND_LO + tune.x * (BAND_HI - BAND_LO)).toFixed(1);
    const locked = best as Station | null;
    deps.onReadout(locked && bestS > 0.18
      ? `${locked.call} · ${midiToNote(locked.midi)} · ${khz} kHz · S${Math.round(bestS * 9)}`
      : `${khz} kHz · no carrier · S${Math.round(bestS * 9)}`);
  }

  function draw(): void {
    if (!W) return;
    g.fillStyle = "#0e1113"; g.fillRect(0, 0, W, H);
    const padB = 26 * DPR;                    // waterfall strip along the foot
    const plotH = H - padB;

    // graticule — frequency ticks across, bandwidth divisions down
    g.strokeStyle = "rgba(95,168,138,0.1)"; g.lineWidth = 1;
    for (let i = 0; i <= 12; i++) {
      const x = (i / 12) * W;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, plotH); g.stroke();
    }
    for (let i = 1; i < 5; i++) {
      const y = (i / 5) * plotH;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    g.fillStyle = "rgba(143,139,129,0.5)"; g.font = `${8 * DPR}px ui-monospace, monospace`;
    for (let i = 0; i <= 4; i++) {
      const x = (i / 4) * W;
      g.fillText(String(Math.round(BAND_LO + (i / 4) * (BAND_HI - BAND_LO))), Math.min(W - 26 * DPR, x + 2 * DPR), plotH - 4 * DPR);
    }

    // transmitters: a blip with a lock halo, brightening as you close in
    stations.forEach((s) => {
      const x = s.x * W, y = s.y * plotH, lit = s.lock;
      if (lit > 0.01) {
        const halo = g.createRadialGradient(x, y, 0, x, y, 34 * DPR * (0.6 + lit));
        halo.addColorStop(0, `rgba(95,168,138,${0.05 + lit * 0.4})`);
        halo.addColorStop(1, "rgba(95,168,138,0)");
        g.fillStyle = halo;
        g.beginPath(); g.arc(x, y, 34 * DPR * (0.6 + lit), 0, Math.PI * 2); g.fill();
      }
      // carrier spike
      g.strokeStyle = lit > 0.2 ? "#5fa88a" : "rgba(95,168,138,0.35)";
      g.lineWidth = (1 + lit * 2) * DPR;
      g.beginPath(); g.moveTo(x, y + 7 * DPR); g.lineTo(x, y - (8 + lit * 22) * DPR); g.stroke();
      g.fillStyle = lit > 0.2 ? "#c87941" : "rgba(143,139,129,0.55)";
      g.font = `${8 * DPR}px ui-monospace, monospace`;
      g.fillText(s.call, x + 4 * DPR, y - (10 + lit * 22) * DPR);
    });

    // reticle
    const rx = tune.x * W, ry = tune.y * plotH;
    g.strokeStyle = "rgba(200,121,65,0.85)"; g.lineWidth = 1 * DPR;
    g.beginPath();
    g.moveTo(rx, 0); g.lineTo(rx, plotH);
    g.moveTo(0, ry); g.lineTo(W, ry);
    g.stroke();
    g.strokeStyle = "#c87941"; g.lineWidth = 1.4 * DPR;
    g.beginPath(); g.arc(rx, ry, 9 * DPR, 0, Math.PI * 2); g.stroke();

    // waterfall of recent signal strength
    g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, plotH, W, padB);
    const bw = W / 160;
    history.forEach((s, i) => {
      g.fillStyle = s > 0.6 ? "#5fa88a" : s > 0.25 ? "rgba(95,168,138,0.6)" : "rgba(95,168,138,0.18)";
      const h = Math.max(1, s * (padB - 6 * DPR));
      g.fillRect(i * bw, plotH + padB - 3 * DPR - h, Math.max(1, bw - 1), h);
    });
  }

  function frame(): void {
    raf = requestAnimationFrame(frame);
    if (!active || document.hidden) return;
    if (!W || canvas.getBoundingClientRect().width * DPR !== W) resize();
    step(); draw();
  }

  const fromEvent = (ev: PointerEvent): void => {
    const r = canvas.getBoundingClientRect();
    pointer = { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
  };
  canvas.addEventListener("pointerdown", (ev) => {
    ev.preventDefault(); startAudio(); root.focus();
    fromEvent(ev); canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointermove", (ev) => { if (pointer) fromEvent(ev); });
  const drop = (): void => { pointer = null; };
  canvas.addEventListener("pointerup", drop);
  canvas.addEventListener("pointercancel", drop);
  rescanBtn.addEventListener("click", () => { silence(); seed(); history.length = 0; draw(); });

  const NAV = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"];
  window.addEventListener("keydown", (ev) => {
    if (!active || root.hidden || !root.offsetParent) return;
    const k = ev.key.toLowerCase();
    if (!NAV.includes(k)) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || focused instanceof HTMLSelectElement) return;
    ev.preventDefault(); keys[k] = true; startAudio();
    step(); draw();
  });
  window.addEventListener("keyup", (ev) => { keys[ev.key.toLowerCase()] = false; });

  seed();
  return {
    root,
    silence,
    setActive: (on: boolean) => {
      active = on;
      if (on) { resize(); draw(); if (!raf) raf = requestAnimationFrame(frame); }
      else { pointer = null; Object.keys(keys).forEach((k) => { keys[k] = false; }); silence(); }
    },
  };
}
