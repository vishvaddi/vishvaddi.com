// Modular device rack — combinator macros, groove player + euclidean writer,
// EQ / compressor / delay / reverb / limiter device cards. Extracted verbatim
// from index.ts (Phase 0 split). (Combinator deletion is a Phase 2 item —
// kept as-is here.)
import { clip, mpc, rackState, fx, sampleParams, padEvents, patternLengths } from "./state";
import { ensureNodes, applyFxState, initReverb, initDelay, refreshSpaceSize } from "./engine";
import { saveAll } from "./persistence";
import { el, btn, help, sliderRow, euclideanPattern } from "./helpers";

export function buildDeviceRack(deps: { paintEventLane: () => void }): HTMLElement {
  const devicePanel = el("div", "wa-panel");
  let refreshTabs = (): void => {};   // assigned once the device tab list exists (D3)
  const fxSlider = (label: string, min: number, max: number, value: number, step: number, apply: (v: number) => void) =>
    sliderRow(label, min, max, value, step, (v) => { ensureNodes(); apply(v); applyFxState(); saveAll(); });
  const deviceHeader = (key: string, label: string): HTMLElement => {
    const header = el("div", "wa-device-header");
    const bypass = btn(rackState.devices[key] ? "ON" : "BYPASS", "wa-toggle wa-btn-sm");
    bypass.classList.toggle("active", rackState.devices[key]);
    bypass.addEventListener("click", () => {
      rackState.devices[key] = !rackState.devices[key];
      bypass.textContent = rackState.devices[key] ? "ON" : "BYPASS"; bypass.classList.toggle("active", rackState.devices[key]);
      applyFxState(); saveAll(); refreshTabs();
    });
    header.append(el("span", "wa-device-title", label), bypass);
    return header;
  };
  const combinator = el("div", "wa-combinator");
  combinator.append(el("div", "wa-fx-title", "COMBINATOR MACROS"));
  const applyMacro = (index: number, value: number) => {
    rackState.macros[index] = value;
    if (index === 0) {
      fx.compThreshold = -8 - value * 32; fx.compRatio = 2 + value * 10; fx.high = value * 5;
    } else if (index === 1) {
      fx.reverb = value * 0.5; fx.delayMix = value * 0.35; if (value > 0) { initReverb(fx.reverb); initDelay(); }
    } else if (index === 2) {
      sampleParams.forEach((pad) => { pad.filter = 18000 - value * 16800; });
    } else {
      rackState.grooveTiming = value * 0.7; rackState.grooveRandom = value * 18; rackState.grooveVelocity = value * 0.25;
    }
    applyFxState(); saveAll();
  };
  ["Dirt", "Space", "Cutoff", "Break"].forEach((name, i) => {
    combinator.append(sliderRow(name, 0, 1, rackState.macros[i], 0.01, (value) => applyMacro(i, value)));
  });
  const patchRow = el("div", "wa-export");
  const patchSelect = document.createElement("select");
  ["Clean MPC", "Dusty Hip Hop", "Jungle Pressure", "Dub Space"].forEach((name) => {
    const option = document.createElement("option"); option.value = name; option.textContent = name; patchSelect.append(option);
  });
  const loadPatchBtn = btn("Load patch", "wa-btn-sm");
  help(loadPatchBtn, "Apply a complete macro and effects preset.");
  loadPatchBtn.addEventListener("click", () => {
    const presets: Record<string, number[]> = {
      "Clean MPC": [0.05, 0, 0, 0.1],
      "Dusty Hip Hop": [0.55, 0.12, 0.18, 0.45],
      "Jungle Pressure": [0.72, 0.28, 0.08, 0.82],
      "Dub Space": [0.2, 0.9, 0.35, 0.35],
    };
    presets[patchSelect.value].forEach((value, i) => applyMacro(i, value));
    location.reload();
  });
  patchRow.append(patchSelect, loadPatchBtn); combinator.append(patchRow);

  const playerRack = el("div", "wa-device");
  const euclidControls = el("div", "wa-export");
  const euclidPulses = document.createElement("input"); euclidPulses.type = "number"; euclidPulses.min = "1"; euclidPulses.max = "32"; euclidPulses.value = "7";
  const euclidRotate = document.createElement("input"); euclidRotate.type = "number"; euclidRotate.min = "0"; euclidRotate.max = "31"; euclidRotate.value = "0";
  const euclidBtn = btn("Write Euclidean", "wa-btn-sm");
  help(euclidBtn, "Distribute a chosen number of hits evenly across the 16-step pattern.");
  euclidBtn.addEventListener("click", () => {
    const pattern = euclideanPattern(patternLengths[clip.sel], Number(euclidPulses.value), Number(euclidRotate.value)), pad = mpc.selectedPad;
    padEvents[clip.sel] = padEvents[clip.sel].filter((event) => event.pad !== pad);
    pattern.forEach((on, step) => { if (on) padEvents[clip.sel].push({ pad, step, velocity: step % 4 === 0 ? 115 : 86, offset: 0, probability: 100, ratchets: 1 }); });
    deps.paintEventLane(); saveAll();
  });
  euclidControls.append(el("span", "wa-lbl", "Pulses"), euclidPulses, el("span", "wa-lbl", "Rotate"), euclidRotate, euclidBtn);
  playerRack.append(
    deviceHeader("player", "PLAYER · GROOVE + GLITCH"),
    sliderRow("Timing", 0, 0.75, rackState.grooveTiming, 0.01, (v) => { rackState.grooveTiming = v; saveAll(); }),
    sliderRow("Velocity", 0, 0.5, rackState.grooveVelocity, 0.01, (v) => { rackState.grooveVelocity = v; saveAll(); }),
    sliderRow("Random", 0, 40, rackState.grooveRandom, 1, (v) => { rackState.grooveRandom = v; saveAll(); }),
    sliderRow("Glitch", 0, 100, rackState.glitch, 1, (v) => { rackState.glitch = v; saveAll(); }),
    sliderRow("Echoes", 0, 8, rackState.noteEcho, 1, (v) => { rackState.noteEcho = v; saveAll(); }),
    sliderRow("Echo decay", 0.1, 0.95, rackState.echoDecay, 0.01, (v) => { rackState.echoDecay = v; saveAll(); }),
    euclidControls,
  );
  const eqDevice = el("div", "wa-device");
  eqDevice.append(
    deviceHeader("eq", "CHANNEL EQ · low / mid / high"),
    fxSlider("LOW", -12, 12, fx.low, 0.5, (v) => { fx.low = v; }),
    fxSlider("MID", -12, 12, fx.mid, 0.5, (v) => { fx.mid = v; }),
    fxSlider("HIGH", -12, 12, fx.high, 0.5, (v) => { fx.high = v; }),
  );
  const compDevice = el("div", "wa-device");
  compDevice.append(
    deviceHeader("compressor", "BUS COMPRESSOR"),
    fxSlider("THRESH", -50, 0, fx.compThreshold, 1, (v) => { fx.compThreshold = v; }),
    fxSlider("RATIO", 1, 20, fx.compRatio, 0.5, (v) => { fx.compRatio = v; }),
  );
  const driveDevice = el("div", "wa-device");
  driveDevice.append(
    deviceHeader("drive", "DRIVE · master saturation"),
    fxSlider("AMT", 0, 1, fx.drive ?? 0, 0.01, (v) => { fx.drive = v; }),
  );
  const delayDevice = el("div", "wa-device");
  delayDevice.append(
    deviceHeader("delay", "TAPE ECHO · damped feedback return"),
    fxSlider("TIME", 0.05, 1, fx.delayTime, 0.01, (v) => { fx.delayTime = v; }),
    fxSlider("REGEN", 0, 0.85, fx.delayFeedback, 0.01, (v) => { fx.delayFeedback = v; }),
    fxSlider("MIX", 0, 0.6, fx.delayMix, 0.02, (v) => { fx.delayMix = v; }),
    fxSlider("TONE", 600, 8000, fx.echoDamp ?? 2200, 50, (v) => { fx.echoDamp = v; }),
    fxSlider("WOW", 0, 1, fx.echoWow ?? 0.25, 0.01, (v) => { fx.echoWow = v; }),
  );
  const reverbDevice = el("div", "wa-device");
  reverbDevice.append(
    deviceHeader("reverb", "SPACE · convolution return"),
    fxSlider("MIX", 0, 0.6, fx.reverb, 0.02, (v) => { fx.reverb = v; initReverb(v); }),
    fxSlider("SIZE", 0.4, 5, fx.spaceSize ?? 2.2, 0.1, (v) => { fx.spaceSize = v; refreshSpaceSize(); }),
  );
  const limiterDevice = el("div", "wa-device");
  limiterDevice.append(
    deviceHeader("limiter", "MASTER LIMITER"),
    fxSlider("CEILING", -12, 0, fx.limiter, 0.5, (v) => { fx.limiter = v; }),
  );
  // ── Device browser (D3): side tab per device, one detail pane ──
  const sections: Array<{ id: string; key: string | null; label: string; elx: HTMLElement }> = [
    { id: "macros", key: null, label: "MACROS", elx: combinator },
    { id: "player", key: "player", label: "PLAYER", elx: playerRack },
    { id: "drive", key: "drive", label: "DRIVE", elx: driveDevice },
    { id: "eq", key: "eq", label: "CHANNEL EQ", elx: eqDevice },
    { id: "compressor", key: "compressor", label: "COMPRESSOR", elx: compDevice },
    { id: "delay", key: "delay", label: "TAPE ECHO", elx: delayDevice },
    { id: "reverb", key: "reverb", label: "SPACE", elx: reverbDevice },
    { id: "limiter", key: "limiter", label: "LIMITER", elx: limiterDevice },
  ];
  const browser = el("div", "wa-devbrowser");
  const tabList = el("div", "wa-devtabs");
  const detail = el("div", "wa-devdetail");
  const tabs: HTMLButtonElement[] = [];
  let sel = localStorage.getItem("vv_studio_device") || "eq";
  if (!sections.some((s) => s.id === sel)) sel = "eq";
  const paintTabs = (): void => {
    tabs.forEach((tab, i) => {
      const s = sections[i];
      tab.classList.toggle("active", s.id === sel);
      const led = tab.querySelector(".wa-modekey-led");
      if (led && s.key) led.classList.toggle("lit", !!rackState.devices[s.key]);
    });
    sections.forEach((s) => { s.elx.style.display = s.id === sel ? "" : "none"; });
  };
  refreshTabs = paintTabs;
  sections.forEach((s) => {
    const tab = el("button", "wa-devtab") as HTMLButtonElement;
    tab.type = "button";
    tab.append(el("span", "wa-modekey-led" + (s.key ? "" : " wa-led-none")), document.createTextNode(s.label));
    help(tab, s.key ? `Show the ${s.label.toLowerCase()} — the dot lights when it's in the chain.` : "Combinator macros — four knobs that drive whole groups of parameters.");
    tab.addEventListener("click", () => { sel = s.id; localStorage.setItem("vv_studio_device", sel); paintTabs(); });
    tabs.push(tab); tabList.append(tab);
    detail.append(s.elx);
  });
  browser.append(tabList, detail);
  paintTabs();
  devicePanel.append(
    el("p", "wa-help", "Signal flow: Player → MPC Program → DRIVE → EQ → compressor → parallel TAPE ECHO / SPACE → LIMITER."),
    browser,
  );

  return devicePanel;
}
