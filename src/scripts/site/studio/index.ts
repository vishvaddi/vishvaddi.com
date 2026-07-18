import "../../../styles/studio.css";

// VishAmp Studio — Winamp-styled mini-DAW. Pure Web Audio, CSP-clean.
// Session workflow: each track (drums / pads / synth) plays its own clip from
// the 8 scenes, Ableton-style; launches apply on the next pattern boundary.

import {
  STEPS, SCENES, SCENE_LABELS, DRUMS, PAD_BANK_SIZE, ROLL_NOTES,
  TRACKS, TRACK_LABELS, clip, transport, stepDur, audible,
  allPats, allVels, synthNotes, padEvents, arrangement,
  sampleParams, sampleBuffers, sampleData, dp, DP_DEF, DP_SPECS, mpc, rackState, fx, vsynthPatch, mute, solo,
} from "./state";
import type { ArrangeBlock, HistoryState, MpcState, PadEvent, SamplerP, TrackId, VNote } from "./state";
import {
  ac, ensureNodes, trackGain,
  initReverb, initDelay, applyFxState, metroClick,
  playDrum, playPad,
  reversedBuffer, hydrateSample, crushBuffer,
} from "./engine";
import * as engine from "./engine";
import { playNote, LiveVoices, PRESETS, PRESET_CATEGORIES, TABLE_NAMES, MOD_SRCS, MOD_DESTS, sampleWaveform, noteToMidi, midiToNote } from "./vsynth";
import type { ModSlot, VPatch } from "./vsynth";
import {
  saveAll, historyState, restoreHistory, projectState, loadAll, applyProject, pendingProjectStore,
} from "./persistence";
import {
  el, btn, help, sliderRow, download,
  dataUrlToBytes, readAsDataUrl, blobAsDataUrl,
  equalSlices, transientSlices, snapZero, euclideanPattern, drawWaveform, drawScope, drawEnvelopeShape,
  encodeWav, encodeMp3,
} from "./helpers";
import { initTooltips } from "./tooltip";
import { buildKeys, highlightKey } from "./keys";
import { buildProjectExport } from "./render";
import { buildScratchpad } from "./scratch";
import { buildSession } from "./session";
import { buildMixer } from "./mixerui";
import { ctx, playhead, gridRepainters, isGridLine, stepsPerGridLine } from "./ctx";
import { setCellOpacity, showVelPopup, showVelocityPopup } from "./velpopup";
import { buildDrumGrid } from "./drumgrid";
import { buildPads } from "./padsui";
import { buildRack } from "./rackui";
import { buildChop } from "./chopui";
import { buildSynth } from "./synthui";
import { buildDeviceRack } from "./fxrack";
import { buildTutorial } from "./tutorial";
import { buildPlayback } from "./playback";
import { knob } from "./knob";
import { bindKeyboard } from "./keymap";
import { buildLayout } from "./layout";

// One color per scene (A-H), distinct from the accent/amber/blue already
// used for state (playhead.playing/queued/selected) — identity, not status.
// ─── Main ────────────────────────────────────────────────────────────────────
export async function initStudio(): Promise<void> {
  const root = document.getElementById("studio");
  if (!root) return;

  const pending = await Promise.race([
    pendingProjectStore("get").catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 800)),
  ]);
  if (pending) applyProject(pending); else loadAll();
  sampleData.forEach((data, r) => { if (data) void hydrateSample(r); });

  // ── Tooltips ── delegated hover/focus rendering of [data-help] — see tooltip.ts
  initTooltips();

  const win = el("div", "wa-win");
  const titleBar = el("div", "wa-title");
  const projectName = document.createElement("input");
  projectName.className = "wa-project-name"; projectName.value = localStorage.getItem("vv_studio_name") || "Untitled beat";
  projectName.setAttribute("aria-label", "Project name");
  projectName.addEventListener("change", () => { localStorage.setItem("vv_studio_name", projectName.value.trim() || "Untitled beat"); });
  // CV-80 header hardware: POWER (master mute with phosphor LED) + MASTER knob
  const powerBtn = el("button", "wa-power on") as HTMLButtonElement;
  powerBtn.type = "button";
  powerBtn.append(el("span", "wa-power-led"), document.createTextNode("POWER"));
  help(powerBtn, "Master output on/off — the polite panic button.");
  let masterLevel = 0.8;
  powerBtn.addEventListener("click", () => {
    ensureNodes();
    const on = !powerBtn.classList.contains("on");
    powerBtn.classList.toggle("on", on);
    engine.master!.gain.value = on ? masterLevel : 0;
  });
  const masterKnob = knob("Master", 0, 1, masterLevel, 0.01, (v) => {
    masterLevel = v;
    ensureNodes();
    if (powerBtn.classList.contains("on")) engine.master!.gain.value = v;
  });
  help(masterKnob.root, "Master output level — the same gain the mixer's MASTER fader controls.");
  const fsBtn = btn("⛶", "wa-btn-sm wa-fs-btn");
  help(fsBtn, "Fullscreen — the studio takes the whole display; Esc exits.");
  fsBtn.addEventListener("click", () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void win.requestFullscreen();
  });
  titleBar.append(el("span", "wa-title-text", "VISHAMP — STUDIO"), projectName, el("span", "wa-title-dots"), fsBtn, powerBtn, masterKnob.root);
  const lcd = el("div", "wa-lcd");
  const lcdBpm = el("span", "wa-lcd-seg", `${transport.bpm} BPM`);
  const lcdState = el("span", "wa-lcd-seg", "■ STOP");
  const lcdMode = el("span", "wa-lcd-seg wa-lcd-mode", "");
  const saveState = el("span", "wa-save-state", "SAVED");
  window.addEventListener("vv-studio-saved", () => {
    saveState.textContent = "SAVED"; saveState.classList.add("flash");
    setTimeout(() => saveState.classList.remove("flash"), 450);
  });
  lcd.append(lcdBpm, lcdState, lcdMode, saveState);

  // ── Transport ──
  const transportBar = el("div", "wa-transport");
  const playBtn = btn("▶"), stopBtn = btn("■");
  const bpmDown = btn("–", "wa-btn-sm"), bpmUp = btn("+", "wa-btn-sm");
  const bpmInput = document.createElement("input");
  bpmInput.type = "number"; bpmInput.min = "40"; bpmInput.max = "240"; bpmInput.value = String(transport.bpm); bpmInput.className = "wa-bpm";
  help(bpmInput, "Type an exact tempo, or use the – / + buttons.");
  const swingIn = document.createElement("input");
  swingIn.type = "range"; swingIn.min = "0"; swingIn.max = "0.6"; swingIn.step = "0.02"; swingIn.value = "0"; swingIn.className = "wa-swing-in";
  const swingWrap = el("span", "wa-swing"); swingWrap.append(el("span", "wa-lbl", "Swing"), swingIn);
  const metroBtn = btn("Metro", "wa-toggle"), songBtn = btn(transport.songMode ? "Arrange" : "Session", "wa-toggle");
  const countBtn = btn("Count-in", "wa-toggle");
  let countIn = localStorage.getItem("vv_studio_countin") === "1";
  countBtn.classList.toggle("active", countIn);
  countBtn.addEventListener("click", () => {
    countIn = !countIn;
    countBtn.classList.toggle("active", countIn);
    localStorage.setItem("vv_studio_countin", countIn ? "1" : "0");
  });
  help(countBtn, "One bar of metronome before playback starts while recording is armed (pads or keys) — settle your hands, then play.");
  const metroVolIn = document.createElement("input");
  metroVolIn.type = "range"; metroVolIn.min = "0"; metroVolIn.max = "1"; metroVolIn.step = "0.05"; metroVolIn.value = String(transport.metroVolume); metroVolIn.className = "wa-swing-in";
  help(metroVolIn, "Metronome click volume.");
  const gridSel = document.createElement("select");
  [["0", "Off"], ["4", "1/4"], ["8", "1/8"], ["16", "1/16"]].forEach(([value, label]) => {
    const o = document.createElement("option"); o.value = value; o.textContent = label; gridSel.append(o);
  });
  gridSel.value = String(transport.quantizeGrid);
  help(gridSel, "Snap/grid for the editors. Off = free, unquantized placement in the piano roll (Cubase-style); 1/4–1/16 snap to the grid.");
  const undoBtn = btn("Undo", "wa-btn-sm"), redoBtn = btn("Redo", "wa-btn-sm");
  const tutorialBtn = btn("? Tutorial", "wa-btn-sm");
  help(playBtn, "Start playback from the beginning of the current clips or song.");
  help(stopBtn, "Stop playback and clear the playhead.");
  help(metroBtn, "Toggle the metronome. It is also included in audio export while enabled.");
  ctx.songBtn = songBtn;
  help(songBtn, "Switch between looping the launched session clips and playing each track's own arrangement.");
  help(undoBtn, "Restore the previous destructive edit, including chops, fills and dropped samples.");
  help(redoBtn, "Reapply the last undone edit.");
  help(tutorialBtn, "Open the guided tour, or switch to Browse Help for a searchable reference and keyboard shortcuts.");
  songBtn.classList.toggle("active", transport.songMode);
  transportBar.append(
    playBtn, stopBtn, el("span", "wa-sep"), el("span", "wa-lbl", "BPM"), bpmDown, bpmInput, bpmUp, el("span", "wa-sep"),
    swingWrap, el("span", "wa-lbl", "Grid"), gridSel, metroBtn, metroVolIn, countBtn, songBtn, el("span", "wa-sep"),
    undoBtn, redoBtn, tutorialBtn,
  );
  const undoStack: HistoryState[] = [], redoStack: HistoryState[] = [];
  function checkpoint(): void {
    undoStack.push(historyState());
    if (undoStack.length > 40) undoStack.shift();
    redoStack.length = 0;
    undoBtn.disabled = undoStack.length === 0; redoBtn.disabled = true;
  }
  undoBtn.disabled = true; redoBtn.disabled = true;
  ctx.checkpoint = checkpoint;

  // ── Shared velocity popup ── (velpopup.ts — Phase 0 split)

  // ── Beat ── (drumgrid.ts — Phase 0 split)
  const { beat, cells, sceneBtns } = buildDrumGrid();

  // ── Project / export ── (render.ts — Phase 0 split; built before pads so
  // the resample feature can take renderBuffer directly)
  const { panel: exp, renderSel, renderBuffer } = buildProjectExport();
  ctx.renderSel = renderSel;

  // ── MPC performance ── (padsui.ts — Phase 0 split)
  const { mpcPanel, padSeqPanel, padButtons, paintMpcPads, paintEventLane, triggerPerformancePad, padGrid, eventLane, selectedPadLabel, selectedSampleEditor } = buildPads({ renderBuffer });

  // ── Drum rack / sampler ── (rackui.ts — Phase 0 split)
  const rack = buildRack();

  // ── Chop / sample capture ── (chopui.ts — Phase 0 split)
  const { chop, getChopBuffer, waveform } = buildChop({ paintMpcPads, paintEventLane });

  // ── Synth: VV-1 wavetable ── (synthui.ts — Phase 0 split)
  const synth = buildSynth();
  const { synthPanel, synthKeys, liveKeys, rollPlayheadBar, paintRoll, renderPatchEditor, recordSynthOn, recordSynthOff, setOctaveShift, presetRow, pianoRoll } = synth;

  // ── Session view ── (session.ts — Phase 0 split)
  const { song, launchStatus, paintSession, arrangeLanePaints, sessionGrid, arrangeLanes } = buildSession();
  ctx.paintSession = paintSession;

  // ── Mixer ── (mixerui.ts — Phase 0 split)
  const mixer = buildMixer();

  // ── Modular device rack ── (fxrack.ts — Phase 0 split)
  const devicePanel = buildDeviceRack({ paintEventLane });

  // Project/export built earlier (render.ts) — panel mounted here.

  // ── Layout ── (layout.ts — one-screen frame; rail/editor/inspector/drawer)
  const inspector = el("aside", "wa-inspector");
  inspector.append(el("div", "wa-inspector-title", "SELECTED PAD"), selectedPadLabel, selectedSampleEditor);
  // ── Vinyl scratchpad ── (scratch.ts — Phase 0 split)
  const scratchPanel = buildScratchpad(getChopBuffer);

  const layout = buildLayout({
    beat, mpcPanel, padSeqPanel, padGrid, pianoRoll, synthKeys,
    keysHeader: synth.keysHeader, synthPanel,
    sessionGrid, launchStatus, song, mixer, devicePanel, exp,
    rack, chop, scratchPanel, inspector,
    onSynthVisible: () => synth.waveRedraws().forEach((fn) => fn()),
    onModeChange: (label) => { lcdMode.textContent = label; },
  });
  const tabBtns = layout.navButtons;
  win.append(titleBar, lcd, layout.modeBar, transportBar, layout.workarea);
  root.append(win);
  // Fit the chassis to the viewport remainder below the site nav — the CSS
  // 100dvh height assumed the win started at the top of the document.
  const fitWin = () => {
    if (document.fullscreenElement === win) { win.style.height = "100dvh"; return; }
    const top = Math.round(win.getBoundingClientRect().top + window.scrollY);
    win.style.height = `max(480px, calc(100dvh - ${top}px - 8px))`;
  };
  fitWin();
  window.addEventListener("resize", fitWin);
  document.addEventListener("fullscreenchange", fitWin);

  // ── Help and tutorial ── (tutorial.ts — Phase 0 split)
  const { showTutorialStep } = buildTutorial({
    tabBtns, padGrid, selectedSampleEditor, waveform, eventLane, pianoRoll,
    gridSel, presetRow, sessionGrid, arrangeLanes, devicePanel, exp,
    transportBar, tutorialBtn,
  });
  tutorialBtn.addEventListener("click", () => showTutorialStep(0));

  // ── Scene selection + repaint ──
  function selectScene(scene: number): void {
    clip.sel = Math.max(0, Math.min(SCENES - 1, scene));
    sceneBtns.forEach((b, i) => b.classList.toggle("active", i === clip.sel));
    cells.forEach((row, r) => row.forEach((cell, c) => {
      const on = allPats[clip.sel][r][c]; cell.classList.toggle("on", on);
      if (on) setCellOpacity(cell, allVels[clip.sel][r][c]); else cell.style.opacity = "";
    }));
    paintRoll();
    paintEventLane();
    paintSession();
    arrangeLanePaints.forEach((fn) => fn());
  }
  function refreshVisibleState(): void {
    selectScene(clip.sel);
    arrangeLanePaints.forEach((fn) => fn());
    paintMpcPads(); paintEventLane(); applyFxState(); renderPatchEditor();
  }
  undoBtn.addEventListener("click", () => {
    const previous = undoStack.pop(); if (!previous) return;
    redoStack.push(historyState()); restoreHistory(previous); refreshVisibleState();
    undoBtn.disabled = undoStack.length === 0; redoBtn.disabled = false;
  });
  redoBtn.addEventListener("click", () => {
    const next = redoStack.pop(); if (!next) return;
    undoStack.push(historyState()); restoreHistory(next); refreshVisibleState();
    undoBtn.disabled = false; redoBtn.disabled = redoStack.length === 0;
  });
  function setBpm(v: number): void {
    transport.bpm = Math.max(40, Math.min(240, Math.round(v) || transport.bpm));
    bpmInput.value = String(transport.bpm); lcdBpm.textContent = `${transport.bpm} BPM`; saveAll();
  }
  ctx.setBpm = setBpm;
  bpmDown.addEventListener("click", () => setBpm(transport.bpm - 1));
  bpmUp.addEventListener("click", () => setBpm(transport.bpm + 1));
  bpmInput.addEventListener("change", () => setBpm(Number(bpmInput.value)));
  bpmInput.addEventListener("keydown", (event) => { if (event.key === "Enter") bpmInput.blur(); });
  swingIn.addEventListener("input", () => { transport.swing = Number(swingIn.value); });
  metroBtn.addEventListener("click", () => { transport.metro = !transport.metro; metroBtn.classList.toggle("active", transport.metro); saveAll(); });
  metroVolIn.addEventListener("input", () => { transport.metroVolume = Number(metroVolIn.value); saveAll(); });
  gridSel.addEventListener("change", () => {
    transport.quantizeGrid = Number(gridSel.value); saveAll();
    gridRepainters.forEach((fn) => fn());
  });
  songBtn.addEventListener("click", () => {
    transport.songMode = !transport.songMode; songBtn.textContent = transport.songMode ? "Arrange" : "Session"; songBtn.classList.toggle("active", transport.songMode);
    renderSel.value = transport.songMode ? "song" : "pattern"; saveAll();
  });
  // ── Transport / scheduler ── (playback.ts — Phase 0 split)
  ctx.selectScene = selectScene;
  ctx.isPlaying = () => playhead.playing;
  buildPlayback({ cells, rollPlayheadBar, launchStatus, lcdState, playBtn, stopBtn, getCountIn: () => countIn, isSynthRec: synth.isSynthRec });

  // ── Keyboard ── (keymap.ts — Phase 0 split)
  bindKeyboard({ getActiveMode: layout.getActiveMode, padButtons, triggerPerformancePad, synth, playBtn, stopBtn, undoBtn, redoBtn });

  // Initial paint reflects loaded project state (scene selection, session grid).
  selectScene(clip.sel);
  // First-time visitors get the guided tour automatically; the flag was
  // already written on close/finish, it just had nothing reading it back.
  if (!localStorage.getItem("vv_studio_tutorial_seen")) showTutorialStep(0);
}

// Key builders live in keys.ts (Phase 0 split).
