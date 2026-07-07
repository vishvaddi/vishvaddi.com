// Drum step grid (Sequence workspace): scene selector row, the 8×16 step
// grid with velocity editing, per-drum sound-design panels and pattern tools.

import {
  STEPS, SCENES, SCENE_LABELS, DRUMS, clip,
  allPats, allVels, synthNotes, padEvents, sampleParams, dp, DP_DEF, DP_SPECS,
} from "./state";
import { ac, ensureNodes, trackGain, playDrum } from "./engine";
import { saveAll } from "./persistence";
import { el, btn } from "./helpers";
import { ctx } from "./ctx";

export interface DrumGrid {
  beat: HTMLElement;
  cells: HTMLElement[][];
  sceneBtns: HTMLButtonElement[];
}

export function buildDrumGrid(): DrumGrid {
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
  const cells: HTMLElement[][] = [];
  const sdPanels: HTMLElement[] = [];

  function showVelPopup(r: number, c: number, cell: HTMLElement, x: number, y: number): void {
    ctx.showVelocityPopup(allVels[clip.sel][r][c], x, y, (v) => {
      allVels[clip.sel][r][c] = v; ctx.setCellOpacity(cell, v);
    });
  }

  DRUMS.forEach((name, r) => {
    // Drum row
    const rowEl = el("div", "wa-row");
    const lab = btn(name, "wa-drum"); lab.classList.remove("wa-btn");
    let sdOpen = false;
    lab.addEventListener("click", () => {
      sdOpen = !sdOpen;
      sdPanels[r].style.display = sdOpen ? "block" : "none";
      lab.classList.toggle("active", sdOpen);
    });
    rowEl.append(lab);

    const rowCells: HTMLElement[] = [];
    for (let c = 0; c < STEPS; c++) {
      const cell = el("button", "wa-cell" + (c % 4 === 0 ? " wa-beat" : "")) as HTMLButtonElement;
      cell.type = "button";
      if (allPats[clip.sel][r][c]) { cell.classList.add("on"); ctx.setCellOpacity(cell, allVels[clip.sel][r][c]); }
      cell.addEventListener("click", () => {
        allPats[clip.sel][r][c] = !allPats[clip.sel][r][c];
        cell.classList.toggle("on", allPats[clip.sel][r][c]);
        if (allPats[clip.sel][r][c]) {
          ctx.setCellOpacity(cell, allVels[clip.sel][r][c]);
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

    // Sound design panel (below each row, hidden by default)
    const sdPanel = el("div", "wa-sd-panel"); sdPanel.style.display = "none";
    const sdRow = el("div", "wa-sd-row");
    const specs = DP_SPECS[r];
    specs.forEach((spec) => {
      const item = el("div", "wa-sd-item");
      const inp = document.createElement("input");
      inp.type = "range"; inp.min = String(spec.min); inp.max = String(spec.max); inp.step = String(spec.step); inp.value = String(dp[r][spec.key]);
      const vout = el("span", "wa-sd-val", `${dp[r][spec.key]}${spec.unit ?? ""}`);
      inp.addEventListener("input", () => {
        const v = Number(inp.value); (dp[r][spec.key] as number) = v; vout.textContent = `${v}${spec.unit ?? ""}`; saveAll();
      });
      item.append(el("span", "wa-sd-lbl", spec.label), inp, vout);
      sdRow.append(item);
    });
    const testBtn = btn("▶ Test", "wa-btn-sm");
    testBtn.addEventListener("click", () => { ensureNodes(); playDrum(ac(), trackGain[r], r, 1, ac().currentTime); });
    const resetBtn = btn("Reset", "wa-btn-sm");
    resetBtn.addEventListener("click", () => {
      Object.assign(dp[r], DP_DEF[r]);
      sdPanel.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((inp, i) => {
        if (i >= specs.length) return;
        inp.value = String(dp[r][specs[i].key]);
        const vout = inp.nextElementSibling as HTMLElement;
        if (vout) vout.textContent = `${dp[r][specs[i].key]}${specs[i].unit ?? ""}`;
      });
      saveAll();
    });
    const actions = el("div", "wa-sd-actions"); actions.append(testBtn, resetBtn);
    sdPanel.append(sdRow, actions);
    sdPanels.push(sdPanel); grid.append(sdPanel);
  });

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
