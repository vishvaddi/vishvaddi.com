// Global keyboard maps — space/undo shortcuts, MPC pad keys (DRUMS/PADS
// modes), two-row DAW note layout with octave shift (KEYS mode). Extracted
// verbatim from index.ts (Phase 0 split); routing follows the active mode.
import { ensureNodes, ac } from "./engine";
import * as engine from "./engine";
import { vsynthPatch, mpc } from "./state";
import { noteToMidi, midiToNote } from "./vsynth";
import { playhead } from "./ctx";
import { highlightKey } from "./keys";
import type { SynthUI } from "./synthui";
import type { ModeId } from "./layout";

export interface KeyboardDeps {
  getActiveMode: () => ModeId;
  padButtons: HTMLButtonElement[];
  triggerPerformancePad: (localPad: number, velocity: number) => void;
  synth: SynthUI;
  playBtn: HTMLElement;
  stopBtn: HTMLElement;
  undoBtn: HTMLElement;
  redoBtn: HTMLElement;
}

export function bindKeyboard(deps: KeyboardDeps): void {
  // Global transport/undo shortcuts — skipped while typing in any text
  // field so Space still types a space and Ctrl+Z still edits text natively.
  window.addEventListener("keydown", (ev) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;
    if (ev.code === "Space" && !ev.repeat) { ev.preventDefault(); (playhead.playing ? deps.stopBtn : deps.playBtn).click(); return; }
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey) {
      const key = ev.key.toLowerCase();
      if (key === "z" && !ev.shiftKey) { ev.preventDefault(); deps.undoBtn.click(); }
      else if ((key === "z" && ev.shiftKey) || key === "y") { ev.preventDefault(); deps.redoBtn.click(); }
    }
  });

  // Export + project file logic lives in render.ts (Phase 0 split).

  // ── Keyboard ──
  // Two-row DAW layout (Ableton/FL): Z-row is the lower octave, Q-row the
  // upper — ~2.5 octaves without shifting. - / = still shift for extremes.
  const keyMap: Record<string, string> = {
    z:"C3", s:"C#3", x:"D3", d:"D#3", c:"E3", v:"F3", g:"F#3",
    b:"G3", h:"G#3", n:"A3", j:"A#3", m:"B3",
    q:"C4", "2":"C#4", w:"D4", "3":"D#4", e:"E4", r:"F4", "5":"F#4",
    t:"G4", "6":"G#4", y:"A4", "7":"A#4", u:"B4",
    i:"C5", "9":"C#5", o:"D5", "0":"D#5", p:"E5",
  };
  const padKeyMap: Record<string, number> = {
    "1": 12, "2": 13, "3": 14, "4": 15,
    q: 8, w: 9, e: 10, r: 11,
    a: 4, s: 5, d: 6, f: 7,
    z: 0, x: 1, c: 2, v: 3,
  };
  // Physical key -> the actual (octave-shifted) note it triggered, so keyup
  // releases the right note even if the octave changed while it was held.
  const downMap = new Map<string, string>();
  window.addEventListener("keydown", (ev) => {
    const mode = deps.getActiveMode();
    if (mode === "drums" || mode === "pads") {
      const localPad = padKeyMap[ev.key.toLowerCase()];
      if (localPad != null && !ev.repeat && !ev.metaKey && !ev.ctrlKey) {
        ev.preventDefault(); deps.triggerPerformancePad(localPad, mpc.fullLevel ? 127 : 105); deps.padButtons[localPad].classList.add("down"); return;
      }
    }
    if (mode !== "keys") return;
    const key = ev.key.toLowerCase();
    if (!ev.repeat && !ev.metaKey && !ev.ctrlKey) {
      if (key === "-") { deps.synth.setOctaveShift(deps.synth.getOctaveShift() - 1); return; }
      if (key === "=") { deps.synth.setOctaveShift(deps.synth.getOctaveShift() + 1); return; }
    }
    const n0 = keyMap[key];
    if (!n0 || downMap.has(key) || ev.metaKey || ev.ctrlKey) return;
    const n = midiToNote(noteToMidi(n0) + deps.synth.getOctaveShift() * 12);
    downMap.set(key, n); ensureNodes(); deps.synth.liveKeys.noteOn(ac(), engine.synthGain!, vsynthPatch, n); highlightKey(deps.synth.synthKeys, n0, true);
    deps.synth.recordSynthOn(n);
  });
  window.addEventListener("keyup", (ev) => {
    const localPad = padKeyMap[ev.key.toLowerCase()];
    if (localPad != null) deps.padButtons[localPad].classList.remove("down");
    // Note release is NOT mode-gated: switching modes mid-hold must still
    // release the voice, or the note sticks on forever.
    const key = ev.key.toLowerCase();
    const n = downMap.get(key); if (!n) return;
    downMap.delete(key); deps.synth.liveKeys.noteOff(ac(), n); highlightKey(deps.synth.synthKeys, keyMap[key], false);
    deps.synth.recordSynthOff(n);
  });


}
