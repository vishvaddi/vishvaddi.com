// Mixer strip — channel levels only; device parameters live in the rack.
// Extracted verbatim from index.ts (Phase 0 split).
import { DRUMS, mute, solo } from "./state";
import { ac, ensureNodes, trackGain } from "./engine";
import * as engine from "./engine";
import { el, btn } from "./helpers";

function mixChannel(name: string, val: number, on: (v: number) => void, idx: number): HTMLElement {
  const ch = el("div", "wa-ch");
  const inp = document.createElement("input");
  inp.type = "range"; inp.min = "0"; inp.max = "1"; inp.step = "0.01"; inp.value = String(val); inp.className = "wa-fader";
  inp.addEventListener("input", () => on(Number(inp.value))); ch.append(inp);
  if (idx >= 0) {
    const ms = el("div", "wa-ms");
    const m = btn("M", "wa-mute"); m.classList.remove("wa-btn");
    m.addEventListener("click", () => { mute[idx] = !mute[idx]; m.classList.toggle("active", mute[idx]); });
    const s = btn("S", "wa-solo"); s.classList.remove("wa-btn");
    s.addEventListener("click", () => { solo[idx] = !solo[idx]; s.classList.toggle("active", solo[idx]); });
    ms.append(m, s); ch.append(ms);
  }
  ch.append(el("span", "wa-ch-name", name)); return ch;
}

export function buildMixer(): HTMLElement {
  const mixer = el("div", "wa-panel");
  const mixGrid = el("div", "wa-mixer");
  DRUMS.forEach((name, i) => mixGrid.append(mixChannel(name, 0.8, (v) => { ensureNodes(); trackGain[i].gain.value = v; }, i)));
  mixGrid.append(mixChannel("Synth", 0.7, (v) => { ensureNodes(); engine.synthGain!.gain.value = v; }, -1));
  mixGrid.append(mixChannel("MASTER", 0.8, (v) => { ac(); engine.master!.gain.value = v; }, -1));
  mixer.append(mixGrid);
  return mixer;
}
