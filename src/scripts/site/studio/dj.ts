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
  cross: GainNode;
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
}

interface LibraryTrack {
  key: string;
  file: File;
  name: string;
  bpm: number | null;
}

const STORE_KEY = "vv_studio_dj_cues_v1";
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
    context.strokeStyle = SCREEN_FG; context.beginPath();
    for (let x = 0; x < width; x++) {
      let peak = 0;
      for (let i = x * stride; i < Math.min(data.length, (x + 1) * stride); i++) peak = Math.max(peak, Math.abs(data[i]));
      const y = peak * height * 0.43; context.moveTo(x, height / 2 - y); context.lineTo(x, height / 2 + y);
    }
    context.stroke();
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
    const x = deck.audio.currentTime / duration * width;
    context.strokeStyle = "#f1e7c8"; context.lineWidth = 2; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
  }
}

export function buildDj(): { root: HTMLElement } {
  const root = el("section", "wa-dj");
  const deckHost = el("div", "wa-dj-decks");
  const mixer = el("section", "wa-dj-mixer wa-panel");
  const libraryTracks: LibraryTrack[] = [];
  const libraryRows = el("div", "wa-dj-library-rows");
  let bus: GainNode | null = null, recordTarget: MediaStreamAudioDestinationNode | null = null;
  let recorder: MediaRecorder | null = null, recordingChunks: Blob[] = [];
  let crossfade = 0.5;

  const ensureBus = (): GainNode => {
    const context = ac();
    if (!bus) {
      bus = context.createGain(); bus.gain.value = 0.9; bus.connect(master!);
      recordTarget = context.createMediaStreamDestination(); bus.connect(recordTarget);
    }
    return bus;
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
    const hp = context.createBiquadFilter(), lp = context.createBiquadFilter(), fader = context.createGain(), cross = context.createGain();
    low.type = "lowshelf"; low.frequency.value = 250; mid.type = "peaking"; mid.frequency.value = 1200; mid.Q.value = 0.8;
    high.type = "highshelf"; high.frequency.value = 5000; hp.type = "highpass"; hp.frequency.value = 20; lp.type = "lowpass"; lp.frequency.value = 20000;
    fader.gain.value = 0.9;
    source.connect(input).connect(low).connect(mid).connect(high).connect(hp).connect(lp).connect(fader).connect(cross).connect(ensureBus());
    deck.nodes = { source, input, low, mid, high, hp, lp, fader, cross };
    updateCrossfade();
    return deck.nodes;
  };

  const saveDeck = (deck: Deck): void => {
    if (!deck.file) return;
    const store = cueStore(); store[fileKey(deck.file)] = { cue: deck.cue, hotCues: deck.hotCues, bpm: deck.bpm };
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  };

  const setPitch = (deck: Deck, pitch: number): void => {
    deck.pitch = clamp(pitch, -16, 16); deck.audio.playbackRate = 1 + deck.pitch / 100;
    const tempoInput = deck.root.querySelector<HTMLInputElement>('input[aria-label="TEMPO"]');
    if (tempoInput) tempoInput.value = String(deck.pitch);
    deck.pitchReadout.textContent = `${deck.pitch >= 0 ? "+" : ""}${deck.pitch.toFixed(2)}%`;
  };

  const updateLoop = (deck: Deck): void => {
    deck.loop.classList.toggle("active", deck.loopOn); deck.loop.setAttribute("aria-pressed", String(deck.loopOn));
    drawDeckWaveform(deck);
  };

  const decks: Deck[] = (["A", "B"] as DeckId[]).map((id) => {
    const deckRoot = el("section", `wa-dj-deck wa-dj-deck-${id.toLowerCase()} wa-panel`);
    deckRoot.dataset.deck = id;
    const head = el("div", "wa-dj-deck-head");
    const badge = el("span", "wa-dj-deck-badge", `DECK ${id}`), title = el("strong", "wa-dj-track-title", "NO TRACK LOADED");
    const load = btn("LOAD", "wa-btn-sm wa-dj-load");
    const input = document.createElement("input"); input.type = "file"; input.accept = "audio/*"; input.hidden = true; input.setAttribute("aria-label", `Load audio into deck ${id}`);
    load.addEventListener("click", () => input.click()); head.append(badge, title, load, input);
    const display = el("div", "wa-dj-display");
    const time = el("span", "wa-dj-time", "--:--.---"), bpmReadout = el("span", "wa-dj-bpm", "--- BPM"), pitchReadout = el("span", "wa-dj-pitch", "+0.00%");
    display.append(time, bpmReadout, pitchReadout);
    const canvas = document.createElement("canvas"); canvas.className = "wa-dj-waveform"; canvas.setAttribute("aria-label", `Deck ${id} waveform; click to seek`);
    const transport = el("div", "wa-dj-transport");
    const play = btn("▶ PLAY", "wa-dj-play"), cueButton = btn("CUE"), setCue = btn("SET CUE", "wa-btn-sm"), sync = btn("SYNC", "wa-btn-sm"), tempo = btn("MASTER TEMPO", "wa-btn-sm active");
    tempo.setAttribute("aria-pressed", "true");
    transport.append(cueButton, play, setCue, sync, tempo);
    const jog = el("div", "wa-dj-jog"); jog.tabIndex = 0; jog.setAttribute("role", "slider"); jog.setAttribute("aria-label", `Deck ${id} jog wheel`);
    jog.append(el("span", "wa-dj-jog-ring"), el("span", "wa-dj-jog-label", id));
    const performancePanel = el("div", "wa-dj-performance");
    const loopBar = el("div", "wa-dj-loopbar");
    const loopIn = btn("IN", "wa-btn-sm"), loopOut = btn("OUT", "wa-btn-sm"), loop = btn("LOOP", "wa-btn-sm"), slip = btn("SLIP", "wa-btn-sm");
    const loopLength = document.createElement("select"); loopLength.className = "wa-select wa-dj-loop-length"; loopLength.setAttribute("aria-label", "Loop length in beats");
    [1, 2, 4, 8, 16, 32].forEach((beats) => { const option = document.createElement("option"); option.value = String(beats); option.textContent = `${beats} BEAT`; if (beats === 4) option.selected = true; loopLength.append(option); });
    loopBar.append(loopIn, loopOut, loop, loopLength, slip);
    const hotCueGrid = el("div", "wa-dj-hotcues"), hotCueButtons: HTMLButtonElement[] = [];
    for (let i = 0; i < 8; i++) { const cue = btn(`HOT ${i + 1}`, "wa-dj-hotcue"); cue.dataset.cue = String(i); hotCueButtons.push(cue); hotCueGrid.append(cue); }
    performancePanel.append(loopBar, hotCueGrid);
    const controls = el("div", "wa-dj-controls");
    controls.append(
      labelledRange("TRIM", 0, 1.5, 1, 0.01, (value) => { ensureDeckNodes(deck).input.gain.value = value; }),
      labelledRange("HI", -26, 6, 0, 0.5, (value) => { ensureDeckNodes(deck).high.gain.value = value; }),
      labelledRange("MID", -26, 6, 0, 0.5, (value) => { ensureDeckNodes(deck).mid.gain.value = value; }),
      labelledRange("LOW", -26, 6, 0, 0.5, (value) => { ensureDeckNodes(deck).low.gain.value = value; }),
      labelledRange("FILTER", -1, 1, 0, 0.01, (value) => { const nodes = ensureDeckNodes(deck); nodes.hp.frequency.value = value > 0 ? 20 * Math.pow(250, value) : 20; nodes.lp.frequency.value = value < 0 ? 20000 * Math.pow(60, value) : 20000; }),
      labelledRange("LEVEL", 0, 1.2, 0.9, 0.01, (value) => { ensureDeckNodes(deck).fader.gain.value = value; }),
      labelledRange("TEMPO", -16, 16, 0, 0.05, (value) => setPitch(deck, value)),
    );
    deckRoot.append(head, display, canvas, transport, jog, performancePanel, controls);
    const deck: Deck = { id, audio: new Audio(), root: deckRoot, fileInput: input, title, time, bpmReadout, pitchReadout, canvas, play, cueButton, sync, tempo, loop, slip, hotCueButtons, nodes: null, file: null, objectUrl: null, buffer: null, bpm: 0, pitch: 0, cue: 0, hotCues: Array(8).fill(null), loopIn: null, loopOut: null, loopBeats: 4, loopOn: false, slipOn: false, slipStartedAt: null };
    deck.audio.preload = "metadata";

    const togglePlay = async (): Promise<void> => {
      if (!deck.file) { input.click(); return; }
      ensureDeckNodes(deck);
      if (deck.audio.paused) await deck.audio.play(); else deck.audio.pause();
    };
    play.addEventListener("click", togglePlay);
    deck.audio.addEventListener("play", () => { play.textContent = "❚❚ PAUSE"; play.classList.add("active"); });
    deck.audio.addEventListener("pause", () => { play.textContent = "▶ PLAY"; play.classList.remove("active"); });
    cueButton.addEventListener("click", () => { deck.audio.pause(); deck.audio.currentTime = deck.cue; });
    setCue.addEventListener("click", () => { deck.cue = deck.audio.currentTime; cueButton.textContent = `CUE ${formatTime(deck.cue)}`; saveDeck(deck); });
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
    loopIn.addEventListener("click", () => { deck.loopIn = deck.audio.currentTime; deck.loopOut = null; });
    loopOut.addEventListener("click", () => { deck.loopOut = Math.max(deck.audio.currentTime, (deck.loopIn || 0) + 0.05); deck.loopOn = deck.loopIn != null; updateLoop(deck); });
    loop.addEventListener("click", () => {
      if (!deck.loopOn) { deck.loopIn = deck.audio.currentTime; deck.loopOut = deck.loopIn + deck.loopBeats * 60 / (deck.bpm || 120); }
      deck.loopOn = !deck.loopOn; if (!deck.loopOn && deck.slipOn && deck.slipStartedAt != null) deck.audio.currentTime += (performance.now() - deck.slipStartedAt) / 1000;
      deck.slipStartedAt = deck.loopOn && deck.slipOn ? performance.now() : null; updateLoop(deck);
    });
    slip.addEventListener("click", () => { deck.slipOn = !deck.slipOn; slip.classList.toggle("active", deck.slipOn); slip.setAttribute("aria-pressed", String(deck.slipOn)); });
    hotCueButtons.forEach((button, index) => button.addEventListener("click", () => {
      if (deck.hotCues[index] == null) { deck.hotCues[index] = deck.audio.currentTime; button.classList.add("set"); }
      else deck.audio.currentTime = deck.hotCues[index]!;
      saveDeck(deck); drawDeckWaveform(deck);
    }));
    hotCueButtons.forEach((button, index) => button.addEventListener("contextmenu", (event) => { event.preventDefault(); deck.hotCues[index] = null; button.classList.remove("set"); saveDeck(deck); drawDeckWaveform(deck); }));
    canvas.addEventListener("pointerdown", (event) => { if (Number.isFinite(deck.audio.duration)) deck.audio.currentTime = event.offsetX / canvas.clientWidth * deck.audio.duration; });
    let jogStart = 0, timeStart = 0;
    jog.addEventListener("pointerdown", (event) => { jog.setPointerCapture(event.pointerId); jogStart = event.clientX; timeStart = deck.audio.currentTime; jog.classList.add("touching"); });
    jog.addEventListener("pointermove", (event) => { if (!jog.hasPointerCapture(event.pointerId)) return; deck.audio.currentTime = clamp(timeStart + (event.clientX - jogStart) * 0.025, 0, deck.audio.duration || Infinity); });
    jog.addEventListener("pointerup", (event) => { if (jog.hasPointerCapture(event.pointerId)) jog.releasePointerCapture(event.pointerId); jog.classList.remove("touching"); });
    deck.audio.addEventListener("timeupdate", () => { if (deck.loopOn && deck.loopIn != null && deck.loopOut != null && deck.audio.currentTime >= deck.loopOut) deck.audio.currentTime = deck.loopIn; });
    input.addEventListener("change", () => { const file = input.files?.[0]; if (file) void loadFile(deck, file); input.value = ""; });
    ["dragenter", "dragover"].forEach((name) => deckRoot.addEventListener(name, (event) => { event.preventDefault(); deckRoot.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach((name) => deckRoot.addEventListener(name, () => deckRoot.classList.remove("dragover")));
    deckRoot.addEventListener("drop", (event) => { event.preventDefault(); const file = event.dataTransfer?.files[0]; if (file?.type.startsWith("audio/")) void loadFile(deck, file); });
    return deck;
  });

  async function loadFile(deck: Deck, file: File): Promise<void> {
    deck.audio.pause(); if (deck.objectUrl) URL.revokeObjectURL(deck.objectUrl);
    deck.file = file; deck.objectUrl = URL.createObjectURL(file); deck.audio.src = deck.objectUrl; deck.title.textContent = file.name;
    deck.title.title = file.name; ensureDeckNodes(deck);
    try {
      const buffer = await ac().decodeAudioData(await file.arrayBuffer()); deck.buffer = buffer; deck.bpm = estimateBpm(buffer);
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
  const crossfader = labelledRange("CROSSFADER", 0, 1, 0.5, 0.005, (value) => { crossfade = value; updateCrossfade(); });
  crossfader.classList.add("wa-dj-crossfader");
  const record = btn("● REC", "wa-dj-record"), recordStatus = el("span", "wa-dj-record-status", "READY");
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
  const policy = el("div", "wa-dj-policy");
  policy.append(el("strong", "", "EMBEDS AREN’T MIXABLE"), document.createTextNode(" YouTube and SoundCloud public players cannot enter EQ, cue or recording. A licensed provider SDK is required."));
  help(policy, "This boundary prevents a fake or terms-breaking streaming mixer. Local files never leave this browser.");
  mixer.append(mixerTitle, crossfader, record, recordStatus, policy);
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
      "[": () => { crossfade = clamp(crossfade - 0.05, 0, 1); updateCrossfade(); }, "]": () => { crossfade = clamp(crossfade + 0.05, 0, 1); updateCrossfade(); },
    };
    if (actions[event.key.toLowerCase()]) { event.preventDefault(); actions[event.key.toLowerCase()](); }
  });

  const animate = (): void => {
    if (root.offsetParent) decks.forEach((deck) => { deck.time.textContent = formatTime(deck.audio.currentTime); drawDeckWaveform(deck); });
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
  window.addEventListener("resize", () => decks.forEach(drawDeckWaveform));
  return { root };
}
