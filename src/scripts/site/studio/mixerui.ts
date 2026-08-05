// MIX console — full-height channel strips. Each strip is name plate → pan →
// mute/solo → fader beside a ladder meter (the pair takes the remaining
// height, which is both the tactile payoff and what stops MIX reading as a
// settings page) → dB readout. Device parameters still live in the rack.
import { DRUMS, mute, solo, laneSends } from "./state";
import { ac, ensureNodes, trackGain, setTrackPan, trackMeters, synthMeter, masterAnalyser } from "./engine";
import * as engine from "./engine";
import { saveAll } from "./persistence";
import { el, btn, help } from "./helpers";
import { knob } from "./knob";

const LADDER = 14;   // meter segments

interface Strip { meter: () => AnalyserNode | null; segs: HTMLElement[]; readout: HTMLElement }

function dbLabel(peak: number): string {
  if (peak < 0.0005) return "−∞";
  const db = 20 * Math.log10(peak);
  return `${db > 0 ? "+" : ""}${db.toFixed(1)}`;
}

function mixChannel(
  name: string, val: number, on: (v: number) => void, idx: number,
  meterOf: () => AnalyserNode | null, strips: Strip[],
): HTMLElement {
  const ch = el("div", "wa-ch");
  ch.append(el("span", "wa-ch-name", name));

  if (idx >= 0) {
    const pan = knob("Pan", -1, 1, laneSends[idx]?.pan ?? 0, 0.02, (v) => {
      ensureNodes(); setTrackPan(idx, v); saveAll();
    }, { fmt: (v) => (Math.abs(v) < 0.02 ? "C" : `${v < 0 ? "L" : "R"}${Math.round(Math.abs(v) * 100)}`) });
    pan.root.classList.add("wa-ch-pan");
    ch.append(pan.root);
  }

  if (idx >= 0) {
    const ms = el("div", "wa-ms");
    const m = btn("M", "wa-mute"); m.classList.remove("wa-btn");
    m.addEventListener("click", () => { mute[idx] = !mute[idx]; m.classList.toggle("active", mute[idx]); });
    const s = btn("S", "wa-solo"); s.classList.remove("wa-btn");
    s.addEventListener("click", () => { solo[idx] = !solo[idx]; s.classList.toggle("active", solo[idx]); });
    ms.append(m, s); ch.append(ms);
  }

  // fader + ladder meter share the remaining height
  const well = el("div", "wa-ch-well");
  const inp = document.createElement("input");
  inp.type = "range"; inp.min = "0"; inp.max = "1"; inp.step = "0.01"; inp.value = String(val);
  inp.className = "wa-fader"; inp.setAttribute("aria-label", `${name} level`);
  inp.addEventListener("input", () => on(Number(inp.value)));
  const ladder = el("div", "wa-meter");
  const segs: HTMLElement[] = [];
  for (let i = 0; i < LADDER; i++) {
    const seg = el("div", "wa-meter-seg" + (i < 2 ? " hot" : i < 5 ? " warm" : ""));
    ladder.prepend(seg); segs.push(seg);   // segs[0] is the top segment
  }
  well.append(inp, ladder);
  ch.append(well);

  const readout = el("span", "wa-ch-db", "−∞");
  ch.append(readout);
  strips.push({ meter: meterOf, segs, readout });
  return ch;
}

export function buildMixer(): HTMLElement {
  const mixer = el("div", "wa-panel wa-console");
  const mixGrid = el("div", "wa-mixer");
  const strips: Strip[] = [];
  DRUMS.forEach((name, i) => mixGrid.append(mixChannel(
    name, 0.8, (v) => { ensureNodes(); trackGain[i].gain.value = v; }, i,
    () => trackMeters[i] ?? null, strips,
  )));
  mixGrid.append(mixChannel("Synth", 0.7, (v) => { ensureNodes(); engine.synthGain!.gain.value = v; }, -1, () => synthMeter, strips));
  const master = mixChannel("Master", 0.8, (v) => { ac(); engine.master!.gain.value = v; }, -1, () => masterAnalyser, strips);
  master.classList.add("wa-ch-master");
  mixGrid.append(master);
  help(mixGrid, "Channel levels, pan and metering. Device parameters live in the rack below.");
  mixer.append(mixGrid);

  // One rAF loop drives every ladder — peak per channel, decayed so the
  // meters trickle rather than strobe.
  const peaks = new Float32Array(strips.length);
  const buf = new Uint8Array(256);
  function paintMeters(): void {
    requestAnimationFrame(paintMeters);
    if (!mixer.isConnected || !mixer.offsetParent) return;
    strips.forEach((strip, i) => {
      const an = strip.meter();
      let peak = 0;
      if (an) {
        an.getByteTimeDomainData(buf.subarray(0, an.fftSize));
        for (let s = 0; s < an.fftSize; s += 2) peak = Math.max(peak, Math.abs((buf[s] - 128) / 128));
      }
      peaks[i] = Math.max(peak, peaks[i] * 0.88);
      const lit = Math.round(peaks[i] * LADDER);
      strip.segs.forEach((seg, s) => seg.classList.toggle("lit", LADDER - s <= lit));
      strip.readout.textContent = dbLabel(peaks[i]);
    });
  }
  paintMeters();
  return mixer;
}
