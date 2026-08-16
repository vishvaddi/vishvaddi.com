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

  // Touch has no hover, so the ~150 help strings were simply invisible on
  // phones (the CSS hides .wa-tooltip under pointer:coarse). Long-press any
  // [data-help] control to read its help as a dismissible bottom sheet.
  if (window.matchMedia("(pointer: coarse)").matches) {
    const sheet = el("div", "wa-help-sheet"); sheet.hidden = true;
    const sheetText = el("div", "wa-help-sheet-text");
    const sheetClose = document.createElement("button");
    sheetClose.type = "button"; sheetClose.className = "wa-help-sheet-close"; sheetClose.textContent = "✕";
    sheetClose.setAttribute("aria-label", "Dismiss help");
    sheet.append(sheetText, sheetClose);
    document.body.append(sheet);
    const hideSheet = (): void => { sheet.hidden = true; };
    sheetClose.addEventListener("click", hideSheet);

    let pressTimer = 0;
    let pressX = 0, pressY = 0;
    const cancelPress = (): void => { window.clearTimeout(pressTimer); pressTimer = 0; };
    document.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-help]");
      if (!target?.dataset.help) return;
      pressX = event.clientX; pressY = event.clientY;
      cancelPress();
      pressTimer = window.setTimeout(() => {
        sheetText.textContent = target.dataset.help ?? "";
        sheet.hidden = false;
      }, 550);
    }, { passive: true });
    document.addEventListener("pointermove", (event) => {
      if (pressTimer && Math.hypot(event.clientX - pressX, event.clientY - pressY) > 12) cancelPress();
    }, { passive: true });
    document.addEventListener("pointerup", cancelPress, { passive: true });
    document.addEventListener("pointercancel", cancelPress, { passive: true });
    // Any tap outside the sheet dismisses it — it must never trap a workflow.
    document.addEventListener("pointerdown", (event) => {
      if (!sheet.hidden && !sheet.contains(event.target as Node)) hideSheet();
    }, { passive: true });
  }
}
