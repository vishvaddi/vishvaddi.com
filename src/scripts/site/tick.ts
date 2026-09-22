// Animates a number changing in place (e.g. a live calc result) instead of
// snapping, so a recalculated stat reads as "updated" rather than "reset".
// First paint must stay instant — callers only reach here on a subsequent
// recompute, and the empty-previous-text check below is the second guard.
export interface TickOptions {
  duration?: number;
  plain?: boolean;
}

const inFlight = new WeakMap<HTMLElement, number>();

// Programmatic fills (a URL-prefilled calculator, a loaded project) should land
// instantly; only a person's own edit earns the tick.
let instantDepth = 0;
export function instantTicks<T>(fn: () => T): T {
  instantDepth++;
  try { return fn(); } finally { instantDepth--; }
}

// First numeric run: optional thousands separators + decimal part. Sign/currency
// glyphs and any trailing unit text are left in the surrounding prefix/suffix.
const NUM_RE = /-?\d[\d,]*(?:\.\d+)?/;

function parseNum(raw: string): { value: number; decimals: number } {
  const dot = raw.indexOf(".");
  return {
    value: parseFloat(raw.replace(/,/g, "")),
    decimals: dot === -1 ? 0 : raw.length - dot - 1,
  };
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function tickText(el: HTMLElement, next: string, opts: TickOptions = {}): void {
  const pending = inFlight.get(el);
  if (pending !== undefined) {
    cancelAnimationFrame(pending);
    inFlight.delete(el);
  }

  const prev = el.textContent ?? "";
  if (prev === next) return;

  const targetMatch = next.match(NUM_RE);
  const prevMatch = prev.match(NUM_RE);

  if (instantDepth > 0 || opts.plain || reducedMotion() || !targetMatch || !prevMatch || !el.isConnected) {
    el.classList.remove("tick-live");
    el.textContent = next;
    return;
  }

  const duration = opts.duration ?? 260;
  const { value: fromValue } = parseNum(prevMatch[0]);
  const { value: toValue, decimals } = parseNum(targetMatch[0]);
  const prefix = next.slice(0, targetMatch.index);
  const suffix = next.slice((targetMatch.index ?? 0) + targetMatch[0].length);

  el.classList.add("tick-live");
  const start = performance.now();

  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) * (1 - t); // ease-out
    const value = fromValue + (toValue - fromValue) * eased;
    const formatted = value.toLocaleString("en-AU", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    el.textContent = prefix + formatted + suffix;
    if (t < 1) {
      inFlight.set(el, requestAnimationFrame(frame));
    } else {
      el.textContent = next;
      el.classList.remove("tick-live");
      inFlight.delete(el);
    }
  };

  inFlight.set(el, requestAnimationFrame(frame));
}
