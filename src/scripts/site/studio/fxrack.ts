// Modular device rack — combinator macros, groove player + euclidean writer,
// EQ / compressor / delay / reverb / limiter device cards. Extracted verbatim
// from index.ts (Phase 0 split). (Combinator deletion is a Phase 2 item —
// kept as-is here.)
import { clip, mpc, rackState, fx, sampleParams, padEvents, patternLengths, mixState, transport } from "./state";
import { ensureNodes, applyFxState, initReverb, initDelay, refreshSpaceSize, refreshSpace, setEchoRoll, setSpaceIr, masterReduction } from "./engine";
import { loudness } from "../audio/dsp";
import { saveAll } from "./persistence";
import { ctx } from "./ctx";
import { el, btn, help, sliderRow, euclideanPattern, readAsDataUrl } from "./helpers";
import { knob } from "./knob";

export function buildDeviceRack(deps: { paintEventLane: () => void }): HTMLElement {
  const devicePanel = el("div", "wa-panel");
  let refreshTabs = (): void => {};   // assigned once the device tab list exists (D3)
  const fxSlider = (label: string, min: number, max: number, value: number, step: number, apply: (v: number) => void) =>
    sliderRow(label, min, max, value, step, (v) => { ensureNodes(); apply(v); applyFxState(); saveAll(); });
  const fxSelect = (label: string, options: Array<[string, string]>, value: string, apply: (v: string) => void): HTMLElement => {
    const row = el("div", "wa-export wa-fx-select-row");
    const select = document.createElement("select");
    options.forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; select.append(o); });
    select.value = value;
    select.addEventListener("change", () => { ensureNodes(); apply(select.value); applyFxState(); saveAll(); });
    row.append(el("span", "wa-lbl", label), select);
    return row;
  };
  const fxToggle = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLButtonElement => {
    const button = btn(label, "wa-toggle wa-btn-sm");
    button.classList.toggle("active", get());
    button.addEventListener("click", () => { ensureNodes(); set(!get()); button.classList.toggle("active", get()); applyFxState(); saveAll(); });
    return button;
  };
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
  combinator.append(el("div", "wa-fx-title", "PERFORMANCE MACROS"), el("p", "wa-macro-intro", "Shape the whole mix with the large controls, then tune each mapped parameter underneath."));
  const syncMacroDetails: Array<() => void> = [];
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
    applyFxState(); saveAll(); syncMacroDetails[index]?.();
  };
  const macroGrid = el("div", "wa-macro-grid");
  const macroCopy = [
    "Compression, saturation and high-frequency bite.",
    "Reverb, echo return, room size and regeneration.",
    "Sample filtering and broad low/mid tonal balance.",
    "Timing displacement, velocity drift, randomisation and glitch.",
  ];
  ["Dirt", "Space", "Cutoff", "Break"].forEach((name, i) => {
    const card = el("section", "wa-macro-card"); card.dataset.macro = name.toLowerCase();
    const head = el("div", "wa-macro-head"), main = knob(name, 0, 1, rackState.macros[i], 0.01, (value) => applyMacro(i, value), { fmt: (value) => `${Math.round(value * 100)}%`, reset: 0 });
    main.root.classList.add("wa-macro-main");
    const identity = el("div", "wa-macro-identity"); identity.append(el("strong", "wa-macro-name", name.toUpperCase()), el("span", "wa-macro-copy", macroCopy[i]));
    head.append(main.root, identity);
    const details = el("div", "wa-macro-details"), syncers: Array<() => void> = [];
    const detail = (label: string, min: number, max: number, step: number, get: () => number, set: (value: number) => void, fmt?: (value: number) => string) => {
      const control = knob(label, min, max, get(), step, (value) => { ensureNodes(); set(value); applyFxState(); saveAll(); }, { fmt });
      control.root.classList.add("wa-macro-detail"); details.append(control.root); syncers.push(() => control.set(get()));
    };
    if (i === 0) {
      detail("Drive", 0, 1, .01, () => fx.drive ?? 0, (v) => { fx.drive = v; }, (v) => `${Math.round(v * 100)}%`);
      detail("Threshold", -50, 0, 1, () => fx.compThreshold, (v) => { fx.compThreshold = v; }, (v) => `${Math.round(v)}dB`);
      detail("Ratio", 1, 20, .5, () => fx.compRatio, (v) => { fx.compRatio = v; }, (v) => `${v.toFixed(1)}:1`);
      detail("Air", -12, 12, .5, () => fx.high, (v) => { fx.high = v; }, (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}dB`);
    } else if (i === 1) {
      detail("Reverb", 0, .6, .01, () => fx.reverb, (v) => { fx.reverb = v; initReverb(v); }, (v) => `${Math.round(v * 100)}%`);
      detail("Delay", 0, .6, .01, () => fx.delayMix, (v) => { fx.delayMix = v; initDelay(); }, (v) => `${Math.round(v * 100)}%`);
      detail("Size", .4, 5, .1, () => fx.spaceSize ?? 2.2, (v) => { fx.spaceSize = v; refreshSpaceSize(); }, (v) => `${v.toFixed(1)}s`);
      detail("Regen", 0, .85, .01, () => fx.delayFeedback, (v) => { fx.delayFeedback = v; }, (v) => `${Math.round(v * 100)}%`);
    } else if (i === 2) {
      detail("Pad filter", 200, 18000, 100, () => sampleParams[0]?.filter ?? 18000, (v) => { sampleParams.forEach((pad) => { pad.filter = v; }); }, (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`);
      detail("Low", -12, 12, .5, () => fx.low, (v) => { fx.low = v; }, (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}dB`);
      detail("Mid", -12, 12, .5, () => fx.mid, (v) => { fx.mid = v; }, (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}dB`);
      detail("High", -12, 12, .5, () => fx.high, (v) => { fx.high = v; }, (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}dB`);
    } else {
      detail("Timing", 0, .75, .01, () => rackState.grooveTiming, (v) => { rackState.grooveTiming = v; }, (v) => `${Math.round(v * 100)}%`);
      detail("Velocity", 0, .5, .01, () => rackState.grooveVelocity, (v) => { rackState.grooveVelocity = v; }, (v) => `${Math.round(v * 100)}%`);
      detail("Random", 0, 40, 1, () => rackState.grooveRandom, (v) => { rackState.grooveRandom = v; }, (v) => `${Math.round(v)}%`);
      detail("Glitch", 0, 100, 1, () => rackState.glitch, (v) => { rackState.glitch = v; }, (v) => `${Math.round(v)}%`);
    }
    syncMacroDetails[i] = () => syncers.forEach((sync) => sync());
    card.append(head, details); macroGrid.append(card);
  });
  combinator.append(macroGrid);
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
    ctx.checkpoint();
    presets[patchSelect.value].forEach((value, i) => applyMacro(i, value));
    ctx.refreshVisibleState();
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
    fxSelect("TYPE", [["tube", "TUBE"], ["tape", "TAPE"], ["fuzz", "FUZZ"], ["fold", "WARP"], ["digital", "DIGITAL"]], fx.driveType ?? "tube", (v) => { fx.driveType = v as typeof fx.driveType; }),
    fxSlider("AMT", 0, 1, fx.drive ?? 0, 0.01, (v) => { fx.drive = v; }),
    fxSlider("BODY", 0, 1, fx.driveBody ?? 0, 0.01, (v) => { fx.driveBody = v; }),
  );
  const echoModeRow = el("div", "wa-export");
  const pingPongBtn = fxToggle("PING-PONG", () => !!fx.echoPingPong, (v) => { fx.echoPingPong = v; });
  help(pingPongBtn, "Alternate repeats left and right instead of stacking them in the centre.");
  const rollBtn = btn("ROLL", "wa-btn-sm");
  help(rollBtn, "Hold: the echo feeds back past unity and self-oscillates. Release: back to the REGEN setting.");
  const rollOn = (event: Event) => { event.preventDefault(); ensureNodes(); setEchoRoll(true); rollBtn.classList.add("active"); };
  const rollOff = () => { setEchoRoll(false); rollBtn.classList.remove("active"); };
  rollBtn.addEventListener("pointerdown", rollOn); rollBtn.addEventListener("pointerup", rollOff); rollBtn.addEventListener("pointerleave", rollOff); rollBtn.addEventListener("pointercancel", rollOff);
  echoModeRow.append(pingPongBtn, rollBtn);
  const delayDevice = el("div", "wa-device");
  delayDevice.append(
    deviceHeader("delay", "TAPE ECHO · damped feedback return"),
    fxSlider("TIME", 0.05, 1, fx.delayTime, 0.01, (v) => { fx.delayTime = v; }),
    fxSlider("REGEN", 0, 0.85, fx.delayFeedback, 0.01, (v) => { fx.delayFeedback = v; }),
    fxSlider("MIX", 0, 0.6, fx.delayMix, 0.02, (v) => { fx.delayMix = v; }),
    fxSlider("TONE", 600, 8000, fx.echoDamp ?? 2200, 50, (v) => { fx.echoDamp = v; }),
    fxSlider("WOW", 0, 1, fx.echoWow ?? 0.25, 0.01, (v) => { fx.echoWow = v; }),
    fxSelect("SYNC", [["free", "FREE (TIME)"], ["1/16", "1/16"], ["1/8T", "1/8 T"], ["1/8", "1/8"], ["1/8D", "1/8 D"], ["1/4", "1/4"], ["1/4D", "1/4 D"]], fx.echoSync ?? "free", (v) => { fx.echoSync = v as typeof fx.echoSync; }),
    fxSlider("DUCK", 0, 1, fx.echoDuck ?? 0, 0.01, (v) => { fx.echoDuck = v; }),
    echoModeRow,
  );
  const irRow = el("div", "wa-export");
  const irInput = document.createElement("input"); irInput.type = "file"; irInput.accept = "audio/*,.wav,.aif,.aiff,.flac"; irInput.hidden = true; irInput.dataset.ir = "1";
  const irBtn = btn("Load IR", "wa-btn-sm"), irClearBtn = btn("Clear IR", "wa-btn-sm"), irStatus = el("span", "wa-status", fx.spaceIrName ? `IR: ${fx.spaceIrName}` : "");
  help(irBtn, "Use your own impulse response — any short WAV of a real room, plate or spring — as the SPACE reverb.");
  irBtn.addEventListener("click", () => irInput.click());
  irInput.addEventListener("change", async () => {
    const file = irInput.files?.[0]; if (!file) return;
    if (file.size > 4 * 1024 * 1024) { irStatus.textContent = "IR too large (4 MB max)"; irInput.value = ""; return; }
    try { ensureNodes(); await setSpaceIr(await readAsDataUrl(file), file.name); irStatus.textContent = `IR: ${file.name}`; spaceTypeSelect().value = "file"; applyFxState(); saveAll(); }
    catch { irStatus.textContent = "Could not decode that file"; }
    irInput.value = "";
  });
  irClearBtn.addEventListener("click", () => { void setSpaceIr(null); irStatus.textContent = ""; spaceTypeSelect().value = "hall"; applyFxState(); saveAll(); });
  irRow.append(irBtn, irClearBtn, irInput, irStatus);
  const reverbDevice = el("div", "wa-device");
  const spaceTypeSelect = (): HTMLSelectElement => reverbDevice.querySelector("select") as HTMLSelectElement;
  if (fx.spaceType === "file" && fx.spaceIr) void setSpaceIr(fx.spaceIr, fx.spaceIrName ?? "").catch(() => { irStatus.textContent = "Saved IR could not be decoded"; });
  reverbDevice.append(
    deviceHeader("reverb", "SPACE · convolution return"),
    fxSelect("TYPE", [["hall", "HALL"], ["plate", "PLATE"], ["room", "ROOM"], ["spring", "SPRING"], ["file", "IMPULSE FILE"]], fx.spaceType ?? "hall", (v) => { fx.spaceType = v as typeof fx.spaceType; if (v === "file" && !fx.spaceIr) irStatus.textContent = "Load an impulse response (WAV) below"; refreshSpace(); }),
    fxSlider("MIX", 0, 0.6, fx.reverb, 0.02, (v) => { fx.reverb = v; initReverb(v); }),
    fxSlider("SIZE", 0.4, 5, fx.spaceSize ?? 2.2, 0.1, (v) => { fx.spaceSize = v; refreshSpaceSize(); }),
    fxSlider("TONE", 1500, 16000, fx.spaceTone ?? 9000, 100, (v) => { fx.spaceTone = v; }),
    irRow,
  );
  const limiterRow = el("div", "wa-export");
  const softBtn = fxToggle("SOFT CLIP", () => !!fx.limiterSoft, (v) => { fx.limiterSoft = v; });
  help(softBtn, "Round off anything the limiter lets through with a tanh knee at the ceiling — louder without hard edges.");
  limiterRow.append(softBtn);
  const grMeter = el("div", "wa-gr-meter"), grTrack = el("div", "wa-gr-track"), grFill = el("div", "wa-gr-fill"), grText = el("span", "wa-gr-text", "GR 0.0 dB");
  grTrack.append(grFill); grMeter.append(grTrack, grText);
  const targetRow = el("div", "wa-export");
  const targetSelect = document.createElement("select");
  [["-14", "−14 LUFS · Spotify / YouTube"], ["-16", "−16 LUFS · Apple Music"], ["-9", "−9 LUFS · loud"], ["-7", "−7 LUFS · club"]].forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; targetSelect.append(o); });
  const targetBtn = btn("Master to target", "wa-btn-sm"), targetStatus = el("span", "wa-status");
  help(targetBtn, "Renders the song offline, measures integrated loudness (BS.1770) and moves the master fader to hit the chosen target with the ceiling at −1 dBTP and soft clip on.");
  targetBtn.addEventListener("click", async () => {
    if (!ctx.renderBuffer) { targetStatus.textContent = "Renderer not ready"; return; }
    targetBtn.setAttribute("disabled", "1"); targetStatus.textContent = "Rendering…";
    try {
      const buffer = await ctx.renderBuffer(transport.songMode ? "song" : "pattern");
      const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
      const measured = loudness(channels, buffer.sampleRate).integrated;
      if (!Number.isFinite(measured)) { targetStatus.textContent = "Nothing to measure — add some clips first"; return; }
      const target = Number(targetSelect.value), gainDb = target - measured;
      const nextLevel = Math.max(0.05, Math.min(1, mixState.masterLevel * Math.pow(10, gainDb / 20)));
      const applied = 20 * Math.log10(nextLevel / mixState.masterLevel);
      ctx.checkpoint();
      mixState.masterLevel = nextLevel; fx.limiter = -1; fx.limiterSoft = true; rackState.devices.limiter = true;
      softBtn.classList.add("active"); applyFxState(); saveAll(); ctx.refreshVisibleState();
      targetStatus.textContent = `Was ${measured.toFixed(1)} LUFS — master ${applied >= 0 ? "+" : ""}${applied.toFixed(1)} dB${Math.abs(applied - gainDb) > 0.2 ? ` (fader maxed; ${(gainDb - applied).toFixed(1)} dB short — raise the mix)` : ""}, ceiling −1 dBTP, soft clip on.`;
    } catch { targetStatus.textContent = "Render failed"; }
    finally { targetBtn.removeAttribute("disabled"); }
  });
  targetRow.append(targetSelect, targetBtn, targetStatus);
  const limiterDevice = el("div", "wa-device");
  limiterDevice.append(
    deviceHeader("limiter", "MASTER LIMITER"),
    fxSlider("CEILING", -12, 0, fx.limiter, 0.5, (v) => { fx.limiter = v; }),
    limiterRow,
    grMeter,
    targetRow,
  );
  // Gain-reduction meter: the ladder fills as the limiter works, readout in dB.
  const paintGr = (): void => {
    const gr = Math.min(0, masterReduction());
    grFill.style.width = `${Math.min(100, (-gr / 12) * 100)}%`;
    grText.textContent = `GR ${gr.toFixed(1)} dB`;
    requestAnimationFrame(paintGr);
  };
  requestAnimationFrame(paintGr);
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
  const tabList = el("div", "wa-devtabs wa-subtabs");
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
    const tab = el("button", "wa-devtab wa-subtab") as HTMLButtonElement;
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
