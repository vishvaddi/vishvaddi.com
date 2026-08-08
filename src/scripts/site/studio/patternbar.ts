// Pattern length + step rate. These are scene-level settings, so they belong
// wherever a pattern is edited — not only on the piano roll, which is where
// they used to live. Resizing a DRUM pattern meant leaving the DRUMS page.
// One builder, mounted on both surfaces, sharing state and staying in sync
// through gridRepainters.
import { clip, patternLengths, patternDivisions } from "./state";
import { saveAll } from "./persistence";
import { el } from "./helpers";
import { ctx, gridRepainters } from "./ctx";

const LENGTHS = [4, 8, 12, 16, 24, 32];
const DIVISIONS: Array<[number, string]> = [
  [3, "1/8 triplet"], [4, "1/16"], [6, "1/16 triplet"], [8, "1/32"], [12, "1/32 triplet"],
];

export interface PatternBar { root: HTMLElement; sync: () => void }

export function buildPatternBar(opts: { compact?: boolean; onChange?: () => void } = {}): PatternBar {
  const root = el("div", "wa-patternbar" + (opts.compact ? " compact" : ""));

  const lengthSelect = document.createElement("select");
  lengthSelect.setAttribute("aria-label", "Pattern length");
  LENGTHS.forEach((v) => lengthSelect.append(new Option(`${v} steps`, String(v))));

  const divisionSelect = document.createElement("select");
  divisionSelect.setAttribute("aria-label", "Steps per beat");
  DIVISIONS.forEach(([v, label]) => divisionSelect.append(new Option(label, String(v))));

  const sync = (): void => {
    lengthSelect.value = String(patternLengths[clip.sel]);
    divisionSelect.value = String(patternDivisions[clip.sel]);
  };
  const commit = (): void => {
    saveAll();
    gridRepainters.forEach((fn) => fn());
    opts.onChange?.();
  };
  lengthSelect.addEventListener("change", () => {
    ctx.checkpoint();
    patternLengths[clip.sel] = Number(lengthSelect.value);
    commit();
  });
  divisionSelect.addEventListener("change", () => {
    ctx.checkpoint();
    patternDivisions[clip.sel] = Number(divisionSelect.value);
    commit();
  });

  root.append(el("span", "wa-lbl", "Len"), lengthSelect, el("span", "wa-lbl", "Rate"), divisionSelect);
  sync();
  gridRepainters.push(sync);
  return { root, sync };
}
