import { BAR_CHOICES, clip, clipLen } from "./state";
import type { TrackId } from "./state";
import { saveAll } from "./persistence";
import { el, btn } from "./helpers";
import { ctx } from "./ctx";

export function clipLengthControl(track: TrackId): HTMLElement {
  const host = el("div", "wa-clip-length"); host.dataset.track = track;
  host.append(el("span", "wa-lbl", "Length"));
  BAR_CHOICES.forEach((steps) => {
    const button = btn(`${steps / 16} BAR`, "wa-btn-sm"); button.dataset.steps = String(steps);
    button.addEventListener("click", () => { clipLen[clip.sel][track] = steps; refreshClipLengthControls(); ctx.refreshVisibleState(); saveAll(); });
    host.append(button);
  });
  queueMicrotask(refreshClipLengthControls);
  return host;
}

export function refreshClipLengthControls(): void {
  document.querySelectorAll<HTMLElement>(".wa-clip-length").forEach((host) => {
    const track = host.dataset.track as TrackId; const current = clipLen[clip.sel][track];
    host.querySelectorAll<HTMLButtonElement>("button[data-steps]").forEach((button) => button.classList.toggle("active", Number(button.dataset.steps) === current));
  });
}
