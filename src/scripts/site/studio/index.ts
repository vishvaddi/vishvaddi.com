import "../../../styles/studio.css";
import { SCENES, clip, allPats, allVels, songChain, sampleData, mpc, vsynthPatch } from "./state";
import { ac, ensureNodes, hydrateSample, applyFxState } from "./engine";
import * as engine from "./engine";
import { loadAll, applyProject, pendingProjectStore } from "./persistence";
import { buildShell } from "./shell";
import { buildDrumGrid } from "./drumgrid";
import { buildPads } from "./padsui";
import { buildRack } from "./rackui";
import { buildChop } from "./chopui";
import { buildSynthUI, highlightKey } from "./synthui";
import { buildSession } from "./session";
import { buildMixer } from "./mixerui";
import { buildRender } from "./render";
import { buildPlayback } from "./playback";
import { buildLayout } from "./layout";
import { buildTutorial } from "./tutorial";
import { ctx } from "./ctx";

export async function initStudio(): Promise<void> {
  const root = document.getElementById("studio"); if (!root) return;
  const pending = await Promise.race([pendingProjectStore("get").catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), 800))]);
  if (pending) applyProject(pending); else loadAll();
  sampleData.forEach((data, row) => { if (data) void hydrateSample(row); });

  const shell = buildShell();
  const drums = buildDrumGrid();
  const pads = buildPads();
  const rack = buildRack();
  const chop = buildChop();
  const synth = buildSynthUI();
  const session = buildSession();
  const mixer = buildMixer();
  const render = buildRender();
  buildPlayback(shell, drums.cells, synth.synthCells);
  buildLayout(root, shell, { ...pads, ...chop, rack, beat: drums.beat, synthPanel: synth.synthPanel, song: session.song, mixer: mixer.mixer, devicePanel: mixer.devicePanel, exp: render.exp });
  buildTutorial(shell, { ...pads, waveform: chop.waveform, pianoRoll: synth.pianoRoll, sessionGrid: session.sessionGrid, chain: session.chain, devicePanel: mixer.devicePanel, exp: render.exp });

  ctx.selectScene = (scene: number): void => {
    clip.sel = Math.max(0, Math.min(SCENES - 1, scene));
    drums.sceneBtns.forEach((button, index) => button.classList.toggle("active", index === clip.sel));
    drums.cells.forEach((row, rowIndex) => row.forEach((cell, step) => { const on = allPats[clip.sel][rowIndex][step]; cell.classList.toggle("on", on); if (on) ctx.setCellOpacity(cell, allVels[clip.sel][rowIndex][step]); else cell.style.opacity = ""; }));
    ctx.paintRoll(); ctx.paintEventLane(); ctx.paintSession();
  };
  ctx.refreshVisibleState = (): void => { ctx.selectScene(clip.sel); session.chainSelects.forEach((select, index) => { select.value = String(songChain[index]); }); ctx.paintMpcPads(); ctx.paintEventLane(); applyFxState(); };

  const keyMap: Record<string, string> = { a: "C4", w: "C#4", s: "D4", e: "D#4", d: "E4", f: "F4", t: "F#4", g: "G4", y: "G#4", h: "A4", u: "A#4", j: "B4", k: "C5" };
  const padMap: Record<string, number> = { "1": 12, "2": 13, "3": 14, "4": 15, q: 8, w: 9, e: 10, r: 11, a: 4, s: 5, d: 6, f: 7, z: 0, x: 1, c: 2, v: 3 };
  const down = new Set<string>();
  window.addEventListener("keydown", (event) => {
    if (shell.activeTab() === 0) { const localPad = padMap[event.key.toLowerCase()]; if (localPad != null && !event.repeat && !event.metaKey && !event.ctrlKey) { event.preventDefault(); pads.triggerPerformancePad(localPad, mpc.fullLevel ? 127 : 105); pads.padButtons[localPad].classList.add("down"); return; } }
    if (shell.activeTab() !== 1) return; const note = keyMap[event.key.toLowerCase()]; if (!note || down.has(note) || event.metaKey || event.ctrlKey) return;
    down.add(note); ensureNodes(); synth.liveKeys.noteOn(ac(), engine.synthGain!, vsynthPatch, note); highlightKey(synth.synthKeys, note, true);
  });
  window.addEventListener("keyup", (event) => { const localPad = padMap[event.key.toLowerCase()]; if (localPad != null) pads.padButtons[localPad].classList.remove("down"); if (shell.activeTab() !== 1) return; const note = keyMap[event.key.toLowerCase()]; if (!note) return; down.delete(note); synth.liveKeys.noteOff(ac(), note); highlightKey(synth.synthKeys, note, false); });

  ctx.selectScene(clip.sel);
  if (import.meta.env.DEV) (window as unknown as { __vishamp: { renderBuffer: typeof ctx.renderBuffer } }).__vishamp = { renderBuffer: ctx.renderBuffer };
}
