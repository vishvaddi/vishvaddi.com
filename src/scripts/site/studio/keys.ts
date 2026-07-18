// Piano-key DOM builders — extracted verbatim from index.ts (Phase 0 split).
// Studio v2 C2: HOLD latch (tap toggles a sustained note) + mouse glissando
// (slide across keys with the button down).
import { el } from "./helpers";

const WHITE = ["C", "D", "E", "F", "G", "A", "B"];
const HAS_BLACK: Record<string, boolean> = { C: true, D: true, F: true, G: true, A: true };
export type NoteFn = (note: string) => void;

let latch = false;
const latched = new Set<string>();
const releasers = new Map<string, () => void>();

/** HOLD toggle — switching latch off releases everything still sounding. */
export function setKeysLatch(on: boolean): void {
  latch = on;
  if (!on) {
    latched.forEach((note) => releasers.get(note)?.());
    latched.clear();
  }
}

export function buildKeys(host: HTMLElement, noteOn: NoteFn, noteOff: NoteFn): void {
  for (let oct = 3; oct <= 4; oct++) {
    for (const w of WHITE) {
      const key = el("button", "wa-key") as HTMLButtonElement; key.type = "button"; key.dataset.note = `${w}${oct}`; bindKey(key, `${w}${oct}`, noteOn, noteOff);
      if (HAS_BLACK[w]) {
        const bk = el("button", "wa-key wa-key-black") as HTMLButtonElement; bk.type = "button"; bk.dataset.note = `${w}#${oct}`; bindKey(bk, `${w}#${oct}`, noteOn, noteOff); key.append(bk);
      }
      host.append(key);
    }
  }
}

function bindKey(key: HTMLElement, note: string, noteOn: NoteFn, noteOff: NoteFn): void {
  const release = () => { noteOff(note); key.classList.remove("down"); };
  releasers.set(note, release);
  const on = (e: Event) => {
    e.preventDefault(); e.stopPropagation();
    if (latch) {
      if (latched.has(note)) { latched.delete(note); release(); }
      else { latched.add(note); noteOn(note); key.classList.add("down"); }
      return;
    }
    noteOn(note); key.classList.add("down");
  };
  const off = () => { if (!latch && key.classList.contains("down")) release(); };
  key.addEventListener("mousedown", on); key.addEventListener("mouseup", off);
  key.addEventListener("mouseleave", off);
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
