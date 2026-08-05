// FIELD — the walkable tone world (LYSERGIC parity, B4). Glide a presence
// through a field of planted blooms: entering one sustains its note, leaving
// releases it, and overlapping blooms stack into chords. Notes run through the
// same VV-1 patch and synth bus as the keys, so every knob, device and the
// master chain apply here too.
import { el, btn, help } from "./helpers";
import { ac, ensureNodes } from "./engine";
import * as engine from "./engine";
import { LiveVoices, midiToNote } from "./vsynth";
import { vsynthPatch } from "./state";

const WORLD = 1700;
// D-major pentatonic across four octaves — always consonant with the keys.
const SCALE = [38, 40, 42, 45, 47, 50, 52, 54, 57, 59, 62, 64, 66, 69, 71, 74];
const hueOf = (midi: number): number => {
  const pc = ((midi % 12) + 12) % 12;
  const named: Record<number, number> = { 2: 186, 4: 172, 6: 196, 9: 160, 11: 204 };
  return named[pc] ?? 170 + pc * 4;
};

interface Bloom { x: number; y: number; r: number; midi: number; hue: number; inside: boolean; glow: number; phase: number; petals: number }

export interface BloomField { root: HTMLElement; setActive: (on: boolean) => void; silence: () => void }

export function buildBloomField(deps: { onReadout: (text: string) => void }): BloomField {
  const root = el("div", "wa-bloomfield");
  const canvas = document.createElement("canvas"); canvas.className = "wa-bloom-canvas";
  const mini = document.createElement("canvas"); mini.className = "wa-bloom-mini";
  mini.width = 80; mini.height = 80;
  const replantBtn = btn("REPLANT", "wa-btn-sm");
  help(replantBtn, "Scatter a fresh set of tone blooms across the field.");
  const tools = el("div", "wa-bloom-tools"); tools.append(replantBtn);
  root.append(canvas, mini, tools);
  root.tabIndex = 0;

  const g = canvas.getContext("2d")!, mg = mini.getContext("2d")!;
  const blooms: Bloom[] = [];
  const flora: Array<{ x: number; y: number; s: number; z: number; hue: number }> = [];
  const held = new Set<number>();
  const voices = new LiveVoices();
  const keys: Record<string, boolean> = {};
  let pointer: { x: number; y: number } | null = null;
  const me = { x: WORLD / 2, y: WORLD / 2, vx: 0, vy: 0 };
  const cam = { x: WORLD / 2, y: WORLD / 2 };
  let W = 0, VW = 1, DPR = 1, active = false, raf = 0, started = false;

  function plant(): void {
    blooms.length = 0;
    for (let i = 0; i < 16; i++) {
      let bx = 0, by = 0, ok = false, tries = 0;
      while (!ok && tries++ < 50) {
        bx = 150 + Math.random() * (WORLD - 300);
        by = 150 + Math.random() * (WORLD - 300);
        ok = blooms.every((b) => Math.hypot(b.x - bx, b.y - by) > 240);
      }
      const midi = SCALE[Math.floor(Math.random() * SCALE.length)];
      blooms.push({ x: bx, y: by, r: 130 + Math.random() * 110, midi, hue: hueOf(midi), inside: false, glow: 0, phase: Math.random() * 6.28, petals: 5 + Math.floor(Math.random() * 4) });
    }
    flora.length = 0;
    for (let i = 0; i < 160; i++) {
      flora.push({ x: Math.random() * WORLD, y: Math.random() * WORLD, s: Math.random() * 1.6 + 0.3, z: 0.4 + Math.random() * 0.6, hue: 165 + Math.random() * 40 });
    }
  }
  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    VW = rect.width; DPR = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.width = Math.max(1, Math.floor(VW * DPR));
    canvas.height = W;   // square world viewport
  }
  const release = (midi: number): void => {
    if (!held.has(midi)) return;
    held.delete(midi); voices.noteOff(ac(), midiToNote(midi));
  };
  function silence(): void {
    blooms.forEach((b) => { b.inside = false; });
    held.clear();
    if (engine.AC) voices.releaseAll(ac());
  }

  /** One movement + audio + readout tick, also called synchronously on keydown
   *  so a keypress has an immediate visible effect. */
  function step(): void {
    let ax = 0, ay = 0;
    if (keys.w || keys.arrowup) ay -= 1;
    if (keys.s || keys.arrowdown) ay += 1;
    if (keys.a || keys.arrowleft) ax -= 1;
    if (keys.d || keys.arrowright) ax += 1;
    if (pointer) {
      const wx = cam.x + (pointer.x - VW / 2), wy = cam.y + (pointer.y - VW / 2);
      const dx = wx - me.x, dy = wy - me.y, d = Math.hypot(dx, dy) || 1;
      if (d > 6) { ax += dx / d; ay += dy / d; }
    }
    const mag = Math.hypot(ax, ay) || 1;
    me.vx += (ax / mag) * 0.5; me.vy += (ay / mag) * 0.5;
    me.vx *= 0.86; me.vy *= 0.86;
    me.x = Math.max(30, Math.min(WORLD - 30, me.x + me.vx));
    me.y = Math.max(30, Math.min(WORLD - 30, me.y + me.vy));
    cam.x += (me.x - cam.x) * 0.09; cam.y += (me.y - cam.y) * 0.09;

    let near: Bloom | null = null, nearD = Infinity;
    blooms.forEach((b) => {
      const d = Math.hypot(b.x - me.x, b.y - me.y), inside = d < b.r;
      if (inside && d < nearD) { nearD = d; near = b; }
      if (inside && !b.inside) {
        b.inside = true;
        if (started && !held.has(b.midi)) {
          held.add(b.midi);
          ensureNodes();
          voices.noteOn(ac(), engine.synthGain!, vsynthPatch, midiToNote(b.midi), 100);
        }
      } else if (!inside && b.inside) {
        b.inside = false;
        if (!blooms.some((o) => o.inside && o.midi === b.midi)) release(b.midi);
      }
      b.glow += ((b.inside ? 1 : 0) - b.glow) * 0.08;
    });
    const chord = held.size > 1 ? ` +${held.size - 1}` : "";
    const where = `${Math.round(me.x)},${Math.round(me.y)}`;
    deps.onReadout(near ? `${midiToNote((near as Bloom).midi)} · in bloom${chord} · ${where}` : `open field · ${where}`);
  }

  function draw(): void {
    if (!W) return;
    const t = performance.now() / 1000;
    const ox = cam.x - VW / 2, oy = cam.y - VW / 2;
    const sx = (wx: number): number => (wx - ox) * DPR, sy = (wy: number): number => (wy - oy) * DPR;

    g.fillStyle = "#050a0c"; g.fillRect(0, 0, W, W);
    const glow = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W * 0.7);
    glow.addColorStop(0, "rgba(16,30,34,0.5)"); glow.addColorStop(1, "rgba(5,8,11,0)");
    g.fillStyle = glow; g.fillRect(0, 0, W, W);

    g.globalCompositeOperation = "lighter";
    flora.forEach((f) => {
      const px = sx(me.x + (f.x - me.x) * f.z), py = sy(me.y + (f.y - me.y) * f.z);
      if (px < -20 || px > W + 20 || py < -20 || py > W + 20) return;
      const twinkle = 0.4 + (Math.sin(t * 1.5 + f.x) * 0.5 + 0.5) * 0.5;
      g.beginPath(); g.arc(px, py, f.s * DPR, 0, 6.28);
      g.fillStyle = `hsla(${f.hue},55%,60%,${0.12 + twinkle * 0.18})`; g.fill();
    });
    blooms.forEach((b) => {
      const px = sx(b.x), py = sy(b.y), rr = b.r * DPR;
      if (px < -rr || px > W + rr || py < -rr || py > W + rr) return;
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.2 + b.phase), lit = b.glow;
      const grad = g.createRadialGradient(px, py, 0, px, py, rr);
      grad.addColorStop(0, `hsla(${b.hue},75%,${52 + lit * 18}%,${0.06 + lit * 0.3 + pulse * 0.02})`);
      grad.addColorStop(0.6, `hsla(${b.hue},70%,46%,${0.03 + lit * 0.12})`);
      grad.addColorStop(1, "hsla(0,0%,0%,0)");
      g.fillStyle = grad; g.beginPath(); g.arc(px, py, rr, 0, 6.28); g.fill();
      g.beginPath(); g.arc(px, py, rr * (0.9 + pulse * 0.04), 0, 6.28);
      g.lineWidth = (0.6 + lit * 1.6) * DPR;
      g.strokeStyle = `hsla(${b.hue},78%,${58 + lit * 20}%,${0.1 + lit * 0.4})`; g.stroke();
      const coreR = (14 + lit * 10) * DPR;
      for (let i = 0; i < b.petals; i++) {
        const a = (i / b.petals) * 6.28 + t * 0.2 * (b.inside ? 1 : 0.3);
        g.beginPath(); g.arc(px + Math.cos(a) * coreR, py + Math.sin(a) * coreR, (2 + lit * 2.4) * DPR, 0, 6.28);
        g.fillStyle = `hsla(${b.hue},85%,${64 + lit * 16}%,${0.4 + lit * 0.5})`; g.fill();
      }
      g.beginPath(); g.arc(px, py, (3 + lit * 3) * DPR, 0, 6.28);
      g.fillStyle = `hsla(${b.hue},90%,${72 + lit * 14}%,${0.5 + lit * 0.5})`; g.fill();
    });
    const mpx = sx(me.x), mpy = sy(me.y), speed = Math.hypot(me.vx, me.vy);
    const aura = g.createRadialGradient(mpx, mpy, 0, mpx, mpy, 54 * DPR);
    aura.addColorStop(0, `hsla(186,80%,70%,${0.5 + Math.min(0.4, speed * 0.05)})`);
    aura.addColorStop(1, "hsla(186,80%,60%,0)");
    g.fillStyle = aura; g.beginPath(); g.arc(mpx, mpy, 54 * DPR, 0, 6.28); g.fill();
    g.beginPath(); g.arc(mpx, mpy, 5.5 * DPR, 0, 6.28);
    g.fillStyle = "hsla(186,90%,85%,0.95)"; g.fill();
    g.globalCompositeOperation = "source-over";

    mg.clearRect(0, 0, mini.width, mini.height);
    mg.fillStyle = "rgba(255,255,255,0.04)"; mg.fillRect(0, 0, mini.width, mini.height);
    blooms.forEach((b) => {
      mg.beginPath(); mg.arc(b.x / WORLD * mini.width, b.y / WORLD * mini.height, b.inside ? 3 : 1.5, 0, 6.28);
      mg.fillStyle = `hsla(${b.hue},75%,60%,${b.inside ? 1 : 0.5})`; mg.fill();
    });
    mg.beginPath(); mg.arc(me.x / WORLD * mini.width, me.y / WORLD * mini.height, 2.2, 0, 6.28);
    mg.fillStyle = "#aef5cf"; mg.fill();
  }

  function frame(): void {
    raf = requestAnimationFrame(frame);
    if (!active || document.hidden) return;
    if (!W || canvas.getBoundingClientRect().width * DPR !== W) resize();
    step(); draw();
  }

  const begin = (): void => { if (!started) { started = true; ensureNodes(); } };
  canvas.addEventListener("pointerdown", (ev) => {
    ev.preventDefault(); begin(); root.focus();
    const r = canvas.getBoundingClientRect();
    pointer = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!pointer) return;
    const r = canvas.getBoundingClientRect();
    pointer = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  });
  const drop = (): void => { pointer = null; };
  canvas.addEventListener("pointerup", drop);
  canvas.addEventListener("pointercancel", drop);
  replantBtn.addEventListener("click", () => { silence(); plant(); draw(); });

  const NAV = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"];
  window.addEventListener("keydown", (ev) => {
    if (!active || root.hidden || !root.offsetParent) return;
    const k = ev.key.toLowerCase();
    if (!NAV.includes(k)) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || focused instanceof HTMLSelectElement) return;
    ev.preventDefault(); keys[k] = true; begin();
    step(); draw();   // immediate response; the rAF loop carries the glide
  });
  window.addEventListener("keyup", (ev) => { keys[ev.key.toLowerCase()] = false; });

  plant();
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
