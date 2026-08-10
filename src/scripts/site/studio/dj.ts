import { ac, master } from "./engine";
import { btn, download, el, help, SCREEN_BG, SCREEN_FG, screenRgba } from "./helpers";

type DeckId = "A" | "B";
type StoredCue = { cue: number; hotCues: Array<number | null>; bpm: number };

interface DeckNodes {
  source: MediaElementAudioSourceNode;
  input: GainNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  hp: BiquadFilterNode;
  lp: BiquadFilterNode;
  fader: GainNode;
  meter: AnalyserNode;
  cross: GainNode;
  scratch: AudioWorkletNode | null;
}

interface Deck {
  id: DeckId;
  audio: HTMLAudioElement;
  root: HTMLElement;
  fileInput: HTMLInputElement;
  title: HTMLElement;
  time: HTMLElement;
  bpmReadout: HTMLElement;
  pitchReadout: HTMLElement;
  canvas: HTMLCanvasElement;
  play: HTMLButtonElement;
  cueButton: HTMLButtonElement;
  sync: HTMLButtonElement;
  tempo: HTMLButtonElement;
  loop: HTMLButtonElement;
  slip: HTMLButtonElement;
  hotCueButtons: HTMLButtonElement[];
  nodes: DeckNodes | null;
  file: File | null;
  objectUrl: string | null;
  buffer: AudioBuffer | null;
  bpm: number;
  pitch: number;
  cue: number;
  hotCues: Array<number | null>;
  loopIn: number | null;
  loopOut: number | null;
  loopBeats: number;
  loopOn: boolean;
  slipOn: boolean;
  slipStartedAt: number | null;
  virtualTime: number;
  loopSource: AudioBufferSourceNode | null;
  loopStartedAt: number;
  loopStartPosition: number;
  loopWraps: number;
  scratchPosition: number;
  scratchWasPlaying: boolean;
  scratchStartedAt: number;
  scratchSlipAnchor: number;
  playIntent: boolean;
}

interface LibraryTrack {
  key: string;
  file: File;
  name: string;
  bpm: number | null;
}

const STORE_KEY = "vv_studio_dj_cues_v1";
let scratchModulePromise: Promise<void> | null = null;
const cueStore = (): Record<string, StoredCue> => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; }
};
const fileKey = (file: File): string => `${file.name}:${file.size}:${file.lastModified}`;
const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return "--:--.---";
  const sign = seconds < 0 ? "−" : "";
  const value = Math.abs(seconds), mins = Math.floor(value / 60), secs = Math.floor(value % 60);
  return `${sign}${mins}:${String(secs).padStart(2, "0")}.${String(Math.floor((value % 1) * 1000)).padStart(3, "0")}`;
};
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function labelledRange(label: string, min: number, max: number, value: number, step: number, onInput: (value: number) => void): HTMLElement {
  const root = el("label", "wa-dj-range");
  const caption = el("span", "wa-dj-range-label", label);
  const input = document.createElement("input");
  input.type = "range"; input.min = String(min); input.max = String(max); input.value = String(value); input.step = String(step);
  input.setAttribute("aria-label", label);
  input.addEventListener("input", () => onInput(Number(input.value)));
  root.append(caption, input);
  return root;
}

function estimateBpm(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0), sampleRate = buffer.sampleRate;
  const hop = Math.max(256, Math.round(sampleRate / 200));
  const energy: number[] = [];
  for (let start = 0; start < data.length; start += hop) {
    let total = 0;
    for (let i = start; i < Math.min(data.length, start + hop); i++) total += data[i] * data[i];
    energy.push(Math.sqrt(total / hop));
  }
  const onset = energy.map((value, i) => Math.max(0, value - (energy[i - 1] || 0)));
  let bestBpm = 120, bestScore = -Infinity;
  for (let bpm = 70; bpm <= 180; bpm++) {
    const lag = Math.round((60 * 200) / bpm);
    let score = 0;
    for (let i = lag; i < onset.length; i++) score += onset[i] * onset[i - lag];
    if (score > bestScore) { bestScore = score; bestBpm = bpm; }
  }
  return bestBpm;
}

function drawDeckWaveform(deck: Deck): void {
  const canvas = deck.canvas, width = canvas.clientWidth || 500, height = canvas.clientHeight || 96;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * scale); canvas.height = Math.floor(height * scale);
  const context = canvas.getContext("2d"); if (!context) return;
  context.scale(scale, scale); context.fillStyle = SCREEN_BG; context.fillRect(0, 0, width, height);
  context.strokeStyle = screenRgba(0.14); context.lineWidth = 1;
  for (let i = 1; i < 16; i++) { const x = i * width / 16; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
  if (deck.buffer) {
    const data = deck.buffer.getChannelData(0), stride = Math.max(1, Math.floor(data.length / width));
    const spectrum = context.createLinearGradient(0, 0, width, 0);
    spectrum.addColorStop(0, deck.id === "A" ? "#ffd36a" : "#ff72ba"); spectrum.addColorStop(0.32, "#63ffd4"); spectrum.addColorStop(0.66, "#b85cff"); spectrum.addColorStop(1, "#ff675c");
    context.shadowBlur = 7; context.shadowColor = deck.id === "A" ? "#64ffd6" : "#ec6dff"; context.strokeStyle = spectrum; context.beginPath();
    for (let x = 0; x < width; x++) {
      let peak = 0;
      for (let i = x * stride; i < Math.min(data.length, (x + 1) * stride); i++) peak = Math.max(peak, Math.abs(data[i]));
      const y = peak * height * 0.43; context.moveTo(x, height / 2 - y); context.lineTo(x, height / 2 + y);
    }
    context.stroke(); context.shadowBlur = 0;
  } else {
    context.fillStyle = screenRgba(0.55); context.font = "11px monospace"; context.textAlign = "center";
    context.fillText("LOAD OR DROP A LOCAL AUDIO FILE", width / 2, height / 2 + 4);
  }
  const duration = deck.audio.duration;
  if (Number.isFinite(duration) && duration > 0) {
    deck.hotCues.forEach((cue, index) => {
      if (cue == null) return;
      const x = cue / duration * width; context.fillStyle = index % 2 ? "#c978a0" : "#db9e56";
      context.fillRect(x - 1, 0, 3, 10);
    });
    if (deck.loopOn && deck.loopIn != null && deck.loopOut != null) {
      context.fillStyle = screenRgba(0.16);
      context.fillRect(deck.loopIn / duration * width, 0, (deck.loopOut - deck.loopIn) / duration * width, height);
    }
    const x = deckTimeForDraw(deck) / duration * width;
    context.shadowBlur = 9; context.shadowColor = "#ffffff"; context.strokeStyle = "#fff7df"; context.lineWidth = 2; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); context.shadowBlur = 0;
  }
}

const deckTimeForDraw = (deck: Deck): number => deck.loopSource ? deck.virtualTime : deck.root.classList.contains("scratching") ? deck.scratchPosition : deck.audio.currentTime;

export function buildDj(): { root: HTMLElement } {
  const root = el("section", "wa-dj");
  const deckHost = el("div", "wa-dj-decks");
  const mixer = el("section", "wa-dj-mixer wa-panel");
  const libraryTracks: LibraryTrack[] = [];
  const libraryRows = el("div", "wa-dj-library-rows");
  let bus: GainNode | null = null, recordTarget: MediaStreamAudioDestinationNode | null = null;
  let dryGain: GainNode | null = null, wetGain: GainNode | null = null, fxInput: GainNode | null = null;
  let fxCleanup: (() => void) | null = null, fxMode = "ECHO", fxWet = 0.32, fxOn = false;
  let recorder: MediaRecorder | null = null, recordingChunks: Blob[] = [];
  let crossfade = 0.5;

  const ensureBus = (): GainNode => {
    const context = ac();
    if (!bus) {
      bus = context.createGain(); bus.gain.value = 0.9;
      dryGain = context.createGain(); wetGain = context.createGain(); fxInput = context.createGain();
      dryGain.gain.value = 1; wetGain.gain.value = 0; bus.connect(dryGain).connect(master!); bus.connect(fxInput); wetGain.connect(master!);
      recordTarget = context.createMediaStreamDestination(); bus.connect(recordTarget);
    }
    return bus;
  };

  const rebuildEffect = (): void => {
    ensureBus(); if (!fxInput || !wetGain || !dryGain) return;
    fxCleanup?.(); fxCleanup = null; fxInput.disconnect();
    const context = ac(), finish = (node: AudioNode): void => { node.connect(wetGain!); };
    if (fxMode === "ECHO" || fxMode === "ROLL") {
      const delay = context.createDelay(2), feedback = context.createGain();
      delay.delayTime.value = fxMode === "ROLL" ? 0.125 : 0.375; feedback.gain.value = fxMode === "ROLL" ? 0.62 : 0.38;
      fxInput.connect(delay); delay.connect(feedback).connect(delay); finish(delay);
    } else if (fxMode === "REVERB") {
      const convolver = context.createConvolver(), impulse = context.createBuffer(2, context.sampleRate * 2, context.sampleRate);
      for (let channel = 0; channel < 2; channel++) { const samples = impulse.getChannelData(channel); for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / samples.length, 2.4); }
      convolver.buffer = impulse; fxInput.connect(convolver); finish(convolver);
    } else if (fxMode === "FLANGER") {
      const delay = context.createDelay(0.05), lfo = context.createOscillator(), depth = context.createGain(); delay.delayTime.value = 0.006; lfo.frequency.value = 0.22; depth.gain.value = 0.004;
      lfo.connect(depth).connect(delay.delayTime); fxInput.connect(delay); finish(delay); lfo.start(); fxCleanup = () => lfo.stop();
    } else if (fxMode === "PHASER") {
      let node: AudioNode = fxInput;
      [420, 900, 1800].forEach((frequency) => { const stage = context.createBiquadFilter(); stage.type = "allpass"; stage.frequency.value = frequency; stage.Q.value = 2.5; node.connect(stage); node = stage; }); finish(node);
    } else if (fxMode === "FILTER") {
      const filter = context.createBiquadFilter(); filter.type = "bandpass"; filter.frequency.value = 900; filter.Q.value = 1.2; fxInput.connect(filter); finish(filter);
    } else if (fxMode === "CRUSHER") {
      const shaper = context.createWaveShaper(), curve = new Float32Array(512); for (let i = 0; i < curve.length; i++) curve[i] = Math.round(((i / 511) * 2 - 1) * 12) / 12;
      shaper.curve = curve; shaper.oversample = "none"; fxInput.connect(shaper); finish(shaper);
    } else {
      const gate = context.createGain(), lfo = context.createOscillator(), depth = context.createGain(); gate.gain.value = 0.5; lfo.type = "square"; lfo.frequency.value = 8; depth.gain.value = 0.5;
      lfo.connect(depth).connect(gate.gain); fxInput.connect(gate); finish(gate); lfo.start(); fxCleanup = () => lfo.stop();
    }
    wetGain.gain.setTargetAtTime(fxOn ? fxWet : 0, context.currentTime, 0.02); dryGain.gain.setTargetAtTime(fxOn ? Math.max(0.65, 1 - fxWet * 0.35) : 1, context.currentTime, 0.02);
    root.dataset.effect = fxOn ? fxMode.toLowerCase() : "off";
  };

  const updateCrossfade = (): void => {
    const a = decks[0].nodes?.cross, b = decks[1].nodes?.cross;
    if (a) a.gain.setTargetAtTime(Math.cos(crossfade * Math.PI / 2), ac().currentTime, 0.01);
    if (b) b.gain.setTargetAtTime(Math.sin(crossfade * Math.PI / 2), ac().currentTime, 0.01);
  };

  const ensureDeckNodes = (deck: Deck): DeckNodes => {
    if (deck.nodes) return deck.nodes;
    const context = ac(), source = context.createMediaElementSource(deck.audio);
    const input = context.createGain(), low = context.createBiquadFilter(), mid = context.createBiquadFilter(), high = context.createBiquadFilter();
    const hp = context.createBiquadFilter(), lp = context.createBiquadFilter(), fader = context.createGain(), meter = context.createAnalyser(), cross = context.createGain();
    low.type = "lowshelf"; low.frequency.value = 250; mid.type = "peaking"; mid.frequency.value = 1200; mid.Q.value = 0.8;
    high.type = "highshelf"; high.frequency.value = 5000; hp.type = "highpass"; hp.frequency.value = 20; lp.type = "lowpass"; lp.frequency.value = 20000;
    fader.gain.value = 0.9;
    meter.fftSize = 256; meter.smoothingTimeConstant = 0.68;
    source.connect(input).connect(low).connect(mid).connect(high).connect(hp).connect(lp).connect(fader).connect(meter).connect(cross).connect(ensureBus());
    deck.nodes = { source, input, low, mid, high, hp, lp, fader, meter, cross, scratch: null };
    updateCrossfade();
    return deck.nodes;
  };

  const ensureScratchNode = async (deck: Deck): Promise<AudioWorkletNode | null> => {
    const context = ac(), nodes = ensureDeckNodes(deck);
    if (nodes.scratch) return nodes.scratch;
    if (!("audioWorklet" in context) || typeof AudioWorkletNode === "undefined") return null;
    scratchModulePromise ??= context.audioWorklet.addModule("/worklets/dj-scratch.js");
    await scratchModulePromise;
    const node = new AudioWorkletNode(context, "vv-dj-scratch", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.connect(nodes.input);
    node.port.addEventListener("message", ({ data }) => {
      if (data.type !== "position") return;
      deck.scratchPosition = Number(data.seconds) || 0;
      deck.root.dataset.scratchVelocity = Number(data.velocity || 0).toFixed(3);
      deck.root.dataset.scratchDirection = data.velocity < -0.05 ? "reverse" : data.velocity > 0.05 ? "forward" : "still";
    });
    node.port.start(); nodes.scratch = node; deck.root.dataset.engine = "worklet";
    return node;
  };

  const saveDeck = (deck: Deck): void => {
    if (!deck.file) return;
    const store = cueStore(); store[fileKey(deck.file)] = { cue: deck.cue, hotCues: deck.hotCues, bpm: deck.bpm };
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  };

  const setPitch = (deck: Deck, pitch: number): void => {
    deck.pitch = clamp(pitch, -16, 16); deck.audio.playbackRate = 1 + deck.pitch / 100;
    if (deck.loopSource) deck.loopSource.playbackRate.setTargetAtTime(1 + deck.pitch / 100, ac().currentTime, 0.01);
    const tempoInput = deck.root.querySelector<HTMLInputElement>('input[aria-label="PITCH ±16"]');
    if (tempoInput) tempoInput.value = String(deck.pitch);
    deck.pitchReadout.textContent = `${deck.pitch >= 0 ? "+" : ""}${deck.pitch.toFixed(2)}%`;
  };

  const updateLoop = (deck: Deck): void => {
    deck.loop.classList.toggle("active", deck.loopOn); deck.loop.setAttribute("aria-pressed", String(deck.loopOn));
    drawDeckWaveform(deck);
  };

  const deckTime = (deck: Deck): number => deck.loopSource ? deck.virtualTime : deck.root.classList.contains("scratching") ? deck.scratchPosition : deck.audio.currentTime;

  const stopLoopPlayback = (deck: Deck, resume: boolean): void => {
    if (!deck.loopSource) return;
    const source = deck.loopSource; deck.loopSource = null;
    try { source.stop(); } catch { /* already stopped */ }
    const elapsed = Math.max(0, ac().currentTime - deck.loopStartedAt);
    const rate = 1 + deck.pitch / 100, span = Math.max(0.01, (deck.loopOut || 0) - (deck.loopIn || 0));
    const loopPosition = (deck.loopIn || 0) + ((deck.loopStartPosition - (deck.loopIn || 0) + elapsed * rate) % span);
    const slipPosition = deck.loopStartPosition + elapsed * rate;
    deck.audio.currentTime = clamp(deck.slipOn ? slipPosition : loopPosition, 0, deck.audio.duration || Infinity);
    deck.virtualTime = deck.audio.currentTime;
    deck.playIntent = resume;
    if (resume) void deck.audio.play().catch(() => undefined);
    else { deck.root.classList.remove("playing"); deck.play.classList.remove("active"); deck.play.textContent = "START · STOP"; }
  };

  const startLoopPlayback = (deck: Deck): void => {
    if (!deck.buffer || deck.loopIn == null || deck.loopOut == null || deck.loopOut <= deck.loopIn) return;
    if (deck.loopSource) stopLoopPlayback(deck, false);
    const context = ac(), source = context.createBufferSource();
    source.buffer = deck.buffer; source.loop = true; source.loopStart = deck.loopIn; source.loopEnd = deck.loopOut;
    source.playbackRate.value = 1 + deck.pitch / 100; source.connect(ensureDeckNodes(deck).input);
    deck.audio.pause(); deck.loopStartPosition = clamp(deck.audio.currentTime, deck.loopIn, deck.loopOut); deck.virtualTime = deck.loopStartPosition;
    deck.loopStartedAt = context.currentTime; deck.loopWraps = 0; deck.loopSource = source;
    deck.playIntent = true; source.start(0, deck.loopStartPosition); deck.root.classList.add("playing"); deck.play.classList.add("active"); deck.play.textContent = "STOP";
    deck.root.dataset.loopWraps = "0";
  };

  const decks: Deck[] = (["A", "B"] as DeckId[]).map((id) => {
    const deckRoot = el("section", `wa-dj-deck wa-dj-deck-${id.toLowerCase()} wa-panel`);
    deckRoot.dataset.deck = id;
    const head = el("div", "wa-dj-deck-head");
    const badge = el("span", "wa-dj-deck-badge", `DECK ${id}`), title = el("strong", "wa-dj-track-title", "NO TRACK LOADED");
    const load = btn("LOAD", "wa-btn-sm wa-dj-load");
    const input = document.createElement("input"); input.type = "file"; input.accept = "audio/*"; input.hidden = true; input.setAttribute("aria-label", `Load audio into deck ${id}`);
    load.addEventListener("click", () => input.click()); head.append(badge, title, load, input);
    help(load, `Load a local audio file into deck ${id}. The file stays on this device.`);
    const display = el("div", "wa-dj-display");
    const time = el("span", "wa-dj-time", "--:--.---"), bpmReadout = el("span", "wa-dj-bpm", "--- BPM"), pitchReadout = el("span", "wa-dj-pitch", "+0.00%");
    display.append(time, bpmReadout, pitchReadout);
    const canvas = document.createElement("canvas"); canvas.className = "wa-dj-waveform"; canvas.setAttribute("aria-label", `Deck ${id} waveform; click to seek`);
    help(canvas, "Click or tap the waveform to jump to that point in the track.");
    const transport = el("div", "wa-dj-transport");
    const cueButton = btn("CUE"), setCue = btn("SET CUE", "wa-btn-sm"), sync = btn("SYNC", "wa-btn-sm"), tempo = btn("MASTER TEMPO", "wa-btn-sm active");
    tempo.setAttribute("aria-pressed", "true");
    help(cueButton, "Stop and return to the saved cue point."); help(setCue, "Store the current playhead as the main cue point.");
    help(sync, "Match this deck's effective BPM to the other loaded deck."); help(tempo, "Preserve musical pitch while the speed fader changes tempo.");
    transport.append(cueButton, setCue, sync, tempo);
    const turntable = el("div", "wa-dj-turntable");
    const jog = el("div", "wa-dj-jog wa-dj-platter"); jog.tabIndex = 0; jog.setAttribute("role", "slider"); jog.setAttribute("aria-label", `Deck ${id} direct-drive platter`);
    const vinyl = el("span", "wa-dj-vinyl"), recordLabel = el("span", "wa-dj-record-label", id), spindle = el("span", "wa-dj-spindle");
    vinyl.append(recordLabel, spindle); jog.append(el("span", "wa-dj-strobe-dots"), vinyl);
    help(jog, "Grab and move the vinyl. Forward and reverse motion scrubs the decoded audio; SLIP keeps the hidden playhead moving.");
    const tonearm = el("div", "wa-dj-tonearm");
    const armAssembly = el("span", "wa-dj-arm-assembly"); armAssembly.append(el("span", "wa-dj-arm-tube"), el("span", "wa-dj-headshell"));
    tonearm.setAttribute("aria-hidden", "true"); tonearm.append(el("span", "wa-dj-arm-pivot"), armAssembly);
    const startStop = btn("START · STOP", "wa-dj-start wa-dj-play");
    const speed = el("div", "wa-dj-speed"); speed.append(el("span", "active", "33"), el("span", "", "45"));
    const targetLight = el("span", "wa-dj-target-light"); targetLight.setAttribute("aria-hidden", "true");
    const pitchFader = labelledRange("PITCH ±16", -16, 16, 0, 0.05, (value) => setPitch(deck, value)); pitchFader.classList.add("wa-dj-pitch-fader");
    turntable.append(jog, tonearm, startStop, speed, targetLight, pitchFader, el("span", "wa-dj-quartz", "QUARTZ · DIRECT DRIVE"));
    const performancePanel = el("div", "wa-dj-performance");
    const loopBar = el("div", "wa-dj-loopbar");
    const loopIn = btn("IN", "wa-btn-sm"), loopOut = btn("OUT", "wa-btn-sm"), loop = btn("LOOP", "wa-btn-sm"), slip = btn("SLIP", "wa-btn-sm");
    help(loopIn, "Set a beat-snapped loop start."); help(loopOut, "Set the loop end and engage the loop."); help(loop, "Create or toggle a seamless beat-length loop."); help(slip, "Keep the hidden song position moving while looping or scratching.");
    const loopLength = document.createElement("select"); loopLength.className = "wa-select wa-dj-loop-length"; loopLength.setAttribute("aria-label", "Loop length in beats");
    [0.25, 0.5, 1, 2, 4, 8, 16, 32].forEach((beats) => { const option = document.createElement("option"); option.value = String(beats); option.textContent = beats === 0.25 ? "¼" : beats === 0.5 ? "½" : String(beats); if (beats === 4) option.selected = true; loopLength.append(option); });
    loopBar.append(loopIn, loopOut, loop, loopLength, slip);
    const hotCueGrid = el("div", "wa-dj-hotcues"), hotCueButtons: HTMLButtonElement[] = [];
    for (let i = 0; i < 8; i++) { const cue = btn(String(i + 1), "wa-dj-hotcue"); cue.dataset.cue = String(i); cue.setAttribute("aria-label", `Hot cue ${i + 1}`); hotCueButtons.push(cue); hotCueGrid.append(cue); }
    const clearCues = btn("CLEAR CUES", "wa-btn-sm wa-dj-clear-cues");
    help(clearCues, "Clear all eight hot cues on this deck. Right-click also clears one cue on desktop.");
    clearCues.addEventListener("click", () => { deck.hotCues.fill(null); hotCueButtons.forEach((button) => button.classList.remove("set")); saveDeck(deck); drawDeckWaveform(deck); });
    performancePanel.append(loopBar, hotCueGrid, clearCues);
    const controls = el("div", "wa-dj-controls");
    controls.append(
      labelledRange("TRIM", 0, 1.5, 1, 0.01, (value) => { ensureDeckNodes(deck).input.gain.value = value; }),
      labelledRange("HI", -26, 6, 0, 0.5, (value) => { ensureDeckNodes(deck).high.gain.value = value; }),
      labelledRange("MID", -26, 6, 0, 0.5, (value) => { ensureDeckNodes(deck).mid.gain.value = value; }),
      labelledRange("LOW", -26, 6, 0, 0.5, (value) => { ensureDeckNodes(deck).low.gain.value = value; }),
      labelledRange("FILTER", -1, 1, 0, 0.01, (value) => { const nodes = ensureDeckNodes(deck); nodes.hp.frequency.value = value > 0 ? 20 * Math.pow(250, value) : 20; nodes.lp.frequency.value = value < 0 ? 20000 * Math.pow(60, value) : 20000; }),
      labelledRange("LEVEL", 0, 1.2, 0.9, 0.01, (value) => { ensureDeckNodes(deck).fader.gain.value = value; }),
    );
    deckRoot.append(head, display, canvas, turntable, transport, performancePanel, controls);
    const deck: Deck = { id, audio: new Audio(), root: deckRoot, fileInput: input, title, time, bpmReadout, pitchReadout, canvas, play: startStop, cueButton, sync, tempo, loop, slip, hotCueButtons, nodes: null, file: null, objectUrl: null, buffer: null, bpm: 0, pitch: 0, cue: 0, hotCues: Array(8).fill(null), loopIn: null, loopOut: null, loopBeats: 4, loopOn: false, slipOn: false, slipStartedAt: null, virtualTime: 0, loopSource: null, loopStartedAt: 0, loopStartPosition: 0, loopWraps: 0, scratchPosition: 0, scratchWasPlaying: false, scratchStartedAt: 0, scratchSlipAnchor: 0, playIntent: false };
    deck.audio.preload = "metadata";

    const togglePlay = async (): Promise<void> => {
      if (!deck.file) { input.click(); return; }
      ensureDeckNodes(deck);
      if (deck.loopSource) { stopLoopPlayback(deck, false); return; }
      if (deck.root.classList.contains("playing")) { deck.playIntent = false; deck.audio.pause(); deck.root.classList.remove("playing"); deck.play.classList.remove("active"); deck.play.textContent = "START · STOP"; return; }
      if (deck.audio.paused) {
        deck.playIntent = true; if (deck.loopOn) startLoopPlayback(deck); else await deck.audio.play();
      } else { deck.playIntent = false; deck.audio.pause(); }
    };
    startStop.addEventListener("click", togglePlay);
    deck.audio.addEventListener("play", () => { if (!deck.playIntent) { deck.audio.pause(); return; } startStop.textContent = "STOP"; startStop.classList.add("active"); deckRoot.classList.add("playing"); });
    deck.audio.addEventListener("pause", () => { startStop.textContent = "START · STOP"; startStop.classList.remove("active"); deckRoot.classList.remove("playing"); });
    cueButton.addEventListener("click", () => { stopLoopPlayback(deck, false); deck.audio.pause(); deck.audio.currentTime = deck.cue; deck.virtualTime = deck.cue; });
    setCue.addEventListener("click", () => { deck.cue = deckTime(deck); cueButton.textContent = `CUE ${formatTime(deck.cue)}`; saveDeck(deck); });
    sync.addEventListener("click", () => {
      const other = decks.find((candidate) => candidate !== deck && candidate.bpm > 0);
      if (!other || !deck.bpm) return;
      setPitch(deck, (other.bpm * (1 + other.pitch / 100) / deck.bpm - 1) * 100); sync.classList.add("active");
    });
    tempo.addEventListener("click", () => {
      const active = !tempo.classList.contains("active"); tempo.classList.toggle("active", active); tempo.setAttribute("aria-pressed", String(active));
      const audio = deck.audio as HTMLAudioElement & { preservesPitch?: boolean; mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean };
      audio.preservesPitch = active; audio.mozPreservesPitch = active; audio.webkitPreservesPitch = active;
    });
    loopLength.addEventListener("change", () => { deck.loopBeats = Number(loopLength.value); });
    const snapToBeat = (position: number): number => { const beat = 60 / (deck.bpm || 120); return clamp(Math.round(position / beat) * beat, 0, deck.audio.duration || Infinity); };
    loopIn.addEventListener("click", () => { deck.loopIn = snapToBeat(deckTime(deck)); deck.loopOut = null; });
    loopOut.addEventListener("click", () => {
      if (deck.loopIn == null) deck.loopIn = snapToBeat(deckTime(deck));
      deck.loopOut = Math.max(snapToBeat(deckTime(deck)), deck.loopIn + 0.05); deck.loopOn = true; updateLoop(deck);
      if (!deck.audio.paused || deck.loopSource) startLoopPlayback(deck);
    });
    loop.addEventListener("click", () => {
      const wasPlaying = Boolean(deck.loopSource) || !deck.audio.paused;
      if (!deck.loopOn) { deck.loopIn = snapToBeat(deckTime(deck)); deck.loopOut = Math.min(deck.audio.duration || Infinity, deck.loopIn + deck.loopBeats * 60 / (deck.bpm || 120)); deck.loopOn = true; if (wasPlaying) startLoopPlayback(deck); }
      else { deck.loopOn = false; if (deck.loopSource) stopLoopPlayback(deck, wasPlaying); }
      updateLoop(deck);
    });
    slip.addEventListener("click", () => { deck.slipOn = !deck.slipOn; slip.classList.toggle("active", deck.slipOn); slip.setAttribute("aria-pressed", String(deck.slipOn)); });
    hotCueButtons.forEach((button, index) => button.addEventListener("click", () => {
      if (deck.hotCues[index] == null) { deck.hotCues[index] = deckTime(deck); button.classList.add("set"); }
      else { const resume = Boolean(deck.loopSource); stopLoopPlayback(deck, false); deck.audio.currentTime = deck.hotCues[index]!; deck.virtualTime = deck.audio.currentTime; if (resume && deck.loopOn) startLoopPlayback(deck); }
      saveDeck(deck); drawDeckWaveform(deck);
    }));
    hotCueButtons.forEach((button, index) => button.addEventListener("contextmenu", (event) => { event.preventDefault(); deck.hotCues[index] = null; button.classList.remove("set"); saveDeck(deck); drawDeckWaveform(deck); }));
    canvas.addEventListener("pointerdown", (event) => { if (Number.isFinite(deck.audio.duration)) { stopLoopPlayback(deck, false); deck.audio.currentTime = event.offsetX / canvas.clientWidth * deck.audio.duration; deck.virtualTime = deck.audio.currentTime; } });
    let lastJogX = 0, lastJogAt = 0;
    jog.addEventListener("pointerdown", async (event) => {
      if (!deck.buffer) return;
      jog.setPointerCapture(event.pointerId); lastJogX = event.clientX; lastJogAt = performance.now();
      deck.scratchPosition = deckTime(deck); deck.scratchWasPlaying = Boolean(deck.loopSource) || !deck.audio.paused; deck.scratchStartedAt = ac().currentTime; deck.scratchSlipAnchor = deck.scratchPosition;
      stopLoopPlayback(deck, false); deck.audio.pause(); deck.root.classList.add("scratching"); jog.classList.add("touching");
      const node = await ensureScratchNode(deck); node?.port.postMessage({ type: "scratch", active: true, position: deck.scratchPosition, velocity: 0 });
    });
    jog.addEventListener("pointermove", (event) => {
      if (!jog.hasPointerCapture(event.pointerId)) return;
      const now = performance.now(), elapsed = Math.max(8, now - lastJogAt) / 1000;
      const velocity = clamp(((event.clientX - lastJogX) / Math.max(80, jog.clientWidth)) / elapsed / (33.333 / 60), -8, 8);
      deck.nodes?.scratch?.port.postMessage({ type: "scratch", active: true, position: deck.scratchPosition, velocity });
      lastJogX = event.clientX; lastJogAt = now;
    });
    const releaseScratch = (event: PointerEvent): void => {
      if (!jog.hasPointerCapture(event.pointerId)) return;
      jog.releasePointerCapture(event.pointerId); deck.nodes?.scratch?.port.postMessage({ type: "scratch", active: false, position: deck.scratchPosition, velocity: 0 });
      const elapsed = Math.max(0, ac().currentTime - deck.scratchStartedAt);
      const resumeAt = deck.slipOn ? deck.scratchSlipAnchor + elapsed * (1 + deck.pitch / 100) : deck.scratchPosition;
      deck.audio.currentTime = clamp(resumeAt, 0, deck.audio.duration || Infinity); deck.virtualTime = deck.audio.currentTime;
      deck.root.classList.remove("scratching"); jog.classList.remove("touching"); deck.root.dataset.scratchDirection = "still";
      if (deck.scratchWasPlaying) { deck.playIntent = true; if (deck.loopOn) startLoopPlayback(deck); else void deck.audio.play().catch(() => undefined); }
    };
    jog.addEventListener("pointerup", releaseScratch); jog.addEventListener("pointercancel", releaseScratch);
    input.addEventListener("change", () => { const file = input.files?.[0]; if (file) void loadFile(deck, file); input.value = ""; });
    ["dragenter", "dragover"].forEach((name) => deckRoot.addEventListener(name, (event) => { event.preventDefault(); deckRoot.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach((name) => deckRoot.addEventListener(name, () => deckRoot.classList.remove("dragover")));
    deckRoot.addEventListener("drop", (event) => { event.preventDefault(); const file = event.dataTransfer?.files[0]; if (file?.type.startsWith("audio/")) void loadFile(deck, file); });
    return deck;
  });

  async function loadFile(deck: Deck, file: File): Promise<void> {
    deck.audio.pause(); if (deck.objectUrl) URL.revokeObjectURL(deck.objectUrl);
    deck.file = file; deck.objectUrl = URL.createObjectURL(file); deck.audio.src = deck.objectUrl; deck.title.textContent = file.name; deck.root.classList.add("loaded");
    deck.title.title = file.name; ensureDeckNodes(deck);
    try {
      const buffer = await ac().decodeAudioData(await file.arrayBuffer()); deck.buffer = buffer; deck.bpm = estimateBpm(buffer);
      const scratch = await ensureScratchNode(deck);
      if (scratch) {
        const left = buffer.getChannelData(0).slice(), right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : left.slice();
        scratch.port.postMessage({ type: "load", channels: [left.buffer, right.buffer], sampleRate: buffer.sampleRate }, [left.buffer, right.buffer]);
      }
      const stored = cueStore()[fileKey(file)];
      if (stored) { deck.bpm = stored.bpm || deck.bpm; deck.cue = stored.cue || 0; deck.hotCues = [...stored.hotCues.slice(0, 8), ...Array(8).fill(null)].slice(0, 8); }
      deck.bpmReadout.textContent = `${deck.bpm.toFixed(1)} BPM`; deck.cueButton.textContent = deck.cue ? `CUE ${formatTime(deck.cue)}` : "CUE";
      deck.hotCueButtons.forEach((button, index) => button.classList.toggle("set", deck.hotCues[index] != null));
      const key = fileKey(file), existing = libraryTracks.find((track) => track.key === key);
      if (existing) existing.bpm = deck.bpm; else libraryTracks.push({ key, file, name: file.name, bpm: deck.bpm });
      renderLibrary(); drawDeckWaveform(deck);
    } catch { deck.bpmReadout.textContent = "BPM ERROR"; }
  }

  function renderLibrary(): void {
    libraryRows.replaceChildren();
    if (!libraryTracks.length) { libraryRows.append(el("p", "wa-help", "No files yet. Load or drop audio onto either deck.")); return; }
    libraryTracks.forEach((track) => {
      const row = el("div", "wa-dj-library-row");
      const name = el("span", "wa-dj-library-name", track.name), bpm = el("span", "wa-dj-library-bpm", track.bpm ? `${track.bpm.toFixed(1)} BPM` : "—");
      const loadA = btn("→ A", "wa-btn-sm"), loadB = btn("→ B", "wa-btn-sm");
      loadA.addEventListener("click", () => void loadFile(decks[0], track.file)); loadB.addEventListener("click", () => void loadFile(decks[1], track.file));
      row.append(name, bpm, loadA, loadB); libraryRows.append(row);
    });
  }

  const mixerTitle = el("div", "wa-fx-title", "PERFORMANCE MIXER");
  const channelStrips = el("div", "wa-dj-channel-strips");
  decks.forEach((deck) => {
    const strip = el("section", "wa-dj-channel-strip"); strip.dataset.channel = deck.id;
    strip.append(el("strong", "wa-dj-channel-title", `CH ${deck.id}`), deck.root.querySelector(".wa-dj-controls")!); channelStrips.append(strip);
  });
  const meters = el("div", "wa-dj-meters");
  const meterCells: HTMLElement[][] = decks.map((deck) => {
    const strip = el("div", "wa-dj-meter"); strip.setAttribute("aria-label", `Deck ${deck.id} level meter`);
    const cells = Array.from({ length: 12 }, (_, index) => el("span", index > 9 ? "peak" : index > 7 ? "warn" : ""));
    const cellHost = el("div", "wa-dj-meter-cells"); cellHost.append(...cells); strip.append(el("b", "", deck.id), cellHost); meters.append(strip); return cells;
  });
  const crossfader = labelledRange("CROSSFADER", 0, 1, 0.5, 0.005, (value) => { crossfade = value; updateCrossfade(); });
  crossfader.classList.add("wa-dj-crossfader");
  const crossfaderInput = crossfader.querySelector<HTMLInputElement>("input")!;
  const record = btn("● REC", "wa-dj-record"), recordStatus = el("span", "wa-dj-record-status", "READY");
  const effects = el("section", "wa-dj-effects");
  const effectSelect = document.createElement("select"); effectSelect.className = "wa-select wa-dj-effect-select"; effectSelect.setAttribute("aria-label", "Master effect");
  ["ECHO", "REVERB", "FLANGER", "PHASER", "FILTER", "CRUSHER", "TRANS", "ROLL"].forEach((name) => { const option = document.createElement("option"); option.value = name; option.textContent = name; effectSelect.append(option); });
  const effectToggle = btn("FX ON", "wa-dj-effect-toggle"); effectToggle.setAttribute("aria-pressed", "false");
  const wetControl = labelledRange("FX WET / DRY", 0, 1, fxWet, 0.01, (value) => { fxWet = value; rebuildEffect(); });
  help(effectSelect, "Choose the master effect: echo, reverb, flanger, phaser, filter, crusher, rhythmic transform or roll.");
  help(effectToggle, "Route the mixed decks through the selected effect."); help(wetControl, "Balance the processed effect against the original mix.");
  effectSelect.addEventListener("change", () => { fxMode = effectSelect.value; rebuildEffect(); });
  effectToggle.addEventListener("click", () => { fxOn = !fxOn; effectToggle.classList.toggle("active", fxOn); effectToggle.setAttribute("aria-pressed", String(fxOn)); effectToggle.textContent = fxOn ? "FX ACTIVE" : "FX ON"; rebuildEffect(); });
  effects.append(el("strong", "wa-dj-effect-title", "MASTER FX"), effectSelect, wetControl, effectToggle);
  record.addEventListener("click", () => {
    ensureBus();
    if (recorder?.state === "recording") { recorder.stop(); return; }
    if (!recordTarget || typeof MediaRecorder === "undefined") { recordStatus.textContent = "RECORDING NOT SUPPORTED"; return; }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    recordingChunks = []; recorder = new MediaRecorder(recordTarget.stream, { mimeType: mime });
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size) recordingChunks.push(event.data); });
    recorder.addEventListener("stop", () => { download(`vishamp-dj-mix-${Date.now()}.webm`, new Blob(recordingChunks, { type: mime })); record.classList.remove("active"); record.textContent = "● REC"; recordStatus.textContent = "SAVED"; });
    recorder.start(250); record.classList.add("active"); record.textContent = "■ STOP"; recordStatus.textContent = "RECORDING LOCAL MIX";
  });
  mixer.append(mixerTitle, channelStrips, meters, effects, crossfader, record, recordStatus);
  deckHost.append(decks[0].root, mixer, decks[1].root);

  const library = el("section", "wa-dj-library wa-panel");
  const addFiles = btn("ADD LOCAL FILES", "wa-btn-sm");
  const libraryInput = document.createElement("input"); libraryInput.type = "file"; libraryInput.accept = "audio/*"; libraryInput.multiple = true; libraryInput.hidden = true;
  addFiles.addEventListener("click", () => libraryInput.click());
  libraryInput.addEventListener("change", () => { Array.from(libraryInput.files || []).forEach((file) => { const key = fileKey(file); if (!libraryTracks.some((track) => track.key === key)) libraryTracks.push({ key, file, name: file.name, bpm: null }); }); renderLibrary(); libraryInput.value = ""; });
  const privacy = el("span", "wa-dj-private", "LOCAL ONLY · FILES NEVER UPLOAD");
  library.append(el("div", "wa-fx-title", "BROWSER LIBRARY"), addFiles, privacy, libraryRows); renderLibrary();
  root.append(deckHost, library);

  const active = (): boolean => Boolean(root.closest(".wa-page-dj:not([hidden])"));
  window.addEventListener("keydown", (event) => {
    if (!active() || event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement)?.matches("input, textarea, select")) return;
    const actions: Record<string, () => void> = {
      w: () => decks[0].play.click(), e: () => decks[0].cueButton.click(), r: () => decks[0].sync.click(),
      i: () => decks[1].play.click(), o: () => decks[1].cueButton.click(), p: () => decks[1].sync.click(),
      "[": () => { crossfade = clamp(crossfade - 0.05, 0, 1); crossfaderInput.value = String(crossfade); updateCrossfade(); }, "]": () => { crossfade = clamp(crossfade + 0.05, 0, 1); crossfaderInput.value = String(crossfade); updateCrossfade(); },
    };
    if (actions[event.key.toLowerCase()]) { event.preventDefault(); actions[event.key.toLowerCase()](); }
  });

  const animate = (): void => {
    if (root.offsetParent) decks.forEach((deck, deckIndex) => {
      if (!deck.playIntent && !deck.loopSource && deck.audio.paused) { deck.root.classList.remove("playing"); deck.play.classList.remove("active"); deck.play.textContent = "START · STOP"; }
      if (deck.loopSource && deck.loopIn != null && deck.loopOut != null) {
        const span = deck.loopOut - deck.loopIn, elapsed = Math.max(0, ac().currentTime - deck.loopStartedAt) * (1 + deck.pitch / 100);
        deck.virtualTime = deck.loopIn + ((deck.loopStartPosition - deck.loopIn + elapsed) % span);
        const wraps = Math.floor((deck.loopStartPosition - deck.loopIn + elapsed) / span);
        if (wraps !== deck.loopWraps) { deck.loopWraps = wraps; deck.root.dataset.loopWraps = String(wraps); }
      }
      const position = deckTime(deck); deck.time.textContent = formatTime(position); drawDeckWaveform(deck);
      const progress = Number.isFinite(deck.audio.duration) && deck.audio.duration > 0 ? position / deck.audio.duration : 0;
      deck.root.style.setProperty("--wa-tonearm-angle", `${22 - progress * 7}deg`);
      const analyser = deck.nodes?.meter;
      let level = 0;
      if (analyser && (!deck.audio.paused || Boolean(deck.loopSource) || deck.root.classList.contains("scratching"))) {
        const samples = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(samples);
        level = Math.sqrt(samples.reduce((sum, sample) => sum + Math.pow((sample - 128) / 128, 2), 0) / samples.length);
      }
      const lit = Math.round(clamp(level * 34, 0, 12));
      deck.root.style.setProperty("--wa-dj-level", String(clamp(level * 8, 0, 1)));
      meterCells[deckIndex].forEach((cell, index) => cell.classList.toggle("lit", index < lit));
    });
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
  window.addEventListener("resize", () => decks.forEach(drawDeckWaveform));
  return { root };
}
