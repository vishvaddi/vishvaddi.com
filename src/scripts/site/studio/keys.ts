// Piano-key DOM builders — extracted verbatim from index.ts (Phase 0 split).
import { el } from "./helpers";

const WHITE = ["C", "D", "E", "F", "G", "A", "B"];
const HAS_BLACK: Record<string, boolean> = { C: true, D: true, F: true, G: true, A: true };
export type NoteFn = (note: string) => void;

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
  const on = (e: Event) => { e.preventDefault(); e.stopPropagation(); noteOn(note); key.classList.add("down"); };
  const off = () => { noteOff(note); key.classList.remove("down"); };
  key.addEventListener("mousedown", on); key.addEventListener("mouseup", off);
  key.addEventListener("mouseleave", () => { if (key.classList.contains("down")) off(); });
  key.addEventListener("touchstart", on, { passive: false });
  key.addEventListener("touchend", (e) => { e.preventDefault(); off(); });
}

export function highlightKey(host: HTMLElement, note: string, on: boolean): void {
  const k = host.querySelector<HTMLElement>(`[data-note="${CSS.escape(note)}"]`);
  if (k) k.classList.toggle("down", on);
}
