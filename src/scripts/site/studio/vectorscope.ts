import { masterAnalyser, masterSplit } from "./engine";
import { el, btn, help } from "./helpers";

type SpectralMode = "kaleido" | "tunnel" | "bloom";

export interface Vectorscope {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  setActive: (on: boolean) => void;
}

const MODES: Array<{ id: SpectralMode; label: string }> = [
  { id: "kaleido", label: "KALEIDO" },
  { id: "tunnel", label: "TUNNEL" },
  { id: "bloom", label: "PHASE BLOOM" },
];

export function buildVectorscope(): Vectorscope {
  const root = el("div", "wa-spectral");
  const canvas = document.createElement("canvas");
  canvas.className = "wa-vectorscope";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Psychedelic audio spectrometer driven by the master frequency spectrum and stereo phase");
  const controls = el("div", "wa-spectral-controls");
  let mode = (localStorage.getItem("vv_studio_spectral_mode") as SpectralMode) || "kaleido";
  if (!MODES.some((item) => item.id === mode)) mode = "kaleido";
  let symmetry = Number(localStorage.getItem("vv_studio_spectral_symmetry")) || 8;
  let intensity = Number(localStorage.getItem("vv_studio_spectral_intensity")) || 0.78;
  let trail = Number(localStorage.getItem("vv_studio_spectral_trail")) || 0.82;
  const modeButtons: HTMLButtonElement[] = [];
  MODES.forEach((item) => {
    const button = btn(item.label, "wa-spectral-mode") as HTMLButtonElement;
    button.classList.remove("wa-btn");
    button.setAttribute("aria-pressed", String(item.id === mode));
    button.addEventListener("click", () => {
      mode = item.id;
      localStorage.setItem("vv_studio_spectral_mode", mode);
      modeButtons.forEach((candidate, index) => {
        const selected = MODES[index].id === mode;
        candidate.classList.toggle("active", selected);
        candidate.setAttribute("aria-pressed", String(selected));
      });
    });
    button.classList.toggle("active", item.id === mode);
    modeButtons.push(button);
    controls.append(button);
  });
  const symmetrySelect = document.createElement("select");
  symmetrySelect.setAttribute("aria-label", "Spectrometer symmetry");
  [6, 8, 12].forEach((value) => symmetrySelect.append(new Option(`${value}×`, String(value))));
  symmetrySelect.value = String(symmetry);
  symmetrySelect.addEventListener("change", () => {
    symmetry = Number(symmetrySelect.value);
    localStorage.setItem("vv_studio_spectral_symmetry", String(symmetry));
  });
  const makeRange = (label: string, value: number, onInput: (next: number) => void) => {
    const input = document.createElement("input");
    input.type = "range"; input.min = "0.2"; input.max = "1"; input.step = "0.02"; input.value = String(value);
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => onInput(Number(input.value)));
    return input;
  };
  const intensityInput = makeRange("Spectrometer intensity", intensity, (value) => {
    intensity = value; localStorage.setItem("vv_studio_spectral_intensity", String(value));
  });
  const trailInput = makeRange("Spectrometer trail persistence", trail, (value) => {
    trail = value; localStorage.setItem("vv_studio_spectral_trail", String(value));
  });
  controls.append(symmetrySelect, el("span", "wa-spectral-lbl", "GAIN"), intensityInput, el("span", "wa-spectral-lbl", "TRAIL"), trailInput);
  help(controls, "A real master-bus display: colour follows bass, mids and highs; the centre plots true left/right phase.");
  root.append(canvas, controls);

  const g = canvas.getContext("2d")!;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let width = 0, height = 0, dpr = 1, active = false, raf = 0, last = 0;
  let drive = 0, transient = 0, correlation = 0, hue = 165;
  const left = new Uint8Array(1024), right = new Uint8Array(1024), mono = new Uint8Array(2048), frequency = new Uint8Array(1024);

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(2, devicePixelRatio || 1);
    width = canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    height = canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    g.fillStyle = "#06060d"; g.fillRect(0, 0, width, height);
  };
  new ResizeObserver(resize).observe(canvas);

  const energy = (from: number, to: number): number => {
    let sum = 0;
    const end = Math.min(to, frequency.length);
    for (let i = from; i < end; i++) sum += frequency[i];
    return end > from ? sum / (end - from) / 255 : 0;
  };

  const polar = (cx: number, cy: number, radius: number, angle: number): [number, number] => [
    cx + Math.cos(angle) * radius,
    cy + Math.sin(angle) * radius,
  ];

  function drawKaleido(cx: number, cy: number, radius: number, low: number, mid: number, high: number, time: number): void {
    const span = Math.PI * 2 / symmetry;
    g.globalCompositeOperation = "lighter";
    for (let arm = 0; arm < symmetry; arm++) {
      const base = arm * span + time * (0.025 + high * 0.05);
      for (let layer = 0; layer < 3; layer++) {
        const band = layer === 0 ? low : layer === 1 ? mid : high;
        g.beginPath();
        for (let point = 0; point <= 44; point++) {
          const fraction = point / 44;
          const bin = Math.min(frequency.length - 1, Math.floor(Math.pow(fraction, 1.7) * (frequency.length - 1)));
          const amp = frequency[bin] / 255;
          const angle = base + (fraction - .5) * span * .82;
          const wave = Math.sin(fraction * Math.PI * (3 + layer) + time * (1 + layer * .17)) * radius * .035 * band;
          const r = radius * (.2 + fraction * .66) + amp * radius * (.11 + intensity * .17) + wave;
          const [x, y] = polar(cx, cy, r, angle);
          if (point === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        const light = 48 + band * 24;
        g.strokeStyle = `hsla(${(hue + layer * 72 + arm * 4) % 360},100%,${light}%,${.18 + band * .55})`;
        g.fillStyle = `hsla(${(hue + layer * 72 + arm * 7) % 360},100%,58%,${.012 + band * .045})`;
        g.lineWidth = (.7 + band * 2.5) * dpr;
        g.shadowColor = `hsla(${(hue + layer * 72) % 360},100%,65%,.8)`;
        g.shadowBlur = (3 + band * 14) * dpr;
        g.closePath(); g.fill(); g.stroke();
      }
    }
    g.shadowBlur = 0;
  }

  function drawAura(cx: number, cy: number, radius: number, low: number, mid: number, high: number, time: number): void {
    g.globalCompositeOperation = "lighter";
    const aura = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
    aura.addColorStop(0, `hsla(${(hue + 80) % 360},100%,62%,${.09 + low * .1})`);
    aura.addColorStop(.38, `hsla(${hue},100%,52%,${.035 + mid * .06})`);
    aura.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = aura; g.beginPath(); g.arc(cx, cy, radius, 0, Math.PI * 2); g.fill();
    for (let ring = 0; ring < 5; ring++) {
      g.beginPath();
      const points = 120;
      for (let point = 0; point <= points; point++) {
        const angle = point / points * Math.PI * 2;
        const ripple = Math.sin(angle * (symmetry / 2 + ring) + time * (.7 + ring * .13)) * radius * (.012 + high * .035);
        const r = radius * (.16 + ring * .165) + ripple;
        const [x, y] = polar(cx, cy, r, angle + time * .015 * (ring % 2 ? 1 : -1));
        if (!point) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      g.strokeStyle = `hsla(${(hue + ring * 43) % 360},100%,65%,${.055 + (4 - ring) * .022 + mid * .12})`;
      g.lineWidth = (.45 + low * 1.2) * dpr; g.stroke();
    }
    for (let bead = 0; bead < symmetry * 2; bead++) {
      const angle = bead / (symmetry * 2) * Math.PI * 2 + time * (.08 + high * .1);
      const orbit = radius * (.52 + .17 * Math.sin(bead * 2.399 + time * .3));
      const [x, y] = polar(cx, cy, orbit, angle);
      g.fillStyle = `hsla(${(hue + bead * 19) % 360},100%,70%,${.22 + mid * .35})`;
      g.beginPath(); g.arc(x, y, (1.1 + low * 3.5) * dpr, 0, Math.PI * 2); g.fill();
    }
  }

  function drawTunnel(cx: number, cy: number, radius: number, low: number, mid: number, high: number, time: number): void {
    g.globalCompositeOperation = "lighter";
    for (let ring = 0; ring < 12; ring++) {
      const depth = ((ring / 12 + time * .045) % 1);
      const baseRadius = radius * (.08 + depth * .9);
      const points = 96;
      g.beginPath();
      for (let point = 0; point <= points; point++) {
        const fraction = point / points;
        const bin = Math.floor(fraction * Math.min(384, frequency.length - 1));
        const amp = frequency[bin] / 255;
        const angle = fraction * Math.PI * 2 + time * .08 * (ring % 2 ? 1 : -1);
        const warp = (amp * intensity + Math.sin(angle * symmetry / 2 + time) * .05 * mid) * radius * .1;
        const [x, y] = polar(cx, cy, baseRadius + warp, angle);
        if (!point) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      g.strokeStyle = `hsla(${(hue + ring * 19 + high * 80) % 360},100%,${48 + low * 24}%,${.08 + (1 - depth) * .35})`;
      g.lineWidth = (.6 + (1 - depth) * 1.8) * dpr;
      g.stroke();
    }
  }

  function drawBloom(cx: number, cy: number, radius: number, low: number, mid: number, high: number, time: number): void {
    g.globalCompositeOperation = "lighter";
    for (let petal = 0; petal < symmetry; petal++) {
      const angle = petal / symmetry * Math.PI * 2 + time * .02;
      const [tipX, tipY] = polar(cx, cy, radius * (.34 + low * .38), angle);
      const tangent = angle + Math.PI / 2;
      const spread = radius * (.12 + mid * .19);
      const [c1x, c1y] = polar(cx, cy, spread, tangent);
      const [c2x, c2y] = polar(tipX, tipY, spread * (.7 + high), tangent + Math.PI);
      g.beginPath();
      g.moveTo(cx, cy);
      g.bezierCurveTo(c1x, c1y, c2x, c2y, tipX, tipY);
      g.bezierCurveTo(2 * tipX - c2x, 2 * tipY - c2y, 2 * cx - c1x, 2 * cy - c1y, cx, cy);
      g.fillStyle = `hsla(${(hue + petal * 360 / symmetry) % 360},100%,60%,${.035 + drive * .18})`;
      g.strokeStyle = `hsla(${(hue + 55 + petal * 21) % 360},100%,68%,${.2 + high * .55})`;
      g.lineWidth = (1 + mid * 2) * dpr;
      g.fill(); g.stroke();
    }
  }

  function drawPhase(cx: number, cy: number, radius: number): void {
    const split = masterSplit;
    if (!split) return;
    const count = Math.min(split.left.fftSize, split.right.fftSize);
    split.left.getByteTimeDomainData(left.subarray(0, count));
    split.right.getByteTimeDomainData(right.subarray(0, count));
    let lr = 0, ll = 0, rr = 0;
    g.globalCompositeOperation = "lighter";
    g.beginPath();
    for (let i = 0; i < count; i += 2) {
      const l = (left[i] - 128) / 128, r = (right[i] - 128) / 128;
      lr += l * r; ll += l * l; rr += r * r;
      const x = cx + (l - r) * radius * .46;
      const y = cy - (l + r) * radius * .46;
      if (!i) g.moveTo(x, y); else g.lineTo(x, y);
    }
    if (ll + rr < .0005) {
      g.beginPath();
      for (let i = 0; i <= 240; i++) {
        const t = i / 240 * Math.PI * 2;
        const x = cx + Math.sin(t * 3 + hue * .01) * radius * .18;
        const y = cy + Math.sin(t * 4) * radius * .18;
        if (!i) g.moveTo(x, y); else g.lineTo(x, y);
      }
    }
    const denom = Math.sqrt(ll * rr);
    const nextCorrelation = denom > 1e-6 ? lr / denom : 0;
    correlation += (nextCorrelation - correlation) * .12;
    const gradient = g.createLinearGradient(cx - radius / 2, cy, cx + radius / 2, cy);
    gradient.addColorStop(0, "#a97eff"); gradient.addColorStop(.5, "#68f5cf"); gradient.addColorStop(1, "#ff55d5");
    g.strokeStyle = gradient; g.lineWidth = (1 + drive * 2.5) * dpr;
    g.shadowColor = "rgba(104,245,207,.85)"; g.shadowBlur = 8 * dpr; g.stroke(); g.shadowBlur = 0;
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (!active || document.hidden || now - last < (reduceMotion ? 80 : 16)) return;
    last = now;
    if (!width) resize();
    if (!width) return;
    const analyser = masterAnalyser;
    if (analyser) {
      analyser.getByteFrequencyData(frequency.subarray(0, analyser.frequencyBinCount));
      analyser.getByteTimeDomainData(mono.subarray(0, analyser.fftSize));
    } else frequency.fill(0);
    const low = energy(1, 18), mid = energy(18, 110), high = energy(110, 420);
    const nextDrive = low * .5 + mid * .32 + high * .18;
    transient = Math.max(0, nextDrive - drive * 1.16, transient * .88);
    drive += (nextDrive - drive) * .2;
    hue = (hue + .08 + high * .35) % 360;
    g.globalCompositeOperation = "source-over";
    g.fillStyle = `rgba(4,4,12,${Math.max(.055, .28 - trail * .24)})`;
    g.fillRect(0, 0, width, height);
    const cx = width / 2, cy = height / 2, radius = Math.min(width, height) * .43;
    const time = reduceMotion ? 0 : now / 1000;
    const idle = drive < .012;
    const visualLow = Math.max(low, idle ? .24 + Math.sin(time * .7) * .05 : 0);
    const visualMid = Math.max(mid, idle ? .18 + Math.sin(time * .53 + 2) * .04 : 0);
    const visualHigh = Math.max(high, idle ? .13 + Math.sin(time * .91 + 4) * .03 : 0);
    drawAura(cx, cy, radius, visualLow, visualMid, visualHigh, time);
    if (mode === "kaleido") drawKaleido(cx, cy, radius, visualLow, visualMid, visualHigh, time);
    else if (mode === "tunnel") drawTunnel(cx, cy, radius, visualLow, visualMid, visualHigh, time);
    else drawBloom(cx, cy, radius, visualLow, visualMid, visualHigh, time);
    if (transient > .025) {
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = `hsla(${(hue + 160) % 360},100%,72%,${Math.min(.8, transient * 7)})`;
      g.lineWidth = (1 + transient * 18) * dpr;
      g.beginPath(); g.arc(cx, cy, radius * (.25 + transient * 1.8), 0, Math.PI * 2); g.stroke();
    }
    drawPhase(cx, cy, radius);
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "rgba(211,255,246,.72)";
    g.font = `${8 * dpr}px ui-monospace, monospace`;
    g.fillText(`${mode.toUpperCase()}  B ${Math.round(low * 99)}  M ${Math.round(mid * 99)}  H ${Math.round(high * 99)}  Φ ${correlation.toFixed(2)}`, 9 * dpr, height - 10 * dpr);
  }

  return {
    root,
    canvas,
    setActive: (on: boolean) => {
      active = on;
      if (on) { resize(); if (!raf) raf = requestAnimationFrame(frame); }
    },
  };
}
