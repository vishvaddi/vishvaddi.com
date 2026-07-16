import "../../../styles/studio.css";

// VishAmp Studio — Winamp-styled mini-DAW. Pure Web Audio, CSP-clean.
// Session workflow: each track (drums / pads / synth) plays its own clip from
// the 8 scenes, Ableton-style; launches apply on the next pattern boundary.

import {
  STEPS, SCENES, SCENE_LABELS, DRUMS, PAD_BANK_SIZE, ROLL_NOTES,
  TRACKS, TRACK_LABELS, clip, transport, stepDur, audible,
  allPats, allVels, synthNotes, padEvents, arrangement, arrangePos,
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
  const bpmInput = document.createElement("input");
  bpmInput.type = "number"; bpmInput.min = "40"; bpmInput.max = "240"; bpmInput.value = String(transport.bpm); bpmInput.className = "wa-bpm";
  help(bpmInput, "Type an exact tempo, or use the – / + buttons.");
  const swingIn = document.createElement("input");
  swingIn.type = "range"; swingIn.min = "0"; swingIn.max = "0.6"; swingIn.step = "0.02"; swingIn.value = "0"; swingIn.className = "wa-swing-in";
  const swingWrap = el("span", "wa-swing"); swingWrap.append(el("span", "wa-lbl", "Swing"), swingIn);
  const metroBtn = btn("Metro", "wa-toggle"), songBtn = btn(transport.songMode ? "Arrange" : "Session", "wa-toggle"), rotBtn = btn("⤢ Flip", "wa-btn-sm");
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
  [["4", "1/4"], ["8", "1/8"], ["16", "1/16 (off)"]].forEach(([value, label]) => {
    const o = document.createElement("option"); o.value = value; o.textContent = label; gridSel.append(o);
  });
  gridSel.value = String(transport.quantizeGrid);
  help(gridSel, "Snap/grid resolution for the drum, pad-event and piano-roll editors.");
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
  help(rotBtn, "Expand Studio to the viewport. On portrait phones this rotates the workstation.");
  songBtn.classList.toggle("active", transport.songMode);
  transportBar.append(
    playBtn, stopBtn, el("span", "wa-sep"), el("span", "wa-lbl", "BPM"), bpmDown, bpmInput, bpmUp, el("span", "wa-sep"),
    swingWrap, el("span", "wa-lbl", "Grid"), gridSel, metroBtn, metroVolIn, countBtn, songBtn, el("span", "wa-sep"),
    undoBtn, redoBtn, tutorialBtn, rotBtn,
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

  // ── Workspaces ──
  const tabbar = el("div", "wa-tabs"), panels = el("div", "wa-panels");
  const tabNames = ["Create", "Sequence", "Arrange", "Mix"];
  const tabBtns: HTMLElement[] = [], panelEls: HTMLElement[] = [];
  let activeTab = Math.max(0, Math.min(3, Number(localStorage.getItem("vv_studio_workspace")) || 0));
  tabNames.forEach((t, i) => {
    const b = btn(t, "wa-tab"); b.classList.remove("wa-btn");
    const descriptions = [
      "Load or record samples, chop breaks and perform on the pads.",
      "Program drums and synth notes with step and piano-roll editors.",
      "Launch clips and scenes live, or order scenes into a complete song.",
      "Shape the sound, balance tracks and save or export the project.",
    ];
    help(b, descriptions[i]);
    b.addEventListener("click", () => { activeTab = i; localStorage.setItem("vv_studio_workspace", String(i)); paintTabs(); });
    tabBtns.push(b); tabbar.append(b);
  });
  function paintTabs(): void {
    tabBtns.forEach((b, i) => b.classList.toggle("active", i === activeTab));
    panelEls.forEach((p, i) => { p.style.display = i === activeTab ? "block" : "none"; });
    // Canvases drawn while their tab is hidden measure 0 width — redraw once
    // the Sequence tab (synth waveform previews) actually becomes visible.
    if (activeTab === 1) synth.waveRedraws().forEach((fn) => fn());
  }
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

  // ── Modular device rack ──
  const devicePanel = el("div", "wa-panel");
  const fxSlider = (label: string, min: number, max: number, value: number, step: number, apply: (v: number) => void) =>
    sliderRow(label, min, max, value, step, (v) => { ensureNodes(); apply(v); applyFxState(); saveAll(); });
  const deviceHeader = (key: string, label: string): HTMLElement => {
    const header = el("div", "wa-device-header");
    const bypass = btn(rackState.devices[key] ? "ON" : "BYPASS", "wa-toggle wa-btn-sm");
    bypass.classList.toggle("active", rackState.devices[key]);
    bypass.addEventListener("click", () => {
      rackState.devices[key] = !rackState.devices[key];
      bypass.textContent = rackState.devices[key] ? "ON" : "BYPASS"; bypass.classList.toggle("active", rackState.devices[key]);
      applyFxState(); saveAll();
    });
    header.append(el("span", "wa-device-title", label), bypass);
    return header;
  };
  const combinator = el("div", "wa-combinator");
  combinator.append(el("div", "wa-fx-title", "COMBINATOR MACROS"));
  const applyMacro = (index: number, value: number) => {
    rackState.macros[index] = value;
    if (index === 0) {
      fx.compThreshold = -8 - value * 32; fx.compRatio = 2 + value * 10; fx.high = value * 5;
    } else if (index === 1) {
      fx.reverb = value * 0.5; fx.delayMix = value * 0.35; if (value > 0) { initReverb(fx.reverb); initDelay(); }
    } else if (index === 2) {
      sampleParams.forEach((pad) => { pad.filter = 18000 - value * 16800; });
    } else {
      rackState.grooveTiming = value * 0.7; rackState.grooveRandom = value * 18; rackState.grooveVelocity = value * 0.25;
    }
    applyFxState(); saveAll();
  };
  ["Dirt", "Space", "Cutoff", "Break"].forEach((name, i) => {
    combinator.append(sliderRow(name, 0, 1, rackState.macros[i], 0.01, (value) => applyMacro(i, value)));
  });
  const patchRow = el("div", "wa-export");
  const patchSelect = document.createElement("select");
  ["Clean MPC", "Dusty Hip Hop", "Jungle Pressure", "Dub Space"].forEach((name) => {
    const option = document.createElement("option"); option.value = name; option.textContent = name; patchSelect.append(option);
  });
  const loadPatchBtn = btn("Load patch", "wa-btn-sm");
  help(loadPatchBtn, "Apply a complete macro and effects preset.");
  loadPatchBtn.addEventListener("click", () => {
    const presets: Record<string, number[]> = {
      "Clean MPC": [0.05, 0, 0, 0.1],
      "Dusty Hip Hop": [0.55, 0.12, 0.18, 0.45],
      "Jungle Pressure": [0.72, 0.28, 0.08, 0.82],
      "Dub Space": [0.2, 0.9, 0.35, 0.35],
    };
    presets[patchSelect.value].forEach((value, i) => applyMacro(i, value));
    location.reload();
  });
  patchRow.append(patchSelect, loadPatchBtn); combinator.append(patchRow);

  const playerRack = el("div", "wa-device");
  const euclidControls = el("div", "wa-export");
  const euclidPulses = document.createElement("input"); euclidPulses.type = "number"; euclidPulses.min = "1"; euclidPulses.max = "16"; euclidPulses.value = "7";
  const euclidRotate = document.createElement("input"); euclidRotate.type = "number"; euclidRotate.min = "0"; euclidRotate.max = "15"; euclidRotate.value = "0";
  const euclidBtn = btn("Write Euclidean", "wa-btn-sm");
  help(euclidBtn, "Distribute a chosen number of hits evenly across the 16-step pattern.");
  euclidBtn.addEventListener("click", () => {
    const pattern = euclideanPattern(STEPS, Number(euclidPulses.value), Number(euclidRotate.value)), pad = mpc.selectedPad;
    padEvents[clip.sel] = padEvents[clip.sel].filter((event) => event.pad !== pad);
    pattern.forEach((on, step) => { if (on) padEvents[clip.sel].push({ pad, step, velocity: step % 4 === 0 ? 115 : 86, offset: 0, probability: 100, ratchets: 1 }); });
    paintEventLane(); saveAll();
  });
  euclidControls.append(el("span", "wa-lbl", "Pulses"), euclidPulses, el("span", "wa-lbl", "Rotate"), euclidRotate, euclidBtn);
  playerRack.append(
    deviceHeader("player", "PLAYER · GROOVE + NOTE ECHO"),
    sliderRow("Timing", 0, 0.75, rackState.grooveTiming, 0.01, (v) => { rackState.grooveTiming = v; saveAll(); }),
    sliderRow("Velocity", 0, 0.5, rackState.grooveVelocity, 0.01, (v) => { rackState.grooveVelocity = v; saveAll(); }),
    sliderRow("Random", 0, 40, rackState.grooveRandom, 1, (v) => { rackState.grooveRandom = v; saveAll(); }),
    sliderRow("Echoes", 0, 8, rackState.noteEcho, 1, (v) => { rackState.noteEcho = v; saveAll(); }),
    sliderRow("Echo decay", 0.1, 0.95, rackState.echoDecay, 0.01, (v) => { rackState.echoDecay = v; saveAll(); }),
    euclidControls,
  );
  const deviceRack = el("div", "wa-device-stack");
  const eqDevice = el("div", "wa-device");
  eqDevice.append(
    deviceHeader("eq", "CHANNEL EQ · low / mid / high"),
    fxSlider("LOW", -12, 12, fx.low, 0.5, (v) => { fx.low = v; }),
    fxSlider("MID", -12, 12, fx.mid, 0.5, (v) => { fx.mid = v; }),
    fxSlider("HIGH", -12, 12, fx.high, 0.5, (v) => { fx.high = v; }),
  );
  const compDevice = el("div", "wa-device");
  compDevice.append(
    deviceHeader("compressor", "BUS COMPRESSOR"),
    fxSlider("THRESH", -50, 0, fx.compThreshold, 1, (v) => { fx.compThreshold = v; }),
    fxSlider("RATIO", 1, 20, fx.compRatio, 0.5, (v) => { fx.compRatio = v; }),
  );
  const delayDevice = el("div", "wa-device");
  delayDevice.append(
    deviceHeader("delay", "FEEDBACK DELAY · parallel return"),
    fxSlider("TIME", 0.05, 1, fx.delayTime, 0.01, (v) => { fx.delayTime = v; initDelay(); }),
    fxSlider("FEEDBACK", 0, 0.85, fx.delayFeedback, 0.01, (v) => { fx.delayFeedback = v; initDelay(); }),
    fxSlider("MIX", 0, 0.6, fx.delayMix, 0.02, (v) => { fx.delayMix = v; initDelay(); }),
  );
  const reverbDevice = el("div", "wa-device");
  reverbDevice.append(
    deviceHeader("reverb", "CONVOLUTION REVERB · parallel return"),
    fxSlider("AMOUNT", 0, 0.6, fx.reverb, 0.02, (v) => { fx.reverb = v; initReverb(v); }),
  );
  const limiterDevice = el("div", "wa-device");
  limiterDevice.append(
    deviceHeader("limiter", "MASTER LIMITER"),
    fxSlider("CEILING", -12, 0, fx.limiter, 0.5, (v) => { fx.limiter = v; }),
  );
  deviceRack.append(eqDevice, compDevice, delayDevice, reverbDevice, limiterDevice);
  devicePanel.append(
    el("p", "wa-help", "Signal flow: Player → MPC Program → EQ → compressor → parallel delay/reverb → limiter."),
    combinator, playerRack, deviceRack,
  );

  // Project/export built earlier (render.ts) — panel mounted here.

  const createWorkspace = el("div", "wa-workspace");
  const sequenceWorkspace = el("div", "wa-workspace");
  const arrangeWorkspace = el("div", "wa-workspace");
  const mixWorkspace = el("div", "wa-workspace");
  const hint = (title: string, text: string): HTMLElement => {
    const box = el("div", "wa-hint");
    box.append(el("strong", "", title), document.createTextNode(` ${text}`)); return box;
  };
  const section = (title: string, content: HTMLElement): HTMLElement => {
    const host = el("section", "wa-workspace-section");
    const descriptions: Record<string, string> = {
      Pads: "Perform, record and edit the current 16-pad bank.",
      Chop: "Load or record longer audio and divide it into playable slices.",
      "Sample Rack": "Quick controls for the original drum voices and loaded samples.",
      "Drum Sequence": "Program the legacy eight-lane drum grid and adjust generated drum sounds.",
      "Synth + Piano Roll": "Design and sequence the VV-1 wavetable synth.",
      "Session + Song": "Launch clips and scenes live, or order scenes into a linear song.",
      Devices: "Apply groove, macros and the modular master processing chain.",
      Mixer: "Set drum, synth and master levels, mute or solo channels, and adjust effects.",
      "Project + Export": "Save editable project data or render finished audio.",
      Scratch: "Drag the vinyl to scratch the selected pad's sample over the beat.",
    };
    help(host, descriptions[title] ?? title);
    host.append(el("h2", "wa-section-title", title), content); return host;
  };
  // Sample Rack now opens in a slide-in drawer rather than always sitting in view.
  const rackDrawer = el("aside", "wa-drawer");
  const rackOverlay = el("div", "wa-drawer-overlay");
  const rackClose = btn("✕ Close", "wa-btn-sm");
  const rackHead = el("div", "wa-drawer-head");
  rackHead.append(el("span", "wa-drawer-title", "SAMPLE RACK"), rackClose);
  rackDrawer.append(rackHead, rack);
  const closeRack = (): void => { rackDrawer.classList.remove("open"); rackOverlay.classList.remove("open"); };
  rackClose.addEventListener("click", closeRack);
  rackOverlay.addEventListener("click", closeRack);

  const openRackBtn = btn("⊞ Sample Rack", "wa-btn-sm");
  help(openRackBtn, "Open the drum and sample voice controls in a side panel.");
  openRackBtn.addEventListener("click", () => { rackDrawer.classList.add("open"); rackOverlay.classList.add("open"); });
  const createBar = el("div", "wa-mpc-toolbar"); createBar.append(openRackBtn);

  // ── Help content — folded into the tutorial overlay below as a second
  // "browse" view (searchable reference + shortcuts), rather than a
  // separate drawer: one overlay, reached the same way, for both the
  // guided first pass and coming back later to look something up.
  const shortcutsBox = el("div", "wa-help-shortcuts");
  shortcutsBox.append(el("div", "wa-fx-title", "KEYBOARD SHORTCUTS"));
  ([
    ["Space", "Play / stop"],
    ["Ctrl+Z", "Undo"],
    ["Ctrl+Shift+Z or Ctrl+Y", "Redo"],
    ["1-4, Q-R, A-F, Z-V", "Play MPC pads (Create tab)"],
    ["Z–M row", "Play synth notes C3–B3 (Sequence tab)"],
    ["Q–P row", "Play synth notes C4–E5 (Sequence tab)"],
    ["− / =", "Shift synth keyboard octave (Sequence tab)"],
    ["Enter", "Confirm the typed BPM"],
  ] as const).forEach(([key, desc]) => {
    const row = el("div", "wa-help-shortcut-row");
    row.append(el("span", "wa-help-key", key), el("span", "wa-help-desc", desc));
    shortcutsBox.append(row);
  });

  const helpSearch = document.createElement("input");
  helpSearch.type = "text"; helpSearch.placeholder = "Search help…"; helpSearch.className = "wa-preset-search";
  const helpTopics: Array<{ section: string; title: string; text: string }> = [
    { section: "Create", title: "Pads & sampling", text: "Drop an audio file onto any pad, or record from the mic. The inspector on the right shows the selected pad's tune, start/end, filter, attack/decay, choke group, loop and warp controls." },
    { section: "Create", title: "Chopping breaks", text: "Load or record a longer break, then slice it equally, by transient detection, or manually. Sync BPM matches the project tempo to the break; Assign + pattern replays the chop across the pads." },
    { section: "Create", title: "Scratch pad", text: "Drag the vinyl left/right to scratch the selected pad's sample (or the loaded break) over the beat. Forward and backward both play; release to stop." },
    { section: "Create", title: "MPC performance tools", text: "Full Level forces max velocity; 16 Levels maps the pad bank across velocity, pitch, filter or start. Note Repeat retriggers a held pad. Rotate, Mutate, Fill and Ghosts generate variations on the selected pad's pattern; Extract Groove captures its timing/velocity feel into the Player device." },
    { section: "Sequence", title: "Drum sequencer", text: "Click a step to toggle a hit, right-click (or long-press) for velocity. Click a drum's name to open its sound-design panel below the row." },
    { section: "Sequence", title: "Pad sequence grid", text: "Every pad in the current bank gets its own row — switching the selected pad highlights its row instead of swapping what you're looking at. Velocity/Chance/Micro/Ratchet sliders apply to whichever pad is selected." },
    { section: "Sequence", title: "Piano roll", text: "Drag empty space to draw a note and set its length. Drag a note's body to move it (drag vertically to change pitch), drag its right edge to resize, click without dragging to delete, right-click for velocity. Notes snap to the Grid setting in the transport bar." },
    { section: "Sequence", title: "Grid / quantize", text: "The Grid selector in the transport bar (1/4, 1/8, 1/16) sets the snap resolution for the piano roll, and the beat-line grouping shown on the drum and pad grids." },
    { section: "Synth", title: "Oscillators & wavetables", text: "Each oscillator picks a table (Basic, PWM, Harmonic, Vocal, Digital) and a position that morphs through it. The mini waveform above each oscillator shows the current shape live." },
    { section: "Synth", title: "Text-to-wavetable", text: "Type a word into an oscillator's text box and hit Generate — it hashes into a unique, reproducible wavetable shape, saved as part of the patch." },
    { section: "Synth", title: "Filter & envelopes", text: "The filter has low/high/band-pass/notch types with resonance and envelope amount. Drag the envelope shape directly (attack peak, decay/sustain point, release end) or use the sliders below it — both stay in sync." },
    { section: "Synth", title: "LFOs & mod matrix", text: "Two LFOs and a 6-slot mod matrix route sources (LFOs, envelope 2, velocity, macros) to destinations (pitch, cutoff, amp, pan, oscillator position). A small MOD badge appears on the Cutoff and Position sliders when something is modulating them." },
    { section: "Synth", title: "Presets, Randomize & Simple view", text: "Search or filter presets by category. Randomize jitters the current patch within musical ranges. Simple view collapses the editor to Wave/Filter/Envelope/Volume for quick sound design; Advanced view shows everything including the mod matrix and macros." },
    { section: "Arrange", title: "Session view", text: "Each column is a track (drums/pads/synth), each row a scene. Launch single clips or a whole scene — changes land on the next bar so transitions stay in time." },
    { section: "Arrange", title: "Arrangement", text: "Each track keeps its own ordered list of blocks (scene + bar length), independent of the other tracks. Add, resize (+/-) or reassign a block's scene, then enable Arrange mode in the transport to play the full arrangement." },
    { section: "Mix", title: "Mixer & device rack", text: "The Mixer sets channel/synth/master levels. The Devices panel is the actual signal chain — Channel EQ, Bus Compressor, Feedback Delay, Convolution Reverb and Master Limiter each have their own editable parameters plus a bypass toggle." },
    { section: "Mix", title: "Metronome & BPM", text: "Type an exact BPM directly, or use the – / + buttons. The Metro toggle enables the click (included in export while on); its volume slider sits right beside the toggle." },
    { section: "Mix", title: "Save, export & undo", text: "Save Project downloads an editable file with all patterns, sounds and settings; Open Project loads one back. Export WAV/MP3 renders either the launched clips or the full arrangement. Undo/Redo (or Ctrl+Z / Ctrl+Shift+Z) cover pattern, sample, synth-patch and arrangement edits." },
  ];
  const helpList = el("div", "wa-help-topics");
  function renderHelpTopics(query: string): void {
    helpList.replaceChildren();
    const q = query.trim().toLowerCase();
    const matches = helpTopics.filter((t) => !q || t.title.toLowerCase().includes(q) || t.text.toLowerCase().includes(q) || t.section.toLowerCase().includes(q));
    if (!matches.length) { helpList.append(el("p", "wa-help", "No matching topics.")); return; }
    let lastSection = "";
    matches.forEach((t) => {
      if (t.section !== lastSection) { helpList.append(el("div", "wa-fx-title", t.section.toUpperCase())); lastSection = t.section; }
      const item = el("div", "wa-help-topic");
      item.append(el("h3", "wa-help-topic-title", t.title), el("p", "wa-help", t.text));
      helpList.append(item);
    });
  }
  helpSearch.addEventListener("input", () => renderHelpTopics(helpSearch.value));
  renderHelpTopics("");

  // ── Vinyl scratchpad ── (scratch.ts — Phase 0 split)
  const scratchPanel = buildScratchpad(getChopBuffer);

  createWorkspace.append(
    hint("Start here.", "Drop audio onto a pad, or load a break in Chop. Use Z–V, A–F, Q–R and 1–4 to play the 16 pads."),
    createBar,
    section("Pads", mpcPanel), section("Chop", chop), section("Scratch", scratchPanel),
  );
  sequenceWorkspace.append(
    hint("Build the loop.", "Drag across the selected-pad lane to paint or erase hits. Right-click drum steps to edit velocity."),
    section("Drum Sequence", beat), section("Pad Sequence", padSeqPanel), section("Synth + Piano Roll", synthPanel),
  );
  arrangeWorkspace.append(
    hint("Turn loops into a track.", "Launch clips per track or whole scenes, then chain scenes and enable Song mode."),
    section("Session + Song", song),
  );
  mixWorkspace.append(
    hint("Finish and preserve it.", "Shape the device chain, set levels, save an editable project, then export the audio."),
    section("Mixer", mixer), section("Devices", devicePanel), section("Project + Export", exp),
  );
  panelEls.push(createWorkspace, sequenceWorkspace, arrangeWorkspace, mixWorkspace);
  panels.append(createWorkspace, sequenceWorkspace, arrangeWorkspace, mixWorkspace);

  const inspector = el("aside", "wa-inspector");
  inspector.append(el("div", "wa-inspector-title", "SELECTED PAD"), selectedPadLabel, selectedSampleEditor);
  const workarea = el("div", "wa-workarea"); workarea.append(panels, inspector);
  win.append(titleBar, lcd, tabbar, transportBar, workarea, rackOverlay, rackDrawer);
  root.append(win);
  paintTabs();

  // ── Help and tutorial ── one overlay, two views: the guided tour (a
  // spotlight walkthrough) and Browse Help (the searchable reference built
  // above) — reached from the same "? Tutorial" button and switchable
  // mid-overlay, instead of two separate entry points.
  const tutorial = el("div", "wa-tutorial"); tutorial.hidden = true;
  const tutorialShade = el("div", "wa-tutorial-shade");
  const tutorialCard = el("div", "wa-tutorial-card");
  const tutorialStep = el("span", "wa-tutorial-step"), tutorialTitle = el("h2", "wa-tutorial-title"), tutorialText = el("p", "wa-tutorial-text");
  const tourView = el("div", "wa-tutorial-tour-view");
  tourView.append(tutorialStep, tutorialTitle, tutorialText);
  const browseView = el("div", "wa-tutorial-browse-view"); browseView.hidden = true;
  browseView.append(el("h2", "wa-tutorial-title", "Help"), shortcutsBox, el("div", "wa-sep-h"), helpSearch, helpList);
  const tutorialActions = el("div", "wa-tutorial-actions");
  const tutorialPrev = btn("Previous", "wa-btn-sm"), tutorialNext = btn("Next", "wa-btn-sm"), tutorialClose = btn("✕ Close", "wa-btn-sm");
  const browseHelpBtn = btn("Browse Help ▤", "wa-btn-sm"), takeTourBtn = btn("▶ Take the Tour", "wa-btn-sm");
  tutorialActions.append(tutorialClose, browseHelpBtn, takeTourBtn, tutorialPrev, tutorialNext);
  tutorialCard.append(tourView, browseView, tutorialActions);
  tutorial.append(tutorialShade, tutorialCard); document.body.append(tutorial);
  function setTutorialMode(mode: "tour" | "browse"): void {
    tourView.hidden = mode !== "tour";
    browseView.hidden = mode !== "browse";
    tutorialCard.classList.toggle("wa-tutorial-browsing", mode === "browse");
    tutorialPrev.hidden = mode !== "tour"; tutorialNext.hidden = mode !== "tour";
    browseHelpBtn.hidden = mode !== "tour"; takeTourBtn.hidden = mode !== "browse";
  }
  help(browseHelpBtn, "Switch to a searchable reference covering every section, plus keyboard shortcuts.");
  help(takeTourBtn, "Switch back to the guided step-by-step tour.");
  const tutorialSteps: Array<{ workspace: number; target: HTMLElement; title: string; text: string }> = [
    { workspace: 0, target: tabBtns[0], title: "Create", text: "This is the sampling and performance workspace. Start here whenever you are building a new beat." },
    { workspace: 0, target: padGrid, title: "Play the pads", text: "Use the mouse, touch, computer keyboard or MIDI controller. Drop an audio file directly onto any pad to replace it." },
    { workspace: 0, target: selectedSampleEditor, title: "Shape the selected pad", text: "The inspector follows your selected pad across every workspace. Trim, tune, filter, choke, reverse, loop or warp it here." },
    { workspace: 0, target: waveform, title: "Chop a break", text: "Load or record audio, choose equal, transient or manual slicing, then assign the slices to the active pad bank." },
    { workspace: 1, target: eventLane, title: "Sequence pad events", text: "Drag across the lane to paint or erase hits. Use velocity, chance, microtiming and ratchets to make the pattern move." },
    { workspace: 1, target: pianoRoll, title: "Add musical parts", text: "Program synth notes in the piano roll or play them from the on-screen and computer keyboards. Drag a note to move it, its right edge to resize, or click without dragging to delete it." },
    { workspace: 1, target: gridSel, title: "Grid & quantize", text: "Sets the snap resolution for the piano roll, and the beat-line grouping shown on the drum and pad grids. Coarser (1/4) locks notes to the beat; 1/16 allows free placement." },
    { workspace: 1, target: presetRow, title: "The VV-1 synth", text: "Search or randomize a patch, or drag the envelope shape and watch the live waveform preview react. Simple view collapses the editor to the essentials — Advanced view reveals the full mod matrix." },
    { workspace: 2, target: sessionGrid, title: "Launch clips and scenes", text: "Each column is a track and each row a scene. Launch single clips or a whole row — changes wait for the next bar so transitions stay in time." },
    { workspace: 2, target: arrangeLanes, title: "Arrange the song", text: "Each track keeps its own list of blocks (scene + bar length) — add, resize or reassign them, then enable Arrange mode in the transport to play them back independently." },
    { workspace: 3, target: devicePanel, title: "Process the sound", text: "Use macros, groove controls and device bypass switches to shape the complete signal chain." },
    { workspace: 3, target: exp, title: "Save and export", text: "Save an editable project before exporting. WAV preserves full quality; MP3 is smaller for sharing." },
    { workspace: 3, target: transportBar, title: "Transport stays available", text: "Playback, BPM, grid, metronome, undo and tutorial controls remain visible in every workspace. Space plays/stops; Ctrl+Z undoes." },
    { workspace: 3, target: tutorialBtn, title: "Come back anytime", text: "This same button reopens things later — Browse Help (top of this card) is a searchable reference for every section plus the full keyboard-shortcut list, or replay this tour from the start." },
  ];
  let tutorialIndex = 0, tutorialTarget: HTMLElement | null = null;
  function closeTutorial(): void {
    tutorial.hidden = true; tutorialTarget?.classList.remove("wa-tutorial-target"); tutorialTarget = null;
    localStorage.setItem("vv_studio_tutorial_seen", "1");
  }
  function showTutorialStep(index: number): void {
    setTutorialMode("tour");
    tutorialIndex = Math.max(0, Math.min(tutorialSteps.length - 1, index));
    const step = tutorialSteps[tutorialIndex];
    tutorialTarget?.classList.remove("wa-tutorial-target"); tabBtns[step.workspace].click();
    tutorialTarget = step.target; tutorialTarget.classList.add("wa-tutorial-target");
    tutorialTarget.scrollIntoView({ block: "center", behavior: "smooth" });
    tutorialStep.textContent = `${tutorialIndex + 1} / ${tutorialSteps.length}`;
    tutorialTitle.textContent = step.title; tutorialText.textContent = step.text;
    tutorialPrev.disabled = tutorialIndex === 0;
    tutorialNext.textContent = tutorialIndex === tutorialSteps.length - 1 ? "Finish" : "Next";
    tutorial.hidden = false;
  }
  function showHelpBrowse(): void {
    tutorialTarget?.classList.remove("wa-tutorial-target"); tutorialTarget = null;
    setTutorialMode("browse");
    tutorial.hidden = false;
  }
  tutorialPrev.addEventListener("click", () => showTutorialStep(tutorialIndex - 1));
  tutorialNext.addEventListener("click", () => {
    if (tutorialIndex === tutorialSteps.length - 1) closeTutorial(); else showTutorialStep(tutorialIndex + 1);
  });
  tutorialClose.addEventListener("click", closeTutorial);
  tutorialShade.addEventListener("click", closeTutorial);
  browseHelpBtn.addEventListener("click", showHelpBrowse);
  takeTourBtn.addEventListener("click", () => showTutorialStep(0));
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
  const flipBackdrop = el("div", "wa-flip-backdrop");
  const flipExit = el("div", "wa-flip-exit"); flipExit.textContent = "✕ Exit";
  document.body.append(flipBackdrop, flipExit);
  function setFlip(on: boolean) {
    win.classList.toggle("wa-rotated", on);
    flipBackdrop.classList.toggle("on", on);
    flipExit.classList.toggle("on", on);
  }
  rotBtn.addEventListener("click", () => setFlip(!win.classList.contains("wa-rotated")));
  flipExit.addEventListener("click", () => setFlip(false));

  // ── Transport / scheduler ──
  ctx.selectScene = selectScene;
  let schedTimer = 0, nextTime = 0;
  ctx.isPlaying = () => playhead.playing;
  // Arrangement playback: each track independently follows its own block list
  // (scene + bar-length), advancing at bar boundaries — replaces the old
  // single shared songChain, which forced every track onto the same scene.
  function applyArrangePos(track: TrackId): void {
    const blocks = arrangement[track];
    clip.play[track] = blocks.length ? blocks[Math.min(arrangePos[track].block, blocks.length - 1)].scene : null;
  }
  function advanceArrangeTrack(track: TrackId): void {
    const blocks = arrangement[track];
    if (!blocks.length) { arrangePos[track] = { block: 0, barInBlock: 0 }; clip.play[track] = null; return; }
    const pos = arrangePos[track];
    if (pos.block >= blocks.length) pos.block = 0;
    pos.barInBlock++;
    if (pos.barInBlock >= blocks[pos.block].bars) { pos.barInBlock = 0; pos.block = (pos.block + 1) % blocks.length; }
    clip.play[track] = blocks[pos.block].scene;
  }
  function highlight(s: number): void {
    if (playhead.lastHi >= 0) for (let r = 0; r < 8; r++) cells[r][playhead.lastHi].classList.remove("play");
    if (clip.play.drums === clip.sel) for (let r = 0; r < 8; r++) cells[r][s].classList.add("play");
    rollPlayheadBar.classList.toggle("on", clip.play.synth === clip.sel);
    rollPlayheadBar.style.left = `${(s / STEPS) * 100}%`;
    playhead.lastStepStartedMs = performance.now();
    playhead.lastHi = s; lcdState.textContent = `▶ ${String(s + 1).padStart(2, "0")}`;
  }
  function scheduleStep(s: number, baseWhen: number): void {
    const a = ac();
    const groove = rackState.devices.player && s % 2 === 1 ? rackState.grooveTiming * stepDur() * 0.5 : 0;
    const random = rackState.devices.player ? (Math.random() * 2 - 1) * rackState.grooveRandom / 1000 : 0;
    const when = baseWhen + (s % 2 === 1 ? transport.swing * stepDur() : 0) + groove + random;
    const drumClip = clip.play.drums, padClip = clip.play.pads, synthClip = clip.play.synth;
    if (drumClip !== null) {
      for (let r = 0; r < 8; r++) {
        if (allPats[drumClip][r][s] && audible(r)) playDrum(a, trackGain[r], r, allVels[drumClip][r][s] / 127, when);
      }
    }
    if (padClip !== null) {
      padEvents[padClip].filter((event) => event.step === s).forEach((event) => {
        if (Math.random() * 100 > event.probability) return;
        const velocity = Math.max(1, Math.min(127, event.velocity * (1 + (rackState.devices.player ? (Math.random() * 2 - 1) * rackState.grooveVelocity : 0))));
        const ratchets = Math.max(1, event.ratchets), spacing = stepDur() / ratchets;
        for (let i = 0; i < ratchets; i++) {
          const eventWhen = Math.max(baseWhen, when + event.offset / 1000 + i * spacing);
          playPad(a, event.pad, velocity, eventWhen, event.pad % PAD_BANK_SIZE);
          if (rackState.devices.player && rackState.noteEcho > 0) for (let echo = 1; echo <= rackState.noteEcho; echo++) {
            playPad(a, event.pad, velocity * Math.pow(rackState.echoDecay, echo), eventWhen + echo * stepDur(), event.pad % PAD_BANK_SIZE);
          }
        }
      });
    }
    if (synthClip !== null) {
      synthNotes[synthClip].forEach((n) => {
        if (n.step === s) playNote(a, engine.synthGain!, vsynthPatch, n.note, n.vel, when, stepDur() * n.len * 0.98);
      });
    }
    if (transport.metro && s % 4 === 0) metroClick(a, engine.master!, baseWhen, s === 0);
    window.setTimeout(() => { if (playhead.playing) highlight(s); }, Math.max(0, (baseWhen - a.currentTime) * 1000));
  }
  function applyQueued(): boolean {
    let changed = false;
    TRACKS.forEach((track) => {
      if (clip.queued[track] !== undefined) {
        clip.play[track] = clip.queued[track] as number | null;
        clip.queued[track] = undefined;
        changed = true;
      }
    });
    return changed;
  }
  function scheduler(): void {
    const a = ac();
    while (nextTime < a.currentTime + 0.1) {
      scheduleStep(playhead.schStep, nextTime);
      nextTime += stepDur();
      playhead.schStep++;
      if (playhead.schStep >= STEPS) {
        playhead.schStep = 0;
        const launched = applyQueued();
        if (launched) {
          transport.songMode = false;
          songBtn.textContent = "Session"; songBtn.classList.remove("active"); renderSel.value = "pattern";
          launchStatus.textContent = "Launched";
        } else if (transport.songMode) {
          TRACKS.forEach((track) => advanceArrangeTrack(track));
        }
        paintSession();
      }
    }
  }
  playBtn.addEventListener("click", () => {
    if (playhead.playing) return;
    ensureNodes(); playhead.playing = true; playhead.schStep = 0;
    TRACKS.forEach((track) => { arrangePos[track] = { block: 0, barInBlock: 0 }; });
    applyQueued();
    if (transport.songMode) TRACKS.forEach((track) => applyArrangePos(track));
    paintSession();
    nextTime = ac().currentTime + 0.06;
    // 1-bar count-in when recording is armed: four clicks, then the loop starts.
    if (countIn && (mpc.recording || synth.isSynthRec())) {
      const beat = stepDur() * 4;
      for (let b = 0; b < 4; b++) metroClick(ac(), engine.master!, nextTime + b * beat, b === 0);
      nextTime += 4 * beat;
      lcdState.textContent = "COUNT";
    }
    schedTimer = window.setInterval(scheduler, 25);
  });
  stopBtn.addEventListener("click", () => {
    playhead.playing = false; if (schedTimer) { clearInterval(schedTimer); schedTimer = 0; }
    if (playhead.lastHi >= 0) for (let r = 0; r < 8; r++) cells[r][playhead.lastHi].classList.remove("play");
    rollPlayheadBar.classList.remove("on");
    TRACKS.forEach((track) => { clip.queued[track] = undefined; });
    paintSession();
    playhead.lastHi = -1; lcdState.textContent = "■ STOP";
  });

  // Global transport/undo shortcuts — skipped while typing in any text
  // field so Space still types a space and Ctrl+Z still edits text natively.
  window.addEventListener("keydown", (ev) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;
    if (ev.code === "Space" && !ev.repeat) { ev.preventDefault(); (playhead.playing ? stopBtn : playBtn).click(); return; }
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey) {
      const key = ev.key.toLowerCase();
      if (key === "z" && !ev.shiftKey) { ev.preventDefault(); undoBtn.click(); }
      else if ((key === "z" && ev.shiftKey) || key === "y") { ev.preventDefault(); redoBtn.click(); }
    }
  });

  // Export + project file logic lives in render.ts (Phase 0 split).

  // ── Keyboard ──
  // Two-row DAW layout (Ableton/FL): Z-row is the lower octave, Q-row the
  // upper — ~2.5 octaves without shifting. - / = still shift for extremes.
  const keyMap: Record<string, string> = {
    z:"C3", s:"C#3", x:"D3", d:"D#3", c:"E3", v:"F3", g:"F#3",
    b:"G3", h:"G#3", n:"A3", j:"A#3", m:"B3",
    q:"C4", "2":"C#4", w:"D4", "3":"D#4", e:"E4", r:"F4", "5":"F#4",
    t:"G4", "6":"G#4", y:"A4", "7":"A#4", u:"B4",
    i:"C5", "9":"C#5", o:"D5", "0":"D#5", p:"E5",
  };
  const padKeyMap: Record<string, number> = {
    "1": 12, "2": 13, "3": 14, "4": 15,
    q: 8, w: 9, e: 10, r: 11,
    a: 4, s: 5, d: 6, f: 7,
    z: 0, x: 1, c: 2, v: 3,
  };
  // Physical key -> the actual (octave-shifted) note it triggered, so keyup
  // releases the right note even if the octave changed while it was held.
  const downMap = new Map<string, string>();
  window.addEventListener("keydown", (ev) => {
    if (activeTab === 0) {
      const localPad = padKeyMap[ev.key.toLowerCase()];
      if (localPad != null && !ev.repeat && !ev.metaKey && !ev.ctrlKey) {
        ev.preventDefault(); triggerPerformancePad(localPad, mpc.fullLevel ? 127 : 105); padButtons[localPad].classList.add("down"); return;
      }
    }
    if (activeTab !== 1) return;
    const key = ev.key.toLowerCase();
    if (!ev.repeat && !ev.metaKey && !ev.ctrlKey) {
      if (key === "-") { setOctaveShift(synth.getOctaveShift() - 1); return; }
      if (key === "=") { setOctaveShift(synth.getOctaveShift() + 1); return; }
    }
    const n0 = keyMap[key];
    if (!n0 || downMap.has(key) || ev.metaKey || ev.ctrlKey) return;
    const n = midiToNote(noteToMidi(n0) + synth.getOctaveShift() * 12);
    downMap.set(key, n); ensureNodes(); liveKeys.noteOn(ac(), engine.synthGain!, vsynthPatch, n); highlightKey(synthKeys, n0, true);
    recordSynthOn(n);
  });
  window.addEventListener("keyup", (ev) => {
    const localPad = padKeyMap[ev.key.toLowerCase()];
    if (localPad != null) padButtons[localPad].classList.remove("down");
    if (activeTab !== 1) return;
    const key = ev.key.toLowerCase();
    const n = downMap.get(key); if (!n) return;
    downMap.delete(key); liveKeys.noteOff(ac(), n); highlightKey(synthKeys, keyMap[key], false);
    recordSynthOff(n);
  });

  // Initial paint reflects loaded project state (scene selection, session grid).
  selectScene(clip.sel);
  // First-time visitors get the guided tour automatically; the flag was
  // already written on close/finish, it just had nothing reading it back.
  if (!localStorage.getItem("vv_studio_tutorial_seen")) showTutorialStep(0);
}

// Key builders live in keys.ts (Phase 0 split).
