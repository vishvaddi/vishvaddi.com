// Beat editor — scene selector row, 8×16 drum step grid. Lane names select
// the lane for the sampler sidebar (laneui.ts, D2) — the old inline
// sound-design panels moved there.
import { STEPS, SCENES, SCENE_LABELS, DRUMS, clip, allPats, allVels, synthNotes, padEvents } from "./state";
import { ac, ensureNodes, trackGain, playDrum } from "./engine";
import { saveAll } from "./persistence";
import { el, btn, stepRuler } from "./helpers";
import { ctx, gridRepainters, isGridLine } from "./ctx";
import { setCellOpacity, showVelPopup } from "./velpopup";

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
    synthNotes[next] = synthNotes[clip.sel].map((note) => ({ ...note }));
    padEvents[next] = padEvents[clip.sel].map((event) => ({ ...event }));
    ctx.paintSession();
    saveAll(); const orig = copyBtn.textContent; copyBtn.textContent = "Copied ✓";
    setTimeout(() => { copyBtn.textContent = orig; }, 1200);
  });
  patRow.append(el("span", "wa-sep"), copyBtn);
  beat.append(patRow);

  const grid = el("div", "wa-grid");
  grid.append(stepRuler());
  const cells: HTMLElement[][] = [];
  const laneBtns: HTMLElement[] = [];

  DRUMS.forEach((name, r) => {
    // Drum row — clicking the name selects the lane in the sampler sidebar
    const rowEl = el("div", "wa-row");
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
      if (allPats[clip.sel][r][c]) { cell.classList.add("on"); setCellOpacity(cell, allVels[clip.sel][r][c]); }
      cell.addEventListener("click", () => {
        ctx.checkpoint();
        allPats[clip.sel][r][c] = !allPats[clip.sel][r][c];
        cell.classList.toggle("on", allPats[clip.sel][r][c]);
        if (allPats[clip.sel][r][c]) {
          setCellOpacity(cell, allVels[clip.sel][r][c]);
          ensureNodes(); playDrum(ac(), trackGain[r], r, allVels[clip.sel][r][c] / 127, ac().currentTime);
        } else { cell.style.opacity = ""; }
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
  laneBtns[0]?.classList.add("active");
  gridRepainters.push(() => cells.forEach((row) => row.forEach((cell, c) => cell.classList.toggle("wa-beat", isGridLine(c)))));

  const clearBtn = btn("CLEAR", "wa-btn-sm");
  clearBtn.addEventListener("click", () => {
    ctx.checkpoint();
    for (let r = 0; r < 8; r++) for (let c = 0; c < STEPS; c++) {
      allPats[clip.sel][r][c] = false; cells[r][c].classList.remove("on"); cells[r][c].style.opacity = "";
    }
    ctx.paintSession();
    saveAll();
  });
  const rowTools = el("div", "wa-row-tools"); rowTools.append(clearBtn);
  beat.append(grid, rowTools);

  return { beat, cells, sceneBtns };
}
