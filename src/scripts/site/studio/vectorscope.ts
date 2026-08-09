// Stereo vectorscope — the studio's own master display, replacing the
// geodesic-orb visualiser that was too close a port of its reference.
//
// This is a real measurement instrument rather than an ornament: it plots the
// left channel against the right on a 45°-rotated axis, so a mono signal
// draws a vertical line, a wide stereo signal opens into a cloud, and an
// out-of-phase signal lies horizontal. The graticule and the correlation
// readout underneath are the same conventions a hardware scope uses.
import { masterAnalyser, masterSplit } from "./engine";
import { SCREEN_FG } from "./helpers";

export interface Vectorscope { canvas: HTMLCanvasElement; setActive: (on: boolean) => void }

export function buildVectorscope(): Vectorscope {
  const canvas = document.createElement("canvas");
  canvas.className = "wa-vectorscope";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Audio-reactive stereo signal organism; vertical is mono, width is stereo correlation");
  const g = canvas.getContext("2d")!;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0, DPR = 1, active = false, raf = 0;
  const resize = (): void => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.width = Math.max(1, Math.floor(r.width * DPR));
    H = canvas.height = Math.max(1, Math.floor(r.height * DPR));
  };

  const left = new Uint8Array(2048), right = new Uint8Array(2048), mono = new Uint8Array(2048);
  let corr = 0, drive = 0;

  function graticule(cx: number, cy: number, rad: number): void {
    g.strokeStyle = "rgba(104,245,207,0.13)";
    g.lineWidth = 1 * DPR;
    // concentric rings at -20, -12, -6, 0 dB
    [0.1, 0.25, 0.5, 1].forEach((r) => {
      g.beginPath(); g.arc(cx, cy, rad * r, 0, Math.PI * 2); g.stroke();
    });
    // L / R diagonals and the mono vertical
    g.beginPath();
    g.moveTo(cx - rad, cy - rad); g.lineTo(cx + rad, cy + rad);
    g.moveTo(cx - rad, cy + rad); g.lineTo(cx + rad, cy - rad);
    g.stroke();
    g.strokeStyle = "rgba(95,168,138,0.1)";
    g.beginPath(); g.moveTo(cx, cy - rad); g.lineTo(cx, cy + rad); g.stroke();
    g.fillStyle = "rgba(185,151,255,0.58)";
    g.font = `${9 * DPR}px ui-monospace, monospace`;
    g.fillText("L", cx - rad + 4 * DPR, cy - rad + 12 * DPR);
    g.fillText("R", cx + rad - 12 * DPR, cy - rad + 12 * DPR);
    g.fillText("M", cx + 4 * DPR, cy - rad + 12 * DPR);
  }

  function frame(): void {
    raf = requestAnimationFrame(frame);
    if (!active || document.hidden) return;
    if (!W || canvas.getBoundingClientRect().width * DPR !== W) resize();
    if (!W) return;

    // Phosphor persistence: fade the previous frame instead of clearing, so
    // the trace leaves a decaying tail the way a CRT scope does.
    g.globalCompositeOperation = "source-over";
    const wash = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * .65);
    wash.addColorStop(0, "rgba(23,22,54,.2)"); wash.addColorStop(1, "rgba(6,7,13,.3)");
    g.fillStyle = wash;
    g.fillRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2, rad = Math.min(W, H) * 0.42;
    graticule(cx, cy, rad);

    // The signal organism is a functional persistence layer: its breathing
    // radius follows RMS drive and its asymmetry follows stereo correlation.
    const time = reduceMotion ? 0 : performance.now() / 1800;
    g.globalCompositeOperation = "lighter";
    for (let ring = 0; ring < 3; ring++) {
      g.strokeStyle = ring === 0 ? "rgba(255,123,216,.28)" : ring === 1 ? "rgba(104,245,207,.22)" : "rgba(169,126,255,.18)";
      g.lineWidth = (1 + drive * 2) * DPR; g.beginPath();
      const points = 18 + ring * 6;
      for (let i = 0; i <= points; i++) {
        const a = (i / points) * Math.PI * 2;
        const pulse = 1 + Math.sin(a * (3 + ring) + time + ring) * (.08 + drive * .22);
        const spread = 1 + corr * Math.cos(a * 2) * .16;
        const rr = rad * (.34 + ring * .18) * pulse * spread;
        const x = cx + Math.cos(a + time * .08 * (ring + 1)) * rr;
        const y = cy + Math.sin(a + time * .08 * (ring + 1)) * rr;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.stroke();
    }

    const split = masterSplit, an = masterAnalyser;
    let n = 0, sumLR = 0, sumL = 0, sumR = 0;
    if (split) {
      split.left.getByteTimeDomainData(left.subarray(0, split.left.fftSize));
      split.right.getByteTimeDomainData(right.subarray(0, split.right.fftSize));
      n = split.left.fftSize;
    } else if (an) {
      an.getByteTimeDomainData(mono.subarray(0, an.fftSize));
      n = an.fftSize;
    }

    if (n) {
      g.globalCompositeOperation = "lighter";
      const trace = g.createLinearGradient(cx - rad, cy, cx + rad, cy);
      trace.addColorStop(0, "#9f7bff"); trace.addColorStop(.5, "#6cf5d0"); trace.addColorStop(1, "#ff7bd8");
      g.strokeStyle = trace;
      g.lineWidth = 1.1 * DPR;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const l = split ? (left[i] - 128) / 128 : (mono[i] - 128) / 128;
        const r = split ? (right[i] - 128) / 128 : l;
        sumLR += l * r; sumL += l * l; sumR += r * r;
        // 45° rotation: mono sums to the vertical axis, difference to horizontal
        const x = cx + (l - r) * rad * 0.707;
        const y = cy - (l + r) * rad * 0.707;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      const denom = Math.sqrt(sumL * sumR);
      const nowCorr = denom > 1e-6 ? sumLR / denom : 0;
      corr += (nowCorr - corr) * 0.15;
      drive += (Math.sqrt(sumL / n) - drive) * 0.2;
    } else {
      // idle: a slow Lissajous so the screen reads as live, not broken
      const t = performance.now() / 1000;
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = "rgba(255,123,216,0.55)";
      g.lineWidth = 1 * DPR;
      g.beginPath();
      for (let i = 0; i <= 240; i++) {
        const a = (i / 240) * Math.PI * 2;
        const x = cx + Math.sin(a * 3 + t * 0.6) * rad * 0.32;
        const y = cy - Math.sin(a * 2 + t * 0.4) * rad * 0.32;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }

    // correlation meter along the bottom: −1 out of phase, +1 mono
    g.globalCompositeOperation = "source-over";
    const barW = W * 0.6, barX = cx - barW / 2, barY = H - 14 * DPR;
    g.fillStyle = "rgba(95,168,138,0.12)";
    g.fillRect(barX, barY, barW, 4 * DPR);
    const pos = barX + ((corr + 1) / 2) * barW;
    g.fillStyle = corr < -0.2 ? "#d4553f" : corr < 0.2 ? "#d9a441" : SCREEN_FG;
    g.fillRect(pos - 1.5 * DPR, barY - 2 * DPR, 3 * DPR, 8 * DPR);
    g.font = `${9 * DPR}px ui-monospace, monospace`;
    g.fillStyle = "rgba(143,139,129,0.9)";
    g.fillText(`CORR ${corr >= 0 ? "+" : ""}${corr.toFixed(2)}`, barX, barY - 6 * DPR);
  }

  window.addEventListener("resize", resize);
  return {
    canvas,
    setActive: (on: boolean) => {
      active = on;
      if (on) { resize(); if (!raf) raf = requestAnimationFrame(frame); }
    },
  };
}
