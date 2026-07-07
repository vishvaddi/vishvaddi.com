// Session view (Arrange workspace): Ableton-style clip/scene launch grid and
// the linear song chain.

import {
  SCENE_LABELS, SONG_SLOTS, TRACKS, TRACK_LABELS, clip, clipLen, transport,
  allPats, synthNotes, padEvents, songChain,
} from "./state";
import type { TrackId } from "./state";
import { saveAll } from "./persistence";
import { el, btn, help } from "./helpers";
import { ctx } from "./ctx";

export interface SessionUI {
  song: HTMLElement;
  sessionGrid: HTMLElement;
  chain: HTMLElement;
  chainSelects: HTMLSelectElement[];
}

export function buildSession(): SessionUI {
  const song = el("div", "wa-panel");
  const launchStatus = el("span", "wa-status", "Clips launch on the next bar");
  ctx.launchStatus = launchStatus;
  const sessionGrid = el("div", "wa-session");
  const sessionCells: HTMLButtonElement[][] = [];   // [scene][track]
  const sceneLaunchBtns: HTMLButtonElement[] = [];
  function clipHasContent(track: TrackId, scene: number): boolean {
    if (track === "drums") return allPats[scene].some((row) => row.some(Boolean));
    if (track === "pads") return padEvents[scene].length > 0;
    return synthNotes[scene].length > 0;
  }
  function paintSession(): void {
    const playing = ctx.isPlaying();
    sessionCells.forEach((row, scene) => row.forEach((cell, ti) => {
      const track = TRACKS[ti];
      cell.classList.toggle("has", clipHasContent(track, scene));
      cell.classList.toggle("playing", playing && clip.play[track] === scene);
      cell.classList.toggle("armed", !playing && clip.play[track] === scene);
      cell.classList.toggle("queued", clip.queued[track] === scene);
      cell.classList.toggle("sel", clip.sel === scene);
      cell.dataset.bars = `${clipLen[scene][track] / 16}B`;
    }));
    sceneLaunchBtns.forEach((b, scene) => b.classList.toggle("active", clip.sel === scene));
  }
  ctx.paintSession = paintSession;
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
      help(cell, `Launch ${TRACK_LABELS[track].toLowerCase()} clip ${label}. Tracks can play clips from different scenes.`);
      cell.addEventListener("click", () => launchClip(track, scene));
      rowCells.push(cell); row.append(cell);
    });
    sessionCells.push(rowCells);
    sessionGrid.append(row);
  });
  const chain = el("div", "wa-song-chain");
  const chainSelects: HTMLSelectElement[] = [];
  songChain.forEach((pattern, i) => {
    const slot = el("label", "wa-song-slot");
    slot.append(el("span", "wa-lbl", String(i + 1)));
    const select = document.createElement("select");
    SCENE_LABELS.forEach((label, pi) => {
      const option = document.createElement("option"); option.value = String(pi); option.textContent = `Scene ${label}`; select.append(option);
    });
    select.value = String(pattern);
    select.addEventListener("change", () => { songChain[i] = Number(select.value); saveAll(); });
    chainSelects.push(select); slot.append(select); chain.append(slot);
  });
  const songHelp = el("p", "wa-help", "Each column is a track, each row a scene. Launch single clips or whole scenes — changes land on the next bar. Song mode plays the scene chain left to right.");
  song.append(songHelp, launchStatus, sessionGrid, el("div", "wa-sep-h"), el("div", "wa-lbl", "SONG CHAIN"), chain);

  return { song, sessionGrid, chain, chainSelects };
}
