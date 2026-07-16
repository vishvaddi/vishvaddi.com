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
    if (activeTab === 1) waveRedraws.forEach((fn) => fn());
  }
  let waveRedraws: Array<() => void> = [];
  let modBadgeRefreshers: Array<() => void> = [];
  // ── Shared velocity popup ── (velpopup.ts — Phase 0 split)

  // ── Beat ── (drumgrid.ts — Phase 0 split)
  const { beat, cells, sceneBtns } = buildDrumGrid();

  // ── Project / export ── (render.ts — Phase 0 split; built before pads so
  // the resample feature can take renderBuffer directly)
  const { panel: exp, renderSel, renderBuffer } = buildProjectExport();
  ctx.renderSel = renderSel;

  // ── MPC performance ── (padsui.ts — Phase 0 split)
  const { mpcPanel, padSeqPanel, padButtons, paintMpcPads, paintEventLane, triggerPerformancePad, padGrid, eventLane, selectedPadLabel, selectedSampleEditor } = buildPads({ renderBuffer });

  // ── Drum rack / sampler ──
  const rack = el("div", "wa-panel");
  const rackGrid = el("div", "wa-rack");
  DRUMS.forEach((name, r) => {
    const pad = el("div", "wa-pad");
    const trigger = btn(name, "wa-pad-trigger");
    trigger.addEventListener("click", () => { ensureNodes(); playDrum(ac(), trackGain[r], r, 1, ac().currentTime); });
    const fileName = el("span", "wa-sample-name", sampleParams[r].name || "Synth drum");
    const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = "audio/*"; fileInput.hidden = true;
    const load = btn("Load sample", "wa-btn-sm"), remove = btn("Use synth", "wa-btn-sm");
    // Hear edits as you make them — Reaper-style param audition, debounced so
    // dragging a slider doesn't machine-gun the row.
    let auditionTimer = 0;
    const auditionRow = (): void => {
      window.clearTimeout(auditionTimer);
      auditionTimer = window.setTimeout(() => { ensureNodes(); playDrum(ac(), trackGain[r], r, 0.9, ac().currentTime); }, 140);
    };
    const startRow = sliderRow("Start", 0, 0.95, sampleParams[r].start, 0.01, (v) => {
      sampleParams[r].start = Math.min(v, sampleParams[r].end - 0.01); saveAll(); auditionRow();
    });
    const endRow = sliderRow("End", 0.05, 1, sampleParams[r].end, 0.01, (v) => {
      sampleParams[r].end = Math.max(v, sampleParams[r].start + 0.01); saveAll(); auditionRow();
    });
    const reverse = btn("Reverse", "wa-toggle wa-btn-sm");
    // Start/End/Reverse only exist for samples; grey them out on synth rows so
    // dead sliders don't masquerade as broken ones.
    const syncSampleState = (): void => {
      const hasSample = !!sampleData[r];
      [startRow, endRow].forEach((row) => {
        row.classList.toggle("wa-off", !hasSample);
        row.querySelectorAll("input").forEach((input) => { input.disabled = !hasSample; });
      });
      reverse.classList.toggle("wa-off", !hasSample);
      reverse.disabled = !hasSample;
    };
    load.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0]; if (!file) return;
      try {
        checkpoint();
        sampleData[r] = await readAsDataUrl(file);
        sampleParams[r].name = file.name;
        await hydrateSample(r);
        fileName.textContent = file.name;
        syncSampleState(); saveAll(); auditionRow();
      } catch { fileName.textContent = "Could not load sample"; }
    });
    remove.addEventListener("click", () => {
      checkpoint();
      sampleData[r] = null; sampleBuffers[r] = null; sampleParams[r].name = "";
      fileName.textContent = "Synth drum"; fileInput.value = ""; syncSampleState(); saveAll();
    });
    const controls = el("div", "wa-pad-controls");
    controls.append(
      sliderRow("Tune", -24, 24, sampleParams[r].tune, 1, (v) => { sampleParams[r].tune = v; saveAll(); auditionRow(); }),
      startRow, endRow,
    );
    reverse.classList.toggle("active", sampleParams[r].reverse);
    reverse.addEventListener("click", () => {
      sampleParams[r].reverse = !sampleParams[r].reverse; reverse.classList.toggle("active", sampleParams[r].reverse); saveAll(); auditionRow();
    });
    const actions = el("div", "wa-pad-actions"); actions.append(load, remove, reverse, fileInput);
    syncSampleState();
    pad.append(trigger, fileName, controls, actions); rackGrid.append(pad);
  });
  rack.append(el("p", "wa-help", "Each pad uses its generated drum until you load a local audio file. Tune works on both — it repitches samples and synth drums alike. Samples stay in this session and are embedded when you save a project."), rackGrid);

  // ── Chop / sample capture ──
  const chop = el("div", "wa-panel");
  const chopToolbar = el("div", "wa-chop-toolbar");
  const chopInput = document.createElement("input"); chopInput.type = "file"; chopInput.accept = "audio/*"; chopInput.hidden = true;
  const loadBreakBtn = btn("Load break"), micBtn = btn("Record mic"), equalBtn = btn("Equal"), transientBtn = btn("Transient"), clearSlicesBtn = btn("Manual");
  const assignSlicesBtn = btn("Assign to bank"), patternBtn = btn("Assign + pattern"), normaliseBtn = btn("Normalise"), syncBpmBtn = btn("Sync BPM");
  const sliceCountSel = document.createElement("select");
  [4, 8, 12, 16].forEach((n) => { const o = document.createElement("option"); o.value = String(n); o.textContent = `${n} slices`; sliceCountSel.append(o); });
  sliceCountSel.value = "16";
  help(loadBreakBtn, "Load an audio file into the chop editor.");
  help(micBtn, "Record from the microphone, then chop the recording like any other sample.");
  help(sliceCountSel, "How many slices Equal and Transient aim for.");
  help(equalBtn, "Split the audio into equal-length slices.");
  help(transientBtn, "Detect strong attacks and use them as slice boundaries.");
  help(clearSlicesBtn, "Start with one region, then click the waveform to add slice markers.");
  help(normaliseBtn, "Raise the break to peak level without changing its relative dynamics.");
  help(syncBpmBtn, "Set the project tempo to the detected tempo of the loaded break.");
  help(assignSlicesBtn, "Map the current slices across all 16 pads in the selected bank.");
  help(patternBtn, "Assign the slices AND write them in order into this scene's pad sequence — instant break replay, ready to rearrange.");
  const chopStatus = el("span", "wa-status", "Select a pad or load a break");
  const waveform = document.createElement("canvas"); waveform.className = "wa-waveform";
  help(waveform, "Waveform chop editor. Click a slice to audition it; in Manual mode clicking also adds a marker.");
  let chopBuffer: AudioBuffer | null = null, chopData: string | null = null, chopName = "", slices: Array<[number, number]> = equalSlices(16);
  let chopBpm: number | null = null, chopManual = false, selectedSlice = -1;
  let slicePreview: AudioBufferSourceNode | null = null;
  const sliceCount = (): number => Number(sliceCountSel.value);
  function refreshWaveform(): void { if (chopBuffer) drawWaveform(waveform, chopBuffer, slices, selectedSlice); }
  // Assume a 4/4 break of 1–8 bars; among the plausible bar counts pick the
  // tempo nearest the current project BPM (jungle at 170 finds the 2-bar amen,
  // boom bap at 90 finds the 1-bar loop).
  function guessBreakBpm(duration: number): number | null {
    let best: number | null = null;
    for (const bars of [1, 2, 4, 8]) {
      const bpm = (bars * 4 * 60) / duration;
      if (bpm < 50 || bpm > 220) continue;
      if (best === null || Math.abs(bpm - transport.bpm) < Math.abs(best - transport.bpm)) best = bpm;
    }
    return best;
  }
  function playSlice(index: number): void {
    if (!chopBuffer || !slices[index]) return;
    ensureNodes();
    const [start, end] = slices[index];
    try { slicePreview?.stop(); } catch { /* not playing */ }
    const a = ac(), src = a.createBufferSource(), g = a.createGain();
    src.buffer = chopBuffer; g.gain.value = 0.9;
    src.connect(g); g.connect(engine.master!);
    src.start(a.currentTime, start * chopBuffer.duration, Math.max(0.02, (end - start) * chopBuffer.duration));
    slicePreview = src;
    selectedSlice = index; refreshWaveform();
  }
  async function setChopSource(data: string, name: string): Promise<void> {
    chopBuffer = await ac().decodeAudioData(dataUrlToBytes(data)); chopData = data; chopName = name; slices = equalSlices(sliceCount());
    chopBpm = guessBreakBpm(chopBuffer.duration); syncBpmBtn.disabled = chopBpm === null;
    chopManual = false; selectedSlice = -1;
    chopStatus.textContent = `${name} · ${chopBuffer.duration.toFixed(2)}s${chopBpm ? ` · ≈${Math.round(chopBpm)} BPM` : ""}`;
    refreshWaveform();
  }
  syncBpmBtn.disabled = true;
  syncBpmBtn.addEventListener("click", () => {
    if (chopBpm === null) return;
    setBpm(Math.round(chopBpm)); saveAll();
    chopStatus.textContent = `Project tempo set to ${Math.round(chopBpm)} BPM`;
  });
  loadBreakBtn.addEventListener("click", () => chopInput.click());
  chopInput.addEventListener("change", async () => {
    const file = chopInput.files?.[0]; if (!file) return;
    try { await setChopSource(await readAsDataUrl(file), file.name); } catch { chopStatus.textContent = "Could not decode audio"; }
  });
  micBtn.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { chopStatus.textContent = "Recording is not supported here"; return; }
    if (micBtn.classList.contains("active")) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [], recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType });
        try { await setChopSource(await blobAsDataUrl(blob), `mic-${Date.now()}.webm`); } catch { chopStatus.textContent = "Could not decode recording"; }
        micBtn.classList.remove("active"); micBtn.textContent = "Record mic";
      };
      recorder.start(); micBtn.classList.add("active"); micBtn.textContent = "Stop recording"; chopStatus.textContent = "Recording...";
      const stop = () => { if (recorder.state === "recording") recorder.stop(); micBtn.removeEventListener("click", stop); };
      micBtn.addEventListener("click", stop);
    } catch { chopStatus.textContent = "Microphone permission was not granted"; }
  });
  equalBtn.addEventListener("click", () => { chopManual = false; selectedSlice = -1; slices = equalSlices(sliceCount()); refreshWaveform(); });
  transientBtn.addEventListener("click", () => { if (chopBuffer) { chopManual = false; selectedSlice = -1; slices = transientSlices(chopBuffer, sliceCount()); refreshWaveform(); } });
  clearSlicesBtn.addEventListener("click", () => { chopManual = true; selectedSlice = -1; slices = [[0, 1]]; refreshWaveform(); chopStatus.textContent = "Click the waveform to add slice markers"; });
  waveform.addEventListener("click", (event) => {
    if (!chopBuffer) return;
    const rect = waveform.getBoundingClientRect(), position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    if (chopManual) {
      const starts = [...slices.map(([start]) => start), position].filter((value, i, all) => all.indexOf(value) === i).sort((a, b) => a - b).slice(0, 16);
      slices = starts.map((start, i) => [start, starts[i + 1] ?? 1]);
    }
    playSlice(slices.findIndex(([start, end]) => position >= start && position < end));
  });
  function assignSlices(): boolean {
    if (!chopData || !chopBuffer) { chopStatus.textContent = "Load a break first"; return false; }
    checkpoint();
    const bankStart = mpc.bank * PAD_BANK_SIZE;
    slices.slice(0, PAD_BANK_SIZE).forEach(([start, end], i) => {
      const pad = bankStart + i;
      const snappedStart = snapZero(chopBuffer!, start), snappedEnd = Math.max(snappedStart + 0.001, snapZero(chopBuffer!, end));
      sampleData[pad] = chopData; sampleBuffers[pad] = chopBuffer;
      Object.assign(sampleParams[pad], {
        name: `${chopName} ${i + 1}`, start: snappedStart, end: Math.min(1, snappedEnd),
        reverse: false, loop: false, sourceBpm: chopBpm ? Math.round(chopBpm) : transport.bpm,
      });
    });
    paintMpcPads(); saveAll(); chopStatus.textContent = `${Math.min(16, slices.length)} slices assigned to Bank ${"ABCD"[mpc.bank]}`;
    return true;
  }
  assignSlicesBtn.addEventListener("click", () => { assignSlices(); });
  patternBtn.addEventListener("click", () => {
    if (!assignSlices()) return;
    // Replay the break in slice order across the scene, ReCycle-style: each
    // slice lands on its grid position and rings until the next one.
    const bankStart = mpc.bank * PAD_BANK_SIZE;
    const count = Math.min(PAD_BANK_SIZE, slices.length);
    padEvents[clip.sel] = Array.from({ length: count }, (_, i) => ({
      pad: bankStart + i, step: Math.round((i * STEPS) / count) % STEPS,
      velocity: 110, offset: 0, probability: 100, ratchets: 1,
    }));
    if (clip.play.pads === null) clip.play.pads = clip.sel;
    paintEventLane(); paintSession(); saveAll();
    chopStatus.textContent = `Break assigned to Bank ${"ABCD"[mpc.bank]} and written to scene ${SCENE_LABELS[clip.sel]}`;
  });
  normaliseBtn.addEventListener("click", async () => {
    if (!chopBuffer) return;
    let peak = 0;
    for (let c = 0; c < chopBuffer.numberOfChannels; c++) {
      const data = chopBuffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    }
    if (peak <= 0 || peak >= 0.999) return;
    const normalised = ac().createBuffer(chopBuffer.numberOfChannels, chopBuffer.length, chopBuffer.sampleRate);
    for (let c = 0; c < chopBuffer.numberOfChannels; c++) {
      const source = chopBuffer.getChannelData(c), target = normalised.getChannelData(c);
      for (let i = 0; i < source.length; i++) target[i] = source[i] / peak;
    }
    chopBuffer = normalised; chopData = await blobAsDataUrl(encodeWav(normalised)); refreshWaveform(); chopStatus.textContent = "Normalised";
  });
  chopToolbar.append(loadBreakBtn, micBtn, sliceCountSel, equalBtn, transientBtn, clearSlicesBtn, normaliseBtn, syncBpmBtn, assignSlicesBtn, patternBtn, chopInput, chopStatus);
  chop.append(chopToolbar, waveform, el("p", "wa-help", "Chopping is non-destructive — click a slice to hear it. Sync BPM matches the project tempo to the break; Assign + pattern replays the chopped break on the pads, ready to rearrange in the Sequence lane."));

  // ── Synth: VV-1 wavetable ──
  const synthPanel = el("div", "wa-panel");
  const liveKeys = new LiveVoices();
  const audition = (note: string, vel = 105, lenSteps = 2): void => {
    ensureNodes(); playNote(ac(), engine.synthGain!, vsynthPatch, note, vel, ac().currentTime, stepDur() * lenSteps);
  };
  function ensureMatrixSlots(): void {
    while (vsynthPatch.matrix.length < 6) vsynthPatch.matrix.push({ src: "lfo1", dest: "cutoff", amt: 0 });
    vsynthPatch.matrix.length = 6;
  }
  ensureMatrixSlots();
  const selRow = (label: string, options: Array<[string, string]>, value: string, on: (v: string) => void): HTMLElement => {
    const row = el("div", "wa-slider-row");
    row.append(el("span", "wa-lbl", label));
    const sel = document.createElement("select");
    options.forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; sel.append(o); });
    sel.value = value;
    sel.addEventListener("change", () => on(sel.value));
    row.append(sel); return row;
  };
  // Preset row — searchable + filterable by category (Surge XT style).
  const presetRow = el("div", "wa-export");
  const presetBrowserRow = el("div", "wa-export");
  const presetSearch = document.createElement("input");
  presetSearch.type = "text"; presetSearch.placeholder = "Search presets…"; presetSearch.className = "wa-preset-search";
  const presetCategoryRow = el("div", "wa-preset-categories");
  const presetCategories = ["All", ...Array.from(new Set(Object.keys(PRESETS).map((name) => PRESET_CATEGORIES[name] ?? "Utility")))];
  let activePresetCategory = "All";
  const categoryBtns: HTMLButtonElement[] = [];
  const presetSel = document.createElement("select");
  function refreshPresetOptions(): void {
    const query = presetSearch.value.trim().toLowerCase(), prevValue = presetSel.value;
    presetSel.replaceChildren();
    Object.keys(PRESETS).forEach((name) => {
      const category = PRESET_CATEGORIES[name] ?? "Utility";
      if (activePresetCategory !== "All" && category !== activePresetCategory) return;
      if (query && !name.toLowerCase().includes(query)) return;
      const o = document.createElement("option"); o.value = name; o.textContent = name; presetSel.append(o);
    });
    if (Array.from(presetSel.options).some((o) => o.value === prevValue)) presetSel.value = prevValue;
  }
  presetCategories.forEach((category) => {
    const b = btn(category, "wa-btn-sm" + (category === "All" ? " active" : ""));
    b.addEventListener("click", () => {
      activePresetCategory = category;
      categoryBtns.forEach((other) => other.classList.toggle("active", other === b));
      refreshPresetOptions();
    });
    categoryBtns.push(b); presetCategoryRow.append(b);
  });
  presetSearch.addEventListener("input", refreshPresetOptions);
  refreshPresetOptions();
  const loadPresetBtn = btn("Load preset", "wa-btn-sm");
  const auditionBtn = btn("♪ Audition", "wa-btn-sm");
  const randomizeBtn = btn("🎲 Randomize", "wa-btn-sm");
  help(loadPresetBtn, "Replace the whole synth patch with the selected preset.");
  help(auditionBtn, "Play a short note with the current patch.");
  help(randomizeBtn, "Jitter the current patch's oscillators, filter, envelopes and modulation within musical ranges.");
  // Randomize — biased toward playable results rather than pure chaos: only
  // 1-2 of the 6 mod-matrix slots get a nonzero amount, cutoff is picked on
  // a log scale, and osc2 is silent half the time.
  function randomizePatch(): void {
    checkpoint();
    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
    const filterTypes = ["lowpass", "highpass", "bandpass", "notch"] as const;
    const lfoShapes = ["sine", "triangle", "sawtooth", "square"] as const;
    vsynthPatch.osc1 = {
      table: pick(TABLE_NAMES), pos: Math.random(), octave: Math.round(rand(-1, 1)), semi: 0,
      level: rand(0.6, 1), unison: 1 + Math.floor(Math.random() * 4), detune: rand(0, 35),
    };
    vsynthPatch.osc2 = Math.random() < 0.5
      ? { table: "basic", pos: 0.6, octave: 0, semi: 0, level: 0, unison: 1, detune: 12 }
      : {
          table: pick(TABLE_NAMES), pos: Math.random(), octave: Math.round(rand(-2, 1)), semi: pick([0, 7, 12, -12] as const),
          level: rand(0.3, 0.8), unison: 1 + Math.floor(Math.random() * 3), detune: rand(0, 35),
        };
    vsynthPatch.noise = { level: Math.random() < 0.7 ? 0 : rand(0.05, 0.3), colour: rand(2000, 14000) };
    vsynthPatch.filter = {
      type: pick(filterTypes) as VPatch["filter"]["type"],
      cutoff: 200 * Math.pow(2, Math.random() * 6),
      res: rand(0.3, 4), env2: rand(-0.4, 0.8), track: rand(0, 0.6),
    };
    vsynthPatch.env1 = { a: Math.random() < 0.8 ? rand(0.001, 0.05) : rand(0.1, 1), d: rand(0.05, 1), s: rand(0, 1), r: rand(0.05, 1) };
    vsynthPatch.env2 = { a: rand(0.001, 0.3), d: rand(0.05, 0.8), s: Math.random() < 0.5 ? 0 : rand(0, 0.6), r: rand(0.05, 0.8) };
    vsynthPatch.lfo1 = { shape: pick(lfoShapes) as VPatch["lfo1"]["shape"], rate: rand(0.1, 8) };
    vsynthPatch.lfo2 = { shape: pick(lfoShapes) as VPatch["lfo2"]["shape"], rate: rand(0.1, 6) };
    ensureMatrixSlots();
    const activeSlots = new Set<number>();
    while (activeSlots.size < 1 + Math.floor(Math.random() * 2)) activeSlots.add(Math.floor(Math.random() * vsynthPatch.matrix.length));
    vsynthPatch.matrix.forEach((slot, i) => {
      slot.src = pick(MOD_SRCS); slot.dest = pick(MOD_DESTS);
      slot.amt = activeSlots.has(i) ? rand(-0.6, 0.6) : 0;
    });
    vsynthPatch.macros = vsynthPatch.macros.map(() => Math.random());
    vsynthPatch.volume = rand(0.6, 0.9);
    renderPatchEditor(); saveAll(); audition("C4");
  }
  randomizeBtn.addEventListener("click", randomizePatch);
  loadPresetBtn.addEventListener("click", () => {
    const preset = PRESETS[presetSel.value]; if (!preset) return;
    checkpoint();
    const copy = JSON.parse(JSON.stringify(preset)) as VPatch;
    (Object.keys(copy) as Array<keyof VPatch>).forEach((key) => {
      const value = copy[key];
      if (Array.isArray(value)) (vsynthPatch[key] as unknown[]) = value;
      else if (typeof value === "object" && value !== null) Object.assign(vsynthPatch[key] as object, value);
      else (vsynthPatch[key] as unknown) = value;
    });
    ensureMatrixSlots();
    renderPatchEditor(); saveAll(); audition("C4");
  });
  auditionBtn.addEventListener("click", () => audition("C4"));
  // Patch editor — rebuilt whenever a preset load replaces the patch wholesale.
  const patchBox = el("div", "wa-vpatch");
  // Simple/Advanced — collapses to Wave/Filter/Envelope/Volume for newcomers
  // (CS50 Synth's "only 3 engines" lesson); the class lives on patchBox
  // itself, so it survives renderPatchEditor()'s replaceChildren() rebuilds.
  const simpleBtn = btn("Simple view", "wa-toggle wa-btn-sm");
  let simpleMode = localStorage.getItem("vv_studio_synth_simple") === "1";
  function applySimpleMode(): void {
    patchBox.classList.toggle("wa-simple", simpleMode);
    simpleBtn.textContent = simpleMode ? "Advanced view" : "Simple view";
    simpleBtn.classList.toggle("active", simpleMode);
  }
  help(simpleBtn, "Collapse the patch editor to Wave, Filter, Envelope and Volume, or show the full mod matrix and macros.");
  simpleBtn.addEventListener("click", () => {
    simpleMode = !simpleMode;
    localStorage.setItem("vv_studio_synth_simple", simpleMode ? "1" : "0");
    applySimpleMode();
  });
  applySimpleMode();
  presetBrowserRow.append(presetSearch, presetCategoryRow);
  presetRow.append(el("span", "wa-lbl", "PRESET"), presetSel, loadPresetBtn, auditionBtn, randomizeBtn, simpleBtn);
  // Live oscilloscope — taps synthGain via an analyser. Stays a flat line
  // until audio has actually started (ensureNodes() runs on first pad/key
  // press), matching the rest of the app's "audio starts on first click" rule.
  const scopeCanvas = document.createElement("canvas"); scopeCanvas.className = "wa-scope";
  let scopeAnalyser: AnalyserNode | null = null;
  function drawSynthScope(): void {
    requestAnimationFrame(drawSynthScope);
    if (!engine.synthGain) return;
    if (!scopeAnalyser) { scopeAnalyser = ac().createAnalyser(); scopeAnalyser.fftSize = 1024; engine.synthGain.connect(scopeAnalyser); }
    const data = new Uint8Array(scopeAnalyser.fftSize);
    scopeAnalyser.getByteTimeDomainData(data);
    const floats = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) floats[i] = (data[i] - 128) / 128;
    drawScope(scopeCanvas, floats, "#ffe24d");
  }
  drawSynthScope();
  function renderPatchEditor(): void {
    patchBox.replaceChildren();
    waveRedraws = [];
    modBadgeRefreshers = [];
    const pSlider = (host: HTMLElement, label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
      host.append(sliderRow(label, min, max, get(), step, (v) => { set(v); saveAll(); }));
    };
    // Shows total incoming mod-matrix depth on the one slider it targets
    // (Vital-style knob highlight, simplified to a text badge) instead of
    // only listing it in the separate matrix table below.
    const modBadge = (dest: ModSlot["dest"]): HTMLElement => {
      const badge = el("span", "wa-mod-badge");
      const refresh = () => {
        const depth = vsynthPatch.matrix.filter((s) => s.dest === dest).reduce((sum, s) => sum + Math.abs(s.amt), 0);
        badge.textContent = depth > 0.001 ? `MOD ±${Math.round(depth * 100)}%` : "";
        badge.classList.toggle("active", depth > 0.001);
      };
      modBadgeRefreshers.push(refresh); refresh();
      return badge;
    };
    (["osc1", "osc2"] as const).forEach((key, i) => {
      const o = vsynthPatch[key];
      const box = el("div", "wa-vblock" + (i === 1 ? " wa-advanced-only-block" : ""));
      box.append(el("div", "wa-fx-title", `OSC ${i + 1}`));
      const waveCanvas = document.createElement("canvas"); waveCanvas.className = "wa-wave-mini";
      box.append(waveCanvas);
      const redrawWave = () => drawScope(waveCanvas, sampleWaveform(o.table, o.pos));
      waveRedraws.push(redrawWave);
      const tableOptions: Array<[string, string]> = TABLE_NAMES.map((n) => [n, n.toUpperCase()]);
      if (o.table.startsWith("text:")) tableOptions.push([o.table, `TEXT "${o.table.slice(5)}"`]);
      box.append(selRow("Table", tableOptions, o.table, (v) => { o.table = v; saveAll(); redrawWave(); }));
      const oscAdvanced = el("div", "wa-advanced-only");
      const textRow = el("div", "wa-export");
      const textInput = document.createElement("input");
      textInput.type = "text"; textInput.placeholder = "type a word…"; textInput.maxLength = 24;
      const genBtn = btn("Generate", "wa-btn-sm");
      help(genBtn, "Hash the typed text into a unique, reproducible wavetable shape (Vital-style text-to-wavetable).");
      genBtn.addEventListener("click", () => {
        const text = textInput.value.trim(); if (!text) return;
        o.table = `text:${text}`; saveAll(); renderPatchEditor();
      });
      textRow.append(textInput, genBtn);
      oscAdvanced.append(textRow);
      const posRow = sliderRow("Position", 0, 1, o.pos, 0.01, (v) => { o.pos = v; redrawWave(); saveAll(); });
      posRow.append(modBadge(i === 0 ? "pos1" : "pos2"));
      box.append(posRow);
      pSlider(oscAdvanced, "Octave", -2, 2, 1, () => o.octave, (v) => { o.octave = v; });
      pSlider(oscAdvanced, "Semi", -12, 12, 1, () => o.semi, (v) => { o.semi = v; });
      pSlider(box, "Level", 0, 1, 0.01, () => o.level, (v) => { o.level = v; });
      pSlider(oscAdvanced, "Unison", 1, 8, 1, () => o.unison, (v) => { o.unison = v; });
      pSlider(oscAdvanced, "Detune", 0, 100, 1, () => o.detune, (v) => { o.detune = v; });
      box.append(oscAdvanced);
      patchBox.append(box);
      redrawWave();
    });
    const noiseBox = el("div", "wa-vblock wa-advanced-only-block");
    noiseBox.append(el("div", "wa-fx-title", "NOISE"));
    pSlider(noiseBox, "Level", 0, 1, 0.01, () => vsynthPatch.noise.level, (v) => { vsynthPatch.noise.level = v; });
    pSlider(noiseBox, "Colour", 200, 16000, 100, () => vsynthPatch.noise.colour, (v) => { vsynthPatch.noise.colour = v; });
    patchBox.append(noiseBox);
    const filterBox = el("div", "wa-vblock");
    filterBox.append(el("div", "wa-fx-title", "FILTER"));
    filterBox.append(selRow("Type", [["lowpass", "LOW PASS"], ["highpass", "HIGH PASS"], ["bandpass", "BAND PASS"], ["notch", "NOTCH"]], vsynthPatch.filter.type, (v) => { vsynthPatch.filter.type = v as VPatch["filter"]["type"]; saveAll(); }));
    const cutoffRow = sliderRow("Cutoff", 30, 18000, vsynthPatch.filter.cutoff, 10, (v) => { vsynthPatch.filter.cutoff = v; saveAll(); });
    cutoffRow.append(modBadge("cutoff"));
    filterBox.append(cutoffRow);
    const filterAdvanced = el("div", "wa-advanced-only");
    pSlider(filterAdvanced, "Res", 0.1, 12, 0.1, () => vsynthPatch.filter.res, (v) => { vsynthPatch.filter.res = v; });
    pSlider(filterAdvanced, "Env2 amt", -1, 1, 0.01, () => vsynthPatch.filter.env2, (v) => { vsynthPatch.filter.env2 = v; });
    pSlider(filterAdvanced, "Key track", 0, 1, 0.05, () => vsynthPatch.filter.track, (v) => { vsynthPatch.filter.track = v; });
    filterBox.append(filterAdvanced);
    patchBox.append(filterBox);
    // Envelope: draggable shape (attack peak, decay/sustain point, release
    // end) above the same sliders for precise numeric entry — dragging and
    // sliders both write straight into the same EnvPatch fields and redraw
    // each other. Segment widths are fixed thirds (not literally time-to-
    // scale) so a 5ms attack next to a 3s release is still visible/draggable.
    const ENV_MAX = { a: 2, d: 2, r: 3 };
    (["env1", "env2"] as const).forEach((key, i) => {
      const e = vsynthPatch[key];
      const box = el("div", "wa-vblock" + (i === 1 ? " wa-advanced-only-block" : ""));
      box.append(el("div", "wa-fx-title", i === 0 ? "ENV 1 · AMP" : "ENV 2 · MOD"));
      const envCanvas = document.createElement("canvas"); envCanvas.className = "wa-env-canvas";
      box.append(envCanvas);
      const envPoints = (): Array<[number, number]> => [
        [0, 0],
        [(e.a / ENV_MAX.a) * (1 / 3), 1],
        [1 / 3 + (e.d / ENV_MAX.d) * (1 / 3), 1 - e.s],
        [2 / 3, 1 - e.s],
        [2 / 3 + (e.r / ENV_MAX.r) * (1 / 3), 0],
      ];
      const redrawEnv = () => drawEnvelopeShape(envCanvas, envPoints());
      waveRedraws.push(redrawEnv);
      let dragHandle: 1 | 2 | 4 | null = null;
      const onEnvMove = (event: PointerEvent) => {
        if (!dragHandle) return;
        const rect = envCanvas.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height));
        if (dragHandle === 1) e.a = Math.max(0, Math.min(ENV_MAX.a, (x / (1 / 3)) * ENV_MAX.a));
        else if (dragHandle === 2) {
          e.d = Math.max(0.01, Math.min(ENV_MAX.d, ((x - 1 / 3) / (1 / 3)) * ENV_MAX.d));
          e.s = Math.max(0, Math.min(1, y));
        } else if (dragHandle === 4) {
          e.r = Math.max(0.01, Math.min(ENV_MAX.r, ((x - 2 / 3) / (1 / 3)) * ENV_MAX.r));
        }
        redrawEnv();
      };
      envCanvas.addEventListener("pointerdown", (event) => {
        const rect = envCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        dragHandle = x < 1 / 3 ? 1 : x < 2 / 3 ? 2 : 4;
        envCanvas.setPointerCapture(event.pointerId);
        onEnvMove(event);
      });
      envCanvas.addEventListener("pointermove", onEnvMove);
      envCanvas.addEventListener("pointerup", () => { if (dragHandle) saveAll(); dragHandle = null; });
      redrawEnv();
      pSlider(box, "Attack", 0, 2, 0.005, () => e.a, (v) => { e.a = v; redrawEnv(); });
      pSlider(box, "Decay", 0.01, 2, 0.01, () => e.d, (v) => { e.d = v; redrawEnv(); });
      pSlider(box, "Sustain", 0, 1, 0.01, () => e.s, (v) => { e.s = v; redrawEnv(); });
      pSlider(box, "Release", 0.01, 3, 0.01, () => e.r, (v) => { e.r = v; redrawEnv(); });
      patchBox.append(box);
    });
    (["lfo1", "lfo2"] as const).forEach((key, i) => {
      const l = vsynthPatch[key];
      const box = el("div", "wa-vblock wa-advanced-only-block");
      box.append(el("div", "wa-fx-title", `LFO ${i + 1}`));
      box.append(selRow("Shape", [["sine", "SINE"], ["triangle", "TRI"], ["sawtooth", "SAW"], ["square", "SQR"]], l.shape, (v) => { l.shape = v as VPatch["lfo1"]["shape"]; saveAll(); }));
      pSlider(box, "Rate Hz", 0.05, 20, 0.05, () => l.rate, (v) => { l.rate = v; });
      patchBox.append(box);
    });
    const matrixBox = el("div", "wa-vblock wa-vmatrix wa-advanced-only-block");
    matrixBox.append(el("div", "wa-fx-title", "MOD MATRIX"));
    vsynthPatch.matrix.forEach((slot: ModSlot) => {
      const row = el("div", "wa-vmatrix-row");
      const srcSel = document.createElement("select");
      MOD_SRCS.forEach((s) => { const o = document.createElement("option"); o.value = s; o.textContent = s.toUpperCase(); srcSel.append(o); });
      srcSel.value = slot.src;
      srcSel.addEventListener("change", () => { slot.src = srcSel.value as ModSlot["src"]; saveAll(); modBadgeRefreshers.forEach((fn) => fn()); });
      const destSel = document.createElement("select");
      MOD_DESTS.forEach((d) => { const o = document.createElement("option"); o.value = d; o.textContent = d.toUpperCase(); destSel.append(o); });
      destSel.value = slot.dest;
      destSel.addEventListener("change", () => { slot.dest = destSel.value as ModSlot["dest"]; saveAll(); modBadgeRefreshers.forEach((fn) => fn()); });
      row.append(srcSel, el("span", "wa-lbl", "→"), destSel);
      row.append(sliderRow("Amt", -1, 1, slot.amt, 0.01, (v) => { slot.amt = v; saveAll(); modBadgeRefreshers.forEach((fn) => fn()); }));
      matrixBox.append(row);
    });
    patchBox.append(matrixBox);
    const macroBox = el("div", "wa-vblock");
    macroBox.append(el("div", "wa-fx-title", "MACROS — map via matrix"));
    pSlider(macroBox, "Volume", 0, 1, 0.01, () => vsynthPatch.volume, (v) => { vsynthPatch.volume = v; });
    const macroAdvanced = el("div", "wa-advanced-only");
    ["Macro 1", "Macro 2", "Macro 3", "Macro 4"].forEach((name, i) => {
      pSlider(macroAdvanced, name, 0, 1, 0.01, () => vsynthPatch.macros[i] ?? 0, (v) => { vsynthPatch.macros[i] = v; });
    });
    macroBox.append(macroAdvanced);
    patchBox.append(macroBox);
  }
  renderPatchEditor();
  // Chord player
  const chordRow = el("div", "wa-chords");
  const chords: Array<[string, string[]]> = [
    ["Cm", ["C4", "D#4", "G4"]], ["Fm", ["F4", "G#4", "C5"]], ["Gm", ["G4", "A#4", "D5"]],
    ["Ab", ["G#4", "C5", "D#5"]], ["Bb", ["A#4", "D5", "F5"]], ["C7", ["C4", "E4", "G4", "A#4"]],
  ];
  chords.forEach(([label, notes]) => {
    const button = btn(label, "wa-btn-sm");
    button.addEventListener("click", () => { notes.forEach((note) => audition(note, 90, 3.5)); });
    chordRow.append(button);
  });
  // Piano roll — 3 octaves, notes with length + velocity, rendered as
  // draggable/resizable blocks over a background grid (Ableton-style):
  // drag empty space to draw a note and set its length; drag a note's body
  // to move it (drag vertically to change pitch); drag its right edge to
  // resize; click without dragging deletes it; right-click sets velocity.
  // Still keyed off the same 16-step/1-bar note model, so the scheduler and
  // offline render (which key off n.step/n.len) are untouched.
  const pianoRoll = el("div", "wa-piano-roll wa-vroll");
  const rollNotesLayer = el("div", "wa-roll-notes");
  const rollPlayhead = el("div", "wa-roll-playhead");
  const rollPlayheadBar = el("div", "wa-roll-playhead-bar");
  rollPlayhead.append(rollPlayheadBar);
  const rollNoteAt = (row: number, step: number): VNote | undefined =>
    synthNotes[clip.sel].find((n) => n.note === ROLL_NOTES[row] && step >= n.step && step < n.step + n.len);
  const ROLL_RESIZE_PX = 8;
  const snapStep = (step: number): number => { const g = stepsPerGridLine(); return Math.round(step / g) * g; };
  const snapLen = (len: number): number => { const g = stepsPerGridLine(); return Math.max(g, Math.round(len / g) * g); };
  function paintRoll(): void {
    rollNotesLayer.replaceChildren();
    synthNotes[clip.sel].forEach((n) => {
      const row = ROLL_NOTES.indexOf(n.note); if (row < 0) return;
      const block = el("div", "wa-roll-note");
      block.style.left = `${(n.step / STEPS) * 100}%`;
      block.style.width = `${(n.len / STEPS) * 100}%`;
      block.style.top = `${(row / ROLL_NOTES.length) * 100}%`;
      block.style.height = `${(1 / ROLL_NOTES.length) * 100}%`;
      block.style.opacity = String(0.45 + 0.55 * (n.vel / 127));
      block.title = `${n.note}, step ${n.step + 1}`;
      block.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        checkpoint();
        const rect = rollNotesLayer.getBoundingClientRect();
        const stepWidth = rect.width / STEPS, rowHeight = rect.height / ROLL_NOTES.length;
        const blockRect = block.getBoundingClientRect();
        const resizing = event.clientX - blockRect.left > blockRect.width - ROLL_RESIZE_PX;
        const startX = event.clientX, startY = event.clientY;
        const origStep = n.step, origLen = n.len, origRow = row;
        let moved = false;
        const onMove = (moveEvent: PointerEvent) => {
          const dx = moveEvent.clientX - startX, dy = moveEvent.clientY - startY;
          if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
          moved = true;
          const deltaSteps = Math.round((dx / stepWidth) / stepsPerGridLine()) * stepsPerGridLine();
          if (resizing) {
            n.len = Math.max(stepsPerGridLine(), Math.min(STEPS - origStep, origLen + deltaSteps));
            block.style.width = `${(n.len / STEPS) * 100}%`;
          } else {
            n.step = Math.max(0, Math.min(STEPS - n.len, origStep + deltaSteps));
            const newRow = Math.max(0, Math.min(ROLL_NOTES.length - 1, origRow + Math.round(dy / rowHeight)));
            n.note = ROLL_NOTES[newRow];
            block.style.left = `${(n.step / STEPS) * 100}%`;
            block.style.top = `${(newRow / ROLL_NOTES.length) * 100}%`;
          }
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          if (!resizing && !moved) { synthNotes[clip.sel] = synthNotes[clip.sel].filter((existing) => existing !== n); paintRoll(); }
          paintSession(); saveAll();
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
      block.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        showVelocityPopup(n.vel, (event as MouseEvent).clientX, (event as MouseEvent).clientY, (v) => {
          n.vel = v; block.style.opacity = String(0.45 + 0.55 * (v / 127)); saveAll();
        });
      });
      rollNotesLayer.append(block);
    });
  }
  let dragNote: VNote | null = null, dragRow = -1;
  const rollBackgroundCells: HTMLButtonElement[][] = [];
  ROLL_NOTES.forEach((note, r) => {
    const row = el("div", "wa-piano-row" + (note.startsWith("C") && !note.startsWith("C#") ? " wa-roll-oct" : ""));
    row.append(el("span", "wa-piano-note", note));
    const track = el("div", "wa-piano-track");
    const bgCells: HTMLButtonElement[] = [];
    for (let c = 0; c < STEPS; c++) {
      const cell = el("button", "wa-cell wa-piano-cell" + (isGridLine(c) ? " wa-beat" : "")) as HTMLButtonElement;
      cell.type = "button";
      cell.title = `${note}, step ${c + 1}`;
      cell.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || rollNoteAt(r, c)) return; // existing notes are handled by their own block, on top
        event.preventDefault();
        checkpoint();
        const fresh: VNote = { note, step: Math.min(STEPS - stepsPerGridLine(), snapStep(c)), len: stepsPerGridLine(), vel: 100 };
        synthNotes[clip.sel].push(fresh);
        dragNote = fresh; dragRow = r;
        audition(note, 100, 1);
        paintRoll(); paintSession(); saveAll();
      });
      cell.addEventListener("pointerenter", () => {
        if (!dragNote || dragRow !== r) return;
        if (c >= dragNote.step) { dragNote.len = Math.min(STEPS - dragNote.step, snapLen(c - dragNote.step + 1)); paintRoll(); }
      });
      bgCells.push(cell); track.append(cell);
    }
    rollBackgroundCells.push(bgCells);
    row.append(track);
    pianoRoll.append(row);
  });
  gridRepainters.push(() => rollBackgroundCells.forEach((row) => row.forEach((cell, c) => cell.classList.toggle("wa-beat", isGridLine(c)))));
  pianoRoll.append(rollNotesLayer, rollPlayhead);
  window.addEventListener("pointerup", () => { if (dragNote) saveAll(); dragNote = null; dragRow = -1; });
  const synthKeys = el("div", "wa-keys");
  let octaveShift = 0;
  const octaveLabel = el("span", "wa-status", "OCT 0");
  function setOctaveShift(v: number): void {
    octaveShift = Math.max(-3, Math.min(3, v));
    octaveLabel.textContent = `OCT ${octaveShift >= 0 ? "+" : ""}${octaveShift}`;
  }
  buildKeys(synthKeys,
    (note) => {
      ensureNodes();
      const n = midiToNote(noteToMidi(note) + octaveShift * 12);
      liveKeys.noteOn(ac(), engine.synthGain!, vsynthPatch, n);
      recordSynthOn(n);
    },
    (note) => {
      const n = midiToNote(noteToMidi(note) + octaveShift * 12);
      liveKeys.noteOff(ac(), n);
      recordSynthOff(n);
    });
  // Live key recording — notes land in the playing synth clip's piano roll,
  // snapped to the nearest step. Same target rule as pad recording.
  const keysRecBtn = btn("● Rec", "wa-toggle wa-btn-sm");
  let synthRec = false;
  const heldRec = new Map<string, number>();   // note -> start step
  function currentStepFloat(): number {
    if (!playhead.playing || playhead.lastHi < 0) return -1;
    return playhead.lastHi + Math.min(1, (performance.now() - playhead.lastStepStartedMs) / (stepDur() * 1000));
  }
  function synthRecTarget(): number { return (playhead.playing ? clip.play.synth : null) ?? clip.sel; }
  function recordSynthOn(note: string): void {
    if (!synthRec || !playhead.playing) return;
    const pos = currentStepFloat(); if (pos < 0) return;
    heldRec.set(note, Math.round(pos) % STEPS);
  }
  function recordSynthOff(note: string): void {
    const start = heldRec.get(note); if (start === undefined) return;
    heldRec.delete(note);
    if (!synthRec || !playhead.playing) return;
    const pos = currentStepFloat(); if (pos < 0) return;
    let len = Math.round(pos) - start;
    if (len <= 0) len += STEPS;
    len = Math.max(1, Math.min(STEPS - start, len));
    const target = synthRecTarget();
    synthNotes[target].push({ note, step: start, len, vel: 100 });
    if (target === clip.sel) paintRoll();
    saveAll();
  }
  keysRecBtn.addEventListener("click", () => {
    synthRec = !synthRec;
    if (synthRec) checkpoint();
    keysRecBtn.classList.toggle("active", synthRec);
  });
  help(keysRecBtn, "Capture key presses into the playing synth clip's piano roll while playback runs. Arm Count-in in the transport for a 1-bar lead-in.");
  const keysHeader = el("div", "wa-export");
  keysHeader.append(el("span", "wa-lbl", "KEYS — click, or Z-row / Q-row on the keyboard (− / = shift octave)"), keysRecBtn, octaveLabel);
  synthPanel.append(
    presetBrowserRow,
    presetRow,
    scopeCanvas,
    patchBox,
    el("div", "wa-sep-h"),
    el("div", "wa-lbl", "CHORD PLAYER"), chordRow,
    el("div", "wa-sep-h"),
    el("div", "wa-lbl", "PIANO ROLL — drag empty space to draw, drag a note to move (vertical = pitch) or its right edge to resize, click to delete, right-click for velocity"), pianoRoll,
    el("div", "wa-sep-h"),
    keysHeader, synthKeys,
  );

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
  const scratchPanel = buildScratchpad(() => chopBuffer);

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
    if (countIn && (mpc.recording || synthRec)) {
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
      if (key === "-") { setOctaveShift(octaveShift - 1); return; }
      if (key === "=") { setOctaveShift(octaveShift + 1); return; }
    }
    const n0 = keyMap[key];
    if (!n0 || downMap.has(key) || ev.metaKey || ev.ctrlKey) return;
    const n = midiToNote(noteToMidi(n0) + octaveShift * 12);
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
