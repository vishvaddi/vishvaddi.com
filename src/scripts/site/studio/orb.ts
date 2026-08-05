// Geodesic orb — the audio-reactive visualiser (LYSERGIC parity, B3).
// An icosphere skeleton whose nodes are displaced by the master waveform and
// whose edges are drawn three times at sub-pixel offsets for chromatic split.
// Colours come from the studio palette, not the reference's horror red.
import { masterAnalyser } from "./engine";

interface Geo { verts: Array<[number, number, number]>; edges: Array<[number, number]> }

function normalise(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
/** Icosahedron subdivided `subdiv` times, reduced to a deduped edge list. */
function buildGeodesic(subdiv: number): Geo {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: Array<[number, number, number]> = ([
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ] as Array<[number, number, number]>).map(normalise);
  let faces: Array<[number, number, number]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdiv; s++) {
    const mid = new Map<string, number>();
    const next: Array<[number, number, number]> = [];
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const hit = mid.get(key); if (hit !== undefined) return hit;
      const va = verts[a], vb = verts[b];
      verts.push(normalise([va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]]));
      mid.set(key, verts.length - 1);
      return verts.length - 1;
    };
    faces.forEach((f) => {
      const a = midpoint(f[0], f[1]), b = midpoint(f[1], f[2]), c = midpoint(f[2], f[0]);
      next.push([f[0], a, c], [f[1], b, a], [f[2], c, b], [a, b, c]);
    });
    faces = next;
  }
  const seen = new Set<string>(), edges: Array<[number, number]> = [];
  faces.forEach((f) => {
    for (let i = 0; i < 3; i++) {
      const a = f[i], b = f[(i + 1) % 3], key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!seen.has(key)) { seen.add(key); edges.push([a, b]); }
    }
  });
  return { verts, edges };
}

export interface Orb { canvas: HTMLCanvasElement; setActive: (on: boolean) => void }

export function buildOrb(): Orb {
  const canvas = document.createElement("canvas");
  canvas.className = "wa-orb";
  const g = canvas.getContext("2d")!;
  // Phones get the bare icosahedron and no halo — 42 nodes and 100 particles
  // is a lot of per-frame canvas work on a small GPU.
  const lean = window.matchMedia("(max-width: 700px)").matches;
  const geo = buildGeodesic(lean ? 0 : 1);
  const nV = geo.verts.length;
  const seed = geo.verts.map((_, i) => i / nV);
  const proj = new Array<{ x: number; y: number; z: number }>(nV);
  const PARTS = lean ? 0 : 100;
  const parts = Array.from({ length: PARTS }, (_, i) => ({
    a: Math.random() * Math.PI * 2, r: 0.5 + Math.random() * 1.1,
    bin: 2 + (i % 90), spin: 0.0006 + Math.random() * 0.0022, life: Math.random(),
  }));

  let W = 0, H = 0, DPR = 1;
  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.width = Math.max(1, Math.floor(rect.width * DPR));
    H = canvas.height = Math.max(1, Math.floor(rect.height * DPR));
  };

  const wave = new Uint8Array(2048), freq = new Uint8Array(1024);
  let smoothE = 0, smoothB = 0, smoothH = 0, rot = 0, tear = 0, prevE = 0, flash = 0;
  let active = false, raf = 0;

  const waveAt = (u: number, idle: boolean): number => {
    if (idle) return Math.sin(u * Math.PI * 12 + rot * 7) * 0.5 + Math.sin(u * 20 - rot * 4) * 0.3;
    return (wave[Math.floor(u * wave.length) % wave.length] - 128) / 128;
  };

  function frame(): void {
    raf = requestAnimationFrame(frame);
    if (!active || document.hidden) return;
    if (!W || canvas.getBoundingClientRect().width * DPR !== W) resize();
    if (!W) return;

    let energy = 0, bass = 0, high = 0, live = false;
    const an = masterAnalyser;
    if (an) {
      live = true;
      an.getByteTimeDomainData(wave.subarray(0, an.fftSize));
      an.getByteFrequencyData(freq.subarray(0, an.frequencyBinCount));
      for (let i = 0; i < an.fftSize; i += 2) { const v = (wave[i] - 128) / 128; energy += v * v; }
      energy = Math.sqrt(energy / (an.fftSize / 2));
      for (let i = 0; i < 26; i++) bass += freq[i]; bass /= 26 * 255;
      for (let i = 120; i < 340; i++) high += freq[i]; high /= 220 * 255;
    }
    smoothE += (energy - smoothE) * 0.2;
    smoothB += (bass - smoothB) * 0.12;
    smoothH += (high - smoothH) * 0.25;
    rot += 0.0016 + smoothE * 0.012;

    // Idle still breathes — a dead orb reads as a broken orb.
    const idle = !live || energy < 0.015;
    if (idle) {
      const tt = performance.now() / 1000;
      smoothE = 0.12 + 0.07 * Math.abs(Math.sin(tt * 0.6)) + 0.04 * Math.sin(tt * 2.3);
      smoothB = 0.18 + 0.1 * Math.abs(Math.sin(tt * 0.4));
      smoothH = 0.12;
    }
    const onset = Math.max(0, energy - prevE); prevE = energy;
    tear *= 0.86;
    if (idle) { if (Math.random() < 0.05) tear = Math.min(1, tear + 0.3 + Math.random() * 0.5); }
    else if (onset > 0.04 || Math.random() < 0.015 + smoothE * 0.25) tear = Math.min(1, tear + 0.4 + onset * 4);
    if (onset > 0.05) flash = 1;
    flash *= 0.82;

    g.globalCompositeOperation = "source-over";
    g.fillStyle = "rgba(5,10,12,0.30)";
    g.fillRect(0, 0, W, H);

    const jx = (Math.random() - 0.5) * (3 + tear * 60) * DPR;
    const jy = (Math.random() - 0.5) * (2 + tear * 20) * DPR;
    const cx = W / 2 + jx, cy = H * 0.5 + jy;
    const R = Math.min(W, H) * 0.3 * (1 + smoothB * 0.34);
    const amp = R * (0.10 + smoothE * 0.62);

    g.globalCompositeOperation = "lighter";
    const bloomR = R * (1.4 + smoothB * 1.2 + smoothE * 1.0);
    const bloom = g.createRadialGradient(cx, cy, 0, cx, cy, bloomR);
    bloom.addColorStop(0, `hsla(186, 90%, 50%, ${0.05 + smoothE * 0.2})`);
    bloom.addColorStop(0.5, `hsla(196, 85%, 30%, ${0.025 + smoothE * 0.09})`);
    bloom.addColorStop(1, "hsla(0,0%,0%,0)");
    g.fillStyle = bloom;
    g.beginPath(); g.arc(cx, cy, bloomR, 0, Math.PI * 2); g.fill();

    const ay = rot * 1.25, ax = 0.5 + Math.sin(rot * 0.6) * 0.12;
    const cay = Math.cos(ay), say = Math.sin(ay), cax = Math.cos(ax), sax = Math.sin(ax);
    for (let i = 0; i < nV; i++) {
      const u = geo.verts[i];
      const rr = R + waveAt(seed[i], idle) * amp + smoothB * R * 0.18;
      const x = u[0] * rr, y = u[1] * rr, z = u[2] * rr;
      const x1 = x * cay + z * say, z1 = -x * say + z * cay;
      const y1 = y * cax - z1 * sax, z2 = y * sax + z1 * cax;
      proj[i] = { x: cx + x1, y: cy + y1, z: z2 };
    }

    const split = (1.5 + smoothE * 7 + tear * 22) * DPR;
    const drawEdges = (dx: number, dy: number, stroke: string, lwMul: number): void => {
      g.strokeStyle = stroke;
      geo.edges.forEach((e) => {
        const a = proj[e[0]], b = proj[e[1]];
        const depth = (a.z + b.z) / (2 * R);
        let ax2 = a.x + dx, bx2 = b.x + dx;
        if (tear > 0.2 && Math.random() < tear * 0.25) { const t = (Math.random() - 0.5) * amp * 2; ax2 += t; bx2 -= t; }
        g.globalAlpha = 0.18 + (depth + 1) * 0.42;
        g.lineWidth = (0.7 + (depth + 1) * 0.5) * lwMul * DPR;
        g.beginPath(); g.moveTo(ax2, a.y + dy); g.lineTo(bx2, b.y + dy); g.stroke();
      });
      g.globalAlpha = 1;
    };
    const flick = Math.random() < 0.06 + tear * 0.4 ? 0.4 : 1;
    drawEdges(-split, (Math.random() - 0.5) * tear * 5, `hsla(4, 95%, 60%, ${0.55 * flick})`, 1.1);
    drawEdges(split, (Math.random() - 0.5) * tear * 5, `hsla(186, 100%, 58%, ${0.8 * flick})`, 1.1);
    drawEdges(split * 0.4, -split * 0.3, `hsla(38, 100%, 60%, ${0.4 * flick})`, 0.9);
    drawEdges(0, 0, `hsla(0, 0%, 96%, ${0.22 * flick})`, 0.8);

    for (let i = 0; i < nV; i++) {
      const p = proj[i], depth = p.z / R;
      g.globalAlpha = 0.3 + (depth + 1) * 0.32;
      g.beginPath(); g.arc(p.x, p.y, (0.8 + (depth + 1) * 1.3) * DPR, 0, Math.PI * 2);
      g.fillStyle = depth > 0 ? "hsla(186, 100%, 72%, 1)" : "hsla(38, 90%, 60%, 1)";
      g.fill();
    }
    g.globalAlpha = 1;

    parts.forEach((p) => {
      p.a += p.spin + smoothE * 0.025;
      p.life -= 0.012 + smoothH * 0.04;
      if (p.life <= 0) { p.life = 1; p.a = Math.random() * Math.PI * 2; p.r = 0.5 + Math.random() * 1.1; }
      const f = live && !idle ? freq[p.bin] / 255 : 0.08 + Math.random() * 0.05;
      const rr = R * (1.3 + p.r) + f * R * 1.1;
      const x = cx + Math.cos(p.a + rot) * rr, y = cy + Math.sin(p.a + rot) * rr * 0.78;
      g.beginPath(); g.arc(x, y, (0.5 + f * 3) * DPR, 0, Math.PI * 2);
      g.fillStyle = `hsla(${Math.random() < 0.5 ? 38 : 186}, 95%, ${55 + f * 30}%, ${(0.1 + f * 0.7) * p.life})`;
      g.fill();
    });

    // datamosh: re-blit horizontal bands offset from where they were drawn
    if (tear > 0.12) {
      g.globalCompositeOperation = "source-over";
      const bands = 1 + Math.floor(Math.random() * (2 + tear * 4));
      for (let b = 0; b < bands; b++) {
        const y = Math.random() * H, h = (3 + Math.random() * 40) * DPR, dx = (Math.random() - 0.5) * (40 + tear * 160) * DPR;
        try { g.drawImage(canvas, 0, y, W, h, dx, y, W, h); } catch { /* zero-size band */ }
        if (Math.random() < 0.4) {
          g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.5;
          g.fillStyle = Math.random() < 0.5 ? "rgba(255,60,80,0.2)" : "hsla(186,100%,50%,0.2)";
          g.fillRect(0, y, W, h); g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
        }
      }
    }
    if (flash > 0.05) {
      g.globalCompositeOperation = "lighter";
      g.fillStyle = `hsla(186, 100%, 50%, ${flash * 0.1})`;
      g.fillRect(0, 0, W, H);
    }
  }

  window.addEventListener("resize", resize);
  return {
    canvas,
    setActive: (on: boolean) => {
      active = on;
      if (on) {
        resize();
        // No analyser until audio starts on first click — until then the orb
        // runs its idle animation, same rule the scope follows.
        if (!raf) raf = requestAnimationFrame(frame);
      }
    },
  };
}
