// Piano-key DOM builders — extracted verbatim from index.ts (Phase 0 split).
// Studio v2 C2: HOLD latch (tap toggles a sustained note) + mouse glissando
// (slide across keys with the button down).
import { el } from "./helpers";

const WHITE = ["C", "D", "E", "F", "G", "A", "B"];
const HAS_BLACK: Record<string, boolean> = { C: true, D: true, F: true, G: true, A: true };
/** CV-80 key expression: shift-click accents, alt-click slides. Recording
 *  reads these off the same event that sounds the note. */
export interface KeyMods { accent?: boolean; slide?: boolean }
export type NoteFn = (note: string, mods?: KeyMods) => void;
const HOLD_DRAG_PX = 16;

let latch = false;
const latched = new Set<string>();
const releasers = new Map<string, () => void>();

/** HOLD toggle — switching latch off releases everything still sounding.
 *  Also clears notes latched by the drag-right gesture. */
export function setKeysLatch(on: boolean): void {
  latch = on;
  if (!on) releaseLatched();
}
export function releaseLatched(): void {
  latched.forEach((note) => releasers.get(note)?.());
  latched.clear();
  document.querySelectorAll(".wa-key.held").forEach((k) => k.classList.remove("held"));
}

export function buildKeys(host: HTMLElement, noteOn: NoteFn, noteOff: NoteFn): void {
  for (let oct = 3; oct <= 4; oct++) {
    for (const w of WHITE) {
      const key = el("button", "wa-key") as HTMLButtonElement; key.type = "button"; key.dataset.note = `${w}${oct}`; key.setAttribute("aria-label", `${w}${oct}`); bindKey(key, `${w}${oct}`, noteOn, noteOff);
      if (HAS_BLACK[w]) {
        const bk = el("button", "wa-key wa-key-black") as HTMLButtonElement; bk.type = "button"; bk.dataset.note = `${w}#${oct}`; bk.setAttribute("aria-label", `${w} sharp ${oct}`); bindKey(bk, `${w}#${oct}`, noteOn, noteOff); key.append(bk);
      }
      host.append(key);
    }
  }
}

function bindKey(key: HTMLElement, note: string, noteOn: NoteFn, noteOff: NoteFn): void {
  const release = () => { noteOff(note); key.classList.remove("down"); };
  releasers.set(note, release);
  let pressX: number | null = null;   // drag-right-to-hold origin
  const on = (e: Event) => {
    e.preventDefault(); e.stopPropagation();
    const mouse = e as MouseEvent;
    const mods: KeyMods = { accent: !!mouse.shiftKey, slide: !!mouse.altKey };
    key.classList.toggle("accented", !!mods.accent);
    key.classList.toggle("slid", !!mods.slide);
    if (latch) {
      if (latched.has(note)) { latched.delete(note); release(); }
      else { latched.add(note); noteOn(note, mods); key.classList.add("down"); }
      return;
    }
    pressX = typeof mouse.clientX === "number" ? mouse.clientX : null;
    noteOn(note, mods); key.classList.add("down");
  };
  const off = () => {
    pressX = null;
    if (!latch && !latched.has(note) && key.classList.contains("down")) release();
  };
  key.addEventListener("mousedown", on); key.addEventListener("mouseup", off);
  key.addEventListener("mouseleave", () => { pressX = null; off(); });
  // Drag right on a key you are already holding to latch it (CV-80's
  // "drag note → to hold"). Leaving the key cancels the intent, so this does
  // not fight the glissando below.
  key.addEventListener("mousemove", (e) => {
    if (latch || pressX === null || !((e as MouseEvent).buttons & 1)) return;
    if ((e as MouseEvent).clientX - pressX > HOLD_DRAG_PX) {
      latched.add(note); key.classList.add("held"); pressX = null;
    }
  });
  // glissando: sliding onto a key with the button held plays it
  key.addEventListener("mouseenter", (e) => {
    if (!latch && (e as MouseEvent).buttons & 1) { noteOn(note); key.classList.add("down"); }
  });
  key.addEventListener("touchstart", on, { passive: false });
  key.addEventListener("touchend", (e) => { e.preventDefault(); off(); });
}

export function highlightKey(host: HTMLElement, note: string, on: boolean): void {
  const k = host.querySelector<HTMLElement>(`[data-note="${CSS.escape(note)}"]`);
  if (k) k.classList.toggle("down", on);
}
