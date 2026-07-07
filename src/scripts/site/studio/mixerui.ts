import { DRUMS, clip, padEvents, mpc, rackState, mixerState, fx } from "./state";
import { ensureNodes, initReverb, initDelay, applyFxState, applyMixerState } from "./engine";
import { saveAll } from "./persistence";
import { el, btn, help, euclideanPattern } from "./helpers";
import { ctx } from "./ctx";
import { knob } from "./knob";

function mixChannel(name: string, index: number): HTMLElement {
  const state = mixerState.channels[index];
  const channel = el("div", "wa-ch");
  const fader = document.createElement("input");
  fader.type = "range"; fader.min = "0"; fader.max = "1"; fader.step = "0.01"; fader.value = String(state.gain); fader.className = "wa-fader";
  fader.addEventListener("input", () => { state.gain = Number(fader.value); ensureNodes(); applyMixerState(); saveAll(); });
  channel.append(knob({ label: "Pan", min: -1, max: 1, value: state.pan, step: 0.01, def: 0, fmt: (v) => v === 0 ? "C" : `${v < 0 ? "L" : "R"}${Math.round(Math.abs(v) * 100)}`, onInput: (v) => { state.pan = v; ensureNodes(); applyMixerState(); saveAll(); } }).el, fader);
  const controls = el("div", "wa-ms");
  const muteButton = btn("M", "wa-mute"); muteButton.classList.remove("wa-btn");
  const soloButton = btn("S", "wa-solo"); soloButton.classList.remove("wa-btn");
  muteButton.classList.toggle("active", state.mute); soloButton.classList.toggle("active", state.solo);
  muteButton.addEventListener("click", () => { state.mute = !state.mute; muteButton.classList.toggle("active", state.mute); ensureNodes(); applyMixerState(); saveAll(); });
  soloButton.addEventListener("click", () => { state.solo = !state.solo; soloButton.classList.toggle("active", state.solo); ensureNodes(); applyMixerState(); saveAll(); });
  controls.append(muteButton, soloButton); channel.append(controls);
  channel.append(el("span", "wa-ch-name", name));
  return channel;
}

export interface MixerUI { mixer: HTMLElement; devicePanel: HTMLElement }

export function buildMixer(): MixerUI {
  const mixer = el("div", "wa-panel"), mixGrid = el("div", "wa-mixer");
  DRUMS.forEach((name, index) => mixGrid.append(mixChannel(name, index)));
  mixGrid.append(mixChannel("Pads", 8), mixChannel("Synth", 9));
  const masterChannel = el("div", "wa-ch"), masterFader = document.createElement("input"); masterFader.type = "range"; masterFader.min = "0"; masterFader.max = "1"; masterFader.step = "0.01"; masterFader.value = String(mixerState.masterGain); masterFader.className = "wa-fader";
  masterFader.addEventListener("input", () => { mixerState.masterGain = Number(masterFader.value); ensureNodes(); applyMixerState(); saveAll(); }); masterChannel.append(masterFader, el("span", "wa-ch-name", "MASTER")); mixGrid.append(masterChannel);
  const effects = el("div", "wa-effects");
  const fxSlider = (label: string, min: number, max: number, value: number, step: number, apply: (value: number) => void): HTMLElement =>
    knob({ label, min, max, value, step, def: value, onInput: (next) => { ensureNodes(); apply(next); applyFxState(); saveAll(); } }).el;
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
    knob({ label: "Timing", min: 0, max: 0.75, value: rackState.grooveTiming, step: 0.01, def: 0, onInput: (v) => { rackState.grooveTiming = v; saveAll(); } }).el,
    knob({ label: "Velocity", min: 0, max: 0.5, value: rackState.grooveVelocity, step: 0.01, def: 0, onInput: (v) => { rackState.grooveVelocity = v; saveAll(); } }).el,
    knob({ label: "Random", min: 0, max: 40, value: rackState.grooveRandom, step: 1, def: 0, unit: "ms", onInput: (v) => { rackState.grooveRandom = v; saveAll(); } }).el,
    knob({ label: "Echoes", min: 0, max: 8, value: rackState.noteEcho, step: 1, def: 0, onInput: (v) => { rackState.noteEcho = v; saveAll(); } }).el,
    knob({ label: "Echo decay", min: 0.1, max: 0.95, value: rackState.echoDecay, step: 0.01, def: 0.5, onInput: (v) => { rackState.echoDecay = v; saveAll(); } }).el, euclid);
  const stack = el("div", "wa-device-stack");
  [["eq", "CHANNEL EQ · low / mid / high"], ["compressor", "BUS COMPRESSOR"], ["delay", "FEEDBACK DELAY · parallel return"], ["reverb", "CONVOLUTION REVERB · parallel return"], ["limiter", "MASTER LIMITER"]].forEach(([key, label]) => {
    const device = el("div", "wa-device"), header = el("div", "wa-device-header"), bypass = btn(rackState.devices[key] ? "ON" : "BYPASS", "wa-toggle wa-btn-sm");
    bypass.classList.toggle("active", rackState.devices[key]); bypass.addEventListener("click", () => { rackState.devices[key] = !rackState.devices[key]; bypass.textContent = rackState.devices[key] ? "ON" : "BYPASS"; bypass.classList.toggle("active", rackState.devices[key]); applyFxState(); saveAll(); });
    header.append(el("span", "wa-device-title", label), bypass); device.append(header); stack.append(device);
  });
  devicePanel.append(el("p", "wa-help", "Signal flow: Player → MPC Program → character controls → EQ → compressor → parallel delay/reverb → limiter."), player, stack);
  return { mixer, devicePanel };
}
