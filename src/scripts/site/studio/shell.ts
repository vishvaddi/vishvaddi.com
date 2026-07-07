// Window chrome: title bar, LCD, transport bar, workspace tabs, the shared
// velocity popup and the undo/redo stacks. Play/stop listeners are wired by
// playback.ts; scene-dependent repaints go through ctx.

import { transport } from "./state";
import type { HistoryState } from "./state";
import { historyState, restoreHistory, saveAll } from "./persistence";
import { el, btn, help } from "./helpers";
import { ctx } from "./ctx";

export interface Shell {
  win: HTMLElement;
  titleBar: HTMLElement;
  lcd: HTMLElement;
  lcdBpm: HTMLElement;
  lcdState: HTMLElement;
  transportBar: HTMLElement;
  playBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
  songBtn: HTMLButtonElement;
  metroBtn: HTMLButtonElement;
  tutorialBtn: HTMLButtonElement;
  tabbar: HTMLElement;
  panels: HTMLElement;
  tabBtns: HTMLElement[];
  panelEls: HTMLElement[];
  activeTab(): number;
  paintTabs(): void;
}

export function buildShell(): Shell {
  const win = el("div", "wa-win");
  const titleBar = el("div", "wa-title");
  const projectName = document.createElement("input");
  projectName.className = "wa-project-name"; projectName.value = localStorage.getItem("vv_studio_name") || "Untitled beat";
  projectName.setAttribute("aria-label", "Project name");
  projectName.addEventListener("change", () => { localStorage.setItem("vv_studio_name", projectName.value.trim() || "Untitled beat"); });
  titleBar.append(el("span", "wa-title-text", "VISHAMP — STUDIO"), projectName, el("span", "wa-title-dots"));
  const lcd = el("div", "wa-lcd");
  const lcdBpm = el("span", "wa-lcd-seg", `${transport.bpm} BPM`);
  const lcdState = el("span", "wa-lcd-seg", "■ STOP");
  const saveState = el("span", "wa-save-state", "SAVED");
  window.addEventListener("vv-studio-saved", () => {
    saveState.textContent = "SAVED"; saveState.classList.add("flash");
    setTimeout(() => saveState.classList.remove("flash"), 450);
  });
  lcd.append(lcdBpm, lcdState, saveState);

  // ── Transport ──
  const transportBar = el("div", "wa-transport");
  const playBtn = btn("▶"), stopBtn = btn("■");
  const bpmDown = btn("–", "wa-btn-sm"), bpmUp = btn("+", "wa-btn-sm");
  const bpmLabel = el("span", "wa-bpm", String(transport.bpm));
  const swingIn = document.createElement("input");
  swingIn.type = "range"; swingIn.min = "0"; swingIn.max = "0.6"; swingIn.step = "0.02"; swingIn.value = "0"; swingIn.className = "wa-swing-in";
  const swingWrap = el("span", "wa-swing"); swingWrap.append(el("span", "wa-lbl", "Swing"), swingIn);
  const metroBtn = btn("Metro", "wa-toggle"), songBtn = btn(transport.songMode ? "Song" : "Session", "wa-toggle"), rotBtn = btn("⤢ Flip", "wa-btn-sm");
  const undoBtn = btn("Undo", "wa-btn-sm"), redoBtn = btn("Redo", "wa-btn-sm");
  const tutorialBtn = btn("? Tutorial", "wa-btn-sm");
  help(playBtn, "Start playback from the beginning of the current clips or song.");
  help(stopBtn, "Stop playback and clear the playhead.");
  help(metroBtn, "Toggle the metronome. It is also included in audio export while enabled.");
  help(songBtn, "Switch between looping the launched session clips and playing the arranged song chain.");
  help(undoBtn, "Restore the previous destructive edit, including chops, fills and dropped samples.");
  help(redoBtn, "Reapply the last undone edit.");
  help(rotBtn, "Expand Studio to the viewport. On portrait phones this rotates the workstation.");
  songBtn.classList.toggle("active", transport.songMode);
  transportBar.append(playBtn, stopBtn, el("span", "wa-sep"), el("span", "wa-lbl", "BPM"), bpmDown, bpmLabel, bpmUp, el("span", "wa-sep"), swingWrap, metroBtn, songBtn, el("span", "wa-sep"), undoBtn, redoBtn, tutorialBtn, rotBtn);

  // ── Undo / redo ──
  const undoStack: HistoryState[] = [], redoStack: HistoryState[] = [];
  ctx.checkpoint = (): void => {
    undoStack.push(historyState());
    if (undoStack.length > 40) undoStack.shift();
    redoStack.length = 0;
    undoBtn.disabled = undoStack.length === 0; redoBtn.disabled = true;
  };
  undoBtn.disabled = true; redoBtn.disabled = true;
  undoBtn.addEventListener("click", () => {
    const previous = undoStack.pop(); if (!previous) return;
    redoStack.push(historyState()); restoreHistory(previous); ctx.refreshVisibleState();
    undoBtn.disabled = undoStack.length === 0; redoBtn.disabled = false;
  });
  redoBtn.addEventListener("click", () => {
    const next = redoStack.pop(); if (!next) return;
    undoStack.push(historyState()); restoreHistory(next); ctx.refreshVisibleState();
    undoBtn.disabled = false; redoBtn.disabled = redoStack.length === 0;
  });

  // ── BPM / swing / metro / song mode ──
  ctx.setBpm = (v: number): void => {
    transport.bpm = Math.max(40, Math.min(240, v));
    bpmLabel.textContent = String(transport.bpm); lcdBpm.textContent = `${transport.bpm} BPM`;
  };
  bpmDown.addEventListener("click", () => ctx.setBpm(transport.bpm - 1));
  bpmUp.addEventListener("click", () => ctx.setBpm(transport.bpm + 1));
  swingIn.addEventListener("input", () => { transport.swing = Number(swingIn.value); });
  metroBtn.addEventListener("click", () => { transport.metro = !transport.metro; metroBtn.classList.toggle("active", transport.metro); });
  songBtn.addEventListener("click", () => {
    transport.songMode = !transport.songMode; songBtn.textContent = transport.songMode ? "Song" : "Session"; songBtn.classList.toggle("active", transport.songMode);
    ctx.renderSel.value = transport.songMode ? "song" : "pattern"; saveAll();
  });
  ctx.songBtn = songBtn;

  // ── Flip / fullscreen ──
  const flipBackdrop = el("div", "wa-flip-backdrop");
  const flipExit = el("div", "wa-flip-exit"); flipExit.textContent = "✕ Exit";
  document.body.append(flipBackdrop, flipExit);
  function setFlip(on: boolean): void {
    win.classList.toggle("wa-rotated", on);
    flipBackdrop.classList.toggle("on", on);
    flipExit.classList.toggle("on", on);
  }
  rotBtn.addEventListener("click", () => setFlip(!win.classList.contains("wa-rotated")));
  flipExit.addEventListener("click", () => setFlip(false));

  // ── Workspaces ──
  const tabbar = el("div", "wa-tabs"), panels = el("div", "wa-panels");
  const tabNames = ["SESSION", "MIX"];
  const tabBtns: HTMLElement[] = [], panelEls: HTMLElement[] = [];
  let storedTab = 0;
  try { const stored = JSON.parse(localStorage.getItem("vv_studio_workspace") || "{}"); storedTab = Number(stored.tab) || 0; } catch { storedTab = Number(localStorage.getItem("vv_studio_workspace")) || 0; }
  let activeTab = Math.max(0, Math.min(1, storedTab));
  tabNames.forEach((t, i) => {
    const b = btn(t, "wa-tab"); b.classList.remove("wa-btn");
    const descriptions = ["Launch clips and edit the selected drums, pads or synth track.", "Balance channels, process the master and save or export the project."];
    help(b, descriptions[i]);
    b.addEventListener("click", () => { activeTab = i; let track = "drums"; try { track = JSON.parse(localStorage.getItem("vv_studio_workspace") || "{}").track || track; } catch {} localStorage.setItem("vv_studio_workspace", JSON.stringify({ tab: i, track })); paintTabs(); });
    tabBtns.push(b); tabbar.append(b);
  });
  function paintTabs(): void {
    tabBtns.forEach((b, i) => b.classList.toggle("active", i === activeTab));
    panelEls.forEach((p, i) => { p.style.display = i === activeTab ? "block" : "none"; });
  }

  // ── Shared velocity popup ──
  const velPopup = el("div", "wa-vel-popup");
  velPopup.style.display = "none";
  const velSlider = document.createElement("input");
  velSlider.type = "range"; velSlider.min = "1"; velSlider.max = "127"; velSlider.step = "1"; velSlider.className = "wa-vel-slider";
  const velLabel = el("span", "wa-vel-num", "100");
  velPopup.append(el("span", "wa-lbl", "VEL"), velSlider, velLabel);
  document.body.append(velPopup);
  let velApply: ((v: number) => void) | null = null;
  velSlider.addEventListener("input", () => {
    const v = Number(velSlider.value); velLabel.textContent = String(v);
    velApply?.(v); saveAll();
  });
  document.addEventListener("click", (e) => { if (!velPopup.contains(e.target as Node)) velPopup.style.display = "none"; });
  ctx.setCellOpacity = (cell: HTMLElement, v: number): void => { cell.style.opacity = String(0.45 + 0.55 * (v / 127)); };
  ctx.showVelocityPopup = (value: number, x: number, y: number, apply: (v: number) => void): void => {
    velApply = apply;
    velSlider.value = String(value); velLabel.textContent = String(value);
    velPopup.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
    velPopup.style.top = `${Math.max(y - 54, 4)}px`;
    velPopup.style.display = "flex";
  };

  return {
    win, titleBar, lcd, lcdBpm, lcdState, transportBar,
    playBtn, stopBtn, songBtn, metroBtn, tutorialBtn,
    tabbar, panels, tabBtns, panelEls,
    activeTab: () => activeTab,
    paintTabs,
  };
}
