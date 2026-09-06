// Sample prep page: load one or many files, dial a recipe once, apply it to
// all of them, audition, download. Everything happens in this tab.
import { download } from "../calc";
import { loudness, monoMix, spectral, tempo, toDb } from "./dsp";
import { DEFAULT_RECIPE, applyRecipe, peakOf } from "./process";
import type { Channels, Recipe } from "./process";
import { encodeMp3Channels, encodeWavChannels } from "./wav";
import type { WavDepth } from "./wav";

interface Item {
  name: string; rate: number; channels: Channels; duration: number; peakDb: number; lufs: number; bpm: number;
  out?: { channels: Channels; rate: number; notes: string[]; peakDb: number; lufs: number };
  row: HTMLElement;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const fmt = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d) : "—");

export function initPrep(): void {
  const input = $<HTMLInputElement>("pp-input"), drop = $("pp-drop"), list = $("pp-list"), status = $("pp-status");
  if (!input || !list) return;
  const items: Item[] = [];
  let ctx: AudioContext | null = null, preview: AudioBufferSourceNode | null = null;
  const audio = (): AudioContext => {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  };

  // ── recipe from the form ──
  const val = (id: string): number => Number(($(id) as HTMLInputElement).value) || 0;
  const on = (id: string): boolean => ($(id) as HTMLInputElement).checked;
  const sel = (id: string): string => ($(id) as HTMLSelectElement).value;
  const recipe = (): Recipe => ({
    ...DEFAULT_RECIPE,
    trim: on("pp-trim"), trimDb: val("pp-trim-db") || -50,
    removeDc: on("pp-dc"),
    centre: on("pp-centre"), keepBelowHz: val("pp-keep") || 150,
    mono: on("pp-mono"),
    pitchSemitones: val("pp-pitch"), pitchMode: sel("pp-pitch-mode") as Recipe["pitchMode"],
    stretch: stretchFactor(),
    reverse: on("pp-reverse"),
    fadeInMs: val("pp-fade-in"), fadeOutMs: val("pp-fade-out"),
    normalise: sel("pp-norm") as Recipe["normalise"], peakDb: val("pp-peak-db") || -1, lufs: val("pp-lufs") || -14,
    gainDb: val("pp-gain"),
    outRate: Number(sel("pp-rate")) || 0,
  });
  // Stretch is either a percentage or "make it this BPM" from the detected tempo.
  const stretchFactor = (): number => {
    const mode = sel("pp-stretch-mode");
    if (mode === "bpm") return 0; // resolved per item (needs its detected BPM)
    const pct = val("pp-stretch") || 100;
    return Math.max(25, Math.min(400, pct)) / 100;
  };
  const stretchFor = (item: Item): number => {
    if (sel("pp-stretch-mode") !== "bpm") return stretchFactor();
    const target = val("pp-target-bpm"); if (!target || !item.bpm) return 1;
    return item.bpm / target;
  };
  $("pp-stretch-mode").addEventListener("change", () => {
    const bpm = sel("pp-stretch-mode") === "bpm";
    $("pp-stretch-pct-wrap").hidden = bpm; $("pp-stretch-bpm-wrap").hidden = !bpm;
  });
  $("pp-norm").addEventListener("change", () => {
    const m = sel("pp-norm");
    $("pp-peak-wrap").hidden = m !== "peak"; $("pp-lufs-wrap").hidden = m !== "lufs";
  });

  // ── loading ──
  async function addFiles(files: FileList | File[]): Promise<void> {
    for (const file of Array.from(files)) {
      const row = document.createElement("div"); row.className = "pp-item"; row.innerHTML = `<div class="pp-item-head"><strong></strong><span class="pp-item-meta">decoding…</span></div>`;
      row.querySelector("strong")!.textContent = file.name;
      list.append(row);
      try {
        const buffer = await audio().decodeAudioData(await file.arrayBuffer());
        const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => Float32Array.from(buffer.getChannelData(c)));
        const spec = await spectral(monoMix(channels), buffer.sampleRate);
        const item: Item = { name: file.name, rate: buffer.sampleRate, channels, duration: buffer.duration, peakDb: toDb(peakOf(channels)), lufs: loudness(channels, buffer.sampleRate).integrated, bpm: tempo(spec.onset, spec.fps).bpm, row };
        items.push(item);
        renderItem(item);
      } catch (err) {
        row.querySelector(".pp-item-meta")!.textContent = `could not decode (${(err as Error).message || "unsupported"})`;
      }
    }
    $("pp-actions").hidden = items.length === 0;
  }

  function renderItem(item: Item): void {
    const meta = item.row.querySelector(".pp-item-meta") as HTMLElement;
    meta.textContent = `${fmt(item.duration, 2)} s · ${item.rate} Hz · ${item.channels.length === 1 ? "mono" : "stereo"} · peak ${fmt(item.peakDb)} dBFS · ${fmt(item.lufs)} LUFS · ~${fmt(item.bpm, 0)} BPM`;
    let body = item.row.querySelector(".pp-item-body") as HTMLElement | null;
    if (!body) { body = document.createElement("div"); body.className = "pp-item-body"; item.row.append(body); }
    body.replaceChildren();
    const tools = document.createElement("div"); tools.className = "btn-row";
    const playIn = button("▶ Original", () => play(item.channels, item.rate)), playOut = button("▶ Processed", () => item.out && play(item.out.channels, item.out.rate));
    playOut.disabled = !item.out;
    const dl = button("Download", () => void save(item)); dl.disabled = !item.out; dl.classList.remove("btn-ghost"); dl.classList.add("btn");
    const remove = button("Remove", () => { items.splice(items.indexOf(item), 1); item.row.remove(); $("pp-actions").hidden = items.length === 0; });
    tools.append(playIn, playOut, dl, remove);
    body.append(tools);
    if (item.out) {
      const res = document.createElement("p"); res.className = "pp-result";
      res.textContent = `→ ${fmt(item.out.channels[0].length / item.out.rate, 2)} s · ${item.out.rate} Hz · ${item.out.channels.length === 1 ? "mono" : "stereo"} · peak ${fmt(item.out.peakDb)} dBFS · ${fmt(item.out.lufs)} LUFS${item.out.notes.length ? ` · ${item.out.notes.join(", ")}` : ""}`;
      body.append(res);
    }
  }
  const button = (label: string, onClick: () => void): HTMLButtonElement => { const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost btn-sm"; b.textContent = label; b.addEventListener("click", onClick); return b; };

  function play(channels: Channels, rate: number): void {
    const a = audio(); preview?.stop();
    const buf = a.createBuffer(channels.length, channels[0].length, rate);
    channels.forEach((c, i) => buf.getChannelData(i).set(c));
    preview = a.createBufferSource(); preview.buffer = buf; preview.connect(a.destination); preview.start();
  }

  // ── processing ──
  let busy = false;
  async function processAll(): Promise<void> {
    if (busy || !items.length) return; busy = true;
    const base = recipe();
    for (const [i, item] of items.entries()) {
      status.textContent = `Processing ${i + 1} of ${items.length}: ${item.name}`;
      await new Promise((r) => setTimeout(r, 0));
      const r = { ...base, stretch: stretchFor(item) };
      const { out, rate, notes } = applyRecipe(item.channels, item.rate, r);
      if (r.stretch !== 1 && sel("pp-stretch-mode") === "bpm") notes.unshift(`${fmt(item.bpm, 0)} → ${val("pp-target-bpm")} BPM`);
      item.out = { channels: out, rate, notes, peakDb: toDb(peakOf(out)), lufs: out[0].length ? loudness(out, rate).integrated : -Infinity };
      renderItem(item);
    }
    status.textContent = `Done — ${items.length} file${items.length === 1 ? "" : "s"} processed.`;
    busy = false;
  }
  async function save(item: Item): Promise<void> {
    if (!item.out) return;
    const format = sel("pp-format"), depth = Number(sel("pp-depth")) as WavDepth;
    const stem = item.name.replace(/\.[^.]+$/, "");
    const blob = format === "mp3" ? await encodeMp3Channels(item.out.channels, item.out.rate) : encodeWavChannels(item.out.channels, item.out.rate, depth);
    download(`${stem}-prep.${format === "mp3" ? "mp3" : "wav"}`, URL.createObjectURL(blob));
  }

  // ── wiring ──
  input.addEventListener("change", () => { if (input.files?.length) void addFiles(input.files); input.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const files = (e as DragEvent).dataTransfer?.files; if (files?.length) void addFiles(files); });
  $("pp-process").addEventListener("click", () => void processAll());
  $("pp-download-all").addEventListener("click", async () => {
    for (const item of items) { if (item.out) { await save(item); await new Promise((r) => setTimeout(r, 400)); } }
  });
  $("pp-clear").addEventListener("click", () => { items.splice(0); list.replaceChildren(); $("pp-actions").hidden = true; status.textContent = ""; });
}
