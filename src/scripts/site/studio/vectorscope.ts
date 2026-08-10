import { masterAnalyser, masterSplit } from "./engine";
import { el, help } from "./helpers";

export interface Vectorscope {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  setActive: (on: boolean) => void;
}

interface Spore {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
}

export function buildVectorscope(): Vectorscope {
  const root = el("div", "wa-spectral"); root.dataset.visualizer = "signal-reef";
  const canvas = document.createElement("canvas");
  canvas.className = "wa-vectorscope";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Signal Reef living master-bus visualiser showing bass mass, midrange branches, high-frequency spores and stereo phase threads");
  const controls = el("div", "wa-spectral-controls");
  let intensity = Number(localStorage.getItem("vv_studio_reef_drive")) || 0.76;
  let trail = Number(localStorage.getItem("vv_studio_reef_afterimage")) || 0.8;
  const makeRange = (label: string, value: number, onInput: (next: number) => void): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "range"; input.min = "0.2"; input.max = "1"; input.step = "0.02"; input.value = String(value);
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => onInput(Number(input.value)));
    return input;
  };
  const driveInput = makeRange("Signal Reef drive", intensity, (value) => { intensity = value; localStorage.setItem("vv_studio_reef_drive", String(value)); });
  const trailInput = makeRange("Signal Reef afterimage", trail, (value) => { trail = value; localStorage.setItem("vv_studio_reef_afterimage", String(value)); });
  controls.append(el("span", "wa-spectral-id", "SIGNAL REEF"), el("span", "wa-spectral-lbl", "DRIVE"), driveInput, el("span", "wa-spectral-lbl", "AFTERIMAGE"), trailInput);
  help(controls, "A living master-bus map: bass builds the body, mids grow branches, highs shed spores and the twin threads show stereo phase.");
  root.append(canvas, controls);

  const g = canvas.getContext("2d")!;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frequency = new Uint8Array(1024), left = new Uint8Array(2048), right = new Uint8Array(2048);
  const spores: Spore[] = [];
  let width = 0, height = 0, dpr = 1, active = false, raf = 0, last = 0;
  let drive = 0, transient = 0, correlation = 0, stereoWidth = 0, hue = 158, spawnClock = 0;

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    dpr = Math.min(2, devicePixelRatio || 1);
    width = canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    height = canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    g.fillStyle = "#04040c"; g.fillRect(0, 0, width, height);
  };
  new ResizeObserver(resize).observe(canvas);

  const energy = (from: number, to: number): number => {
    let sum = 0; const end = Math.min(to, frequency.length);
    for (let i = from; i < end; i++) sum += frequency[i];
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

  const reefAmplitude = (fraction: number, time: number, idle: boolean): number => {
    const bin = Math.min(frequency.length - 1, Math.floor(Math.pow(fraction, 1.75) * 500));
    const measured = frequency[bin] / 255;
    return Math.max(measured, idle ? .13 + Math.sin(time * .7 + fraction * 11) * .045 : 0);
  };

  const drawBody = (time: number, low: number, mid: number, high: number, idle: boolean): void => {
    const leftEdge = width * .055, span = width * .89, centre = height * .52;
    const body = g.createLinearGradient(leftEdge, 0, leftEdge + span, 0);
    body.addColorStop(0, `hsla(${(hue + 28) % 360},100%,58%,.2)`); body.addColorStop(.48, `hsla(${(hue + 118) % 360},100%,62%,.28)`); body.addColorStop(1, `hsla(${(hue + 224) % 360},100%,62%,.12)`);
    g.globalCompositeOperation = "lighter"; g.fillStyle = body; g.beginPath();
    for (let pass = 0; pass < 2; pass++) {
      for (let point = 0; point <= 120; point++) {
        const index = pass ? 120 - point : point, fraction = index / 120, amplitude = reefAmplitude(fraction, time, idle);
        const pulse = Math.sin(fraction * 13 + time * (.55 + high)) * height * .012;
        const thickness = height * (.025 + amplitude * (.09 + intensity * .08) + low * .018);
        const y = centre + pulse + (pass ? thickness : -thickness);
        const x = leftEdge + fraction * span;
        if (!pass && point === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
    }
    g.closePath(); g.shadowColor = `hsla(${(hue + 95) % 360},100%,60%,.75)`; g.shadowBlur = (5 + drive * 15) * dpr; g.fill(); g.shadowBlur = 0;

    for (let branch = 0; branch < 26; branch++) {
      const fraction = (branch + .65) / 27, amplitude = reefAmplitude(fraction, time, idle);
      const x = leftEdge + fraction * span, direction = branch % 2 ? 1 : -1;
      const phaseSample = Math.min(left.length - 1, Math.floor(fraction * 1024));
      const phase = ((left[phaseSample] || 128) - (right[phaseSample] || 128)) / 128;
      const startY = centre + Math.sin(fraction * 13 + time * .55) * height * .012;
      const length = height * (.055 + amplitude * (.18 + intensity * .12) + mid * .035);
      const endX = x + phase * width * .045 + Math.sin(branch * 2.17 + time * .23) * width * .012;
      const endY = startY + direction * length;
      g.beginPath(); g.moveTo(x, startY);
      g.bezierCurveTo(x + direction * width * .018, startY + direction * length * .25, endX - direction * width * .014, endY - direction * length * .25, endX, endY);
      g.strokeStyle = `hsla(${(hue + branch * 17 + amplitude * 80) % 360},100%,${58 + high * 18}%,${.2 + amplitude * .62})`;
      g.lineWidth = (.55 + amplitude * 2.4) * dpr; g.shadowColor = g.strokeStyle; g.shadowBlur = (2 + amplitude * 8) * dpr; g.stroke(); g.shadowBlur = 0;
      g.fillStyle = `hsla(${(hue + 120 + branch * 11) % 360},100%,72%,${.24 + high * .5})`;
      g.beginPath(); g.arc(endX, endY, (.8 + high * 2.8 + amplitude * 1.5) * dpr, 0, Math.PI * 2); g.fill();
    }
  };

  const drawPhaseThreads = (time: number): void => {
    const centre = height * .52, leftEdge = width * .055, span = width * .89;
    [left, right].forEach((channel, channelIndex) => {
      g.beginPath();
      for (let point = 0; point <= 160; point++) {
        const fraction = point / 160, sample = channel[Math.min(channel.length - 1, Math.floor(fraction * 1024))];
        const signal = ((sample || 128) - 128) / 128;
        const y = centre + signal * height * (.08 + intensity * .055) + Math.sin(fraction * 9 + time * .4 + channelIndex * Math.PI) * height * .006;
        const x = leftEdge + fraction * span;
        if (!point) g.moveTo(x, y); else g.lineTo(x, y);
      }
      const gradient = g.createLinearGradient(leftEdge, 0, leftEdge + span, 0);
      gradient.addColorStop(0, channelIndex ? "#ff65c8" : "#65ffd5"); gradient.addColorStop(.52, "#f6ff88"); gradient.addColorStop(1, channelIndex ? "#7b8dff" : "#dc62ff");
      g.strokeStyle = gradient; g.globalAlpha = .5 + drive * .42; g.lineWidth = (channelIndex ? 1.1 : 1.6) * dpr; g.shadowColor = channelIndex ? "#ff65c8" : "#65ffd5"; g.shadowBlur = 5 * dpr; g.stroke();
    });
    g.globalAlpha = 1; g.shadowBlur = 0;
  };

  const updateSpores = (time: number, high: number): void => {
    if (!reduceMotion && transient > .018 && time - spawnClock > .045) {
      spawnClock = time; const count = Math.min(8, 2 + Math.floor(transient * 30));
      for (let i = 0; i < count; i++) {
        const phase = time * 5.17 + i * 2.399, x = width * (.18 + ((Math.sin(phase * 1.7) + 1) * .38));
        spores.push({ x, y: height * .52, vx: Math.cos(phase) * width * .0009, vy: Math.sin(phase) * height * .0027, life: 1, hue: (hue + i * 31) % 360 });
      }
      if (spores.length > 90) spores.splice(0, spores.length - 90);
    }
    g.globalCompositeOperation = "lighter";
    for (let i = spores.length - 1; i >= 0; i--) {
      const spore = spores[i]; spore.x += spore.vx; spore.y += spore.vy; spore.vy *= .995; spore.life -= .012 + high * .006;
      if (spore.life <= 0) { spores.splice(i, 1); continue; }
      g.fillStyle = `hsla(${spore.hue},100%,70%,${spore.life * .72})`; g.shadowColor = g.fillStyle; g.shadowBlur = 7 * dpr;
      g.beginPath(); g.arc(spore.x, spore.y, (1 + (1 - spore.life) * 2) * dpr, 0, Math.PI * 2); g.fill();
    }
    g.shadowBlur = 0;
  };

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    if (!active || document.hidden || now - last < (reduceMotion ? 80 : 16)) return;
    last = now; if (!width) resize(); if (!width) return;
    const analyser = masterAnalyser;
    if (analyser) analyser.getByteFrequencyData(frequency.subarray(0, analyser.frequencyBinCount)); else frequency.fill(0);
    readStereo();
    const low = energy(1, 18), mid = energy(18, 110), high = energy(110, 420), nextDrive = low * .5 + mid * .32 + high * .18;
    transient = Math.max(0, nextDrive - drive * 1.14, transient * .87); drive += (nextDrive - drive) * .19; hue = (hue + .055 + high * .28) % 360;
    g.globalCompositeOperation = "source-over"; g.fillStyle = `rgba(3,3,11,${Math.max(.05, .3 - trail * .25)})`; g.fillRect(0, 0, width, height);
    const time = reduceMotion ? 0 : now / 1000, idle = drive < .012;
    const atmosphere = g.createLinearGradient(0, 0, width, height);
    atmosphere.addColorStop(0, `hsla(${(hue + 25) % 360},100%,45%,${.018 + low * .055})`); atmosphere.addColorStop(.5, `hsla(${(hue + 130) % 360},100%,48%,${.018 + mid * .045})`); atmosphere.addColorStop(1, `hsla(${(hue + 245) % 360},100%,52%,${.012 + high * .055})`);
    g.fillStyle = atmosphere; g.fillRect(0, 0, width, height);
    drawBody(time, low, mid, high, idle); drawPhaseThreads(time); updateSpores(time, high);
    g.globalCompositeOperation = "source-over"; g.fillStyle = "rgba(218,255,243,.76)"; g.font = `${8 * dpr}px ui-monospace, monospace`;
    g.fillText(`SIGNAL REEF  B ${Math.round(low * 99)}  M ${Math.round(mid * 99)}  H ${Math.round(high * 99)}  WIDTH ${Math.round(stereoWidth * 99)}  PHASE ${correlation.toFixed(2)}`, 9 * dpr, height - 10 * dpr);
  };

  return { root, canvas, setActive: (on: boolean) => { active = on; if (on) { resize(); if (!raf) raf = requestAnimationFrame(frame); } } };
}
