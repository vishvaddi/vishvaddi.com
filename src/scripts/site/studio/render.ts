import { STEPS, PAD_BANK_SIZE, TRACKS, clip, clipLen, transport, allPats, allVels, synthNotes, padEvents, songChain, rackState, mixerState, chAudible, fx, vsynthPatch } from "./state";
import type { TrackId } from "./state";
import { ensureNodes, playDrum, playPad, metroClick } from "./engine";
import { playNote } from "./vsynth";
import { projectState, pendingProjectStore } from "./persistence";
import { el, btn, help, download, encodeWav, encodeMp3 } from "./helpers";
import { ctx } from "./ctx";

export interface RenderUI { exp: HTMLElement; renderSel: HTMLSelectElement }

export function buildRender(): RenderUI {
  const exp = el("div", "wa-panel"), expRow = el("div", "wa-export");
  const renderSel = document.createElement("select");
  [["pattern", "Launched clips"], ["song", "Full song"]].forEach(([value, label]) => { const option = document.createElement("option"); option.value = value; option.textContent = label; renderSel.append(option); });
  renderSel.value = transport.songMode ? "song" : "pattern"; ctx.renderSel = renderSel;
  const wavBtn = btn("Export WAV"), mp3Btn = btn("Export MP3"), status = el("span", "wa-status");
  help(wavBtn, "Render the launched clips or full song as lossless WAV."); help(mp3Btn, "Render and encode the launched clips or full song as 192 kbps MP3.");
  expRow.append(el("span", "wa-lbl", "Render"), renderSel, wavBtn, mp3Btn, status);
  const projectRow = el("div", "wa-export"), saveButton = btn("Save project"), loadButton = btn("Open project");
  const input = document.createElement("input"); input.type = "file"; input.accept = ".json,application/json"; input.hidden = true;
  projectRow.append(saveButton, loadButton, input);
  exp.append(el("p", "wa-help", "Audio export includes drums and sequenced synth. Project files preserve editable patterns, song order, sounds and tempo."), expRow, el("div", "wa-sep-h"), projectRow);

  ctx.renderBuffer = async (mode): Promise<AudioBuffer> => {
    ensureNodes();
    const sampleRate = 44100, durationStep = 60 / transport.bpm / 4;
    const scenes = mode === "song" ? [...songChain] : [0];
    const clipFor = (track: TrackId, index: number): number | null => mode === "song" ? scenes[index] : clip.play[track];
    const segmentLength = (index: number): number => mode === "song"
      ? Math.max(...TRACKS.map((track) => clipLen[scenes[index]][track]))
      : Math.max(...TRACKS.map((track) => { const scene = clip.play[track]; return scene === null ? STEPS : clipLen[scene][track]; }));
    const totalSteps = scenes.reduce((sum, _, index) => sum + segmentLength(index), 0);
    const offline = new OfflineAudioContext(2, Math.ceil((totalSteps * durationStep + 2.2) * sampleRate), sampleRate);
    const master = offline.createGain(); master.gain.value = mixerState.masterGain;
    const low = offline.createBiquadFilter(); low.type = "lowshelf"; low.frequency.value = 180; low.gain.value = rackState.devices.eq ? fx.low : 0;
    const mid = offline.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1200; mid.Q.value = 0.8; mid.gain.value = rackState.devices.eq ? fx.mid : 0;
    const high = offline.createBiquadFilter(); high.type = "highshelf"; high.frequency.value = 6500; high.gain.value = rackState.devices.eq ? fx.high : 0;
    const compressor = offline.createDynamicsCompressor(); compressor.threshold.value = rackState.devices.compressor ? fx.compThreshold : 0; compressor.ratio.value = rackState.devices.compressor ? fx.compRatio : 1;
    const limiter = offline.createDynamicsCompressor(); limiter.threshold.value = rackState.devices.limiter ? fx.limiter : 0; limiter.ratio.value = rackState.devices.limiter ? 20 : 1; limiter.knee.value = 0; limiter.attack.value = 0.001;
    master.connect(low); low.connect(mid); mid.connect(high); high.connect(compressor); compressor.connect(limiter); limiter.connect(offline.destination);
    if (rackState.devices.reverb && fx.reverb > 0) {
      const length = Math.floor(sampleRate * 2.2), impulse = offline.createBuffer(2, length, sampleRate);
      for (let channel = 0; channel < 2; channel++) { const data = impulse.getChannelData(channel); for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 4); }
      const convolver = offline.createConvolver(), wet = offline.createGain(); convolver.buffer = impulse; wet.gain.value = fx.reverb; master.connect(convolver); convolver.connect(wet); wet.connect(low);
    }
    if (rackState.devices.delay && fx.delayMix > 0) {
      const delay = offline.createDelay(2), feedback = offline.createGain(), wet = offline.createGain(); delay.delayTime.value = fx.delayTime; feedback.gain.value = fx.delayFeedback; wet.gain.value = fx.delayMix; master.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(wet); wet.connect(low);
    }
    const channels: GainNode[] = [];
    for (let i = 0; i < 10; i++) { const gain = offline.createGain(), pan = offline.createStereoPanner(); gain.gain.value = chAudible(i) ? mixerState.channels[i].gain : 0; pan.pan.value = mixerState.channels[i].pan; gain.connect(pan); pan.connect(master); channels.push(gain); }
    let segmentStart = 0;
    scenes.forEach((_, sceneIndex) => { const length = segmentLength(sceneIndex); for (let step = 0; step < length; step++) {
      const base = (segmentStart + step) * durationStep;
      const when = base + (step % 2 === 1 ? transport.swing * durationStep + rackState.grooveTiming * durationStep * 0.5 : 0);
      const drums = clipFor("drums", sceneIndex), pads = clipFor("pads", sceneIndex), synthClip = clipFor("synth", sceneIndex);
      const drumStep = drums === null ? 0 : step % clipLen[drums].drums, padStep = pads === null ? 0 : step % clipLen[pads].pads, synthStep = synthClip === null ? 0 : step % clipLen[synthClip].synth;
      if (drums !== null) for (let row = 0; row < 8; row++) if (allPats[drums][row][drumStep]) playDrum(offline, channels[row], row, allVels[drums][row][drumStep] / 127, when);
      if (pads !== null) padEvents[pads].filter((event) => event.step === padStep).forEach((event) => { if (Math.random() * 100 > event.probability) return; const ratchets = Math.max(1, event.ratchets); for (let i = 0; i < ratchets; i++) { const eventWhen = Math.max(base, when + event.offset / 1000 + i * durationStep / ratchets); playPad(offline, event.pad, event.velocity, eventWhen, event.pad % PAD_BANK_SIZE, channels[8]); for (let echo = 1; echo <= rackState.noteEcho; echo++) playPad(offline, event.pad, event.velocity * Math.pow(rackState.echoDecay, echo), eventWhen + echo * durationStep, event.pad % PAD_BANK_SIZE, channels[8]); } });
      if (synthClip !== null) synthNotes[synthClip].forEach((note) => { if (note.step === synthStep) playNote(offline, channels[9], vsynthPatch, note.note, note.vel, when, durationStep * note.len * 0.98); });
      if (transport.metro && step % 4 === 0) metroClick(offline, master, base, step === 0);
    } segmentStart += length; });
    return offline.startRendering();
  };
  const exportAudio = async (format: "wav" | "mp3"): Promise<void> => {
    wavBtn.disabled = mp3Btn.disabled = true; status.textContent = "Rendering…";
    try { const buffer = await ctx.renderBuffer(renderSel.value as "pattern" | "song"); if (format === "wav") download(`vishamp-${transport.bpm}bpm.wav`, encodeWav(buffer)); else { status.textContent = "Encoding MP3…"; download(`vishamp-${transport.bpm}bpm.mp3`, await encodeMp3(buffer)); } status.textContent = "Saved ✓"; }
    catch { status.textContent = format === "mp3" ? "MP3 failed — try WAV." : "Export failed."; }
    finally { wavBtn.disabled = mp3Btn.disabled = false; }
  };
  wavBtn.addEventListener("click", () => void exportAudio("wav")); mp3Btn.addEventListener("click", () => void exportAudio("mp3"));
  saveButton.addEventListener("click", () => download(`vishamp-project-${transport.bpm}bpm.json`, new Blob([JSON.stringify(projectState())], { type: "application/json" })));
  loadButton.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => { const file = input.files?.[0]; if (!file) return; try { const parsed = JSON.parse(await file.text()) as Record<string, unknown>; if (!Array.isArray(parsed.pats)) throw new Error(); await pendingProjectStore("put", parsed); location.reload(); } catch { status.textContent = "Project file is invalid."; } });
  return { exp, renderSel };
}
