// Project persistence: localStorage autosave, project file schema (v6 adds
// note-based synth clips + the VV-1 patch; v5 session clips and v4 single-
// pattern projects still load), undo history.

import {
  SCENES, STEPS, PAD_COUNT, PAD_LAYER_MAX, PIANO_NOTES, TRACKS, ARRANGE_TRACKS, clip, transport, song,
  allPats, allVels, synthNotes, padEvents, arrangement, songLoop, sampleParams, sampleData, sampleBuffers,
  padLayers, padLayerBuffers, padLayerMode,
  dp, mpc, rackState, fx, vsynthPatch, synthLaneNotes, synthPatches, patternLengths, patternDivisions, SYNTH_LANES,
  DRUMS, laneLengths, laneRates, laneVoices, laneSends, LANE_RATES, mixState, mute, solo, createArrangeBlock,
} from "./state";
import type { ArrangeBlock, ArrangeTrackId, HistoryState, PadEvent, PadLayer, PadLayerMode, SamplerP, DrumP, RackState, TrackId, VNote, SynthLane } from "./state";
import type { VPatch } from "./vsynth";
import { applyFxState, hydrateSample, hydratePadLayer } from "./engine";

const clamp01 = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
};

function applyMixState(saved: Partial<typeof mixState>): void {
  if (Array.isArray(saved.channelLevels)) saved.channelLevels.forEach((value, index) => {
    if (index < mixState.channelLevels.length) mixState.channelLevels[index] = clamp01(value, mixState.channelLevels[index]);
  });
  mixState.synthLevel = clamp01(saved.synthLevel, mixState.synthLevel);
  mixState.masterLevel = clamp01(saved.masterLevel, mixState.masterLevel);
  if (typeof saved.power === "boolean") mixState.power = saved.power;
  if (Array.isArray(saved.mute)) saved.mute.forEach((value, index) => { if (index < mute.length) mute[index] = !!value; });
  if (Array.isArray(saved.solo)) saved.solo.forEach((value, index) => { if (index < solo.length) solo[index] = !!value; });
}

// saveAll fires on essentially every mutation, and a synchronous full-project
// stringify per knob-tick is measurable jank on big projects. Trailing
// debounce, with a flush when the page hides so closing the tab mid-debounce
// cannot lose the last edit. (The undo stack was audited for the same hazard
// and cleared: historyState copies sampleData as an ARRAY of string
// references — JS strings are immutable and shared, not duplicated.)
let saveTimer = 0;
function writeNow(): void {
  try {
    localStorage.setItem("vv_studio_v2", JSON.stringify(projectState(false)));
    window.dispatchEvent(new CustomEvent("vv-studio-saved"));
  } catch { /* ignore */ }
}
function flushPendingSave(): void {
  if (!saveTimer) return;
  window.clearTimeout(saveTimer); saveTimer = 0; writeNow();
}
export function saveAll(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { saveTimer = 0; writeNow(); }, 400);
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPendingSave);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushPendingSave(); });
}
export function historyState(): HistoryState {
  return {
    bpm: transport.bpm,
    title: song.title,
    pats: allPats.map((pattern) => pattern.map((row) => [...row])),
    vels: allVels.map((pattern) => pattern.map((row) => [...row])),
    synthLaneNotes: Object.fromEntries(SYNTH_LANES.map((lane) => [lane, synthLaneNotes[lane].map((notes) => notes.map((note) => ({ ...note })))])) as Record<SynthLane, VNote[][]>,
    synthPatches: Object.fromEntries(SYNTH_LANES.map((lane) => [lane, JSON.parse(JSON.stringify(synthPatches[lane]))])) as Record<SynthLane, VPatch>,
    patternLengths: [...patternLengths],
    patternDivisions: [...patternDivisions],
    laneLengths: laneLengths.map((row) => [...row]),
    laneRates: laneRates.map((row) => [...row]),
    padEvents: padEvents.map((events) => events.map((event) => ({ ...event }))),
    sampleParams: sampleParams.map((params) => ({ ...params })),
    sampleData: [...sampleData],
    arrangement: {
      drums: arrangement.drums.map((b) => ({ ...b })),
      pads: arrangement.pads.map((b) => ({ ...b })),
      bass: arrangement.bass.map((b) => ({ ...b })),
      lead: arrangement.lead.map((b) => ({ ...b })),
      harmony: arrangement.harmony.map((b) => ({ ...b })),
    },
    fx: { ...fx },
    rackState: { ...rackState, macros: [...rackState.macros], devices: { ...rackState.devices } },
    vsynth: JSON.parse(JSON.stringify(vsynthPatch)) as VPatch,
    mix: JSON.parse(JSON.stringify(mixState)),
  };
}
export function restoreHistory(state: HistoryState): void {
  if (typeof state.bpm === "number") transport.bpm = state.bpm;
  if (typeof state.title === "string") song.title = state.title;
  state.pats.forEach((pattern, pi) => pattern.forEach((row, ri) => row.forEach((value, step) => { allPats[pi][ri][step] = value; })));
  state.vels.forEach((pattern, pi) => pattern.forEach((row, ri) => row.forEach((value, step) => { allVels[pi][ri][step] = value; })));
  if (state.synthLaneNotes) SYNTH_LANES.forEach((lane) => {
    state.synthLaneNotes![lane].forEach((notes, i) => { synthLaneNotes[lane][i] = notes.map((note) => ({ ...note })); });
  });
  if (state.synthPatches) SYNTH_LANES.forEach((lane) => Object.assign(synthPatches[lane], JSON.parse(JSON.stringify(state.synthPatches![lane]))));
  state.patternLengths?.forEach((value, i) => { if (i < SCENES) patternLengths[i] = value; });
  state.patternDivisions?.forEach((value, i) => { if (i < SCENES) patternDivisions[i] = value; });
  state.laneLengths?.forEach((row, i) => { if (i < SCENES) row.forEach((v, r) => { laneLengths[i][r] = v; }); });
  state.laneRates?.forEach((row, i) => { if (i < SCENES) row.forEach((v, r) => { laneRates[i][r] = v; }); });
  state.padEvents.forEach((events, i) => { padEvents[i] = events.map((event) => ({ ...event })); });
  state.sampleParams.forEach((params, i) => Object.assign(sampleParams[i], params));
  state.sampleData.forEach((data, i) => { sampleData[i] = data; sampleBuffers[i] = null; if (data) void hydrateSample(i); });
  ARRANGE_TRACKS.forEach((track) => { arrangement[track] = state.arrangement[track].map((b) => ({ ...b })); });
  Object.assign(fx, state.fx);
  Object.assign(rackState, state.rackState);
  rackState.macros = [...state.rackState.macros]; rackState.devices = { ...state.rackState.devices };
  (Object.keys(state.vsynth) as Array<keyof VPatch>).forEach((key) => {
    const value = state.vsynth[key];
    if (Array.isArray(value)) (vsynthPatch[key] as unknown[]) = JSON.parse(JSON.stringify(value));
    else if (typeof value === "object" && value !== null) Object.assign(vsynthPatch[key] as object, value);
    else (vsynthPatch[key] as unknown) = value;
  });
  if (state.mix) applyMixState(state.mix);
  applyFxState(); saveAll();
}
export function projectState(includeSamples = true): object {
  const samplePool: string[] = [];
  const sampleRefs = sampleData.map((data) => {
    if (!includeSamples || !data) return -1;
    let index = samplePool.indexOf(data);
    if (index < 0) { samplePool.push(data); index = samplePool.length - 1; }
    return index;
  });
  return {
    version: 16, // v16: stable clip IDs, free timeline placement and independent synth lanes
    title: song.title,
    pats: allPats.map((p) => p.map((r) => r.map((b) => (b ? 1 : 0)))),
    vels: allVels,
    dp,
    bpm: transport.bpm,
    clipSel: clip.sel,
    clipPlay: clip.play,
    synthLaneNotes,
    synthPatches,
    patternLengths,
    patternDivisions,
    laneLengths,
    laneRates,
    laneVoices,
    laneSends,
    mix: mixState,
    vsynth: synthPatches.bass,
    arrangement,
    songLoop,
    songMode: transport.songMode,
    quantizeGrid: transport.quantizeGrid,
    metroVolume: transport.metroVolume,
    sampleParams,
    samplePool,
    sampleRefs,
    // layer audio rides only in project files (like the sample pool); autosave keeps the meta
    padLayers: includeSamples ? padLayers : padLayers.map((ls) => ls.map((l) => ({ ...l, data: null }))),
    padLayerMode,
    fx,
    padEvents,
    mpc,
    rackState,
  };
}
export function loadAll(): void {
  try {
    const raw = localStorage.getItem("vv_studio_v2") || localStorage.getItem("vv_studio_pattern");
    if (!raw) return;
    applyProject(JSON.parse(raw));
  } catch { /* ignore */ }
}
export function applyProject(saved: Record<string, unknown>): void {
  try {
    if (saved.pats) {
      (saved.pats as number[][][]).forEach((pp, pi) => {
        if (pi >= SCENES) return;
        pp.forEach((row, ri) => { if (ri < 8) row.forEach((v, ci) => { if (ci < STEPS) allPats[pi][ri][ci] = !!v; }); });
      });
      if (saved.vels) (saved.vels as number[][][]).forEach((pp, pi) => {
        if (pi >= SCENES) return;
        pp.forEach((row, ri) => { if (ri < 8) row.forEach((v, ci) => { if (ci < STEPS) allVels[pi][ri][ci] = v; }); });
      });
      if (saved.dp) (saved.dp as Partial<DrumP>[]).forEach((d, i) => { if (i < 8) Object.assign(dp[i], d); });
      // pre-v13 the title lived in its own localStorage key, outside the project
      if (typeof saved.title === "string") song.title = (saved.title as string).slice(0, 48) || "Untitled";
      else song.title = (localStorage.getItem("vv_studio_name") || song.title).slice(0, 48);
      if (saved.bpm) transport.bpm = saved.bpm as number;
      // v4 projects carry a single curPat; v5 carries clipSel + per-track clipPlay.
      const sel = typeof saved.clipSel === "number" ? saved.clipSel : typeof saved.curPat === "number" ? saved.curPat : null;
      if (sel !== null) {
        clip.sel = Math.max(0, Math.min(SCENES - 1, sel));
        TRACKS.forEach((t) => { clip.play[t] = clip.sel; });
      }
      if (saved.clipPlay && typeof saved.clipPlay === "object") {
        const incoming = saved.clipPlay as Record<TrackId, number | null>;
        TRACKS.forEach((t) => {
          const v = incoming[t];
          if (v === null) clip.play[t] = null;
          else if (typeof v === "number") clip.play[t] = Math.max(0, Math.min(SCENES - 1, v));
        });
      }
      if (saved.synthNotes) {
        (saved.synthNotes as VNote[][]).forEach((notes, i) => {
          if (i >= SCENES || !Array.isArray(notes)) return;
          synthNotes[i] = notes
            .filter((n) => n && typeof n.note === "string" && typeof n.step === "number")
            .map((n) => ({ note: n.note, step: n.step % STEPS, len: Math.max(0.25, Math.min(STEPS, n.len || 1)), vel: Math.max(1, Math.min(127, n.vel || 100)), accent: !!n.accent, slide: !!n.slide }));
        });
      } else if (saved.synthPats) {
        // v5 and older stored a 12-row on/off grid — convert to 1-step notes.
        (saved.synthPats as number[][][]).forEach((pp, pi) => {
          if (pi >= SCENES) return;
          const notes: VNote[] = [];
          pp.forEach((row, ri) => {
            if (ri >= PIANO_NOTES.length) return;
            row.forEach((v, ci) => { if (v && ci < STEPS) notes.push({ note: PIANO_NOTES[ri], step: ci, len: 1, vel: 100 }); });
          });
          synthNotes[pi] = notes;
        });
      }
      if (saved.synthLaneNotes && typeof saved.synthLaneNotes === "object") {
        const incoming = saved.synthLaneNotes as Partial<Record<SynthLane, VNote[][]>>;
        SYNTH_LANES.forEach((lane) => incoming[lane]?.forEach((notes, i) => {
          if (i >= SCENES || !Array.isArray(notes)) return;
          synthLaneNotes[lane][i] = notes.filter((n) => n && typeof n.note === "string" && typeof n.step === "number").map((n) => ({
            note: n.note, step: Math.max(0, Math.min(STEPS - 0.25, n.step)), len: Math.max(0.25, Math.min(STEPS, n.len || 1)),
            vel: Math.max(1, Math.min(127, n.vel || 100)), accent: !!n.accent, slide: !!n.slide,
          }));
        }));
      } else {
        synthLaneNotes.bass = synthNotes;
      }
      if (saved.vsynth && typeof saved.vsynth === "object") {
        const incoming = saved.vsynth as Partial<VPatch>;
        (Object.keys(incoming) as Array<keyof VPatch>).forEach((key) => {
          const value = incoming[key];
          if (value === undefined) return;
          if (Array.isArray(value)) (vsynthPatch[key] as unknown[]) = JSON.parse(JSON.stringify(value));
          else if (typeof value === "object" && value !== null) Object.assign(vsynthPatch[key] as object, value);
          else (vsynthPatch[key] as unknown) = value;
        });
      }
      if (saved.synthPatches && typeof saved.synthPatches === "object") {
        const incoming = saved.synthPatches as Partial<Record<SynthLane, VPatch>>;
        SYNTH_LANES.forEach((lane) => { if (incoming[lane]) Object.assign(synthPatches[lane], JSON.parse(JSON.stringify(incoming[lane]))); });
      }
      if (Array.isArray(saved.patternLengths)) (saved.patternLengths as number[]).forEach((value, i) => {
        if (i < SCENES) patternLengths[i] = [4, 8, 12, 16, 24, 32].includes(value) ? value : 16;
      });
      if (Array.isArray(saved.patternDivisions)) (saved.patternDivisions as number[]).forEach((value, i) => {
        if (i < SCENES) patternDivisions[i] = [3, 4, 6, 8, 12, 16].includes(value) ? value : 4;
      });
      // v12 per-lane settings. Absent in older projects, which then read as
      // "follow the scene" — exactly the pre-polymeter behaviour.
      if (Array.isArray(saved.laneLengths)) (saved.laneLengths as number[][]).forEach((row, i) => {
        if (i < SCENES && Array.isArray(row)) row.forEach((v, r) => { if (r < DRUMS.length) laneLengths[i][r] = Math.max(0, Math.min(STEPS, Number(v) || 0)); });
      });
      if (Array.isArray(saved.laneRates)) (saved.laneRates as number[][]).forEach((row, i) => {
        if (i < SCENES && Array.isArray(row)) row.forEach((v, r) => { if (r < DRUMS.length) laneRates[i][r] = LANE_RATES.includes(Number(v)) ? Number(v) : 0; });
      });
      if (Array.isArray(saved.laneVoices)) (saved.laneVoices as string[]).forEach((v, r) => {
        if (r < DRUMS.length) laneVoices[r] = v === "glitch" ? "glitch" : "auto";
      });
      if (Array.isArray(saved.laneSends)) (saved.laneSends as Array<{ echo?: number; space?: number; pan?: number }>).forEach((v, r) => {
        if (r < DRUMS.length && v) {
          laneSends[r].echo = Number(v.echo) || 0; laneSends[r].space = Number(v.space) || 0;
          laneSends[r].pan = Math.max(-1, Math.min(1, Number(v.pan) || 0));
        }
      });
      if (saved.mix && typeof saved.mix === "object") applyMixState(saved.mix as Partial<typeof mixState>);
      if (saved.arrangement && typeof saved.arrangement === "object") {
        const incoming = saved.arrangement as Partial<Record<ArrangeTrackId | "synth", ArrangeBlock[]>>;
        ARRANGE_TRACKS.forEach((track) => {
          const legacySynth = track === "bass" || track === "lead" || track === "harmony" ? incoming.synth : undefined;
          const blocks = incoming[track] ?? legacySynth;
          if (Array.isArray(blocks)) {
            // pre-v9 blocks were sequential (no startBar) — migrate to
            // cumulative positions on the shared timeline
            let cursor = 0;
            arrangement[track] = blocks
              .filter((b) => b && typeof b.scene === "number" && typeof b.bars === "number")
              .map((b) => {
                const bars = Math.max(1, Math.min(128, b.bars));
                const startBar = typeof b.startBar === "number" ? Math.max(0, b.startBar) : cursor;
                cursor = startBar + bars;
                return {
                  id: typeof b.id === "string" && b.id ? b.id : createArrangeBlock(0, 0).id,
                  scene: Math.max(0, Math.min(SCENES - 1, b.scene)), bars, startBar,
                  offset: Math.max(0, Number(b.offset) || 0), loop: b.loop !== false,
                  automation: Array.isArray(b.automation) ? b.automation.filter((r) => r && typeof r.from === "number" && typeof r.to === "number").map((r) => ({ ...r })) : [],
                };
              });
          }
        });
      } else if (saved.songChain) {
        // v6 and older: one shared scene per slot, forced onto every track.
        // Give each track its own equivalent 1-bar-per-slot arrangement so
        // old songs still play back the same way until edited further.
        const chain = saved.songChain as number[];
        ARRANGE_TRACKS.forEach((track) => {
          arrangement[track] = chain.map((scene, i) => createArrangeBlock(Math.max(0, Math.min(SCENES - 1, Number(scene) || 0)), i));
        });
      }
      if (saved.songLoop && typeof saved.songLoop === "object") {
        const incoming = saved.songLoop as Partial<typeof songLoop>;
        songLoop.on = !!incoming.on;
        if (typeof incoming.startBar === "number") songLoop.startBar = Math.max(0, incoming.startBar);
        if (typeof incoming.endBar === "number") songLoop.endBar = Math.max(songLoop.startBar + 1, incoming.endBar);
      }
      if (typeof saved.songMode === "boolean") transport.songMode = saved.songMode;
      if (typeof saved.quantizeGrid === "number" && [0, 4, 8, 16, 32, 64].includes(saved.quantizeGrid)) transport.quantizeGrid = saved.quantizeGrid;
      if (typeof saved.metroVolume === "number") transport.metroVolume = Math.max(0, Math.min(1, saved.metroVolume));
      if (saved.sampleParams) (saved.sampleParams as Partial<SamplerP>[]).forEach((p, i) => { if (i < PAD_COUNT) Object.assign(sampleParams[i], p); });
      if (saved.samplePool && saved.sampleRefs) {
        const pool = saved.samplePool as string[], refs = saved.sampleRefs as number[];
        refs.forEach((ref, i) => { if (i < PAD_COUNT) sampleData[i] = ref >= 0 ? pool[ref] ?? null : null; });
      } else if (saved.sampleData) {
        (saved.sampleData as Array<string | null>).forEach((v, i) => { if (i < PAD_COUNT) sampleData[i] = v; });
      }
      if (saved.padLayers) (saved.padLayers as PadLayer[][]).forEach((ls, i) => {
        if (i >= PAD_COUNT || !Array.isArray(ls)) return;
        padLayers[i] = ls.slice(0, PAD_LAYER_MAX).map((l) => ({
          data: l.data ?? null, name: l.name ?? "", tune: Number(l.tune) || 0, gain: Number(l.gain) || 1,
          velLo: Math.max(0, Math.min(127, Number(l.velLo) || 0)), velHi: Math.max(0, Math.min(127, Number(l.velHi ?? 127))),
        }));
        padLayerBuffers[i] = padLayers[i].map(() => null);
        padLayers[i].forEach((l, j) => { if (l.data) void hydratePadLayer(i, j); });
      });
      if (saved.padLayerMode) (saved.padLayerMode as PadLayerMode[]).forEach((m, i) => {
        if (i < PAD_COUNT && ["velocity", "roundrobin", "random", "layered"].includes(m)) padLayerMode[i] = m;
      });
      if (saved.fx) Object.assign(fx, saved.fx as object);
      if (saved.padEvents) (saved.padEvents as PadEvent[][]).forEach((events, i) => {
        if (i < SCENES) padEvents[i] = events.map((event) => ({ ...event }));
      });
      if (saved.mpc) Object.assign(mpc, saved.mpc as object);
      if (saved.rackState) {
        const incoming = saved.rackState as Partial<RackState>;
        Object.assign(rackState, incoming);
        rackState.devices = { ...rackState.devices, ...(incoming.devices ?? {}) };
      }
    } else if (Array.isArray(saved) && saved.length === 8) {
      for (let r = 0; r < 8; r++) for (let c = 0; c < STEPS; c++) allPats[0][r][c] = !!saved[r][c];
    }
  } catch { /* ignore */ }
}
export function pendingProjectStore(mode: "get" | "put", value?: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vishamp", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("projects");
    request.onblocked = () => reject(new Error("Project storage is blocked"));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("projects", "readwrite"), store = tx.objectStore("projects");
      if (mode === "put") store.put(value, "pending");
      else {
        const get = store.get("pending");
        get.onsuccess = () => {
          const result = (get.result as Record<string, unknown> | undefined) ?? null;
          if (result) store.delete("pending");
          resolve(result);
        };
        get.onerror = () => reject(get.error);
      }
      tx.oncomplete = () => { db.close(); if (mode === "put") resolve(null); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    };
  });
}
