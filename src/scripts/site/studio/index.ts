import "../../../styles/studio.css";

// VishAmp Studio — Winamp-styled mini-DAW. Pure Web Audio, CSP-clean.
// Session workflow: each track (drums / pads / synth) plays its own clip from
// the 8 scenes, Ableton-style; launches apply on the next pattern boundary.

import {
  STEPS, SCENES, SCENE_LABELS, DRUMS, PAD_BANK_SIZE, ROLL_NOTES,
  TRACKS, TRACK_LABELS, ARRANGE_TRACKS, clip, transport, stepDur, audible, song as songMeta,
  allPats, allVels, padEvents, arrangement, songEndBar,
  sampleParams, sampleBuffers, sampleData, dp, DP_DEF, DP_SPECS, mpc, rackState, fx, vsynthPatch, mute, solo, mixState,
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
import { buildLaneInspector } from "./laneui";
import { buildSession, factorySong, blankProject, quickBeatProject } from "./session";
import { buildMixer } from "./mixerui";
import { ctx, playhead, gridRepainters, isGridLine, stepsPerGridLine } from "./ctx";
import { setCellOpacity, showVelPopup, showVelocityPopup } from "./velpopup";
import { buildDrumGrid } from "./drumgrid";
import { buildPads } from "./padsui";
import { buildChop } from "./chopui";
import { buildSynth } from "./synthui";
import { buildDeviceRack } from "./fxrack";
import { buildTutorial } from "./tutorial";
import { buildPlayback } from "./playback";
import { knob } from "./knob";
import { bindKeyboard } from "./keymap";
import { buildLayout } from "./layout";
import { buildDj } from "./dj";

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
  // Boot content, in precedence order: a project handed over from an import,
  // then a saved session, then — only on a genuinely blank slate — a demo, so
  // a first-time visitor meets an instrument with something in it rather than
  // an empty grid. The demo is an ordinary project: editable, clearable and
  // overwritten by the first autosave.
  const hasSaved = !!(localStorage.getItem("vv_studio_v2") || localStorage.getItem("vv_studio_pattern"));
  if (pending) applyProject(pending);
  else if (hasSaved) loadAll();
  else applyProject(factorySong("MIDNIGHT ACID"));
  sampleData.forEach((data, r) => { if (data) void hydrateSample(r); });

  // ── Tooltips ── delegated hover/focus rendering of [data-help] — see tooltip.ts
  initTooltips();

  const win = el("div", "wa-win");
  const titleBar = el("div", "wa-title");
  const homeLink = el("a", "wa-title-text", "V / STUDIO") as HTMLAnchorElement;
  homeLink.href = "/";
  homeLink.setAttribute("aria-label", "Exit Studio and return home");
  help(homeLink, "Return to vishvaddi.com.");
  const projectName = document.createElement("input");
  // The track title now lives in the project itself (v13), so it travels with
  // saved songs and exported files instead of sitting in a stray local key.
  projectName.className = "wa-project-name"; projectName.value = songMeta.title;
  projectName.setAttribute("aria-label", "Track title"); projectName.maxLength = 48;
  projectName.addEventListener("input", () => { songMeta.title = projectName.value.slice(0, 48) || "Untitled"; saveAll(); });
  // CV-80 header hardware: POWER (master mute with phosphor LED) + MASTER knob
  const powerBtn = el("button", "wa-power") as HTMLButtonElement;
  powerBtn.type = "button";
  powerBtn.append(el("span", "wa-power-led"), document.createTextNode("POWER"));
  help(powerBtn, "Master output on/off — the polite panic button.");
  powerBtn.classList.toggle("on", mixState.power);
  powerBtn.setAttribute("aria-pressed", String(mixState.power));
  let syncMixerMaster = (_value: number): void => {};
  powerBtn.addEventListener("click", () => {
    ensureNodes();
    mixState.power = !mixState.power;
    powerBtn.classList.toggle("on", mixState.power);
    powerBtn.setAttribute("aria-pressed", String(mixState.power));
    engine.master!.gain.value = mixState.power ? mixState.masterLevel : 0;
    saveAll();
  });
  const masterKnob = knob("Master", 0, 1, mixState.masterLevel, 0.01, (v) => {
    mixState.masterLevel = v;
    ensureNodes();
    if (mixState.power) engine.master!.gain.value = v;
    syncMixerMaster(v);
    saveAll();
  });
  help(masterKnob.root, "Master output level — the same gain the mixer's MASTER fader controls.");
  const fsBtn = btn("⛶ FULL SCREEN", "wa-btn-sm wa-fs-btn");
  help(fsBtn, "Fullscreen — the studio takes the whole display; Esc exits.");
  fsBtn.addEventListener("click", () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void win.requestFullscreen();
  });
  const densityBtn = btn("SCALE 100%", "wa-btn-sm wa-density-btn");
  const densities = ["compact", "standard", "touch"] as const;
  const savedDensity = localStorage.getItem("vv_studio_density");
  let density: (typeof densities)[number] = savedDensity === "compact" || savedDensity === "standard" || savedDensity === "touch"
    ? savedDensity
    : matchMedia("(pointer: coarse)").matches || innerWidth <= 700 ? "touch" : "standard";
  const applyDensity = (): void => {
    win.dataset.density = density;
    densityBtn.textContent = density === "compact" ? "SCALE 85%" : density === "touch" ? "SCALE 115%" : "SCALE 100%";
  };
  applyDensity();
  densityBtn.addEventListener("click", () => {
    density = densities[(densities.indexOf(density) + 1) % densities.length];
    localStorage.setItem("vv_studio_density", density);
    applyDensity();
  });
  help(densityBtn, "Cycle through compact, standard and large-touch interface scales. This preference is remembered.");
  titleBar.append(homeLink, projectName, el("span", "wa-title-dots"), densityBtn, fsBtn, powerBtn, masterKnob.root);
  const lcd = el("div", "wa-lcd");
  const lcdBpm = el("span", "wa-lcd-seg", `${transport.bpm} BPM`);
  const position = el("span", "wa-position", "1.1.1");
  help(position, "Song position — bar . beat . step.");
  const lcdState = el("span", "wa-lcd-seg", "■ STOP");
  const lcdMode = el("span", "wa-lcd-seg wa-lcd-mode", "");
  const saveState = el("span", "wa-save-state", "SAVED");
  window.addEventListener("vv-studio-saved", () => {
    saveState.textContent = "SAVED"; saveState.classList.add("flash");
    setTimeout(() => saveState.classList.remove("flash"), 450);
  });
  lcd.append(lcdBpm, position, lcdState, lcdMode, saveState);
  titleBar.append(lcd);

  // ── Transport ──
  const transportBar = el("div", "wa-transport");
  const playBtn = btn("▶"), stopBtn = btn("■"), recBtn = btn("●");
  playBtn.setAttribute("aria-label", "Play"); stopBtn.setAttribute("aria-label", "Stop"); recBtn.setAttribute("aria-label", "Record");
  help(recBtn, "Arm recording — pad hits and played keys land in the scene you're editing.");
  const bpmDown = btn("–", "wa-btn-sm"), bpmUp = btn("+", "wa-btn-sm");
  const bpmInput = document.createElement("input");
  bpmInput.type = "number"; bpmInput.min = "40"; bpmInput.max = "240"; bpmInput.value = String(transport.bpm); bpmInput.className = "wa-bpm";
  help(bpmInput, "Type an exact tempo, or use the – / + buttons.");
  const swingIn = document.createElement("input");
  swingIn.type = "range"; swingIn.min = "0"; swingIn.max = "0.6"; swingIn.step = "0.02"; swingIn.value = "0"; swingIn.className = "wa-swing-in";
  const swingWrap = el("span", "wa-swing"); swingWrap.append(el("span", "wa-lbl", "Swing"), swingIn);
  const metroBtn = btn("Metro", "wa-toggle"), songBtn = btn(transport.songMode ? "Song" : "Pattern", "wa-toggle");
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
  [["0", "Off"], ["4", "1/4"], ["8", "1/8"], ["16", "1/16"], ["32", "1/32"], ["64", "1/64"]].forEach(([value, label]) => {
    const o = document.createElement("option"); o.value = value; o.textContent = label; gridSel.append(o);
  });
  gridSel.value = String(transport.quantizeGrid);
  help(gridSel, "Snap/grid for the editors. Off = free, unquantized placement in the piano roll (Cubase-style); 1/4–1/16 snap to the grid.");
  const undoBtn = btn("↶", "wa-btn-sm wa-history"), redoBtn = btn("↷", "wa-btn-sm wa-history");
  undoBtn.setAttribute("aria-label", "Undo"); redoBtn.setAttribute("aria-label", "Redo");
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
  // Recording-target chip: which scene an armed recording lands in. The old
  // behaviour recorded into the PLAYING clip while you looked at another —
  // now recording follows the visible scene, and this chip says so.
  const recChip = el("span", "wa-rec-chip");
  recChip.hidden = true;
  help(recChip, "Recording is armed — pad or key passes land in this scene (the one you're editing).");
  // EXPORT is a rare terminal action — a chassis key opening a modal, rather
  // than a panel holding permanent space on the MIX faceplate.
  const exportBtn = btn("SAVE", "wa-btn-sm wa-export-key");
  exportBtn.setAttribute("aria-label", "Save / export");
  help(exportBtn, "Render the track to WAV, MP3 or stems, or save and open project files.");
  const transportCore = el("div", "wa-transport-core");
  transportCore.append(playBtn, stopBtn, recBtn, songBtn, metroBtn, recChip, el("span", "wa-lbl", "BPM"), bpmDown, bpmInput, bpmUp, undoBtn, redoBtn, exportBtn);
  const transportTiming = el("div", "wa-transport-timing");
  transportTiming.append(swingWrap, metroVolIn, countBtn);
  const transportActions = el("div", "wa-transport-actions");
  transportActions.append(tutorialBtn);
  const transportMore = btn("⋯", "wa-btn-sm wa-transport-more");
  transportMore.setAttribute("aria-label", "More transport tools");
  transportMore.setAttribute("aria-expanded", "false");
  transportMore.addEventListener("click", () => {
    const open = win.classList.toggle("wa-tools-open");
    transportBar.classList.toggle("show-tools", open);
    transportMore.setAttribute("aria-expanded", String(open));
    transportMore.classList.toggle("active", open);
  });
  help(transportMore, "Show timing, history, export and help controls.");
  transportBar.append(transportCore, transportTiming, transportActions, transportMore);
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

  // ── Drum lane sampler sidebar ── (laneui.ts — D2)
  const laneInsp = buildLaneInspector();
  // ── Beat ── (drumgrid.ts — Phase 0 split; lane names select into the sidebar)
  const { beat, cells, sceneBtns } = buildDrumGrid({ onSelectLane: laneInsp.selectLane });

  // ── Project / export ── (render.ts — Phase 0 split; built before pads so
  // the resample feature can take renderBuffer directly)
  const { panel: exp, renderSel, renderBuffer } = buildProjectExport({
    blank: blankProject,
    quick: quickBeatProject,
    demo: () => factorySong("MIDNIGHT ACID"),
  });
  ctx.renderSel = renderSel;
  // Export panel re-housed into a modal (same <dialog> idiom as askText).
  const exportDialog = document.createElement("dialog");
  exportDialog.className = "wa-export-dialog";
  const exportClose = btn("Close", "wa-btn-sm");
  exportClose.addEventListener("click", () => exportDialog.close());
  const exportHead = el("div", "wa-export-dialog-head");
  exportHead.append(el("div", "wa-fx-title", "EXPORT / PROJECT"), exportClose);
  exportDialog.append(exportHead, exp);
  const openProjectMenu = () => { if (!exportDialog.isConnected) win.append(exportDialog); exportDialog.showModal(); };
  exportBtn.addEventListener("click", openProjectMenu);

  // ── MPC performance ── (padsui.ts — Phase 0 split)
  const { mpcPanel, padSeqPanel, padButtons, paintMpcPads, paintEventLane, triggerPerformancePad, padGrid, eventLane, selectedPadLabel, selectedSampleEditor, loadSelectedSample, recordBtn: padRecordBtn } = buildPads({ renderBuffer });
  recBtn.addEventListener("click", () => padRecordBtn.click());
  const paintRecBtn = (): void => { recBtn.classList.toggle("active", mpc.recording); recBtn.setAttribute("aria-pressed", String(mpc.recording)); };
  padRecordBtn.addEventListener("click", () => queueMicrotask(paintRecBtn));
  paintRecBtn();

  // ── Chop / sample capture ── (chopui.ts — Phase 0 split)
  const { chop, waveform, loadBreak } = buildChop({ paintMpcPads, paintEventLane });

  // ── Synth: VV-1 wavetable ── (synthui.ts — Phase 0 split)
  const synth = buildSynth();
  const { synthPanel, synthKeys, liveKeys, rollPlayheadBar, paintRoll, renderPatchEditor, recordSynthOn, recordSynthOff, setOctaveShift, presetRow, pianoRoll } = synth;
  // Grid/quantize lives with the editor it governs (the roll), not the global
  // transport — the same relocation drum pattern-length already got (drumgrid).
  const gridWrap = el("span", "wa-grid-wrap");
  gridWrap.append(el("span", "wa-lbl", "Grid"), gridSel);
  synth.keysHeader.append(gridWrap);
  // Recording-target truth: armed recording always lands in the visible scene.
  function updateRecChip(): void {
    const armed = mpc.recording || synth.isSynthRec();
    recChip.hidden = !armed;
    recChip.textContent = `REC → ${SCENE_LABELS[clip.sel]}`;
    recChip.classList.toggle("live", armed && playhead.playing);
  }
  ctx.updateRecChip = updateRecChip;

  // ── Session view ── (session.ts — Phase 0 split)
  ctx.isPlaying = () => playhead.playing;
  const { song, launchStatus, paintSession, arrangeLanePaints, sessionGrid, addCurrentToSong } = buildSession();
  ctx.paintSession = paintSession;

  // ── Mixer ── (mixerui.ts — Phase 0 split)
  const mixer = buildMixer((value) => {
    mixState.masterLevel = value;
    masterKnob.set(value);
    ensureNodes();
    if (mixState.power) engine.master!.gain.value = value;
    saveAll();
  });
  masterKnob.root.classList.add("wa-master-knob");
  syncMixerMaster = mixer.setMasterLevel;

  // ── Modular device rack ── (fxrack.ts — Phase 0 split)
  const devicePanel = buildDeviceRack({ paintEventLane });

  // Project/export built earlier (render.ts) — panel mounted here.

  // ── Layout ── (layout.ts — one-screen frame; rail/editor/inspector/drawer)
  const inspector = el("aside", "wa-inspector");
  inspector.append(el("div", "wa-inspector-title", "SELECTED PAD"), selectedPadLabel, selectedSampleEditor);
  const laneInspector = el("aside", "wa-inspector wa-lane-aside");
  laneInspector.append(laneInsp.panel);
  const dj = buildDj({ renderStudioMix: (mode) => renderBuffer(mode) });

  const layout = buildLayout({
    shell: win,
    beat, mpcPanel, padSeqPanel, padGrid, pianoRoll, synthKeys,
    keysHeader: synth.keysHeader, synthPanel, synthInspector: synth.synthInspector, xyPanel: synth.xyPanel, scope: synth.scope, chordPanel: synth.chordPanel,
    sessionGrid, launchStatus, song, djPanel: dj.root, mixer: mixer.root, devicePanel,
    chop, inspector, laneInspector, loadSelectedSample, loadBreak, addCurrentToSong, openProjectMenu, openTutorial: () => tutorialBtn.click(),
    cycleScale: () => densityBtn.click(), toggleFullscreen: () => fsBtn.click(), togglePower: () => powerBtn.click(),
    undo: () => undoBtn.click(), redo: () => redoBtn.click(),
    onSynthVisible: () => synth.waveRedraws().forEach((fn) => fn()),
    onModeChange: (label) => { lcdMode.textContent = label; },
    overlayContext: () => `for ${selectedPadLabel.textContent || "the selected pad"} · scene ${SCENE_LABELS[clip.sel]}`,
  });
  const tabBtns = layout.navButtons;
  titleBar.append(layout.menu);
  // FLM: the clip decides the editor — double-tapping a clip or lane block
  // lands in the right editor with that scene selected. No "choose a view".
  ctx.openTrackEditor = (track, scene) => {
    selectScene(scene);
    layout.selectMode(track, "edit");
  };
  // Mode keys + transport stick together while the page scrolls (Cubase-style
  // fixed toolbars) — the un-squash (E) lets every panel take natural height.
  const appBar = el("header", "wa-appbar");
  appBar.append(titleBar, transportBar);
  const stickyChrome = el("div", "wa-sticky-chrome");
  stickyChrome.append(layout.modeBar);
  win.append(appBar, stickyChrome, layout.workarea);
  root.append(win);
  // Fullscreen is the one fixed-height case: the chassis becomes the display
  // and scrolls internally.
  document.addEventListener("fullscreenchange", () => {
    win.style.height = document.fullscreenElement === win ? "100dvh" : "";
  });

  // ── Help and tutorial ── (tutorial.ts — Phase 0 split)
  const { showTutorialStep } = buildTutorial({
    tabBtns, padGrid, selectedSampleEditor, waveform, eventLane, beatGrid: beat, pianoRoll,
    gridSel, presetRow, sessionGrid, devicePanel, exportBtn, projectMenu: layout.menu,
    transportBar, tutorialBtn, djPanel: dj.root,
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
    // Scene-dependent shading (pattern length, per-lane polymeter) has to
    // follow the scene, not just the Grid selector.
    gridRepainters.forEach((fn) => fn());
    arrangeLanePaints.forEach((fn) => fn());
    updateRecChip();
  }
  function refreshVisibleState(): void {
    selectScene(clip.sel);
    arrangeLanePaints.forEach((fn) => fn());
    paintMpcPads(); paintEventLane(); applyFxState(); renderPatchEditor();
    // Chrome that reads project state directly rather than through a painter.
    // Undo already went through here; loading a whole project now does too,
    // which is why these were previously only correct after a page reload.
    bpmInput.value = String(transport.bpm);
    lcdBpm.textContent = `${transport.bpm} BPM`;
    projectName.value = songMeta.title;
    swingIn.value = String(transport.swing);
    songBtn.textContent = transport.songMode ? "Song" : "Pattern";
    songBtn.classList.toggle("active", transport.songMode);
    masterKnob.set(mixState.masterLevel);
    powerBtn.classList.toggle("on", mixState.power);
    powerBtn.setAttribute("aria-pressed", String(mixState.power));
    mixer.syncAudio();
    sampleData.forEach((data, r) => { sampleBuffers[r] = null; if (data) void hydrateSample(r); });
  }
  // Exposed so library loads can apply a project in place instead of
  // restarting the page.
  ctx.refreshVisibleState = refreshVisibleState;
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
    // Nothing to play in Song mode until the arrangement has blocks — say so
    // instead of silently toggling into silence.
    if (!transport.songMode && ARRANGE_TRACKS.every((track) => arrangement[track].length === 0)) {
      const prior = lcdState.textContent;
      lcdState.textContent = "NO SONG";
      songBtn.classList.add("wa-warn-flash");
      setTimeout(() => { songBtn.classList.remove("wa-warn-flash"); if (lcdState.textContent === "NO SONG") lcdState.textContent = prior ?? "■ STOP"; }, 1600);
      return;
    }
    transport.songMode = !transport.songMode; songBtn.textContent = transport.songMode ? "Song" : "Pattern"; songBtn.classList.toggle("active", transport.songMode);
    renderSel.value = transport.songMode ? "song" : "pattern"; saveAll();
  });
  // ── Transport / scheduler ── (playback.ts — Phase 0 split)
  ctx.selectScene = selectScene;
  buildPlayback({ cells, rollPlayheadBar, launchStatus, lcdState, position, playBtn, stopBtn, getCountIn: () => countIn, isSynthRec: synth.isSynthRec });

  // ── Keyboard ── (keymap.ts — Phase 0 split)
  bindKeyboard({ getActiveMode: layout.getActiveMode, padButtons, triggerPerformancePad, synth, playBtn, stopBtn, undoBtn, redoBtn, exportBtn, selectMode: layout.selectMode });

  // Initial paint reflects loaded project state (scene selection, session grid).
  selectScene(clip.sel);
  // First-time visitors used to get the 13-step tour thrown at them behind a
  // shade that blocked every control. Now they get a demo loaded and one
  // dismissible hint; the tour is still there behind the ? Tutorial key.
  if (!localStorage.getItem("vv_studio_tutorial_seen")) {
    const hint = el("div", "wa-firstrun-hint");
    const hintClose = btn("✕", "wa-btn-sm");
    hint.append(
      el("span", "wa-firstrun-text", "A demo is loaded — press ▶ to hear it, then edit anything. ? Tutorial for the tour."),
      hintClose,
    );
    const dismiss = (): void => { hint.remove(); localStorage.setItem("vv_studio_tutorial_seen", "1"); };
    hintClose.addEventListener("click", dismiss);
    playBtn.addEventListener("click", dismiss, { once: true });
    win.append(hint);
  }
}

// Key builders live in keys.ts (Phase 0 split).
