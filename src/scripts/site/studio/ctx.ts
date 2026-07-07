// Shared studio context — breaks the circular imports between UI modules.
// Every field is registered during initStudio() before the first user
// interaction, so call-time lookups are always safe. Build-time DOM refs are
// passed as builder arguments instead; only cross-module *call-time* hooks
// live here.

export interface StudioCtx {
  // Repaints — registered by the module that owns the DOM, callable by anyone.
  paintSession(): void;
  paintRoll(): void;
  paintEventLane(): void;
  paintMpcPads(): void;
  selectScene(scene: number): void;
  refreshVisibleState(): void;
  selectTrack(track: "drums" | "pads" | "synth"): void;
  currentTrack(): "drums" | "pads" | "synth";
  // Undo (owned by shell).
  checkpoint(): void;
  // Shared widgets (owned by shell).
  showVelocityPopup(value: number, x: number, y: number, apply: (v: number) => void): void;
  setCellOpacity(cell: HTMLElement, v: number): void;
  setBpm(v: number): void;
  // Playback status (owned by playback).
  isPlaying(): boolean;
  currentSchedStep(): number;
  lastHighlightedStep(): number;
  lastStepStartedMs(): number;
  onStep?(step: number): void;
  // Transport / export elements other modules poke at call time.
  launchStatus: HTMLElement;
  songBtn: HTMLButtonElement;
  renderSel: HTMLSelectElement;
  renderBuffer(mode: "pattern" | "song"): Promise<AudioBuffer>;
  // Chop editor's loaded break (scratch platter falls back to it).
  chopBuffer(): AudioBuffer | null;
}

export const ctx = {} as StudioCtx;
