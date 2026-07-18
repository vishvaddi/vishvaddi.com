// Shared studio context — the Phase-0 answer to the monolith's closure web.
// index.ts assigns every field during init, in section order; extracted
// modules only READ fields inside event handlers / repaints, which all run
// post-init, so late assignment is safe (same used-before-declared pattern
// the original closures relied on). Grown field-by-field as sections move out.
import { STEPS, transport } from "./state";

export interface StudioCtx {
  checkpoint: () => void
  selectScene: (scene: number) => void
  isPlaying: () => boolean
  paintSession: () => void
  setBpm: (v: number) => void
  songBtn: HTMLButtonElement
  renderSel: HTMLSelectElement
}

export const ctx = {} as StudioCtx

// Live playhead state — written by the scheduler (still in index.ts until
// playback.ts lands), read by pad/synth recording to place captured events.
export const playhead = { playing: false, schStep: 0, lastHi: -1, lastStepStartedMs: 0 };

// Populated by the drum grid, pad-event grid and piano roll as they build
// themselves; re-run whenever the Grid selector changes so all three
// repaint their "wa-beat" line grouping to match.
export const gridRepainters: Array<() => void> = [];
// Grid 0 = Off (no snapping); the step grids still shade quarters for reading.
export function stepsPerGridLine(): number { return transport.quantizeGrid ? STEPS / transport.quantizeGrid : 4; }
export function isGridLine(step: number): boolean { return step % stepsPerGridLine() === 0; }

// One color per scene (A-H), distinct from the accent/amber/blue already
// used for state (playing/queued/selected) — identity, not status.
export const SCENE_COLORS = ["#ff6b8a", "#b98bff", "#ffe066", "#5fd9d9", "#ff8c5a", "#7c8cff", "#b4e66e", "#ff6bd6"];
