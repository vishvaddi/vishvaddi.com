// Project / export — offline render (WAV/MP3) + project file save/load.
// Extracted verbatim from index.ts (Phase 0 split). The offline graph must
// mirror the live engine chain so exports match what you hear.
import {
  STEPS, PAD_BANK_SIZE, TRACKS, clip, transport,
  allPats, allVels, synthNotes, padEvents, blockAt, songEndBar,
  rackState, fx, vsynthPatch, audible,
} from "./state";
import type { TrackId } from "./state";
import { ensureNodes, trackGain, playDrum, playPad, metroClick } from "./engine";
import * as engine from "./engine";
import { playNote } from "./vsynth";
import { projectState, pendingProjectStore } from "./persistence";
import { el, btn, help, download, encodeWav, encodeMp3 } from "./helpers";

export interface ProjectExport {
  panel: HTMLElement;
  renderSel: HTMLSelectElement;
  /** offline render — also used by the MPC resample-to-pad feature */
  renderBuffer: (mode: "pattern" | "song") => Promise<AudioBuffer>;
}

export function buildProjectExport(): ProjectExport {
  const exp = el("div", "wa-panel");
  const expRow = el("div", "wa-export");
  const renderSel = document.createElement("select");
  [["pattern", "Launched clips"], ["song", "Full arrangement"]].forEach(([v, l]) => {
    const o = document.createElement("option"); o.value = v; o.textContent = l; renderSel.append(o);
  });
  renderSel.value = transport.songMode ? "song" : "pattern";
  const wavBtn = btn("Export WAV"), mp3Btn = btn("Export MP3"), expStatus = el("span", "wa-status");
  help(wavBtn, "Render the launched clips or full song as lossless WAV.");
  help(mp3Btn, "Render and encode the launched clips or full song as 192 kbps MP3.");
  expRow.append(el("span", "wa-lbl", "Render"), renderSel, wavBtn, mp3Btn, expStatus);
  const projectRow = el("div", "wa-export");
  const saveProjectBtn = btn("Save project"), loadProjectBtn = btn("Open project");
  help(saveProjectBtn, "Download an editable project containing patterns, settings and embedded samples.");
  help(loadProjectBtn, "Open a previously saved editable Studio project.");
  const projectInput = document.createElement("input"); projectInput.type = "file"; projectInput.accept = ".json,application/json"; projectInput.hidden = true;
  projectRow.append(saveProjectBtn, loadProjectBtn, projectInput);
  exp.append(
    el("p", "wa-help", "Audio export includes drums and sequenced synth. Project files preserve editable patterns, song order, sounds and tempo."),
    expRow,
    el("div", "wa-sep-h"),
    projectRow,
  );

  async function renderBuffer(mode: "pattern" | "song"): Promise<AudioBuffer> {
    ensureNodes();
    const sr = 44100, sd = 60 / transport.bpm / 4;
    // Song mode renders the shared bar timeline (C5): each track plays the
    // block covering the bar, gaps are silence; clip mode renders the
    // launched per-track clips once.
    const bars = mode === "song" ? songEndBar() : 1;
    const sceneAt = (track: TrackId, bar: number): number | null => {
      if (mode !== "song") return clip.play[track];
      return blockAt(track, bar)?.scene ?? null;
    };
    const dur = bars * STEPS * sd + 2.2;
    const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
    const om = off.createGain(); om.gain.value = engine.master!.gain.value;
    const ol = off.createBiquadFilter(); ol.type = "lowshelf"; ol.frequency.value = 180; ol.gain.value = rackState.devices.eq ? fx.low : 0;
    const omi = off.createBiquadFilter(); omi.type = "peaking"; omi.frequency.value = 1200; omi.Q.value = 0.8; omi.gain.value = rackState.devices.eq ? fx.mid : 0;
    const oh = off.createBiquadFilter(); oh.type = "highshelf"; oh.frequency.value = 6500; oh.gain.value = rackState.devices.eq ? fx.high : 0;
    const oc = off.createDynamicsCompressor(); oc.threshold.value = rackState.devices.compressor ? fx.compThreshold : 0; oc.ratio.value = rackState.devices.compressor ? fx.compRatio : 1; oc.knee.value = 12;
    const oli = off.createDynamicsCompressor(); oli.threshold.value = rackState.devices.limiter ? fx.limiter : 0; oli.ratio.value = rackState.devices.limiter ? 20 : 1; oli.knee.value = 0; oli.attack.value = 0.001;
    om.connect(ol); ol.connect(omi); omi.connect(oh); oh.connect(oc); oc.connect(oli); oli.connect(off.destination);
    if (rackState.devices.reverb && fx.reverb > 0) {
      const len = Math.floor(sr * 2.2), ir = off.createBuffer(2, len, sr);
      for (let c = 0; c < 2; c++) {
        const data = ir.getChannelData(c);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
      }
      const conv = off.createConvolver(), wet = off.createGain(); conv.buffer = ir; wet.gain.value = fx.reverb;
      om.connect(conv); conv.connect(wet); wet.connect(ol);
    }
    if (rackState.devices.delay && fx.delayMix > 0) {
      const delay = off.createDelay(2), feedback = off.createGain(), wet = off.createGain();
      delay.delayTime.value = fx.delayTime; feedback.gain.value = fx.delayFeedback; wet.gain.value = fx.delayMix;
      om.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(wet); wet.connect(ol);
    }
    const ot: GainNode[] = [];
    for (let i = 0; i < 8; i++) { const g = off.createGain(); g.gain.value = trackGain[i].gain.value; g.connect(om); ot.push(g); }
    const osg = off.createGain(); osg.gain.value = engine.synthGain!.gain.value; osg.connect(om);
    for (let bar = 0; bar < bars; bar++) { for (let s = 0; s < STEPS; s++) {
      const base = (bar * STEPS + s) * sd;
      const groove = rackState.devices.player && s % 2 === 1 ? rackState.grooveTiming * sd * 0.5 : 0;
      const when = base + (s % 2 === 1 ? transport.swing * sd : 0) + groove;
      const drumClip = sceneAt("drums", bar), padClip = sceneAt("pads", bar), synthClip = sceneAt("synth", bar);
      if (drumClip !== null) for (let r = 0; r < 8; r++) {
        if (allPats[drumClip][r][s] && audible(r)) playDrum(off, ot[r], r, allVels[drumClip][r][s] / 127, when);
      }
      if (padClip !== null) padEvents[padClip].filter((event) => event.step === s).forEach((event) => {
        if (Math.random() * 100 > event.probability) return;
        const ratchets = Math.max(1, event.ratchets), spacing = sd / ratchets;
        for (let i = 0; i < ratchets; i++) {
          playPad(off, event.pad, event.velocity, Math.max(base, when + event.offset / 1000 + i * spacing), event.pad % PAD_BANK_SIZE, ot[event.pad % ot.length]);
        }
      });
      if (synthClip !== null) synthNotes[synthClip].forEach((n) => {
        if (n.step >= s && n.step < s + 1) playNote(off, osg, vsynthPatch, n.note, n.vel, when + (n.step - s) * sd, sd * n.len * 0.98);
      });
      if (transport.metro && s % 4 === 0) metroClick(off, om, base, s === 0);
    } }
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
  saveProjectBtn.addEventListener("click", () => {
    download(`vishamp-project-${transport.bpm}bpm.json`, new Blob([JSON.stringify(projectState())], { type: "application/json" }));
  });
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
      await pendingProjectStore("put", parsed);
      location.reload();
    } catch { expStatus.textContent = "Project file is invalid."; }
  });

  return { panel: exp, renderSel, renderBuffer };
}
