// Project persistence: localStorage autosave, project file schema (v6 adds
// note-based synth clips + the VV-1 patch; v5 session clips and v4 single-
// pattern projects still load), undo history.

import {
  SCENES, STEPS, SONG_SLOTS, PAD_COUNT, PIANO_NOTES, TRACKS, clip, transport,
  allPats, allVels, synthNotes, padEvents, songChain, sampleParams, sampleData, sampleBuffers,
  dp, mpc, rackState, fx, vsynthPatch,
} from "./state";
import type { HistoryState, PadEvent, SamplerP, DrumP, RackState, TrackId, VNote } from "./state";
import type { VPatch } from "./vsynth";
import { applyFxState, hydrateSample } from "./engine";

export function saveAll(): void {
  try {
    localStorage.setItem("vv_studio_v2", JSON.stringify(projectState(false)));
    window.dispatchEvent(new CustomEvent("vv-studio-saved"));
  } catch { /* ignore */ }
}
export function historyState(): HistoryState {
  return {
    pats: allPats.map((pattern) => pattern.map((row) => [...row])),
    vels: allVels.map((pattern) => pattern.map((row) => [...row])),
    synthNotes: synthNotes.map((notes) => notes.map((note) => ({ ...note }))),
    padEvents: padEvents.map((events) => events.map((event) => ({ ...event }))),
    sampleParams: sampleParams.map((params) => ({ ...params })),
    sampleData: [...sampleData],
    songChain: [...songChain],
    fx: { ...fx },
    rackState: { ...rackState, macros: [...rackState.macros], devices: { ...rackState.devices } },
  };
}
export function restoreHistory(state: HistoryState): void {
  state.pats.forEach((pattern, pi) => pattern.forEach((row, ri) => row.forEach((value, step) => { allPats[pi][ri][step] = value; })));
  state.vels.forEach((pattern, pi) => pattern.forEach((row, ri) => row.forEach((value, step) => { allVels[pi][ri][step] = value; })));
  state.synthNotes.forEach((notes, i) => { synthNotes[i] = notes.map((note) => ({ ...note })); });
  state.padEvents.forEach((events, i) => { padEvents[i] = events.map((event) => ({ ...event })); });
  state.sampleParams.forEach((params, i) => Object.assign(sampleParams[i], params));
  state.sampleData.forEach((data, i) => { sampleData[i] = data; sampleBuffers[i] = null; if (data) void hydrateSample(i); });
  state.songChain.forEach((pattern, i) => { songChain[i] = pattern; });
  Object.assign(fx, state.fx);
  Object.assign(rackState, state.rackState);
  rackState.macros = [...state.rackState.macros]; rackState.devices = { ...state.rackState.devices };
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
    version: 6,
    pats: allPats.map((p) => p.map((r) => r.map((b) => (b ? 1 : 0)))),
    vels: allVels,
    dp,
    bpm: transport.bpm,
    clipSel: clip.sel,
    clipPlay: clip.play,
    synthNotes,
    vsynth: vsynthPatch,
    songChain,
    songMode: transport.songMode,
    sampleParams,
    samplePool,
    sampleRefs,
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
            .map((n) => ({ note: n.note, step: n.step % STEPS, len: Math.max(1, Math.min(STEPS, n.len || 1)), vel: Math.max(1, Math.min(127, n.vel || 100)) }));
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
      if (saved.songChain) (saved.songChain as number[]).forEach((v, i) => {
        if (i < SONG_SLOTS) songChain[i] = Math.max(0, Math.min(SCENES - 1, Number(v) || 0));
      });
      if (typeof saved.songMode === "boolean") transport.songMode = saved.songMode;
      if (saved.sampleParams) (saved.sampleParams as Partial<SamplerP>[]).forEach((p, i) => { if (i < PAD_COUNT) Object.assign(sampleParams[i], p); });
      if (saved.samplePool && saved.sampleRefs) {
        const pool = saved.samplePool as string[], refs = saved.sampleRefs as number[];
        refs.forEach((ref, i) => { if (i < PAD_COUNT) sampleData[i] = ref >= 0 ? pool[ref] ?? null : null; });
      } else if (saved.sampleData) {
        (saved.sampleData as Array<string | null>).forEach((v, i) => { if (i < PAD_COUNT) sampleData[i] = v; });
      }
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
