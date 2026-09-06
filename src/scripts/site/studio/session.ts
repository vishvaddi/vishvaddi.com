// Session view + per-track arrangement lanes — extracted verbatim from
// index.ts (Phase 0 split). Cross-section wiring goes through ctx.
import {
  TRACKS, TRACK_LABELS, ARRANGE_TRACKS, ARRANGE_TRACK_LABELS, SCENE_LABELS, SCENES, STEPS, clip, transport, song as songState,
  allPats, synthLaneNotes, SYNTH_LANES, activeSynth, padEvents, arrangement, createArrangeBlock, songLoop, songPos, songEndBar,
  audioTracks, addSynthLane, addAudioTrack,
} from "./state";
import type { TrackId, ArrangeTrackId, ArrangeBlock, AudioArrangeClip, AutomationRamp, SynthLane } from "./state";
import { saveAll, projectState, applyProject } from "./persistence";
import { el, btn, help, download, askText, readAsDataUrl } from "./helpers";
import { ctx, playhead, SCENE_COLORS } from "./ctx";
import { buildDemo, DEMO_TITLES } from "./demos";

export interface SessionView {
  song: HTMLElement;
  launchStatus: HTMLElement;
  paintSession: () => void;
  arrangeLanePaints: Array<() => void>;
  addCurrentToSong: (source: "beat" | "synth") => void;
  // tutorial tour targets
  sessionGrid: HTMLElement;
}

const FACTORY_BASE = JSON.stringify(projectState(false));

export function blankProject(): Record<string, unknown> {
  const state = JSON.parse(FACTORY_BASE) as Record<string, unknown>;
  state.title = "Untitled";
  return state;
}

export function quickBeatProject(): Record<string, unknown> {
  const state = factorySong("QUICK BEAT") as Record<string, unknown> & { arrangement: Record<string, ArrangeBlock[]>; title: string; bpm: number };
  state.title = "Quick Beat"; state.bpm = 120;
  state.arrangement = {
    drums: state.arrangement.drums.slice(0, 1), pads: state.arrangement.pads.slice(0, 1),
    bass: [], lead: [], harmony: [],
  };
  return state;
}

/** Demo projects live in demos.ts; this legacy generator only backs QUICK BEAT now. */
export function factorySong(name: string): Record<string, unknown> {
  const demo = buildDemo(name, JSON.parse(FACTORY_BASE) as Record<string, unknown>);
  if (demo) return demo;
  const state = JSON.parse(FACTORY_BASE) as Record<string, unknown> & {
    pats: number[][][]; vels: number[][][]; synthLaneNotes: Record<string, Array<Array<Record<string, unknown>>>>;
    arrangement: Record<string, ArrangeBlock[]>; bpm: number; title: string; padEvents: Array<Array<Record<string, unknown>>>;
  };
  state.title = name;
  state.pats = Array.from({ length: SCENES }, () => Array.from({ length: 8 }, () => Array(STEPS).fill(0)));
  state.vels = Array.from({ length: SCENES }, () => Array.from({ length: 8 }, () => Array(STEPS).fill(96)));
  state.padEvents = Array.from({ length: SCENES }, () => []);
  const put = (scene: number, row: number, steps: number[]) => steps.forEach((step) => { state.pats[scene][row][step] = 1; });
  [0, 1, 2, 3].forEach((scene) => {
    put(scene, 0, [0, 6, 8, 14]);
    put(scene, 1, [4, 12]); put(scene, 2, [2, 6, 10, 14]);
    if (scene % 2) put(scene, 3, [7, 15]);
  });
  const note = (noteName: string, step: number, len = 1, accent = false, slide = false) => ({ note: noteName, step, len, vel: accent ? 116 : 94, accent, slide });
  state.synthLaneNotes = { bass: Array.from({ length: SCENES }, () => []), lead: Array.from({ length: SCENES }, () => []), harmony: Array.from({ length: SCENES }, () => []) };
  state.synthLaneNotes.bass[0] = [note("C3", 0, 2, true), note("C3", 3), note("D#3", 6, 1, false, true), note("G3", 10), note("A#2", 14)];
  state.synthLaneNotes.bass[1] = [note("F2", 0, 2, true), note("F2", 4), note("G#2", 8, 1, false, true), note("C3", 12)];
  state.synthLaneNotes.lead[2] = [note("C4", 0), note("D#4", 2), note("G4", 4, 2, true), note("A#4", 8), note("G4", 12, 2)];
  state.synthLaneNotes.harmony[3] = [note("C4", 0, 16)];
  const makeBlocks = () => [0, 1, 2, 3].map((scene, index) => ({
    id: `factory-${name.toLowerCase().replace(/\s+/g, "-")}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    scene, bars: 1, startBar: index,
    offset: 0, loop: true,
    automation: index === 2 ? [{ lane: "lead" as const, param: "cutoff" as const, from: .2, to: .9 }] : [],
  }));
  state.arrangement = { drums: makeBlocks(), pads: makeBlocks(), bass: makeBlocks(), lead: makeBlocks(), harmony: makeBlocks() };
  state.bpm = 92;
  return state;
}

export function buildSession(): SessionView {
  const song = el("div", "wa-panel");
  const launchStatus = el("span", "wa-status", "Clips launch on the next bar");
  const scenePosition = el("span", "wa-scene-position", "Scenes 1–16 of 16");
  const statusRow = el("div", "wa-session-status"); statusRow.append(launchStatus, scenePosition);
  const sessionGrid = el("div", "wa-session");
  const sessionCells: HTMLButtonElement[][] = [];   // [scene][track]
  const sceneLaunchBtns: HTMLButtonElement[] = [];
  let showAllScenes = localStorage.getItem("vv_studio_show_all_scenes") === "1";
  function clipActivity(track: TrackId, scene: number): number {
    if (track === "drums") return allPats[scene].reduce((total, row) => total + row.filter(Boolean).length, 0);
    if (track === "pads") return padEvents[scene].length;
    return synthLaneNotes[track][scene].length;
  }
  function paintSession(): void {
    const lastUsed = Math.max(clip.sel, ...SCENE_LABELS.map((_, scene) => TRACKS.some((track) => clipActivity(track, scene) > 0) ? scene : -1));
    const visibleScenes = showAllScenes ? SCENES : Math.min(SCENES, Math.max(4, lastUsed + 2));
    sessionGrid.style.setProperty("--wa-visible-scenes", String(visibleScenes));
    sessionCells.forEach((row, scene) => row.forEach((cell, ti) => {
      const track = TRACKS[ti];
      const activity = clipActivity(track, scene);
      cell.classList.toggle("has", activity > 0);
      cell.style.setProperty("--wa-activity", String(Math.min(1, activity / 16)));
      const count = cell.querySelector<HTMLElement>(".wa-clip-count");
      if (count) count.textContent = activity ? `${activity} ${track === "drums" || track === "pads" ? "hits" : "notes"}` : "empty";
      cell.classList.toggle("playing", ctx.isPlaying() && clip.play[track] === scene);
      cell.classList.toggle("armed", !ctx.isPlaying() && clip.play[track] === scene);
      cell.classList.toggle("queued", clip.queued[track] === scene);
      cell.classList.toggle("sel", clip.sel === scene);
      cell.hidden = scene >= visibleScenes;
    }));
    sceneLaunchBtns.forEach((b, scene) => { b.classList.toggle("active", clip.sel === scene); b.hidden = scene >= visibleScenes; });
  }
  const paintScenePosition = (): void => {
    scenePosition.textContent = `${SCENES} scenes · ${TRACKS.length} tracks`;
  };
  sessionGrid.addEventListener("scroll", paintScenePosition, { passive: true });
  new ResizeObserver(paintScenePosition).observe(sessionGrid);
  // Any manual launch is a statement of intent: you are session-jamming, not
  // playing the arrangement. Exit Song mode VISIBLY (the transport toggle
  // repaints) — the old behaviour left armed clips silently overridden by the
  // arrangement on play.
  function exitSongMode(): void {
    if (!transport.songMode) return;
    transport.songMode = false;
    ctx.songBtn.textContent = "Pattern"; ctx.songBtn.classList.remove("active"); ctx.renderSel.value = "pattern";
  }
  function launchClip(track: TrackId, scene: number | null): void {
    exitSongMode();
    if (ctx.isPlaying() && clip.quantization !== "none") {
      // Clicking an already-queued clip cancels the queue.
      clip.queued[track] = clip.queued[track] === scene ? undefined : scene;
      launchStatus.textContent = scene === null
        ? `${TRACK_LABELS[track]} stopping at the bar`
        : `${TRACK_LABELS[track]} ${SCENE_LABELS[scene]} queued`;
    } else {
      clip.play[track] = scene;
      launchStatus.textContent = scene === null ? `${TRACK_LABELS[track]} stopped` : `${TRACK_LABELS[track]} ${SCENE_LABELS[scene]} armed`;
    }
    if (scene !== null && clip.sel !== scene) ctx.selectScene(scene);
    paintSession(); saveAll(); window.dispatchEvent(new CustomEvent("vv-studio-clip-launch"));
  }
  function launchScene(scene: number): void {
    TRACKS.forEach((track) => {
      if (ctx.isPlaying() && clip.quantization !== "none") clip.queued[track] = scene;
      else clip.play[track] = scene;
    });
    exitSongMode();
    launchStatus.textContent = ctx.isPlaying() ? `Scene ${SCENE_LABELS[scene]} queued` : `Scene ${SCENE_LABELS[scene]} armed`;
    if (clip.sel !== scene) ctx.selectScene(scene);
    paintSession(); saveAll(); window.dispatchEvent(new CustomEvent("vv-studio-clip-launch"));
  }
  // Track columns and vertical scenes match the Live/Bitwig mental model:
  // instruments stay put while musical alternatives run downward.
  const buildSessionGrid = (): void => {
    sessionGrid.replaceChildren(); sessionCells.splice(0); sceneLaunchBtns.splice(0);
    SCENE_LABELS.forEach(() => sessionCells.push([]));
    const headRow = el("div", "wa-session-row wa-session-head wa-scene-rail");
    headRow.append(el("span", "wa-session-scene", "SCENE"));
    SCENE_LABELS.forEach((label, scene) => {
      const launch = btn(label, "wa-scene-launch"); launch.classList.remove("wa-btn");
      help(launch, `Launch every track's clip ${label} together.`); launch.addEventListener("click", () => launchScene(scene));
      sceneLaunchBtns.push(launch); headRow.append(launch);
    });
    sessionGrid.append(headRow);
    TRACKS.forEach((track) => {
      const row = el("div", "wa-session-row wa-track-column"); row.dataset.track = track;
      const trackHead = el("div", "wa-clip-track-head"), trackIdentity = el("div", "wa-clip-track-identity");
      trackIdentity.append(el("span", "wa-track-colour"), el("strong", "wa-clip-track-name", TRACK_LABELS[track]), el("span", "wa-clip-track-type", track === "drums" || track === "pads" ? "AUDIO" : "INSTRUMENT"));
      const stop = btn("■", "wa-clip-stop"); stop.classList.remove("wa-btn"); stop.setAttribute("aria-label", `Stop ${TRACK_LABELS[track]}`);
      help(stop, `Stop the ${TRACK_LABELS[track].toLowerCase()} track at the next bar.`); stop.addEventListener("click", () => launchClip(track, null));
      trackHead.append(trackIdentity, stop); row.append(trackHead);
      SCENE_LABELS.forEach((label, scene) => {
        const cell = btn("", "wa-clip"); cell.classList.remove("wa-btn"); cell.style.setProperty("--scene-color", SCENE_COLORS[scene]);
        cell.append(el("span", "wa-clip-launch-icon", "▶"), el("span", "wa-clip-name", `Clip ${label}`), el("span", "wa-clip-count"), el("span", "wa-clip-activity"));
        help(cell, `Launch ${TRACK_LABELS[track].toLowerCase()} clip ${label} — double-tap to edit it.`); cell.addEventListener("click", () => launchClip(track, scene));
        cell.addEventListener("dblclick", () => {
          if (track !== "drums" && track !== "pads") { activeSynth.lane = track; ctx.openTrackEditor("synth", scene); }
          else ctx.openTrackEditor(track, scene);
        });
        sessionCells[scene].push(cell); row.append(cell);
      });
      sessionGrid.append(row);
    });
    paintSession(); requestAnimationFrame(paintScenePosition);
  };
  buildSessionGrid();
  // Arrangement timeline. Session clips and arranger blocks reference the
  // same scene data; only their playback context differs.
  const composer = el("div", "wa-composer");
  const composerHead = el("div", "wa-composer-head");
  const chain = el("div", "wa-chainstrip wa-arrange-lanes");
  const addBtn = btn("＋ Clip", "wa-btn-sm"), duplicateBtn = btn("Duplicate", "wa-btn-sm"), copyBtn = btn("Copy", "wa-btn-sm"), pasteBtn = btn("Paste", "wa-btn-sm"), splitBtn = btn("Split", "wa-btn-sm"), deleteBtn = btn("Delete", "wa-btn-sm"), zoomOutBtn = btn("−", "wa-btn-sm"), zoomInBtn = btn("＋", "wa-btn-sm"), fitBtn = btn("Fit", "wa-btn-sm");
  const addMidiTrackBtn = btn("＋ MIDI track", "wa-btn-sm"), addAudioTrackBtn = btn("＋ Audio track", "wa-btn-sm");
  const audioInput = document.createElement("input"); audioInput.type = "file"; audioInput.accept = "audio/*"; audioInput.hidden = true;
  const composerTitle = el("span", "wa-fx-title", "ARRANGER");
  const zoomReadout = el("span", "wa-timeline-zoom", "56 px/bar");
  const loopToggle = btn("Loop", "wa-btn-sm wa-toggle");
  const loopStart = document.createElement("input"), loopEnd = document.createElement("input");
  [loopStart, loopEnd].forEach((input) => { input.type = "number"; input.min = "1"; input.max = "128"; input.className = "wa-loop-input"; });
  loopStart.value = String(songLoop.startBar + 1); loopEnd.value = String(songLoop.endBar + 1);
  loopStart.setAttribute("aria-label", "Loop start bar"); loopEnd.setAttribute("aria-label", "Loop end bar");
  loopToggle.classList.toggle("active", songLoop.on);
  let selLane: ArrangeTrackId = "drums";
  let selectedId: string | null = null;
  let selectedAudioId: string | null = null;
  let pixelsPerBar = Number(localStorage.getItem("vv_studio_timeline_zoom")) || 56;
  let audioTargetId: string | null = null;
  const importAudio = async (file: File, targetId?: string | null): Promise<void> => {
    const track = audioTracks.find((item) => item.id === targetId) ?? addAudioTrack(file.name.replace(/\.[^.]+$/, ""));
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      const bars = Math.max(1, Math.ceil(buffer.duration / (60 / transport.bpm * 4)));
      track.clips.push({ id: `audio-clip-${Date.now().toString(36)}`, name: file.name, data: await readAsDataUrl(file), startBar: track.clips.reduce((end, item) => Math.max(end, item.startBar + item.bars), 0), bars, duration: buffer.duration, offset: 0, gain: 1 });
      window.dispatchEvent(new CustomEvent("vv-studio-tracks-change")); saveAll(); paintChain(); launchStatus.textContent = `${file.name} added to ${track.name}`;
    } finally { void context.close(); }
  };
  addMidiTrackBtn.addEventListener("click", async () => {
    const name = await askText("New MIDI track", `MIDI ${SYNTH_LANES.length + 1}`); if (!name) return;
    ctx.checkpoint(); const lane = addSynthLane(name); activeSynth.lane = lane; buildSessionGrid(); saveAll(); paintChain();
  });
  addAudioTrackBtn.addEventListener("click", () => { audioTargetId = null; audioInput.click(); });
  audioInput.addEventListener("change", async () => { const file = audioInput.files?.[0]; if (file) await importAudio(file, audioTargetId); audioInput.value = ""; audioTargetId = null; });
  const selected = (): ArrangeBlock | null => arrangement[selLane].find((block) => block.id === selectedId) ?? null;
  const selectedAudio = () => audioTracks.flatMap((track) => track.clips.map((audioClip) => ({ track, audioClip }))).find(({ audioClip }) => audioClip.id === selectedAudioId) ?? null;
  const clipInspector = el("aside", "wa-arrange-selection"); clipInspector.hidden = true;
  const inspectorTitle = el("span", "wa-inspector-title", "CLIP");
  const closeInspector = btn("×", "wa-btn-sm"); closeInspector.setAttribute("aria-label", "Close clip inspector");
  const sceneSelect = document.createElement("select"); sceneSelect.setAttribute("aria-label", "Clip scene");
  SCENE_LABELS.forEach((label, scene) => sceneSelect.append(new Option(`Scene ${label}`, String(scene))));
  const startInput = document.createElement("input"), barsInput = document.createElement("input");
  [startInput, barsInput].forEach((input) => { input.type = "number"; input.min = "1"; input.max = "128"; });
  startInput.setAttribute("aria-label", "Clip start bar"); barsInput.setAttribute("aria-label", "Clip length in bars");
  const loopCheck = document.createElement("input"); loopCheck.type = "checkbox"; loopCheck.setAttribute("aria-label", "Loop clip contents");
  const editClipBtn = btn("Open editor", "wa-btn-sm");
  const inspectorHead = el("div", "wa-arrange-selection-head"); inspectorHead.append(inspectorTitle, closeInspector);
  const inspectorGrid = el("div", "wa-arrange-selection-grid");
  const field = (label: string, control: HTMLElement) => { const wrap = el("label", "wa-arrange-field"); wrap.append(el("span", "wa-lbl", label), control); return wrap; };
  inspectorGrid.append(field("Scene", sceneSelect), field("Start", startInput), field("Length", barsInput), field("Loop", loopCheck));
  clipInspector.append(inspectorHead, inspectorGrid, editClipBtn);
  const nextFreeBar = (track: ArrangeTrackId): number => arrangement[track].reduce((end, block) => Math.max(end, block.startBar + block.bars), 0);
  const openArrangeEditor = (track: ArrangeTrackId, scene: number): void => {
    if (track !== "drums" && track !== "pads") {
      activeSynth.lane = track as SynthLane; ctx.openTrackEditor("synth", scene);
      return;
    }
    ctx.openTrackEditor(track, scene);
  };
  const paintSelectionInspector = (): void => {
    const block = selected(); clipInspector.hidden = !block;
    if (!block) return;
    inspectorTitle.textContent = `${ARRANGE_TRACK_LABELS[selLane]} · Scene ${SCENE_LABELS[block.scene]}`;
    sceneSelect.value = String(block.scene); startInput.value = String(block.startBar + 1); barsInput.value = String(block.bars); loopCheck.checked = block.loop !== false;
  };
  closeInspector.addEventListener("click", () => { clipInspector.hidden = true; });
  const updateSelected = (mutate: (block: ArrangeBlock) => void) => { const block = selected(); if (!block) return; ctx.checkpoint(); mutate(block); clip.sel = block.scene; commitChain(); paintAutomation(); };
  sceneSelect.addEventListener("change", () => updateSelected((block) => { block.scene = Number(sceneSelect.value); }));
  startInput.addEventListener("change", () => updateSelected((block) => { block.startBar = Math.max(0, Number(startInput.value) - 1 || 0); }));
  barsInput.addEventListener("change", () => updateSelected((block) => { block.bars = Math.max(1, Math.min(128, Number(barsInput.value) || 1)); }));
  loopCheck.addEventListener("change", () => updateSelected((block) => { block.loop = loopCheck.checked; }));
  editClipBtn.addEventListener("click", () => { const block = selected(); if (block) openArrangeEditor(selLane, block.scene); });
  const selectBlock = (track: ArrangeTrackId, block: ArrangeBlock): void => {
    selLane = track; selectedId = block.id; clip.sel = block.scene; paintChain(); paintAutomation(); paintSelectionInspector();
  };
  const commitChain = (): void => {
    ARRANGE_TRACKS.forEach((track) => arrangement[track].sort((a, b) => a.startBar - b.startBar));
    saveAll(); paintChain(); paintSelectionInspector();
  };
  const bindBlockDrag = (item: HTMLButtonElement, track: ArrangeTrackId, block: ArrangeBlock, edge: "move" | "start" | "end"): void => {
    item.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (edge !== "move") event.stopPropagation();
      event.preventDefault();
      selLane = track; selectedId = block.id; clip.sel = block.scene; paintAutomation(); paintSelectionInspector();
      chain.querySelectorAll(".wa-chain-block.active").forEach((node) => node.classList.remove("active"));
      item.classList.add("active");
      const startX = event.clientX, originalStart = block.startBar, originalBars = block.bars;
      item.setPointerCapture(event.pointerId);
      let pendingDelta = 0;
      const move = (moveEvent: PointerEvent) => {
        const delta = Math.round((moveEvent.clientX - startX) / pixelsPerBar);
        if (delta === pendingDelta) return;
        pendingDelta = delta;
        if (edge === "move") item.style.left = `${Math.max(0, originalStart + delta) * pixelsPerBar}px`;
        if (edge === "start") {
          const nextStart = Math.max(0, Math.min(originalStart + originalBars - 1, originalStart + delta));
          item.style.left = `${nextStart * pixelsPerBar}px`;
          item.style.width = `${Math.max(pixelsPerBar, (originalBars + originalStart - nextStart) * pixelsPerBar - 3)}px`;
        }
        if (edge === "end") item.style.width = `${Math.max(pixelsPerBar, Math.min(128, originalBars + delta) * pixelsPerBar - 3)}px`;
      };
      const up = (upEvent: PointerEvent) => {
        item.removeEventListener("pointermove", move);
        item.removeEventListener("pointerup", up);
        item.removeEventListener("pointercancel", up);
        const targetLane = edge === "move" ? (document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest(".wa-arrange-lane[data-track]") as HTMLElement | null)?.dataset.track as ArrangeTrackId | undefined : undefined;
        const movesTrack = !!targetLane && targetLane !== track && ARRANGE_TRACKS.includes(targetLane);
        if (!pendingDelta && !movesTrack) return;
        ctx.checkpoint();
        if (edge === "move") {
          block.startBar = Math.max(0, originalStart + pendingDelta);
          if (movesTrack && targetLane) {
            arrangement[track] = arrangement[track].filter((candidate) => candidate.id !== block.id);
            arrangement[targetLane].push(block); selLane = targetLane;
          }
        }
        if (edge === "start") {
          const nextStart = Math.max(0, Math.min(originalStart + originalBars - 1, originalStart + pendingDelta));
          block.startBar = nextStart; block.bars = originalBars + originalStart - nextStart;
        }
        if (edge === "end") block.bars = Math.max(1, Math.min(128, originalBars + pendingDelta));
        commitChain();
      };
      item.addEventListener("pointermove", move);
      item.addEventListener("pointerup", up);
      item.addEventListener("pointercancel", up);
    });
  };
  const paintChain = () => {
    chain.replaceChildren();
    const visibleBars = Math.max(16, songEndBar() + 8, songLoop.endBar + 1);
    const width = visibleBars * pixelsPerBar;
    zoomReadout.textContent = `${pixelsPerBar} px/bar`;
    const rulerRow = el("div", "wa-timeline-row wa-ruler-row");
    rulerRow.append(el("div", "wa-timeline-corner", "TRACKS"));
    const ruler = el("div", "wa-timeline-ruler"); ruler.style.width = `${width}px`; ruler.style.setProperty("--bar-width", `${pixelsPerBar}px`);
    for (let bar = 0; bar < visibleBars; bar++) {
      const mark = el("span", "wa-ruler-mark", String(bar + 1)); mark.style.left = `${bar * pixelsPerBar}px`; ruler.append(mark);
    }
    ruler.addEventListener("click", (event) => { songPos.bar = Math.max(0, Math.floor((event.clientX - ruler.getBoundingClientRect().left) / pixelsPerBar)); paintChain(); });
    rulerRow.append(ruler); chain.append(rulerRow);
    if (ARRANGE_TRACKS.every((track) => !arrangement[track].length)) chain.append(el("span", "wa-chain-empty", "Choose a scene, then add or drag clips onto the timeline."));
    ARRANGE_TRACKS.forEach((track, trackIndex) => {
      const row = el("div", "wa-arrange-lane");
      row.dataset.track = track;
      row.classList.toggle("sel-lane", track === selLane);
      const name = btn("", "wa-arrange-lane-name");
      name.classList.remove("wa-btn");
      name.append(el("span", "wa-track-colour"), el("span", "wa-arrange-track-number", String(trackIndex + 1).padStart(2, "0")), el("strong", "wa-arrange-track-title", ARRANGE_TRACK_LABELS[track]), el("span", "wa-arrange-track-type", track === "drums" || track === "pads" ? "AUDIO" : "INSTRUMENT"));
      help(name, `Select the ${ARRANGE_TRACK_LABELS[track].toLowerCase()} arrangement track.`);
      name.addEventListener("click", () => { selLane = track; selectedId = arrangement[track][0]?.id ?? null; paintChain(); paintAutomation(); });
      row.append(name);
      const clips = el("div", "wa-arrange-lane-clips");
      clips.style.width = `${width}px`;
      clips.style.setProperty("--bar-width", `${pixelsPerBar}px`);
      clips.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest(".wa-chain-block, .wa-lane-add")) return;
        songPos.bar = Math.max(0, Math.floor((event.clientX - clips.getBoundingClientRect().left) / pixelsPerBar)); paintChain();
      });
      const loopRegion = el("span", "wa-loop-region");
      loopRegion.hidden = !songLoop.on;
      loopRegion.style.left = `${songLoop.startBar * pixelsPerBar}px`; loopRegion.style.width = `${(songLoop.endBar - songLoop.startBar) * pixelsPerBar}px`;
      clips.append(loopRegion);
      const playhead = el("span", "wa-arrange-playhead"); playhead.style.left = `${songPos.bar * pixelsPerBar}px`; clips.append(playhead);
      arrangement[track].forEach((block) => {
        const item = btn(SCENE_LABELS[block.scene], "wa-chain-block");
        item.title = `Scene ${SCENE_LABELS[block.scene]} · ${block.bars} bar${block.bars === 1 ? "" : "s"}`;
        item.classList.remove("wa-btn");
        item.classList.toggle("active", block.id === selectedId);
        item.style.left = `${block.startBar * pixelsPerBar}px`;
        item.style.width = `${Math.max(pixelsPerBar, block.bars * pixelsPerBar - 3)}px`;
        item.style.setProperty("--scene-color", SCENE_COLORS[block.scene]);
        item.style.setProperty("--wa-clip-density", String(Math.min(1, clipActivity(track, block.scene) / 16)));
        if (block.automation?.length) item.classList.add("automated");
        item.dataset.clipId = block.id;
        const leftHandle = el("span", "wa-clip-handle wa-clip-handle-start"), rightHandle = el("span", "wa-clip-handle wa-clip-handle-end");
        item.prepend(leftHandle); item.append(el("span", "wa-arrange-clip-preview"), rightHandle);
        help(item, `Scene ${SCENE_LABELS[block.scene]}, bars ${block.startBar + 1}–${block.startBar + block.bars}. Drag to move; drag either edge to trim.`);
        item.addEventListener("click", () => selectBlock(track, block));
        item.addEventListener("dblclick", () => openArrangeEditor(track, block.scene));
        bindBlockDrag(item, track, block, "move");
        bindBlockDrag(leftHandle as unknown as HTMLButtonElement, track, block, "start");
        bindBlockDrag(rightHandle as unknown as HTMLButtonElement, track, block, "end");
        clips.append(item);
      });
      const laneAdd = btn("＋", "wa-lane-add");
      laneAdd.classList.remove("wa-btn");
      laneAdd.style.left = `${nextFreeBar(track) * pixelsPerBar}px`;
      help(laneAdd, `Add scene ${SCENE_LABELS[clip.sel]} at the end of ${ARRANGE_TRACK_LABELS[track]}.`);
      laneAdd.addEventListener("click", () => {
        ctx.checkpoint(); selLane = track;
        const block = createArrangeBlock(clip.sel, nextFreeBar(track)); arrangement[track].push(block); selectedId = block.id;
        commitChain(); paintAutomation();
      });
      clips.append(laneAdd);
      row.append(clips); chain.append(row);
    });
    audioTracks.forEach((track, trackIndex) => {
      const row = el("div", "wa-arrange-lane wa-audio-lane"); row.dataset.track = "audio";
      const name = btn("", "wa-arrange-lane-name"); name.classList.remove("wa-btn");
      name.append(el("span", "wa-track-colour"), el("span", "wa-arrange-track-number", String(ARRANGE_TRACKS.length + trackIndex + 1).padStart(2, "0")), el("strong", "wa-arrange-track-title", track.name), el("span", "wa-arrange-track-type", "AUDIO"));
      row.append(name);
      const clips = el("div", "wa-arrange-lane-clips"); clips.style.width = `${width}px`; clips.style.setProperty("--bar-width", `${pixelsPerBar}px`);
      const playhead = el("span", "wa-arrange-playhead"); playhead.style.left = `${songPos.bar * pixelsPerBar}px`; clips.append(playhead);
      track.clips.forEach((audioClip) => {
        const item = btn(audioClip.name, "wa-chain-block wa-audio-block"); item.classList.remove("wa-btn");
        item.classList.toggle("active", audioClip.id === selectedAudioId); item.style.left = `${audioClip.startBar * pixelsPerBar}px`; item.style.width = `${Math.max(pixelsPerBar, audioClip.bars * pixelsPerBar - 3)}px`;
        item.dataset.audioClipId = audioClip.id; item.title = `${audioClip.name} · ${audioClip.duration.toFixed(1)} s · drag to move`;
        item.addEventListener("click", () => { selectedAudioId = audioClip.id; selectedId = null; paintChain(); });
        item.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return; selectedAudioId = audioClip.id; selectedId = null; item.classList.add("active"); const startX = event.clientX, original = audioClip.startBar; item.setPointerCapture(event.pointerId);
          const move = (moveEvent: PointerEvent) => { item.style.left = `${Math.max(0, original + Math.round((moveEvent.clientX - startX) / pixelsPerBar)) * pixelsPerBar}px`; };
          const up = (upEvent: PointerEvent) => { item.removeEventListener("pointermove", move); item.removeEventListener("pointerup", up); audioClip.startBar = Math.max(0, original + Math.round((upEvent.clientX - startX) / pixelsPerBar)); saveAll(); paintChain(); };
          item.addEventListener("pointermove", move); item.addEventListener("pointerup", up);
        });
        clips.append(item);
      });
      const laneAdd = btn("＋ Audio", "wa-lane-add"); laneAdd.classList.remove("wa-btn"); laneAdd.style.left = `${track.clips.reduce((end, item) => Math.max(end, item.startBar + item.bars), 0) * pixelsPerBar}px`;
      laneAdd.addEventListener("click", () => { audioTargetId = track.id; audioInput.click(); }); clips.append(laneAdd);
      row.append(clips); chain.append(row);
    });
  };
  window.addEventListener("vv-studio-arrange-playhead", (event) => {
    const bar = (event as CustomEvent<{ bar: number }>).detail?.bar;
    if (!Number.isFinite(bar)) return;
    chain.querySelectorAll<HTMLElement>(".wa-arrange-playhead").forEach((node) => { node.style.left = `${bar * pixelsPerBar}px`; });
  });
  const addSelected = () => { ctx.checkpoint(); const block = createArrangeBlock(clip.sel, nextFreeBar(selLane)); arrangement[selLane].push(block); selectedId = block.id; commitChain(); paintAutomation(); };
  const duplicateSelected = () => {
    const audio = selectedAudio();
    if (audio) { ctx.checkpoint(); const copy = { ...audio.audioClip, id: `audio-clip-${Date.now().toString(36)}`, startBar: audio.audioClip.startBar + audio.audioClip.bars }; audio.track.clips.push(copy); selectedAudioId = copy.id; saveAll(); paintChain(); return; }
    const block = selected(); if (!block) return; ctx.checkpoint(); const copy = { ...block, id: createArrangeBlock(block.scene, 0).id, startBar: block.startBar + block.bars, automation: block.automation?.map((ramp) => ({ ...ramp })) }; arrangement[selLane].push(copy); selectedId = copy.id; commitChain();
  };
  let arrangeClipboard: { kind: "midi"; track: ArrangeTrackId; block: ArrangeBlock } | { kind: "audio"; trackId: string; clip: AudioArrangeClip } | null = null;
  const copySelected = () => {
    const audio = selectedAudio();
    if (audio) { arrangeClipboard = { kind: "audio", trackId: audio.track.id, clip: { ...audio.audioClip } }; return; }
    const block = selected();
    if (block) arrangeClipboard = { kind: "midi", track: selLane, block: { ...block, automation: block.automation?.map((ramp) => ({ ...ramp })) } };
  };
  const pasteSelected = () => {
    const clipboard = arrangeClipboard;
    if (!clipboard) return;
    ctx.checkpoint();
    if (clipboard.kind === "audio") {
      const track = audioTracks.find((candidate) => candidate.id === clipboard.trackId) ?? audioTracks[0];
      if (!track) return;
      const copy = { ...clipboard.clip, id: `audio-clip-${Date.now().toString(36)}`, startBar: songPos.bar };
      track.clips.push(copy); selectedAudioId = copy.id; selectedId = null; saveAll(); paintChain(); return;
    }
    const copy = { ...clipboard.block, id: createArrangeBlock(clipboard.block.scene, 0).id, startBar: songPos.bar, automation: clipboard.block.automation?.map((ramp) => ({ ...ramp })) };
    arrangement[selLane].push(copy); selectedId = copy.id; selectedAudioId = null; commitChain();
  };
  const splitSelected = () => {
    const audio = selectedAudio();
    if (audio && audio.audioClip.bars >= 2) { ctx.checkpoint(); const requested = songPos.bar - audio.audioClip.startBar, leftBars = requested > 0 && requested < audio.audioClip.bars ? requested : Math.floor(audio.audioClip.bars / 2), secondsPerBar = 60 / transport.bpm * 4; const right = { ...audio.audioClip, id: `audio-clip-${Date.now().toString(36)}`, startBar: audio.audioClip.startBar + leftBars, bars: audio.audioClip.bars - leftBars, offset: audio.audioClip.offset + leftBars * secondsPerBar }; audio.audioClip.bars = leftBars; audio.track.clips.push(right); selectedAudioId = right.id; saveAll(); paintChain(); return; }
    const block = selected(); if (!block || block.bars < 2) return; ctx.checkpoint(); const requested = songPos.bar - block.startBar, leftBars = requested > 0 && requested < block.bars ? requested : Math.floor(block.bars / 2), right = { ...block, id: createArrangeBlock(block.scene, 0).id, startBar: block.startBar + leftBars, bars: block.bars - leftBars, automation: block.automation?.map((ramp) => ({ ...ramp })) }; block.bars = leftBars; arrangement[selLane].push(right); selectedId = right.id; commitChain();
  };
  const deleteSelected = () => {
    const audio = selectedAudio();
    if (audio) { ctx.checkpoint(); audio.track.clips = audio.track.clips.filter((item) => item.id !== audio.audioClip.id); selectedAudioId = null; saveAll(); paintChain(); return; }
    if (!selectedId) return; ctx.checkpoint(); arrangement[selLane] = arrangement[selLane].filter((block) => block.id !== selectedId); selectedId = null; commitChain(); paintAutomation();
  };
  addBtn.addEventListener("click", addSelected); duplicateBtn.addEventListener("click", duplicateSelected); copyBtn.addEventListener("click", copySelected); pasteBtn.addEventListener("click", pasteSelected); splitBtn.addEventListener("click", splitSelected); deleteBtn.addEventListener("click", deleteSelected);
  const setZoom = (value: number) => { pixelsPerBar = Math.max(32, Math.min(112, value)); localStorage.setItem("vv_studio_timeline_zoom", String(pixelsPerBar)); paintChain(); };
  zoomOutBtn.addEventListener("click", () => setZoom(pixelsPerBar - 8)); zoomInBtn.addEventListener("click", () => setZoom(pixelsPerBar + 8));
  fitBtn.addEventListener("click", () => { const visibleBars = Math.max(16, songEndBar() + 8, songLoop.endBar + 1); setZoom(Math.floor(Math.max(320, chain.clientWidth - 142) / visibleBars)); });
  loopToggle.addEventListener("click", () => { songLoop.on = !songLoop.on; loopToggle.classList.toggle("active", songLoop.on); saveAll(); paintChain(); });
  const updateLoop = () => { songLoop.startBar = Math.max(0, Number(loopStart.value) - 1 || 0); songLoop.endBar = Math.max(songLoop.startBar + 1, Number(loopEnd.value) - 1 || songLoop.startBar + 8); loopStart.value = String(songLoop.startBar + 1); loopEnd.value = String(songLoop.endBar + 1); saveAll(); paintChain(); };
  loopStart.addEventListener("change", updateLoop); loopEnd.addEventListener("change", updateLoop);
  composer.tabIndex = 0;
  composer.addEventListener("keydown", (event) => {
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelected(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelected(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") { event.preventDefault(); copySelected(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") { event.preventDefault(); pasteSelected(); }
    if (event.key.toLowerCase() === "s" && !event.ctrlKey && !event.metaKey) { event.preventDefault(); splitSelected(); }
  });

  const automation = el("div", "wa-automation-editor");
  const laneSel = document.createElement("select"); [["bass", "Bass"], ["lead", "Lead"], ["harmony", "Harmony"], ["master", "Master"]].forEach(([v, l]) => laneSel.append(new Option(l, v)));
  const paramSel = document.createElement("select"); [["cutoff", "Cutoff"], ["volume", "Volume"], ["reverb", "Reverb"]].forEach(([v, l]) => paramSel.append(new Option(l, v)));
  const fromInput = document.createElement("input"), toInput = document.createElement("input");
  [fromInput, toInput].forEach((input) => { input.type = "number"; input.min = "0"; input.max = "100"; input.value = input === fromInput ? "20" : "80"; input.setAttribute("aria-label", input === fromInput ? "Automation start percent" : "Automation end percent"); });
  const addRampBtn = btn("＋ Ramp", "wa-btn-sm"), ramps = el("div", "wa-ramp-list");
  const paintAutomation = () => {
    ramps.replaceChildren(); const block = selected();
    block?.automation?.forEach((ramp, index) => {
      const row = el("div", "wa-ramp-row", `${ramp.lane} ${ramp.param} ${Math.round(ramp.from * 100)}→${Math.round(ramp.to * 100)}%`);
      const remove = btn("×", "wa-btn-sm"); remove.addEventListener("click", () => { ctx.checkpoint(); block.automation!.splice(index, 1); commitChain(); paintAutomation(); }); row.append(remove); ramps.append(row);
    });
  };
  addRampBtn.addEventListener("click", () => {
    const block = selected(); if (!block) return;
    ctx.checkpoint();
    const ramp: AutomationRamp = { lane: laneSel.value as AutomationRamp["lane"], param: paramSel.value as AutomationRamp["param"], from: Number(fromInput.value) / 100, to: Number(toInput.value) / 100 };
    block.automation ??= []; block.automation.push(ramp); commitChain(); paintAutomation();
  });
  automation.append(el("span", "wa-lbl", "AUTOMATION"), laneSel, paramSel, el("span", "wa-lbl", "FROM"), fromInput, el("span", "wa-lbl", "TO"), toInput, addRampBtn, ramps);

  const songLibrary = el("div", "wa-song-library");
  const songKey = "vv_studio_user_songs"; let songs: Record<string, Record<string, unknown>> = {};
  try { songs = JSON.parse(localStorage.getItem(songKey) || "{}"); } catch { songs = {}; }
  const factorySongs = [...DEMO_TITLES];
  const songSel = document.createElement("select"); songSel.setAttribute("aria-label", "Saved song");
  const refreshSongs = () => {
    const current = songSel.value; songSel.replaceChildren();
    factorySongs.forEach((name) => songSel.append(new Option(name, `factory:${name}`)));
    Object.keys(songs).sort().forEach((name) => songSel.append(new Option(`★ ${name}`, `user:${name}`)));
    if (Array.from(songSel.options).some((option) => option.value === current)) songSel.value = current;
  };
  const saveSongBtn = btn("Save", "wa-btn-sm"), loadSongBtn = btn("Load", "wa-btn-sm"), deleteSongBtn = btn("Delete", "wa-btn-sm"), exportSongBtn = btn("Export", "wa-btn-sm"), importSongBtn = btn("Import", "wa-btn-sm");
  const songInput = document.createElement("input"); songInput.type = "file"; songInput.accept = ".json,application/json"; songInput.hidden = true;
  saveSongBtn.addEventListener("click", async () => { const name = await askText("Save song", "Untitled song"); if (!name) return; songs[name] = projectState(false) as Record<string, unknown>; localStorage.setItem(songKey, JSON.stringify(songs)); refreshSongs(); songSel.value = `user:${name}`; });
  // Loading applies in place. It used to reload the page, which threw away
  // your position in the app and gave no warning that the current track was
  // about to be replaced.
  loadSongBtn.addEventListener("click", () => {
    const saved = songSel.value.startsWith("factory:") ? factorySong(songSel.value.slice(8)) : songs[songSel.value.slice(5)];
    if (!saved) return;
    const label = songSel.value.replace(/^(factory|user):/, "");
    if (!window.confirm(`Load "${label}"? It replaces everything currently in the studio.`)) return;
    ctx.checkpoint();
    applyProject(JSON.parse(JSON.stringify(saved)) as Record<string, unknown>);
    ctx.refreshVisibleState();
    saveAll();
    launchStatus.textContent = `Loaded ${label}`;
  });
  deleteSongBtn.addEventListener("click", () => { if (!songSel.value.startsWith("user:")) return; delete songs[songSel.value.slice(5)]; localStorage.setItem(songKey, JSON.stringify(songs)); refreshSongs(); });
  const slug = (): string => songState.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "song";
  exportSongBtn.addEventListener("click", () => download(`vishamp-${slug()}.json`, new Blob([JSON.stringify({ format: "vishamp-song", version: 1, title: songState.title, song: projectState(false) }, null, 2)], { type: "application/json" })));
  importSongBtn.addEventListener("click", () => songInput.click());
  songInput.addEventListener("change", async () => {
    const file = songInput.files?.[0]; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { song?: Record<string, unknown> };
      if (!parsed.song?.pats) throw new Error("Invalid song");
      if (window.confirm(`Import "${file.name}"? It replaces everything currently in the studio.`)) {
        ctx.checkpoint(); applyProject(parsed.song); ctx.refreshVisibleState(); saveAll(); launchStatus.textContent = `Imported ${file.name}`;
      }
    } catch { launchStatus.textContent = "Song file is invalid"; }
    songInput.value = "";
  });
  refreshSongs();
  songLibrary.append(el("span", "wa-lbl", "SONGS"), songSel, loadSongBtn, saveSongBtn, deleteSongBtn, exportSongBtn, importSongBtn, songInput);

  const trackTools = el("div", "wa-arrange-toolgroup"); trackTools.append(addMidiTrackBtn, addAudioTrackBtn, audioInput);
  const editTools = el("div", "wa-arrange-toolgroup"); editTools.append(addBtn, duplicateBtn, copyBtn, pasteBtn, splitBtn, deleteBtn);
  const loopTools = el("div", "wa-arrange-toolgroup wa-loop-tools"); loopTools.append(loopToggle, loopStart, el("span", "wa-loop-arrow", "→"), loopEnd);
  const zoomTools = el("div", "wa-arrange-toolgroup wa-zoom-tools"); zoomTools.append(zoomOutBtn, zoomReadout, zoomInBtn, fitBtn);
  composerHead.append(composerTitle, trackTools, editTools, el("span", "wa-toolbar-spacer"), loopTools, zoomTools);
  const automationFold = el("details", "wa-fold") as HTMLDetailsElement;
  const automationSummary = el("summary", "wa-fold-head", "AUTOMATION");
  automationFold.append(automationSummary, automation);
  const libraryFold = el("details", "wa-fold") as HTMLDetailsElement;
  const librarySummary = el("summary", "wa-fold-head", "SONGS");
  libraryFold.append(librarySummary, songLibrary);
  // Desktop: both sections stay open as a left inspector; phones keep them folded.
  automationFold.open = libraryFold.open = window.matchMedia("(min-width: 701px) and (min-height: 541px)").matches;
  composer.append(composerHead, chain, automationFold, libraryFold); paintChain(); paintAutomation();
  window.addEventListener("vv-studio-tracks-change", () => { buildSessionGrid(); paintChain(); });
  const arrangeLanePaints: Array<() => void> = [paintChain];
  help(sessionGrid, "Each column is a track, each row a scene — launch single clips or whole scenes; changes land on the next bar so transitions stay in time.");
  const viewBar = el("div", "wa-song-viewbar");
  const arrangeViewBtn = btn("Arrangement", "wa-subtab active"), sessionViewBtn = btn("Clip launcher", "wa-subtab"), scenesBtn = btn(showAllScenes ? "Compact scenes" : "All scenes", "wa-btn-sm"), captureBtn = btn("Capture", "wa-btn-sm"), quantizationSelect = document.createElement("select");
  quantizationSelect.className = "wa-select wa-launch-quantization"; quantizationSelect.setAttribute("aria-label", "Clip launch quantization");
  quantizationSelect.append(new Option("Launch: Bar", "bar"), new Option("Launch: Beat", "beat"), new Option("Launch: Now", "none"));
  const savedQuantization = localStorage.getItem("vv_studio_launch_quantization");
  if (savedQuantization === "bar" || savedQuantization === "beat" || savedQuantization === "none") clip.quantization = savedQuantization;
  quantizationSelect.value = clip.quantization;
  quantizationSelect.addEventListener("change", () => { clip.quantization = quantizationSelect.value as typeof clip.quantization; localStorage.setItem("vv_studio_launch_quantization", clip.quantization); });
  let currentView: "arrange" | "session" = "arrange";
  const showView = (view: "arrange" | "session", moveFocus = false) => {
    currentView = view;
    composer.toggleAttribute("hidden", view !== "arrange"); sessionGrid.toggleAttribute("hidden", view !== "session");
    arrangeViewBtn.classList.toggle("active", view === "arrange"); sessionViewBtn.classList.toggle("active", view === "session");
    localStorage.setItem("vv_studio_song_view", view);
    if (moveFocus) (view === "arrange" ? composer : sessionGrid).focus({ preventScroll: true });
  };
  sessionGrid.tabIndex = 0;
  arrangeViewBtn.addEventListener("click", () => showView("arrange", true)); sessionViewBtn.addEventListener("click", () => showView("session", true));
  scenesBtn.addEventListener("click", () => { showAllScenes = !showAllScenes; localStorage.setItem("vv_studio_show_all_scenes", showAllScenes ? "1" : "0"); scenesBtn.textContent = showAllScenes ? "Compact scenes" : "All scenes"; paintSession(); });
  let captureArmed = false, captureOriginStep = 0;
  const capturePlaying = () => {
    const start = Math.max(0, Math.floor((playhead.absStep - captureOriginStep) / STEPS));
    const capture = (track: ArrangeTrackId, scene: number | null) => {
      if (scene === null) return;
      const previous = arrangement[track].at(-1);
      if (previous?.startBar === start) { previous.scene = scene; return; }
      if (previous && previous.startBar < start) previous.bars = Math.max(1, start - previous.startBar);
      arrangement[track].push(createArrangeBlock(scene, start));
    };
    capture("drums", clip.play.drums); capture("pads", clip.play.pads); SYNTH_LANES.forEach((lane) => capture(lane, clip.play[lane])); commitChain();
  };
  captureBtn.addEventListener("click", () => {
    captureArmed = !captureArmed; captureBtn.classList.toggle("active", captureArmed); captureBtn.textContent = captureArmed ? "● Capturing" : "Capture";
    if (captureArmed) { ctx.checkpoint(); captureOriginStep = playhead.absStep; capturePlaying(); launchStatus.textContent = "Recording clip launches into Song"; }
    else { capturePlaying(); launchStatus.textContent = "Capture committed"; }
  });
  window.addEventListener("vv-studio-clip-launch", () => { if (captureArmed) capturePlaying(); });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && !(event.target as HTMLElement)?.matches("input, textarea, select")) { event.preventDefault(); showView(currentView === "session" ? "arrange" : "session", true); }
  });
  viewBar.append(arrangeViewBtn, sessionViewBtn, scenesBtn, el("span", "wa-toolbar-spacer"), quantizationSelect, captureBtn, statusRow);
  song.append(viewBar, sessionGrid, composer, clipInspector);
  showView(localStorage.getItem("vv_studio_song_view") === "session" ? "session" : "arrange");
  requestAnimationFrame(paintScenePosition);

  const addCurrentToSong = (source: "beat" | "synth"): void => {
    ctx.checkpoint();
    const startBar = Math.max(0, ...ARRANGE_TRACKS.flatMap((track) => arrangement[track].map((block) => block.startBar + block.bars)));
    const tracks: ArrangeTrackId[] = source === "beat" ? ["drums", "pads"] : ["bass", "lead", "harmony"];
    tracks.forEach((track) => arrangement[track].push(createArrangeBlock(clip.sel, startBar)));
    launchStatus.textContent = `${source === "beat" ? "Beat" : "Synth"} added at bar ${startBar + 1}`;
    saveAll(); paintChain();
  };

  return { song, launchStatus, paintSession, arrangeLanePaints, sessionGrid, addCurrentToSong };
}
