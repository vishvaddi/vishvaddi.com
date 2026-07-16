// Shared velocity popup + cell-opacity helper — extracted verbatim from
// index.ts (Phase 0 split). One floating slider serves the drum grid, the
// pad-event lane and the piano roll.
import { clip, allVels } from "./state";
import { saveAll } from "./persistence";
import { el } from "./helpers";

const velPopup = el("div", "wa-vel-popup");
velPopup.style.display = "none";
const velSlider = document.createElement("input");
velSlider.type = "range"; velSlider.min = "1"; velSlider.max = "127"; velSlider.step = "1"; velSlider.className = "wa-vel-slider";
const velLabel = el("span", "wa-vel-num", "100");
velPopup.append(el("span", "wa-lbl", "VEL"), velSlider, velLabel);
let velApply: ((v: number) => void) | null = null;
let mounted = false;

function mount(): void {
  if (mounted) return;
  mounted = true;
  document.body.append(velPopup);
  velSlider.addEventListener("input", () => {
    const v = Number(velSlider.value); velLabel.textContent = String(v);
    velApply?.(v); saveAll();
  });
  document.addEventListener("click", (e) => { if (!velPopup.contains(e.target as Node)) velPopup.style.display = "none"; });
}

export function setCellOpacity(cell: HTMLElement, v: number): void { cell.style.opacity = String(0.45 + 0.55 * (v / 127)); }

export function showVelocityPopup(value: number, x: number, y: number, apply: (v: number) => void): void {
  mount();
  velApply = apply;
  velSlider.value = String(value); velLabel.textContent = String(value);
  velPopup.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
  velPopup.style.top = `${Math.max(y - 54, 4)}px`;
  velPopup.style.display = "flex";
}

export function showVelPopup(r: number, c: number, cell: HTMLElement, x: number, y: number): void {
  showVelocityPopup(allVels[clip.sel][r][c], x, y, (v) => {
    allVels[clip.sel][r][c] = v; setCellOpacity(cell, v);
  });
}
