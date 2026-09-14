// Small canvas line/bar charts for /money. Colours come from the CSS tokens at
// draw time so a theme flip only needs a redraw; `watchTheme` provides that.

export interface Series { label: string; values: number[]; color?: string; dashed?: boolean }
export interface ChartOptions {
  xLabels?: string[];
  yFormat?: (v: number) => string;
  zeroLine?: boolean;
  fill?: boolean;
}

const css = (name: string, fallback: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function chartColours(): { accent: string; fg: string; muted: string; rule: string; second: string; third: string } {
  return {
    accent: css("--site-accent", "#2c63d6"),
    fg: css("--fg", "#1a1a1a"),
    muted: css("--muted", "#888"),
    rule: css("--rule", "#ccc"),
    second: css("--accent", "#C5683F"),
    third: css("--muted", "#888"),
  };
}

function prepare(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; W: number; H: number } | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Draw at device resolution so text stays crisp on phones.
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssW = rect.width || canvas.width || 600;
  const cssH = rect.height || canvas.height || 240;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return { ctx, W: cssW, H: cssH };
}

function niceRange(min: number, max: number): [number, number] {
  if (min === max) { const p = Math.abs(min) * 0.1 || 1; return [min - p, max + p]; }
  const p = (max - min) * 0.08;
  return [min - p, max + p];
}

export function drawLineChart(canvas: HTMLCanvasElement, series: Series[], opts: ChartOptions = {}): void {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, W, H } = p;
  const col = chartColours();
  const palette = [col.accent, col.second, col.muted];
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const padL = 56, padR = 12, padT = 14, padB = 26;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = col.muted;
  if (n < 2) {
    ctx.textAlign = "center";
    ctx.fillText("Not enough data yet.", W / 2, H / 2);
    return;
  }
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  let [minY, maxY] = niceRange(Math.min(...all), Math.max(...all));
  if (opts.zeroLine) { minY = Math.min(minY, 0); maxY = Math.max(maxY, 0); }
  const X = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const Y = (v: number) => H - padB - ((v - minY) / (maxY - minY)) * (H - padT - padB);
  const yFmt = opts.yFormat ?? ((v) => v.toFixed(0));

  ctx.strokeStyle = col.rule; ctx.lineWidth = 1;
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const v = minY + (i / 4) * (maxY - minY), y = Y(v);
    ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = col.muted; ctx.fillText(yFmt(v), padL - 6, y + 4);
  }
  if (opts.zeroLine && minY < 0 && maxY > 0) {
    ctx.strokeStyle = col.muted; ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(W - padR, Y(0)); ctx.stroke();
  }
  if (opts.xLabels?.length) {
    ctx.fillStyle = col.muted;
    const labels = opts.xLabels;
    const step = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor((W - padL - padR) / 70))));
    for (let i = 0; i < labels.length; i += step) {
      ctx.textAlign = i === 0 ? "left" : i >= labels.length - step ? "right" : "center";
      ctx.fillText(labels[i], X(i), H - padB + 16);
    }
    if ((labels.length - 1) % step !== 0) { ctx.textAlign = "right"; ctx.fillText(labels[labels.length - 1], X(labels.length - 1), H - padB + 16); }
  }

  series.forEach((s, si) => {
    const colour = s.color ?? palette[si % palette.length];
    if (opts.fill && si === 0) {
      ctx.beginPath();
      s.values.forEach((v, i) => (i === 0 ? ctx.moveTo(X(i), Y(v)) : ctx.lineTo(X(i), Y(v))));
      ctx.lineTo(X(s.values.length - 1), Y(Math.max(minY, Math.min(0, maxY)))); ctx.lineTo(X(0), Y(Math.max(minY, Math.min(0, maxY)))); ctx.closePath();
      ctx.fillStyle = colour; ctx.globalAlpha = 0.1; ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.setLineDash(s.dashed ? [5, 4] : []);
    s.values.forEach((v, i) => (i === 0 ? ctx.moveTo(X(i), Y(v)) : ctx.lineTo(X(i), Y(v))));
    ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([]);
    if (s.values.length <= 24) {
      ctx.fillStyle = colour;
      s.values.forEach((v, i) => { ctx.beginPath(); ctx.arc(X(i), Y(v), 2.5, 0, Math.PI * 2); ctx.fill(); });
    }
  });

  if (series.length > 1) {
    ctx.textAlign = "left";
    let lx = padL + 4;
    series.forEach((s, si) => {
      const colour = s.color ?? palette[si % palette.length];
      ctx.fillStyle = colour; ctx.fillRect(lx, padT - 8, 10, 3);
      ctx.fillStyle = col.fg; ctx.fillText(s.label, lx + 14, padT - 4);
      lx += 14 + ctx.measureText(s.label).width + 14;
    });
  }
}

export function drawBarChart(canvas: HTMLCanvasElement, labels: string[], values: number[], opts: ChartOptions & { compare?: number[] } = {}): void {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, W, H } = p;
  const col = chartColours();
  const padL = 56, padR = 12, padT = 12, padB = 40;
  ctx.font = "11px system-ui, sans-serif";
  if (!values.length) { ctx.fillStyle = col.muted; ctx.textAlign = "center"; ctx.fillText("Nothing to show yet.", W / 2, H / 2); return; }
  const maxV = Math.max(1, ...values, ...(opts.compare ?? []));
  const Y = (v: number) => H - padB - (v / maxV) * (H - padT - padB);
  const slot = (W - padL - padR) / values.length;
  const yFmt = opts.yFormat ?? ((v) => v.toFixed(0));
  ctx.strokeStyle = col.rule; ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const v = (i / 4) * maxV, y = Y(v);
    ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = col.muted; ctx.fillText(yFmt(v), padL - 6, y + 4);
  }
  values.forEach((v, i) => {
    const x = padL + i * slot;
    if (opts.compare) {
      ctx.fillStyle = col.muted; ctx.globalAlpha = 0.25;
      ctx.fillRect(x + slot * 0.15, Y(opts.compare[i] ?? 0), slot * 0.7, H - padB - Y(opts.compare[i] ?? 0));
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = opts.compare && v > (opts.compare[i] ?? Infinity) ? col.second : col.accent;
    ctx.fillRect(x + slot * 0.25, Y(v), slot * 0.5, H - padB - Y(v));
    ctx.save();
    ctx.translate(x + slot / 2, H - padB + 6);
    ctx.rotate(-Math.PI / 5);
    ctx.textAlign = "right"; ctx.fillStyle = col.muted;
    const label = labels[i].length > 12 ? labels[i].slice(0, 11) + "…" : labels[i];
    ctx.fillText(label, 0, 0);
    ctx.restore();
  });
}

// Calls `redraw` when the theme flips (nav toggle sets data-theme) or the OS
// scheme changes, and when the canvas resizes.
export function watchTheme(redraw: () => void, canvases: HTMLCanvasElement[] = []): void {
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
  if ("ResizeObserver" in window && canvases.length) {
    const ro = new ResizeObserver(() => redraw());
    canvases.forEach((c) => ro.observe(c));
  } else window.addEventListener("resize", redraw);
}
