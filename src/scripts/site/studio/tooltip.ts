// Delegated hover/focus tooltips for [data-help] — extracted verbatim from
// index.ts (Phase 0 split). Document-global; call once.
import { el } from "./helpers";

export function initTooltips(): void {
  const tooltip = el("div", "wa-tooltip"); tooltip.hidden = true;
  document.body.append(tooltip);
  let tooltipTarget: HTMLElement | null = null;
  let tooltipTimer = 0;
  function positionTooltip(target: HTMLElement): void {
    const rect = target.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const fitsAbove = rect.top - tipRect.height - 8 >= 0;
    const top = fitsAbove ? rect.top - tipRect.height - 8 : Math.min(window.innerHeight - tipRect.height - 8, rect.bottom + 8);
    tooltip.style.top = `${Math.max(8, top)}px`;
    tooltip.style.left = `${Math.min(window.innerWidth - 268, Math.max(8, rect.left))}px`;
  }
  function showTooltipNow(target: HTMLElement): void {
    const text = target.dataset.help; if (!text) return;
    tooltipTarget = target;
    tooltip.textContent = text; tooltip.hidden = false;
    positionTooltip(target);
  }
  function showTooltip(target: HTMLElement, delayMs: number): void {
    window.clearTimeout(tooltipTimer);
    tooltipTimer = window.setTimeout(() => showTooltipNow(target), delayMs);
  }
  function hideTooltip(target: HTMLElement): void {
    window.clearTimeout(tooltipTimer);
    if (tooltipTarget === target) { tooltip.hidden = true; tooltipTarget = null; }
  }
  document.addEventListener("pointerover", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-help]");
    if (target && target !== tooltipTarget) showTooltip(target, 900);
  });
  document.addEventListener("pointerout", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-help]");
    if (target) hideTooltip(target);
  });
  document.addEventListener("focusin", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-help]");
    if (target) showTooltip(target, 550);
  });
  document.addEventListener("focusout", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-help]");
    if (target) hideTooltip(target);
  });
  document.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-help]");
    if (target) hideTooltip(target);
  });
}
