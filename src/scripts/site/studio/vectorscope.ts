import { masterAnalyser, masterSplit } from "./engine";
import { el, help } from "./helpers";

export interface Vectorscope {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  setActive: (on: boolean) => void;
}

interface Shockwave {
  radius: number;
  life: number;
  rotation: number;
}

export function buildVectorscope(): Vectorscope {
  const root = el("div", "wa-spectral"); root.dataset.visualizer = "void-coil";
  const canvas = document.createElement("canvas");
  canvas.className = "wa-vectorscope"; canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Void Coil circular master-bus visualiser showing spectral energy, stereo width, phase and transient shockwaves");
  const controls = el("div", "wa-spectral-controls");
  let intensity = Number(localStorage.getItem("vv_studio_void_drive")) || .74;
  let trail = Number(localStorage.getItem("vv_studio_void_decay")) || .78;
  const makeRange = (label: string, value: number, onInput: (next: number) => void): HTMLInputElement => {
    const input = document.createElement("input"); input.type = "range"; input.min = ".2"; input.max = "1"; input.step = ".02"; input.value = String(value);
    input.setAttribute("aria-label", label); input.addEventListener("input", () => onInput(Number(input.value))); return input;
  };
  const driveInput = makeRange("Void Coil drive", intensity, (value) => { intensity = value; localStorage.setItem("vv_studio_void_drive", String(value)); });
  const decayInput = makeRange("Void Coil decay", trail, (value) => { trail = value; localStorage.setItem("vv_studio_void_decay", String(value)); });
  controls.append(el("span", "wa-spectral-id", "VOID COIL"), el("span", "wa-spectral-lbl", "DRIVE"), driveInput, el("span", "wa-spectral-lbl", "DECAY"), decayInput);
  help(controls, "A circular master-bus instrument: frequency runs from the core to the rim, the centre plots stereo phase and red fractures mark transients.");
  root.append(canvas, controls);

  const g = canvas.getContext("2d")!, reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frequency = new Uint8Array(1024), left = new Uint8Array(2048), right = new Uint8Array(2048), shocks: Shockwave[] = [];
  let width = 0, height = 0, dpr = 1, active = false, raf = 0, last = 0, drive = 0, transient = 0, correlation = 0, stereoWidth = 0, lastShock = 0;

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    dpr = Math.min(2, devicePixelRatio || 1); width = canvas.width = Math.max(1, Math.floor(rect.width * dpr)); height = canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    g.fillStyle = "#020406"; g.fillRect(0, 0, width, height);
  };
  new ResizeObserver(resize).observe(canvas);

  const energy = (from: number, to: number): number => {
    let sum = 0; const end = Math.min(to, frequency.length); for (let i = from; i < end; i++) sum += frequency[i];
    return end > from ? sum / (end - from) / 255 : 0;
  };

  const readStereo = (): void => {
    const split = masterSplit; if (!split) { correlation *= .9; stereoWidth *= .9; return; }
    const count = Math.min(left.length, right.length, split.left.fftSize, split.right.fftSize);
    split.left.getByteTimeDomainData(left.subarray(0, count)); split.right.getByteTimeDomainData(right.subarray(0, count));
    let lr = 0, ll = 0, rr = 0, difference = 0;
    for (let i = 0; i < count; i++) {
      const l = (left[i] - 128) / 128, r = (right[i] - 128) / 128;
      lr += l * r; ll += l * l; rr += r * r; difference += Math.abs(l - r);
    }
    const denominator = Math.sqrt(ll * rr);
    correlation += ((denominator > 1e-6 ? lr / denominator : 0) - correlation) * .13;
    stereoWidth += ((count ? difference / count : 0) - stereoWidth) * .16;
  };

  const spectrumAt = (fraction: number, time: number, idle: boolean): number => {
    const bin = Math.min(frequency.length - 1, Math.floor(Math.pow(fraction, 1.72) * 500)), measured = frequency[bin] / 255;
    return Math.max(measured, idle ? .105 + Math.sin(fraction * 19 + time * .42) * .025 : 0);
  };

  const drawAperture = (cx: number, cy: number, radius: number, time: number): void => {
    const voidGradient = g.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.08);
    voidGradient.addColorStop(0, "#000103"); voidGradient.addColorStop(.42, "#03080b"); voidGradient.addColorStop(.78, "#08060c"); voidGradient.addColorStop(1, "#010203");
    g.globalCompositeOperation = "source-over"; g.fillStyle = voidGradient; g.beginPath(); g.arc(cx, cy, radius * 1.08, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "lighter";
    for (let ring = 1; ring <= 4; ring++) {
      g.setLineDash([2 * dpr, (9 + ring * 3) * dpr]); g.lineDashOffset = reduceMotion ? 0 : time * (ring % 2 ? 3 : -2) * dpr;
      g.strokeStyle = ring === 3 ? "rgba(117,38,82,.16)" : "rgba(48,190,185,.105)"; g.lineWidth = .7 * dpr;
      g.beginPath(); g.arc(cx, cy, radius * (.2 + ring * .18), 0, Math.PI * 2); g.stroke();
    }
    g.setLineDash([]);
    for (let tick = 0; tick < 48; tick++) {
      const angle = tick / 48 * Math.PI * 2, outer = radius * .99, inner = outer - radius * (tick % 6 ? .018 : .04);
      g.strokeStyle = tick % 12 === 0 ? "rgba(207,65,75,.42)" : "rgba(77,220,210,.16)"; g.lineWidth = (tick % 12 === 0 ? 1.2 : .6) * dpr;
      g.beginPath(); g.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner); g.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer); g.stroke();
    }
  };

  const drawCoil = (cx: number, cy: number, radius: number, time: number, idle: boolean): void => {
    const coilGradient = g.createRadialGradient(cx, cy, radius * .08, cx, cy, radius);
    coilGradient.addColorStop(0, "rgba(102,228,217,.92)"); coilGradient.addColorStop(.48, "rgba(48,173,174,.78)"); coilGradient.addColorStop(.78, "rgba(111,43,91,.66)"); coilGradient.addColorStop(1, "rgba(160,53,78,.5)");
    g.globalCompositeOperation = "lighter";
    for (let echo = 2; echo >= 0; echo--) {
      g.beginPath();
      for (let point = 0; point <= 280; point++) {
        const fraction = point / 280, amplitude = spectrumAt(fraction, time, idle);
        const angle = -Math.PI / 2 + fraction * Math.PI * 5.25 + time * (reduceMotion ? 0 : .025) + echo * .015;
        const base = radius * (.1 + fraction * .78), signal = amplitude * radius * (.025 + intensity * .09);
        const fracture = Math.sin(fraction * 47 - time * .6) * radius * .008 * amplitude;
        const stereoSample = Math.min(left.length - 1, Math.floor(fraction * 1024));
        const phaseOffset = (((left[stereoSample] || 128) - (right[stereoSample] || 128)) / 128) * radius * .035;
        const r = base + signal + fracture + phaseOffset * (echo === 0 ? 1 : .35);
        const x = cx + Math.cos(angle) * r, y = cy + Math.sin(angle) * r;
        if (!point) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokeStyle = echo ? `rgba(76,214,205,${.07 + echo * .035})` : coilGradient;
      g.lineWidth = (echo ? 1.1 + echo : 1.2 + drive * 3.2) * dpr; g.shadowColor = echo ? "#246d70" : "#3ad8d0"; g.shadowBlur = (echo ? 3 : 7 + drive * 13) * dpr; g.stroke();
    }
    g.shadowBlur = 0;
    for (let node = 4; node < 36; node++) {
      const fraction = node / 38, amplitude = spectrumAt(fraction, time, idle); if (node % 3 && amplitude < .22) continue;
      const angle = -Math.PI / 2 + fraction * Math.PI * 5.25 + time * .025, r = radius * (.1 + fraction * .78) + amplitude * radius * (.025 + intensity * .09);
      g.fillStyle = node % 5 === 0 ? `rgba(207,65,75,${.2 + amplitude * .6})` : `rgba(115,225,216,${.18 + amplitude * .55})`;
      g.beginPath(); g.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, (.8 + amplitude * 2.2) * dpr, 0, Math.PI * 2); g.fill();
    }
  };

  const drawPhaseCore = (cx: number, cy: number, radius: number): void => {
    const count = Math.min(1024, left.length, right.length); g.beginPath();
    for (let i = 0; i < count; i += 3) {
      const l = (left[i] - 128) / 128, r = (right[i] - 128) / 128;
      const x = cx + (l - r) * radius * .12, y = cy - (l + r) * radius * .12;
      if (!i) g.moveTo(x, y); else g.lineTo(x, y);
    }
    if (drive < .008) { g.beginPath(); g.arc(cx, cy, radius * .045, 0, Math.PI * 2); }
    g.strokeStyle = "rgba(183,71,130,.7)"; g.lineWidth = (1 + drive * 2) * dpr; g.shadowColor = "#8c365f"; g.shadowBlur = 6 * dpr; g.stroke(); g.shadowBlur = 0;
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, radius * .13); core.addColorStop(0, "rgba(0,0,0,.98)"); core.addColorStop(.68, "rgba(1,5,8,.94)"); core.addColorStop(1, "rgba(51,200,192,.22)");
    g.fillStyle = core; g.beginPath(); g.arc(cx, cy, radius * .13, 0, Math.PI * 2); g.fill();
  };

  const drawShockwaves = (cx: number, cy: number, radius: number, time: number): void => {
    if (!reduceMotion && transient > .022 && time - lastShock > .08) { lastShock = time; shocks.push({ radius: .18, life: 1, rotation: time * .7 }); if (shocks.length > 7) shocks.shift(); }
    g.globalCompositeOperation = "lighter";
    for (let i = shocks.length - 1; i >= 0; i--) {
      const shock = shocks[i]; shock.radius += .009 + transient * .015; shock.life -= .018;
      if (shock.life <= 0 || shock.radius > 1.05) { shocks.splice(i, 1); continue; }
      g.strokeStyle = `rgba(218,53,63,${shock.life * .5})`; g.lineWidth = (1 + shock.life * 2) * dpr; g.shadowColor = "#c93242"; g.shadowBlur = 8 * dpr;
      g.beginPath(); g.arc(cx, cy, radius * shock.radius, shock.rotation, shock.rotation + Math.PI * 1.12); g.stroke();
      g.beginPath(); g.arc(cx, cy, radius * shock.radius, shock.rotation + Math.PI * 1.38, shock.rotation + Math.PI * 1.82); g.stroke();
    }
    g.shadowBlur = 0;
  };

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame); if (!active || document.hidden || now - last < (reduceMotion ? 80 : 16)) return;
    last = now; if (!width) resize(); if (!width) return;
    const analyser = masterAnalyser; if (analyser) analyser.getByteFrequencyData(frequency.subarray(0, analyser.frequencyBinCount)); else frequency.fill(0); readStereo();
    const low = energy(1, 18), mid = energy(18, 110), high = energy(110, 420), nextDrive = low * .5 + mid * .32 + high * .18;
    transient = Math.max(0, nextDrive - drive * 1.14, transient * .87); drive += (nextDrive - drive) * .19;
    g.globalCompositeOperation = "source-over"; g.fillStyle = `rgba(1,3,5,${Math.max(.07, .34 - trail * .24)})`; g.fillRect(0, 0, width, height);
    const cx = width / 2, cy = height * .49, radius = Math.min(width, height) * .43, time = reduceMotion ? 0 : now / 1000, idle = drive < .012;
    drawAperture(cx, cy, radius, time); drawCoil(cx, cy, radius, time, idle); drawPhaseCore(cx, cy, radius); drawShockwaves(cx, cy, radius, time);
    g.globalCompositeOperation = "source-over"; g.fillStyle = "rgba(132,181,181,.76)"; g.font = `${8 * dpr}px ui-monospace, monospace`;
    g.fillText(`VOID COIL  B ${Math.round(low * 99)}  M ${Math.round(mid * 99)}  H ${Math.round(high * 99)}  WIDTH ${Math.round(stereoWidth * 99)}  PHASE ${correlation.toFixed(2)}`, 9 * dpr, height - 10 * dpr);
  };

  return { root, canvas, setActive: (on: boolean) => { active = on; if (on) { resize(); if (!raf) raf = requestAnimationFrame(frame); } } };
}
