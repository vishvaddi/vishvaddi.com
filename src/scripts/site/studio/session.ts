// Session view + per-track arrangement lanes — extracted verbatim from
// index.ts (Phase 0 split). Cross-section wiring goes through ctx.
import {
  TRACKS, TRACK_LABELS, SCENE_LABELS, SCENES, STEPS, clip, transport, song as songState,
  allPats, synthLaneNotes, SYNTH_LANES, padEvents, arrangement,
} from "./state";
import type { TrackId, ArrangeBlock, AutomationRamp } from "./state";
import { saveAll, projectState, applyProject } from "./persistence";
import { el, btn, help, download, askText } from "./helpers";
import { ctx, SCENE_COLORS } from "./ctx";

export interface SessionView {
  song: HTMLElement;
  launchStatus: HTMLElement;
  paintSession: () => void;
  arrangeLanePaints: Array<() => void>;
  // tutorial tour targets
  sessionGrid: HTMLElement;
}

const FACTORY_BASE = JSON.stringify(projectState(false));

export function blankProject(): Record<string, unknown> {
  const state = JSON.parse(FACTORY_BASE) as Record<string, unknown>;
  state.title = "Untitled";
  return state;
}

/** A complete demo project. Also seeds an empty first run — see index.ts. */
export function factorySong(name: string): Record<string, unknown> {
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
    put(scene, 0, name === "MIDNIGHT ACID" ? [0, 4, 8, 12] : [0, 6, 8, 14]);
    put(scene, 1, [4, 12]); put(scene, 2, [2, 6, 10, 14]);
    if (scene % 2) put(scene, 3, [7, 15]);
  });
  const note = (noteName: string, step: number, len = 1, accent = false, slide = false) => ({ note: noteName, step, len, vel: accent ? 116 : 94, accent, slide });
  state.synthLaneNotes = { bass: Array.from({ length: SCENES }, () => []), lead: Array.from({ length: SCENES }, () => []), harmony: Array.from({ length: SCENES }, () => []) };
  state.synthLaneNotes.bass[0] = [note("C3", 0, 2, true), note("C3", 3), note("D#3", 6, 1, false, true), note("G3", 10), note("A#2", 14)];
  state.synthLaneNotes.bass[1] = [note("F2", 0, 2, true), note("F2", 4), note("G#2", 8, 1, false, true), note("C3", 12)];
  state.synthLaneNotes.lead[2] = [note("C4", 0), note("D#4", 2), note("G4", 4, 2, true), note("A#4", 8), note("G4", 12, 2)];
  state.synthLaneNotes.harmony[3] = [note("C4", 0, 16)];
  const blocks = [0, 1, 2, 3].map((scene, index) => ({ scene, bars: name === "NEON HORIZON" ? 2 : 1, startBar: index * (name === "NEON HORIZON" ? 2 : 1), automation: index === 2 ? [{ lane: "lead" as const, param: "cutoff" as const, from: .2, to: .9 }] : [] }));
  state.arrangement = { drums: blocks, pads: blocks.map((b) => ({ ...b })), synth: blocks.map((b) => ({ ...b })) };
  state.bpm = name === "MIDNIGHT ACID" ? 122 : name === "NEON HORIZON" ? 138 : 92;
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
  function clipHasContent(track: TrackId, scene: number): boolean {
    if (track === "drums") return allPats[scene].some((row) => row.some(Boolean));
    if (track === "pads") return padEvents[scene].length > 0;
    return SYNTH_LANES.some((lane) => synthLaneNotes[lane][scene].length > 0);
  }
  function clipActivity(track: TrackId, scene: number): number {
    if (track === "drums") return allPats[scene].reduce((total, row) => total + row.filter(Boolean).length, 0);
    if (track === "pads") return padEvents[scene].length;
    return SYNTH_LANES.reduce((total, lane) => total + synthLaneNotes[lane][scene].length, 0);
  }
  function paintSession(): void {
    sessionCells.forEach((row, scene) => row.forEach((cell, ti) => {
      const track = TRACKS[ti];
      cell.classList.toggle("has", clipHasContent(track, scene));
      cell.style.setProperty("--wa-activity", String(Math.min(1, clipActivity(track, scene) / 16)));
      cell.classList.toggle("playing", ctx.isPlaying() && clip.play[track] === scene);
      cell.classList.toggle("armed", !ctx.isPlaying() && clip.play[track] === scene);
      cell.classList.toggle("queued", clip.queued[track] === scene);
      cell.classList.toggle("sel", clip.sel === scene);
    }));
    sceneLaunchBtns.forEach((b, scene) => b.classList.toggle("active", clip.sel === scene));
  }
  const paintScenePosition = (): void => {
    if (sessionGrid.clientWidth <= 0 || sessionGrid.scrollWidth <= sessionGrid.clientWidth + 2) { scenePosition.textContent = "Scenes 1–16 of 16"; return; }
    const start = Math.max(1, Math.min(SCENES, Math.floor(sessionGrid.scrollLeft / 52) + 1));
    const visible = Math.max(1, Math.floor((sessionGrid.clientWidth - 76) / 52));
    scenePosition.textContent = `Scenes ${start}–${Math.min(SCENES, start + visible - 1)} of ${SCENES}`;
  };
  sessionGrid.addEventListener("scroll", paintScenePosition, { passive: true });
  new ResizeObserver(paintScenePosition).observe(sessionGrid);
  function launchClip(track: TrackId, scene: number | null): void {
    if (ctx.isPlaying()) {
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
    paintSession(); saveAll();
  }
  function launchScene(scene: number): void {
    TRACKS.forEach((track) => {
      if (ctx.isPlaying()) clip.queued[track] = scene;
      else clip.play[track] = scene;
    });
    transport.songMode = false; ctx.songBtn.textContent = "Session"; ctx.songBtn.classList.remove("active"); ctx.renderSel.value = "pattern";
    launchStatus.textContent = ctx.isPlaying() ? `Scene ${SCENE_LABELS[scene]} queued` : `Scene ${SCENE_LABELS[scene]} armed`;
    if (clip.sel !== scene) ctx.selectScene(scene);
    paintSession(); saveAll();
  }
  // Transposed launcher: 3 track ROWS × 16 scene COLUMNS. Sixteen scenes as
  // rows cannot fit the aperture; as columns they do, and time then runs
  // left-to-right on the same axis as the chain composer below. Cells are
  // still addressed [scene][track] so paintSession is untouched.
  SCENE_LABELS.forEach(() => sessionCells.push([]));
  const headRow = el("div", "wa-session-row wa-session-head");
  headRow.append(el("span", "wa-session-scene", "Scene"));
  SCENE_LABELS.forEach((label, scene) => {
    const launch = btn(label, "wa-scene-launch");
    launch.classList.remove("wa-btn");
    help(launch, `Launch every track's clip ${label} together (a scene).`);
    launch.addEventListener("click", () => launchScene(scene));
    sceneLaunchBtns.push(launch);
    headRow.append(launch);
  });
  sessionGrid.append(headRow);
  TRACKS.forEach((track) => {
    const row = el("div", "wa-session-row");
    const stop = btn(`${TRACK_LABELS[track]} ■`, "wa-clip-stop");
    stop.classList.remove("wa-btn");
    help(stop, `Stop the ${TRACK_LABELS[track].toLowerCase()} track at the next bar.`);
    stop.addEventListener("click", () => launchClip(track, null));
    row.append(stop);
    SCENE_LABELS.forEach((label, scene) => {
      const cell = btn("", "wa-clip");
      cell.classList.remove("wa-btn");
      cell.style.setProperty("--scene-color", SCENE_COLORS[scene]);
      help(cell, `Launch ${TRACK_LABELS[track].toLowerCase()} clip ${label}. Tracks can play clips from different scenes.`);
      cell.addEventListener("click", () => launchClip(track, scene));
      sessionCells[scene].push(cell);
      row.append(cell);
    });
    sessionGrid.append(row);
  });
  // Compact pattern-chain composer. It maps Anchor's repeat/reorder workflow
  // onto the existing shared arrangement timeline instead of maintaining a
  // second song format.
  const composer = el("div", "wa-composer");
  const composerHead = el("div", "wa-composer-head");
  const chain = el("div", "wa-chainstrip wa-arrange-lanes");
  const addBtn = btn("＋ Scene", "wa-btn-sm"), leftBtn = btn("←", "wa-btn-sm"), rightBtn = btn("→", "wa-btn-sm"), shorterBtn = btn("− Bar", "wa-btn-sm"), longerBtn = btn("＋ Bar", "wa-btn-sm"), deleteBtn = btn("Delete", "wa-btn-sm"), clearBtn = btn("Clear", "wa-btn-sm");
  addBtn.setAttribute("aria-label", "Add selected scene");
  shorterBtn.setAttribute("aria-label", "Remove one repeat bar");
  longerBtn.setAttribute("aria-label", "Add one repeat bar");
  let selectedBlock = -1;
  const canonical = (): ArrangeBlock[] => arrangement.drums;
  const normaliseStarts = () => {
    let cursor = 0;
    canonical().forEach((block) => { block.startBar = cursor; cursor += block.bars; });
    TRACKS.slice(1).forEach((track) => { arrangement[track] = canonical().map((block) => ({ ...block, automation: block.automation?.map((r) => ({ ...r })) })); });
  };
  const paintChain = () => {
    chain.replaceChildren();
    if (!canonical().length) chain.append(el("span", "wa-chain-empty", "Add scenes to build an arrangement"));
    TRACKS.forEach((track) => {
      const row = el("div", "wa-arrange-lane");
      row.append(el("span", "wa-arrange-lane-name", TRACK_LABELS[track]));
      const clips = el("div", "wa-arrange-lane-clips");
      arrangement[track].forEach((block, index) => {
        const item = track === "drums"
          ? btn(`${SCENE_LABELS[block.scene]} ×${block.bars}`, "wa-chain-block")
          : el("span", "wa-track-block", `${SCENE_LABELS[block.scene]} ×${block.bars}`);
        item.classList.remove("wa-btn"); item.classList.toggle("active", index === selectedBlock);
        item.style.setProperty("--block-bars", String(block.bars));
        item.style.setProperty("--scene-color", SCENE_COLORS[block.scene]);
        if (block.automation?.length) item.classList.add("automated");
        if (item instanceof HTMLButtonElement) item.addEventListener("click", () => { selectedBlock = index; paintChain(); paintAutomation(); });
        clips.append(item);
      });
      row.append(clips); chain.append(row);
    });
  };
  const commitChain = () => { normaliseStarts(); saveAll(); paintChain(); };
  addBtn.addEventListener("click", () => { ctx.checkpoint(); canonical().push({ scene: clip.sel, bars: 1, startBar: 0, automation: [] }); selectedBlock = canonical().length - 1; commitChain(); });
  leftBtn.addEventListener("click", () => { if (selectedBlock <= 0) return; ctx.checkpoint(); [canonical()[selectedBlock - 1], canonical()[selectedBlock]] = [canonical()[selectedBlock], canonical()[selectedBlock - 1]]; selectedBlock--; commitChain(); });
  rightBtn.addEventListener("click", () => { if (selectedBlock < 0 || selectedBlock >= canonical().length - 1) return; ctx.checkpoint(); [canonical()[selectedBlock + 1], canonical()[selectedBlock]] = [canonical()[selectedBlock], canonical()[selectedBlock + 1]]; selectedBlock++; commitChain(); });
  shorterBtn.addEventListener("click", () => { const block = canonical()[selectedBlock]; if (!block) return; ctx.checkpoint(); block.bars = Math.max(1, block.bars - 1); commitChain(); });
  longerBtn.addEventListener("click", () => { const block = canonical()[selectedBlock]; if (!block) return; ctx.checkpoint(); block.bars = Math.min(128, block.bars + 1); commitChain(); });
  deleteBtn.addEventListener("click", () => { if (selectedBlock < 0) return; ctx.checkpoint(); canonical().splice(selectedBlock, 1); selectedBlock = Math.min(selectedBlock, canonical().length - 1); commitChain(); paintAutomation(); });
  clearBtn.addEventListener("click", () => { ctx.checkpoint(); TRACKS.forEach((track) => { arrangement[track] = []; }); selectedBlock = -1; saveAll(); paintChain(); paintAutomation(); });

  const automation = el("div", "wa-automation-editor");
  const laneSel = document.createElement("select"); [["bass", "Bass"], ["lead", "Lead"], ["harmony", "Harmony"], ["master", "Master"]].forEach(([v, l]) => laneSel.append(new Option(l, v)));
  const paramSel = document.createElement("select"); [["cutoff", "Cutoff"], ["volume", "Volume"], ["reverb", "Reverb"]].forEach(([v, l]) => paramSel.append(new Option(l, v)));
  const fromInput = document.createElement("input"), toInput = document.createElement("input");
  [fromInput, toInput].forEach((input) => { input.type = "number"; input.min = "0"; input.max = "100"; input.value = input === fromInput ? "20" : "80"; input.setAttribute("aria-label", input === fromInput ? "Automation start percent" : "Automation end percent"); });
  const addRampBtn = btn("＋ Ramp", "wa-btn-sm"), ramps = el("div", "wa-ramp-list");
  const paintAutomation = () => {
    ramps.replaceChildren(); const block = canonical()[selectedBlock];
    block?.automation?.forEach((ramp, index) => {
      const row = el("div", "wa-ramp-row", `${ramp.lane} ${ramp.param} ${Math.round(ramp.from * 100)}→${Math.round(ramp.to * 100)}%`);
      const remove = btn("×", "wa-btn-sm"); remove.addEventListener("click", () => { ctx.checkpoint(); block.automation!.splice(index, 1); commitChain(); paintAutomation(); }); row.append(remove); ramps.append(row);
    });
  };
  addRampBtn.addEventListener("click", () => {
    const block = canonical()[selectedBlock]; if (!block) return;
    ctx.checkpoint();
    const ramp: AutomationRamp = { lane: laneSel.value as AutomationRamp["lane"], param: paramSel.value as AutomationRamp["param"], from: Number(fromInput.value) / 100, to: Number(toInput.value) / 100 };
    block.automation ??= []; block.automation.push(ramp); commitChain(); paintAutomation();
  });
  automation.append(el("span", "wa-lbl", "AUTOMATION"), laneSel, paramSel, el("span", "wa-lbl", "FROM"), fromInput, el("span", "wa-lbl", "TO"), toInput, addRampBtn, ramps);

  const songLibrary = el("div", "wa-song-library");
  const songKey = "vv_studio_user_songs"; let songs: Record<string, Record<string, unknown>> = {};
  try { songs = JSON.parse(localStorage.getItem(songKey) || "{}"); } catch { songs = {}; }
  const factorySongs = ["MIDNIGHT ACID", "NEON HORIZON", "DUST BREAK"];
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

  composerHead.append(el("span", "wa-fx-title", "ARRANGEMENT"), addBtn, leftBtn, rightBtn, shorterBtn, longerBtn, deleteBtn, clearBtn);
  composer.append(composerHead, chain, automation, songLibrary); paintChain(); paintAutomation();
  const arrangeLanePaints: Array<() => void> = [paintChain];
  help(sessionGrid, "Each column is a track, each row a scene — launch single clips or whole scenes; changes land on the next bar so transitions stay in time.");
  song.append(statusRow, sessionGrid, composer);
  requestAnimationFrame(paintScenePosition);

  return { song, launchStatus, paintSession, arrangeLanePaints, sessionGrid };
}
