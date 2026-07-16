// Session view + per-track arrangement lanes — extracted verbatim from
// index.ts (Phase 0 split). Cross-section wiring goes through ctx.
import {
  TRACKS, TRACK_LABELS, SCENE_LABELS, clip, transport,
  allPats, synthNotes, padEvents, arrangement,
} from "./state";
import type { ArrangeBlock, TrackId } from "./state";
import { saveAll } from "./persistence";
import { el, btn, help } from "./helpers";
import { ctx, SCENE_COLORS } from "./ctx";

export interface SessionView {
  song: HTMLElement;
  launchStatus: HTMLElement;
  paintSession: () => void;
  arrangeLanePaints: Array<() => void>;
  // tutorial tour targets
  sessionGrid: HTMLElement;
  arrangeLanes: HTMLElement;
}

export function buildSession(): SessionView {
  const song = el("div", "wa-panel");
  const launchStatus = el("span", "wa-status", "Clips launch on the next bar");
  const sessionGrid = el("div", "wa-session");
  const sessionCells: HTMLButtonElement[][] = [];   // [scene][track]
  const sceneLaunchBtns: HTMLButtonElement[] = [];
  function clipHasContent(track: TrackId, scene: number): boolean {
    if (track === "drums") return allPats[scene].some((row) => row.some(Boolean));
    if (track === "pads") return padEvents[scene].length > 0;
    return synthNotes[scene].length > 0;
  }
  function paintSession(): void {
    sessionCells.forEach((row, scene) => row.forEach((cell, ti) => {
      const track = TRACKS[ti];
      cell.classList.toggle("has", clipHasContent(track, scene));
      cell.classList.toggle("playing", ctx.isPlaying() && clip.play[track] === scene);
      cell.classList.toggle("armed", !ctx.isPlaying() && clip.play[track] === scene);
      cell.classList.toggle("queued", clip.queued[track] === scene);
      cell.classList.toggle("sel", clip.sel === scene);
    }));
    sceneLaunchBtns.forEach((b, scene) => b.classList.toggle("active", clip.sel === scene));
  }
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
  // Header: track names double as stop buttons.
  const headRow = el("div", "wa-session-row wa-session-head");
  headRow.append(el("span", "wa-session-scene", "Scene"));
  TRACKS.forEach((track) => {
    const stop = btn(`${TRACK_LABELS[track]} ■`, "wa-clip-stop");
    stop.classList.remove("wa-btn");
    help(stop, `Stop the ${TRACK_LABELS[track].toLowerCase()} track at the next bar.`);
    stop.addEventListener("click", () => launchClip(track, null));
    headRow.append(stop);
  });
  sessionGrid.append(headRow);
  SCENE_LABELS.forEach((label, scene) => {
    const row = el("div", "wa-session-row");
    const launch = btn(`▶ ${label}`, "wa-scene-launch");
    help(launch, `Launch every track's clip ${label} together (a scene).`);
    launch.addEventListener("click", () => launchScene(scene));
    sceneLaunchBtns.push(launch);
    row.append(launch);
    const rowCells: HTMLButtonElement[] = [];
    TRACKS.forEach((track) => {
      const cell = btn("", "wa-clip");
      cell.classList.remove("wa-btn");
      cell.style.setProperty("--scene-color", SCENE_COLORS[scene]);
      help(cell, `Launch ${TRACK_LABELS[track].toLowerCase()} clip ${label}. Tracks can play clips from different scenes.`);
      cell.addEventListener("click", () => launchClip(track, scene));
      rowCells.push(cell); row.append(cell);
    });
    sessionCells.push(rowCells);
    sessionGrid.append(row);
  });
  // Arrangement — each track keeps its own ordered list of blocks (scene +
  // bar-length), independent of the other tracks, so a drum groove can loop
  // for 4 bars while the synth changes scene every bar underneath it.
  const arrangeLanes = el("div", "wa-arrange-lanes");
  const arrangeLanePaints: Array<() => void> = [];
  TRACKS.forEach((track) => {
    const lane = el("div", "wa-arrange-lane");
    lane.append(el("span", "wa-arrange-lane-label", TRACK_LABELS[track]));
    const blocksHost = el("div", "wa-arrange-blocks");
    function paintLane(): void {
      blocksHost.replaceChildren();
      arrangement[track].forEach((block, i) => {
        const chip = el("div", "wa-arrange-block");
        chip.classList.toggle("sel", block.scene === clip.sel);
        chip.style.flexGrow = String(block.bars);
        chip.style.setProperty("--scene-color", SCENE_COLORS[block.scene]);
        const sceneSel = document.createElement("select");
        SCENE_LABELS.forEach((sceneLabel, si) => {
          const option = document.createElement("option"); option.value = String(si); option.textContent = sceneLabel; sceneSel.append(option);
        });
        sceneSel.value = String(block.scene);
        sceneSel.addEventListener("change", () => { block.scene = Number(sceneSel.value); saveAll(); paintLane(); });
        const barsRow = el("div", "wa-arrange-bars-row");
        const barsOut = el("span", "wa-arrange-bars", `${block.bars} bar${block.bars === 1 ? "" : "s"}`);
        const barsMinus = btn("−", "wa-btn-sm"), barsPlus = btn("+", "wa-btn-sm");
        const setBars = (bars: number) => {
          block.bars = Math.max(1, Math.min(64, bars));
          barsOut.textContent = `${block.bars} bar${block.bars === 1 ? "" : "s"}`;
          chip.style.flexGrow = String(block.bars); saveAll();
        };
        barsMinus.addEventListener("click", () => setBars(block.bars - 1));
        barsPlus.addEventListener("click", () => setBars(block.bars + 1));
        barsRow.append(barsMinus, barsOut, barsPlus);
        const delBtn = btn("✕", "wa-btn-sm");
        help(delBtn, `Remove this ${TRACK_LABELS[track].toLowerCase()} block.`);
        delBtn.addEventListener("click", () => { ctx.checkpoint(); arrangement[track].splice(i, 1); saveAll(); paintLane(); });
        chip.append(sceneSel, barsRow, delBtn);
        blocksHost.append(chip);
      });
    }
    arrangeLanePaints.push(paintLane);
    const addBtn = btn("+ Block", "wa-btn-sm");
    help(addBtn, `Append a block playing the currently selected scene to the ${TRACK_LABELS[track].toLowerCase()} arrangement.`);
    addBtn.addEventListener("click", () => {
      arrangement[track].push({ scene: clip.sel, bars: 1 } as ArrangeBlock); saveAll(); paintLane();
    });
    lane.append(blocksHost, addBtn);
    paintLane();
    arrangeLanes.append(lane);
  });
  const songHelp = el("p", "wa-help", "Each column is a track, each row a scene. Launch single clips or whole scenes — changes land on the next bar. Arrange mode plays each track's own block list independently, looping shorter tracks to match the longest.");
  song.append(songHelp, launchStatus, sessionGrid, el("div", "wa-sep-h"), el("div", "wa-lbl", "ARRANGEMENT"), arrangeLanes);

  return { song, launchStatus, paintSession, arrangeLanePaints, sessionGrid, arrangeLanes };
}
