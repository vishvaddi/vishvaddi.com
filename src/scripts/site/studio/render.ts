// Project / export — offline render (WAV/MP3) + project file save/load.
// Extracted verbatim from index.ts (Phase 0 split). The offline graph must
// mirror the live engine chain so exports match what you hear.
import {
  PAD_BANK_SIZE, TRACKS, ARRANGE_TRACKS, clip, transport,
  allPats, allVels, synthLaneNotes, synthPatches, SYNTH_LANES, patternLengths, patternDivisions, laneLength, laneRate, padEvents, blockAt, songEndBar,
  rackState, audible, mixState, audioTracks,
} from "./state";
import type { ArrangeTrackId, TrackId } from "./state";
import { ensureNodes, trackGain, playDrum, playPad, metroClick, buildMasterChain, buildTracks } from "./engine";
import * as engine from "./engine";
import { playNote } from "./vsynth";
import { projectState, applyProject, saveAll } from "./persistence";
import { el, btn, help, download, encodeWav, encodeMp3, dataUrlToBytes } from "./helpers";
import { ctx } from "./ctx";

export interface ProjectExport {
  panel: HTMLElement;
  renderSel: HTMLSelectElement;
  /** offline render — also used by the MPC resample-to-pad feature */
  renderBuffer: (mode: "pattern" | "song", onlyTrack?: TrackId | null) => Promise<AudioBuffer>;
}

export function buildProjectExport(projects: { blank: () => Record<string, unknown>; quick: () => Record<string, unknown>; demo: () => Record<string, unknown> }): ProjectExport {
  const exp = el("div", "wa-panel");
  const expRow = el("div", "wa-export");
  const renderSel = document.createElement("select");
  [["pattern", "Launched clips"], ["song", "Full arrangement"]].forEach(([v, l]) => {
    const o = document.createElement("option"); o.value = v; o.textContent = l; renderSel.append(o);
  });
  renderSel.value = transport.songMode ? "song" : "pattern";
  const wavBtn = btn("Export WAV"), mp3Btn = btn("Export MP3"), stemsBtn = btn("Export stems"), expStatus = el("span", "wa-status");
  help(wavBtn, "Render the launched clips or full song as lossless WAV.");
  help(mp3Btn, "Render and encode the launched clips or full song as 192 kbps MP3.");
  help(stemsBtn, "Render separate drums, pads and synth WAV files for mixing in another DAW.");
  expRow.append(el("span", "wa-lbl", "Render"), renderSel, wavBtn, mp3Btn, stemsBtn, expStatus);
  const projectRow = el("div", "wa-export");
  const saveProjectBtn = btn("Save project"), loadProjectBtn = btn("Open project");
  const quickProjectBtn = btn("Quick beat", "wa-btn-sm"), newProjectBtn = btn("New song", "wa-btn-sm"), demoProjectBtn = btn("Starter song", "wa-btn-sm");
  help(saveProjectBtn, "Download an editable project containing patterns, settings and embedded samples.");
  help(loadProjectBtn, "Open a previously saved editable Studio project.");
  const projectInput = document.createElement("input"); projectInput.type = "file"; projectInput.accept = ".json,application/json"; projectInput.hidden = true;
  help(newProjectBtn, "Replace the current project with a clean blank studio.");
  help(demoProjectBtn, "Reload the editable WESTSIDE starter project.");
  projectRow.append(quickProjectBtn, newProjectBtn, demoProjectBtn, saveProjectBtn, loadProjectBtn, projectInput);
  exp.append(
    el("p", "wa-help", "Audio export includes drums and sequenced synth. Project files preserve editable patterns, song order, sounds and tempo."),
    expRow,
    el("div", "wa-sep-h"),
    projectRow,
  );

  async function renderBuffer(mode: "pattern" | "song", onlyTrack: TrackId | null = null): Promise<AudioBuffer> {
    ensureNodes();
    const sr = 44100, beat = 60 / transport.bpm;
    // Song mode renders the shared bar timeline (C5): each track plays the
    // block covering the bar, gaps are silence; clip mode renders the
    // launched per-track clips once.
    const bars = mode === "song" ? songEndBar() : 1;
    const arrangeSceneAt = (track: ArrangeTrackId, bar: number): number | null => mode === "song"
      ? blockAt(track, bar)?.scene ?? null
      : clip.play[track];
    const barDurations = Array.from({ length: bars }, (_, bar) => Math.max(beat * 4, ...ARRANGE_TRACKS.map((track) => {
      const scene = arrangeSceneAt(track, bar); return scene === null ? 0 : patternLengths[scene] * beat / (patternDivisions[scene] || 4);
    })));
    const barStarts: number[] = []; let renderDuration = 0;
    barDurations.forEach((duration) => { barStarts.push(renderDuration); renderDuration += duration; });
    const dur = renderDuration + 2.2;
    const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
    // One builder for live and offline — drive, tape echo and space cannot
    // drift between what you hear and what you export.
    const chain = buildMasterChain(off, off.destination);
    const om = chain.bus; om.gain.value = mixState.masterLevel;
    const reverbWet: GainNode = chain.spaceWet;
    const built = buildTracks(off, chain, (i) => trackGain[i].gain.value, mixState.synthLevel);
    const ot = built.tracks;
    const osg = built.synth; osg.gain.value = engine.synthGain!.gain.value;
    for (let bar = 0; bar < bars; bar++) {
      const drumClip = arrangeSceneAt("drums", bar), padClip = arrangeSceneAt("pads", bar);
      const automationBlocks = mode === "song" ? ARRANGE_TRACKS.map((track) => blockAt(track, bar)).filter((block): block is NonNullable<typeof block> => block !== null) : [];
      const automated = (lane: string, param: string, progress: number): number | null => {
        const ramp = automationBlocks.flatMap((block) => block.automation ?? []).find((item) => item.lane === lane && item.param === param);
        return ramp ? ramp.from + (ramp.to - ramp.from) * progress : null;
      };
      if ((!onlyTrack || onlyTrack === "drums") && drumClip !== null) {
        // Mirrors playback.ts: each lane walks its own length at its own rate
        // across the bar. Glitch is deliberately NOT applied — an export has to
        // be reproducible, and the glitch engine is randomised per hit.
        const sd = beat / (patternDivisions[drumClip] || 4);
        const barDur = patternLengths[drumClip] * sd;
        for (let r = 0; r < 8; r++) {
          if (!audible(r)) continue;
          const len = laneLength(drumClip, r), rateDur = beat / laneRate(drumClip, r);
          const hits = Math.ceil(barDur / rateDur - 1e-9);
          for (let k = 0; k < hits; k++) {
            const localStep = k % len;
            if (!allPats[drumClip][r][localStep]) continue;
            const offset = k * rateDur;
            const when = barStarts[bar] + offset + (k % 2 ? transport.swing * rateDur : 0) + (rackState.devices.player && k % 2 ? rackState.grooveTiming * rateDur * .5 : 0);
            playDrum(off, ot[r], r, allVels[drumClip][r][localStep] / 127, when);
          }
        }
      }
      if ((!onlyTrack || onlyTrack === "pads") && padClip !== null) {
        const sd = beat / (patternDivisions[padClip] || 4);
        padEvents[padClip].filter((event) => event.step < patternLengths[padClip]).forEach((event) => {
          if (Math.random() * 100 > event.probability) return;
          const base = barStarts[bar] + event.step * sd, when = base + (Math.floor(event.step) % 2 ? transport.swing * sd : 0);
          const ratchets = Math.max(1, event.ratchets), spacing = sd / ratchets;
          for (let i = 0; i < ratchets; i++) playPad(off, event.pad, event.velocity, Math.max(base, when + event.offset / 1000 + i * spacing), event.pad % PAD_BANK_SIZE, ot[event.pad % ot.length]);
        });
      }
      if (!onlyTrack || (onlyTrack !== "drums" && onlyTrack !== "pads")) {
        SYNTH_LANES.forEach((lane) => {
          if (onlyTrack && onlyTrack !== lane) return;
          const synthClip = arrangeSceneAt(lane, bar);
          if (synthClip === null) return;
          const laneSd = beat / (patternDivisions[synthClip] || 4);
          const arrangementBlock = mode === "song" ? blockAt(lane, bar) : null;
          synthLaneNotes[lane][synthClip].filter((note) => note.step < patternLengths[synthClip]).forEach((n) => {
          const when = barStarts[bar] + n.step * laneSd;
          const progress = arrangementBlock ? Math.max(0, Math.min(1, (bar - arrangementBlock.startBar + n.step / patternLengths[synthClip]) / arrangementBlock.bars)) : 0;
          const patch = { ...synthPatches[lane], filter: { ...synthPatches[lane].filter } };
          if (n.slide && (patch.glide ?? 0) < 0.08) patch.glide = 0.08;
          const cutoff = automated(lane, "cutoff", progress), volume = automated(lane, "volume", progress);
          if (cutoff !== null) patch.filter.cutoff = 60 * Math.pow(16000 / 60, Math.max(0, Math.min(1, cutoff)));
          if (volume !== null) patch.volume = Math.max(0, Math.min(1, volume));
          playNote(off, osg, patch, n.note, Math.min(127, n.accent ? Math.round(n.vel * 1.22) : n.vel), when, laneSd * n.len * 0.98);
          const masterVolume = automated("master", "volume", progress); if (masterVolume !== null) om.gain.setValueAtTime(masterVolume, when);
          const masterReverb = automated("master", "reverb", progress); if (masterReverb !== null && reverbWet) reverbWet.gain.setValueAtTime(masterReverb, when);
          });
        });
      }
      if (transport.metro) for (let b = 0; b < 4; b++) metroClick(off, om, barStarts[bar] + b * beat, b === 0);
    }
    if (mode === "song" && !onlyTrack && audioTracks.length) {
      const decode = new AudioContext();
      try {
        for (const track of audioTracks) for (const item of track.clips) {
          try {
            const buffer = await decode.decodeAudioData(dataUrlToBytes(item.data));
            const source = off.createBufferSource(), gain = off.createGain(); source.buffer = buffer; gain.gain.value = item.gain; source.connect(gain).connect(om);
            if (item.offset < buffer.duration) source.start(barStarts[item.startBar] ?? item.startBar * beat * 4, item.offset, Math.min(buffer.duration - item.offset, item.bars * beat * 4));
          } catch { /* a missing local file does not block the remaining render */ }
        }
      } finally { void decode.close(); }
    }
    return off.startRendering();
  }

  async function doExport(fmt: "wav" | "mp3"): Promise<void> {
    wavBtn.setAttribute("disabled", "1"); mp3Btn.setAttribute("disabled", "1"); expStatus.textContent = "Rendering…";
    try {
      const buf = await renderBuffer(renderSel.value as "pattern" | "song");
      if (fmt === "wav") { download(`vishamp-${transport.bpm}bpm.wav`, encodeWav(buf)); }
      else { expStatus.textContent = "Encoding MP3…"; download(`vishamp-${transport.bpm}bpm.mp3`, await encodeMp3(buf)); }
      expStatus.textContent = "Saved ✓";
    } catch { expStatus.textContent = fmt === "mp3" ? "MP3 failed — try WAV." : "Export failed."; }
    finally {
      wavBtn.removeAttribute("disabled"); mp3Btn.removeAttribute("disabled");
      setTimeout(() => { if (expStatus.textContent === "Saved ✓") expStatus.textContent = ""; }, 2500);
    }
  }
  wavBtn.addEventListener("click", () => doExport("wav"));
  mp3Btn.addEventListener("click", () => doExport("mp3"));
  stemsBtn.addEventListener("click", async () => {
    stemsBtn.setAttribute("disabled", "1"); expStatus.textContent = "Rendering stems…";
    try {
      for (const track of TRACKS) download(`vishamp-${track}-${transport.bpm}bpm.wav`, encodeWav(await renderBuffer(renderSel.value as "pattern" | "song", track)));
      expStatus.textContent = "Stems saved ✓";
    } catch { expStatus.textContent = "Stem export failed."; }
    finally { stemsBtn.removeAttribute("disabled"); }
  });
  saveProjectBtn.addEventListener("click", () => {
    download(`vishamp-project-${transport.bpm}bpm.json`, new Blob([JSON.stringify(projectState())], { type: "application/json" }));
  });
  const replaceProject = (state: Record<string, unknown>, label: string): void => {
    if (!window.confirm(`${label}? It replaces everything currently in the studio.`)) return;
    ctx.checkpoint(); applyProject(JSON.parse(JSON.stringify(state)) as Record<string, unknown>);
    ctx.refreshVisibleState(); saveAll(); expStatus.textContent = `${label} loaded`;
  };
  quickProjectBtn.addEventListener("click", () => replaceProject(projects.quick(), "Start a quick beat"));
  newProjectBtn.addEventListener("click", () => replaceProject(projects.blank(), "Start a new song"));
  demoProjectBtn.addEventListener("click", () => replaceProject(projects.demo(), "Reload WESTSIDE"));
  loadProjectBtn.addEventListener("click", () => projectInput.click());
  projectInput.addEventListener("change", async () => {
    const file = projectInput.files?.[0]; if (!file) return;
    if (!window.confirm("Open this project? It replaces everything currently in the studio — save first if you want to keep it.")) {
      projectInput.value = ""; return;
    }
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed?.pats || !Array.isArray(parsed.pats)) throw new Error("Invalid project");
      ctx.checkpoint(); applyProject(parsed); ctx.refreshVisibleState(); saveAll(); expStatus.textContent = "Project opened ✓";
    } catch { expStatus.textContent = "Project file is invalid."; }
  });

  return { panel: exp, renderSel, renderBuffer };
}
