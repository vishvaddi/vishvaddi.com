import { DRUMS, clip, padEvents, mpc, rackState, fx, mute, solo } from "./state";
import { ensureNodes, trackGain, initReverb, initDelay, applyFxState } from "./engine";
import * as engine from "./engine";
import { saveAll } from "./persistence";
import { el, btn, help, sliderRow, euclideanPattern } from "./helpers";
import { ctx } from "./ctx";

function mixChannel(name: string, value: number, onInput: (value: number) => void, index: number): HTMLElement {
  const channel = el("div", "wa-ch");
  const fader = document.createElement("input");
  fader.type = "range"; fader.min = "0"; fader.max = "1"; fader.step = "0.01"; fader.value = String(value); fader.className = "wa-fader";
  fader.addEventListener("input", () => onInput(Number(fader.value)));
  channel.append(fader);
  if (index >= 0) {
    const controls = el("div", "wa-ms");
    const muteButton = btn("M", "wa-mute"); muteButton.classList.remove("wa-btn");
    const soloButton = btn("S", "wa-solo"); soloButton.classList.remove("wa-btn");
    muteButton.classList.toggle("active", mute[index]); soloButton.classList.toggle("active", solo[index]);
    muteButton.addEventListener("click", () => { mute[index] = !mute[index]; muteButton.classList.toggle("active", mute[index]); saveAll(); });
    soloButton.addEventListener("click", () => { solo[index] = !solo[index]; soloButton.classList.toggle("active", solo[index]); saveAll(); });
    controls.append(muteButton, soloButton); channel.append(controls);
  }
  channel.append(el("span", "wa-ch-name", name));
  return channel;
}

export interface MixerUI { mixer: HTMLElement; devicePanel: HTMLElement }

export function buildMixer(): MixerUI {
  const mixer = el("div", "wa-panel"), mixGrid = el("div", "wa-mixer");
  DRUMS.forEach((name, index) => mixGrid.append(mixChannel(name, 0.8, (value) => { ensureNodes(); trackGain[index].gain.value = value; }, index)));
  mixGrid.append(mixChannel("Synth", 0.7, (value) => { ensureNodes(); engine.synthGain!.gain.value = value; }, -1));
  mixGrid.append(mixChannel("MASTER", 0.8, (value) => { ensureNodes(); engine.master!.gain.value = value; }, -1));
  const effects = el("div", "wa-effects");
  const fxSlider = (label: string, min: number, max: number, value: number, step: number, apply: (value: number) => void): HTMLElement =>
    sliderRow(label, min, max, value, step, (next) => { ensureNodes(); apply(next); applyFxState(); saveAll(); });
  effects.append(el("div", "wa-fx-title", "MASTER EFFECTS"),
    fxSlider("EQ LOW", -12, 12, fx.low, 0.5, (v) => { fx.low = v; }),
    fxSlider("EQ MID", -12, 12, fx.mid, 0.5, (v) => { fx.mid = v; }),
    fxSlider("EQ HIGH", -12, 12, fx.high, 0.5, (v) => { fx.high = v; }),
    fxSlider("COMP THRESH", -50, 0, fx.compThreshold, 1, (v) => { fx.compThreshold = v; }),
    fxSlider("COMP RATIO", 1, 20, fx.compRatio, 0.5, (v) => { fx.compRatio = v; }),
    fxSlider("LIMIT", -12, 0, fx.limiter, 0.5, (v) => { fx.limiter = v; }),
    fxSlider("REVERB", 0, 0.6, fx.reverb, 0.02, (v) => { fx.reverb = v; initReverb(v); }),
    fxSlider("DELAY TIME", 0.05, 1, fx.delayTime, 0.01, (v) => { fx.delayTime = v; initDelay(); }),
    fxSlider("DELAY FDBK", 0, 0.85, fx.delayFeedback, 0.01, (v) => { fx.delayFeedback = v; initDelay(); }),
    fxSlider("DELAY MIX", 0, 0.6, fx.delayMix, 0.02, (v) => { fx.delayMix = v; initDelay(); }));
  mixer.append(mixGrid, effects);

  const devicePanel = el("div", "wa-panel"), player = el("div", "wa-device");
  const euclid = el("div", "wa-export");
  const pulses = document.createElement("input"), rotate = document.createElement("input"), write = btn("Write Euclidean", "wa-btn-sm");
  pulses.type = rotate.type = "number"; pulses.min = "1"; pulses.max = "16"; pulses.value = "7"; rotate.min = "0"; rotate.max = "15"; rotate.value = "0";
  help(write, "Distribute hits evenly across the 16-step pattern.");
  write.addEventListener("click", () => { ctx.checkpoint(); const pattern = euclideanPattern(16, Number(pulses.value), Number(rotate.value)), pad = mpc.selectedPad; padEvents[clip.sel] = padEvents[clip.sel].filter((event) => event.pad !== pad); pattern.forEach((on, step) => { if (on) padEvents[clip.sel].push({ pad, step, velocity: step % 4 === 0 ? 115 : 86, offset: 0, probability: 100, ratchets: 1 }); }); ctx.paintEventLane(); saveAll(); });
  euclid.append(el("span", "wa-lbl", "Pulses"), pulses, el("span", "wa-lbl", "Rotate"), rotate, write);
  player.append(el("div", "wa-device-title", "PLAYER · GROOVE + NOTE ECHO"),
    sliderRow("Timing", 0, 0.75, rackState.grooveTiming, 0.01, (v) => { rackState.grooveTiming = v; saveAll(); }),
    sliderRow("Velocity", 0, 0.5, rackState.grooveVelocity, 0.01, (v) => { rackState.grooveVelocity = v; saveAll(); }),
    sliderRow("Random", 0, 40, rackState.grooveRandom, 1, (v) => { rackState.grooveRandom = v; saveAll(); }),
    sliderRow("Echoes", 0, 8, rackState.noteEcho, 1, (v) => { rackState.noteEcho = v; saveAll(); }),
    sliderRow("Echo decay", 0.1, 0.95, rackState.echoDecay, 0.01, (v) => { rackState.echoDecay = v; saveAll(); }), euclid);
  const stack = el("div", "wa-device-stack");
  [["sampler", "MPC PROGRAM · 64 pads / slices"], ["character", "CHARACTER · macros / sampler colour"], ["eq", "CHANNEL EQ · low / mid / high"], ["compressor", "BUS COMPRESSOR"], ["delay", "FEEDBACK DELAY · parallel return"], ["reverb", "CONVOLUTION REVERB · parallel return"], ["limiter", "MASTER LIMITER"]].forEach(([key, label]) => {
    const device = el("div", "wa-device"), header = el("div", "wa-device-header"), bypass = btn(rackState.devices[key] ? "ON" : "BYPASS", "wa-toggle wa-btn-sm");
    bypass.classList.toggle("active", rackState.devices[key]); bypass.addEventListener("click", () => { rackState.devices[key] = !rackState.devices[key]; bypass.textContent = rackState.devices[key] ? "ON" : "BYPASS"; bypass.classList.toggle("active", rackState.devices[key]); applyFxState(); saveAll(); });
    header.append(el("span", "wa-device-title", label), bypass); device.append(header); stack.append(device);
  });
  devicePanel.append(el("p", "wa-help", "Signal flow: Player → MPC Program → character controls → EQ → compressor → parallel delay/reverb → limiter."), player, stack);
  return { mixer, devicePanel };
}
