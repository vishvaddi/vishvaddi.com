// Session view + per-track arrangement lanes — extracted verbatim from
// index.ts (Phase 0 split). Cross-section wiring goes through ctx.
import {
  TRACKS, TRACK_LABELS, SCENE_LABELS, clip, transport,
  allPats, synthNotes, padEvents,
} from "./state";
import type { TrackId } from "./state";
import { saveAll } from "./persistence";
import { el, btn, help } from "./helpers";
import { ctx, SCENE_COLORS } from "./ctx";
import { buildArrange } from "./arrange";

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
    arr.paintPlayhead();
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
  // Arrangement timeline (arrange.ts, C5) — session keeps the old return
  // contract (arrangeLanes element + paint list) so index.ts, the tutorial
  // target and the layout stay untouched.
  const arr = buildArrange();
  const arrangeLanes = arr.host;
  const arrangeLanePaints: Array<() => void> = [arr.paintArrange];
  help(sessionGrid, "Each column is a track, each row a scene — launch clips or whole scenes; changes land on the next bar. The timeline below is the song: blocks play their scene at their bar, gaps are silence, the brace loops a region.");
  song.append(launchStatus, sessionGrid, arrangeLanes);

  return { song, launchStatus, paintSession, arrangeLanePaints, sessionGrid, arrangeLanes };
}
