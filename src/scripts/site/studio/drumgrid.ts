// Beat editor — scene selector row, 8×16 drum step grid. Lane names select
// the lane for the sampler sidebar (laneui.ts, D2) — the old inline
// sound-design panels moved there.
import { STEPS, SCENES, SCENE_LABELS, DRUMS, clip, allPats, allVels, synthLaneNotes, SYNTH_LANES, patternLengths, patternDivisions, padEvents } from "./state";
import { ac, ensureNodes, trackGain, playDrum } from "./engine";
import { saveAll } from "./persistence";
import { el, btn, stepRuler } from "./helpers";
import { ctx, gridRepainters, isGridLine } from "./ctx";
import { setCellOpacity, showVelPopup } from "./velpopup";
import { buildPatternBar } from "./patternbar";

export interface DrumGrid {
  beat: HTMLElement;
  cells: HTMLElement[][];
  sceneBtns: HTMLButtonElement[];
}

export function buildDrumGrid(deps: { onSelectLane: (r: number) => void }): DrumGrid {
  const beat = el("div", "wa-panel");

  // Scene selector row — chooses which scene every editor edits.
  const patRow = el("div", "wa-pat-row");
  patRow.append(el("span", "wa-lbl", "Scene"));
  const sceneBtns: HTMLButtonElement[] = [];
  SCENE_LABELS.forEach((label, pi) => {
    const pb = btn(label, "wa-pat-btn" + (pi === clip.sel ? " active" : "")); pb.classList.remove("wa-btn");
    pb.addEventListener("click", () => { ctx.selectScene(pi); saveAll(); });
    sceneBtns.push(pb); patRow.append(pb);
  });
  const copyBtn = btn("Copy →next", "wa-btn-sm");
  copyBtn.title = "Copy this scene (drums, pads and synth) to the next slot";
  copyBtn.addEventListener("click", () => {
    ctx.checkpoint();
    const next = (clip.sel + 1) % SCENES;
    for (let r = 0; r < 8; r++) for (let c = 0; c < STEPS; c++) {
      allPats[next][r][c] = allPats[clip.sel][r][c];
      allVels[next][r][c] = allVels[clip.sel][r][c];
    }
    SYNTH_LANES.forEach((lane) => { synthLaneNotes[lane][next] = synthLaneNotes[lane][clip.sel].map((note) => ({ ...note })); });
    patternLengths[next] = patternLengths[clip.sel]; patternDivisions[next] = patternDivisions[clip.sel];
    padEvents[next] = padEvents[clip.sel].map((event) => ({ ...event }));
    ctx.paintSession();
    saveAll(); const orig = copyBtn.textContent; copyBtn.textContent = "Copied ✓";
    setTimeout(() => { copyBtn.textContent = orig; }, 1200);
  });
  // Pattern length + rate belong here too — resizing a drum pattern used to
  // mean leaving DRUMS for the piano-roll toolbar.
  const patternBar = buildPatternBar({ compact: true });
  const stepPager = el("div", "wa-step-pager");
  const previousSteps = btn("‹", "wa-btn-sm"), stepRange = el("span", "wa-step-range"), nextSteps = btn("›", "wa-btn-sm");
  previousSteps.setAttribute("aria-label", "Previous step page"); nextSteps.setAttribute("aria-label", "Next step page");
  stepPager.append(previousSteps, stepRange, nextSteps);
  patRow.append(el("span", "wa-sep"), patternBar.root, stepPager, el("span", "wa-sep"), copyBtn);
  beat.append(patRow);

  const grid = el("div", "wa-grid");
  const ruler = stepRuler(STEPS); grid.append(ruler);
  Array.from(ruler.children).slice(1).forEach((tick, step) => { (tick as HTMLElement).dataset.stepIndex = String(step); });
  const cells: HTMLElement[][] = [];
  const laneBtns: HTMLElement[] = [];
  let painting: { on: boolean; visited: Set<string> } | null = null;
  let suppressClick = false;
  const setStep = (r: number, c: number, on: boolean, audition = false) => {
    if (allPats[clip.sel][r][c] === on) return;
    allPats[clip.sel][r][c] = on;
    const target = cells[r]?.[c]; if (!target) return;
    target.classList.toggle("on", on);
    if (on) {
      setCellOpacity(target, allVels[clip.sel][r][c]);
      if (audition) { ensureNodes(); playDrum(ac(), trackGain[r], r, allVels[clip.sel][r][c] / 127, ac().currentTime); }
    } else target.style.opacity = "";
  };

  DRUMS.forEach((name, r) => {
    // Drum row — clicking the name selects the lane in the sampler sidebar
    const rowEl = el("div", "wa-row");
    rowEl.style.setProperty("--track-colour", `var(--wa-track-${(r % 8) + 1})`);
    const lab = btn(name, "wa-drum"); lab.classList.remove("wa-btn");
    lab.addEventListener("click", () => {
      laneBtns.forEach((b, i) => b.classList.toggle("active", i === r));
      deps.onSelectLane(r);
    });
    laneBtns.push(lab);
    rowEl.append(lab);

    const rowCells: HTMLElement[] = [];
    for (let c = 0; c < STEPS; c++) {
      const cell = el("button", "wa-cell" + (isGridLine(c) ? " wa-beat" : "")) as HTMLButtonElement;
      cell.type = "button";
      cell.dataset.stepIndex = String(c);
      cell.dataset.laneIndex = String(r);
      cell.setAttribute("aria-label", `${name} step ${c + 1}`);
      if (allPats[clip.sel][r][c]) { cell.classList.add("on"); setCellOpacity(cell, allVels[clip.sel][r][c]); }
      cell.addEventListener("click", () => {
        if (suppressClick) { suppressClick = false; return; }
        ctx.checkpoint();
        setStep(r, c, !allPats[clip.sel][r][c], true);
        ctx.paintSession();
        saveAll();
      });
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault(); if (!allPats[clip.sel][r][c]) return;
        showVelPopup(r, c, cell, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
      });
      // Long-press for velocity on mobile
      let lpTimer: number | null = null;
      cell.addEventListener("touchstart", (e: TouchEvent) => {
        const t = e.touches[0]; const x = t.clientX, y = t.clientY;
        lpTimer = window.setTimeout(() => { if (allPats[clip.sel][r][c]) showVelPopup(r, c, cell, x, y); lpTimer = null; }, 500);
      }, { passive: true });
      cell.addEventListener("touchend", () => { if (lpTimer !== null) { clearTimeout(lpTimer); lpTimer = null; } });
      rowCells.push(cell); rowEl.append(cell);
    }
    cells.push(rowCells); grid.append(rowEl);
  });
  grid.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>(".wa-cell"); if (!cell || (cell as HTMLButtonElement).disabled) return;
    event.preventDefault(); ctx.checkpoint();
    const r = Number(cell.dataset.laneIndex), c = Number(cell.dataset.stepIndex), on = !allPats[clip.sel][r][c];
    painting = { on, visited: new Set([`${r}:${c}`]) }; suppressClick = true;
    grid.setPointerCapture(event.pointerId); setStep(r, c, on, true);
  });
  grid.addEventListener("pointermove", (event) => {
    if (!painting) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".wa-cell"); if (!cell || !grid.contains(cell) || (cell as HTMLButtonElement).disabled) return;
    const r = Number(cell.dataset.laneIndex), c = Number(cell.dataset.stepIndex), key = `${r}:${c}`; if (painting.visited.has(key)) return;
    painting.visited.add(key); setStep(r, c, painting.on);
  });
  const finishPaint = () => { if (!painting) return; painting = null; ctx.paintSession(); saveAll(); };
  grid.addEventListener("pointerup", finishPaint); grid.addEventListener("pointercancel", finishPaint);
  laneBtns[0]?.classList.add("active");
  let stepPage = Math.max(0, Number(localStorage.getItem("vv_studio_drum_step_page")) || 0);
  const compactSteps = window.matchMedia("(max-width: 760px), (max-height: 540px) and (pointer: coarse)");
  const pageSize = () => compactSteps.matches ? 8 : 16;
  const paintStepPage = () => {
    if (compactSteps.matches) {
      beat.insertBefore(stepPager, grid);
      stepPager.classList.add("wa-step-pager-mobile");
    } else {
      patRow.insertBefore(stepPager, copyBtn);
      stepPager.classList.remove("wa-step-pager-mobile");
    }
    const size = pageSize(), length = patternLengths[clip.sel], pages = Math.max(1, Math.ceil(length / size));
    stepPage = Math.min(stepPage, pages - 1);
    const start = stepPage * size, end = Math.min(length, start + size);
    beat.style.setProperty("--wa-visible-steps", String(size));
    stepRange.textContent = `${start + 1}–${end}`;
    previousSteps.disabled = stepPage === 0; nextSteps.disabled = stepPage >= pages - 1;
    cells.forEach((row) => row.forEach((cell, c) => {
      const outside = c >= length;
      cell.classList.toggle("wa-beat", isGridLine(c)); cell.classList.toggle("outside-pattern", outside);
      (cell as HTMLButtonElement).disabled = outside; cell.hidden = outside || c < start || c >= start + size;
    }));
    Array.from(ruler.children).slice(1).forEach((tick, c) => { (tick as HTMLElement).hidden = c >= length || c < start || c >= start + size; });
    localStorage.setItem("vv_studio_drum_step_page", String(stepPage));
  };
  previousSteps.addEventListener("click", () => { stepPage = Math.max(0, stepPage - 1); paintStepPage(); });
  nextSteps.addEventListener("click", () => { stepPage += 1; paintStepPage(); });
  compactSteps.addEventListener("change", paintStepPage);
  gridRepainters.push(paintStepPage);

  const clearBtn = btn("CLEAR", "wa-btn-sm");
  const randomBtn = btn("RANDOM", "wa-btn-sm");
  randomBtn.addEventListener("click", () => {
    ctx.checkpoint();
    for (let r = 0; r < 8; r++) for (let c = 0; c < STEPS; c++) {
      const density = r === 0 ? 0.22 : r === 1 || r === 4 ? 0.14 : r < 4 ? 0.32 : 0.08;
      allPats[clip.sel][r][c] = c < patternLengths[clip.sel] && Math.random() < density;
      allVels[clip.sel][r][c] = 72 + Math.floor(Math.random() * 55);
      cells[r][c].classList.toggle("on", allPats[clip.sel][r][c]);
      if (allPats[clip.sel][r][c]) setCellOpacity(cells[r][c], allVels[clip.sel][r][c]); else cells[r][c].style.opacity = "";
    }
    ctx.paintSession(); saveAll();
  });
  clearBtn.addEventListener("click", () => {
    ctx.checkpoint();
    for (let r = 0; r < 8; r++) for (let c = 0; c < STEPS; c++) {
      allPats[clip.sel][r][c] = false; cells[r][c].classList.remove("on"); cells[r][c].style.opacity = "";
    }
    ctx.paintSession();
    saveAll();
  });
  randomBtn.textContent = "Random"; clearBtn.textContent = "Clear";
  patRow.append(el("span", "wa-sep"), randomBtn, clearBtn);
  beat.append(grid);
  paintStepPage();

  return { beat, cells, sceneBtns };
}
