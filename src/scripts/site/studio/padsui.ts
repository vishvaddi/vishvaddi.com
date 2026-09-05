// MPC performance deck + pad event lane — extracted verbatim from index.ts
// (Phase 0 split). Playhead state comes from ctx; the offline renderBuffer is
// injected because render.ts builds it during init.
import { STEPS, PAD_BANK_SIZE, PAD_LAYER_MAX, SCENE_LABELS, clip, stepDur, mpc, rackState, sampleParams, sampleBuffers, sampleData, padEvents, padLayers, padLayerBuffers, padLayerMode, patternLengths } from "./state";
import type { MpcState, PadEvent, PadLayerMode, SamplerP } from "./state";
import { ac, ensureNodes, playPad, hydrateSample, hydratePadLayer, crushBuffer } from "./engine";
import { saveAll } from "./persistence";
import { el, btn, help, sliderRow, stepRuler, readAsDataUrl, blobAsDataUrl, encodeWav } from "./helpers";
import { ctx, playhead, gridRepainters, isGridLine } from "./ctx";
import { showVelocityPopup } from "./velpopup";
import { knob } from "./knob";

export interface PadsUI {
  mpcPanel: HTMLElement;
  padSeqPanel: HTMLElement;
  padButtons: HTMLButtonElement[];
  paintMpcPads: () => void;
  paintEventLane: () => void;
  triggerPerformancePad: (localPad: number, velocity: number) => void;
  // tutorial + layout targets
  padGrid: HTMLElement;
  eventLane: HTMLElement;
  selectedPadLabel: HTMLElement;
  selectedSampleEditor: HTMLElement;
  recordBtn: HTMLButtonElement;
  loadSelectedSample: () => void;
}

export function buildPads(deps: { renderBuffer: (mode: "pattern" | "song") => Promise<AudioBuffer> }): PadsUI {
  const mpcPanel = el("div", "wa-panel wa-mpc-panel");
  mpcPanel.dataset.track = "pads";
  const mpcToolbar = el("div", "wa-mpc-toolbar");
  const padColour = (localPad: number): string => `var(--wa-track-${(localPad % 8) + 1})`;
  const bankButtons: HTMLButtonElement[] = [];
  const padButtons: HTMLButtonElement[] = [];
  const eventCells: HTMLButtonElement[][] = [];
  const eventRows: HTMLElement[] = [];
  const eventRowLabels: HTMLElement[] = [];
  const repeatTimers = new Map<number, number>();
  const performanceStatus = el("span", "wa-status", "Ready");
  // Toggle row: glyph + short label on the face, full name on aria-label,
  // explanation on data-help (help()).
  const iconBtn = (icon: string, short: string, name: string, extra: string): HTMLButtonElement => {
    const button = btn("", extra);
    button.append(el("span", "wa-mpc-ico", icon), el("span", "wa-mpc-ico-lbl", short));
    button.setAttribute("aria-label", name);
    return button;
  };
  const fullLevelBtn = iconBtn("▲", "Full", "Full level", "wa-toggle wa-btn-sm");
  const levelsBtn = iconBtn("▦", "16 Lv", "16 levels", "wa-toggle wa-btn-sm");
  const repeatBtn = iconBtn("⟳", "Repeat", "Note repeat", "wa-toggle wa-btn-sm");
  const recordBtn = iconBtn("●", "Rec", "Record pad events", "wa-toggle wa-btn-sm wa-mpc-rec");
  const overdubBtn = iconBtn("⊕", "Dub", "Overdub", "wa-toggle wa-btn-sm active");
  const undoPassBtn = iconBtn("↶", "Undo", "Undo recording pass", "wa-btn-sm");
  const rotateBtn = iconBtn("↻", "Rotate", "Rotate pattern", "wa-btn-sm"), mutateBtn = iconBtn("⚄", "Mutate", "Mutate pattern", "wa-btn-sm"), fillBtn = iconBtn("▤", "Fill", "Write fill", "wa-btn-sm");
  const ghostBtn = iconBtn("◌", "Ghosts", "Add ghost notes", "wa-btn-sm"), extractGrooveBtn = iconBtn("∿", "Groove", "Extract groove", "wa-btn-sm");
  const resampleBtn = iconBtn("⤓", "Resample", "Resample pattern to pad", "wa-btn-sm");
  const midiBtn = iconBtn("⌘", "MIDI", "Connect Web MIDI", "wa-toggle wa-btn-sm");
  help(fullLevelBtn, "Force every pad hit to maximum velocity.");
  help(levelsBtn, "Map the 16 pads across velocity, pitch, filter cutoff or sample start.");
  help(repeatBtn, "Retrigger a held pad at the division selected beside it.");
  help(recordBtn, "Capture pad hits into the playing pads clip while playback runs.");
  help(overdubBtn, "Keep existing events while recording. Disable it to replace events at recorded steps.");
  help(undoPassBtn, "Remove the most recent pad-recording pass.");
  help(rotateBtn, "Move every pad event one step later.");
  help(mutateBtn, "Create a variation by changing timing, velocity and occasional ratchets.");
  help(fillBtn, "Write a four-step fill for the selected pad at the end of the pattern.");
  help(ghostBtn, "Add low-velocity, probabilistic ghost notes for the selected pad.");
  help(extractGrooveBtn, "Create groove timing and velocity settings from the current pad performance.");
  help(midiBtn, "Connect Web MIDI inputs. Notes starting at MIDI note 36 map across the 16 pads.");
  help(resampleBtn, "Render the playing clips through the mixer and effects onto the selected pad.");
  const resampleQuality = document.createElement("select");
  resampleQuality.setAttribute("aria-label", "Resample quality");
  [["clean", "Clean"], ["12bit", "12-bit"], ["8bit", "8-bit"], ["jungle", "Jungle grit"]].forEach(([value, label]) => {
    const option = document.createElement("option"); option.value = value; option.textContent = label; resampleQuality.append(option);
  });
  let recordSnapshot: PadEvent[] | null = null;
  const levelModeSel = document.createElement("select");
  levelModeSel.setAttribute("aria-label", "16 levels parameter");
  help(levelModeSel, "Which parameter the 16 pads sweep while 16 Levels is on.");
  [["velocity", "Velocity"], ["pitch", "Pitch"], ["filter", "Filter"], ["start", "Start"]].forEach(([value, label]) => {
    const option = document.createElement("option"); option.value = value; option.textContent = label; levelModeSel.append(option);
  });
  levelModeSel.value = mpc.levelMode;
  const repeatSel = document.createElement("select");
  repeatSel.setAttribute("aria-label", "Note repeat rate");
  help(repeatSel, "Note repeat rate.");
  [["2", "1/8"], ["3", "1/8T"], ["4", "1/16"], ["6", "1/16T"], ["8", "1/32"], ["16", "1/64"]].forEach(([value, label]) => {
    const option = document.createElement("option"); option.value = value; option.textContent = label; repeatSel.append(option);
  });
  repeatSel.value = String(mpc.repeatDivision);
  const quantSel = document.createElement("select");
  quantSel.setAttribute("aria-label", "Record quantise");
  help(quantSel, "Snap recorded pad hits to this grid.");
  [["0", "Q off"], ["2", "Q 1/8"], ["3", "Q 1/8T"], ["4", "Q 1/16"], ["6", "Q 1/16T"], ["8", "Q 1/32"]].forEach(([value, label]) => {
    const option = document.createElement("option"); option.value = value; option.textContent = label; quantSel.append(option);
  });
  quantSel.value = String(mpc.quantize);
  mpcToolbar.append(fullLevelBtn, levelsBtn, levelModeSel, repeatBtn, repeatSel, recordBtn, overdubBtn, undoPassBtn, quantSel, rotateBtn, mutateBtn, fillBtn, ghostBtn, extractGrooveBtn, midiBtn, resampleQuality, resampleBtn, performanceStatus);

  const padBankRow = el("div", "wa-pad-banks wa-subtabs");
  padBankRow.append(el("span", "wa-lbl", "Bank"));
  ["A", "B", "C", "D"].forEach((label, bank) => {
    const button = btn(label, "wa-subtab wa-pat-btn" + (mpc.bank === bank ? " active" : ""));
    button.classList.remove("wa-btn");
    button.setAttribute("aria-label", `Bank ${label}`);
    button.addEventListener("click", () => {
      mpc.bank = bank; bankButtons.forEach((item, i) => item.classList.toggle("active", i === bank)); paintMpcPads(); saveAll();
    });
    bankButtons.push(button); padBankRow.append(button);
  });
  const padGrid = el("div", "wa-mpc-pads");
  const selectedPadLabel = el("span", "wa-status");
  const selectedSampleEditor = el("div", "wa-selected-sample");
  const selectedInputs: Array<{ key: keyof SamplerP; set: (v: number) => void }> = [];
  function selectedParam(label: string, key: keyof SamplerP, min: number, max: number, step: number): HTMLElement {
    const k = knob(label, min, max, min, step, (value) => {
      (sampleParams[mpc.selectedPad][key] as number) = value; saveAll();
    });
    selectedInputs.push({ key, set: k.set });
    return k.root;
  }
  const reverseSelectedBtn = btn("Reverse", "wa-toggle wa-btn-sm"), loopSelectedBtn = btn("Loop", "wa-toggle wa-btn-sm"), warpSelectedBtn = btn("Warp", "wa-toggle wa-btn-sm");
  const muteSelectedBtn = btn("Mute", "wa-toggle wa-btn-sm"), soloSelectedBtn = btn("Solo", "wa-toggle wa-btn-sm");
  const selectedFileInput = document.createElement("input"); selectedFileInput.type = "file"; selectedFileInput.accept = "audio/*"; selectedFileInput.hidden = true;
  const loadSelectedBtn = btn("＋ Load sample", "wa-btn-sm wa-load-selected");
  help(loadSelectedBtn, "Replace the selected pad with an audio file from this device.");
  loadSelectedBtn.addEventListener("click", () => selectedFileInput.click());
  selectedFileInput.addEventListener("change", async () => {
    const file = selectedFileInput.files?.[0]; if (!file) return;
    const pad = mpc.selectedPad, previousData = sampleData[pad], previousName = sampleParams[pad].name, previousBuffer = sampleBuffers[pad];
    try {
      ctx.checkpoint();
      sampleData[pad] = await readAsDataUrl(file); sampleParams[pad].name = file.name;
      await hydrateSample(pad); paintMpcPads(); saveAll();
    } catch {
      sampleData[pad] = previousData; sampleParams[pad].name = previousName; sampleBuffers[pad] = previousBuffer;
      paintMpcPads(); selectedPadLabel.textContent = "Could not load sample";
    }
    selectedFileInput.value = "";
  });
  help(reverseSelectedBtn, "Play this pad's audio backwards.");
  help(loopSelectedBtn, "Loop the selected sample while it plays.");
  help(warpSelectedBtn, "Use granular playback to follow project tempo without ordinary repitching.");
  help(muteSelectedBtn, "Silence the selected pad.");
  help(soloSelectedBtn, "Play only soloed pads.");
  reverseSelectedBtn.addEventListener("click", () => {
    const p = sampleParams[mpc.selectedPad]; p.reverse = !p.reverse; reverseSelectedBtn.classList.toggle("active", p.reverse); saveAll();
  });
  loopSelectedBtn.addEventListener("click", () => {
    const p = sampleParams[mpc.selectedPad]; p.loop = !p.loop; loopSelectedBtn.classList.toggle("active", p.loop); saveAll();
  });
  warpSelectedBtn.addEventListener("click", () => {
    const p = sampleParams[mpc.selectedPad]; p.warp = !p.warp; warpSelectedBtn.classList.toggle("active", p.warp); saveAll();
  });
  muteSelectedBtn.addEventListener("click", () => {
    mpc.padMute[mpc.selectedPad] = !mpc.padMute[mpc.selectedPad]; paintMpcPads(); saveAll();
  });
  soloSelectedBtn.addEventListener("click", () => {
    mpc.padSolo[mpc.selectedPad] = !mpc.padSolo[mpc.selectedPad]; paintMpcPads(); saveAll();
  });
  const sampleKnobs = el("div", "wa-sample-knobs");
  const sampleToggles = el("div", "wa-sample-toggles");
  sampleKnobs.append(
    selectedParam("Tune", "tune", -24, 24, 1),
    selectedParam("Start", "start", 0, 0.95, 0.01),
    selectedParam("End", "end", 0.05, 1, 0.01),
    selectedParam("Filter", "filter", 200, 18000, 100),
    selectedParam("Attack", "attack", 0, 0.5, 0.01),
    selectedParam("Decay", "decay", 0.02, 2, 0.02),
    selectedParam("Choke", "choke", 0, 8, 1),
    selectedParam("Source BPM", "sourceBpm", 40, 240, 1),
  );
  sampleToggles.append(reverseSelectedBtn, loopSelectedBtn, warpSelectedBtn, muteSelectedBtn, soloSelectedBtn);
  selectedSampleEditor.append(el("div", "wa-sample-primary wa-lbl", "One-shot"), loadSelectedBtn, selectedFileInput, sampleKnobs, sampleToggles);

  // ── Poise-style layers (C4, features only): up to 3 extra samples on the
  // selected pad, dispatched by mode — velocity split / round robin / random /
  // all together. Layer audio rides in project files; autosave keeps the meta.
  const layersBlock = el("div", "wa-pad-layers");
  layersBlock.append(el("div", "wa-fx-title", "Layers"));
  const layerModeSel = document.createElement("select");
  layerModeSel.setAttribute("aria-label", "Pad layer mode");
  ([["velocity", "Velocity split"], ["roundrobin", "Round robin"], ["random", "Random"], ["layered", "Layered"]] as const)
    .forEach(([v, label]) => { const o = document.createElement("option"); o.value = v; o.textContent = label; layerModeSel.append(o); });
  help(layerModeSel, "How the pad picks between its main sample and the layers: by velocity range, alternating, at random, or all at once.");
  layerModeSel.addEventListener("change", () => { padLayerMode[mpc.selectedPad] = layerModeSel.value as PadLayerMode; saveAll(); });
  layersBlock.append(layerModeSel);
  const layerRows = el("div", "wa-pad-layer-rows");
  layersBlock.append(layerRows);
  function paintLayers(): void {
    const pad = mpc.selectedPad;
    layerModeSel.value = padLayerMode[pad];
    layerRows.replaceChildren();
    padLayers[pad].forEach((layer, i) => {
      const row = el("div", "wa-pad-layer-row");
      const name = el("span", "wa-sample-name", layer.name || `Layer ${i + 2}`);
      const lo = document.createElement("input"), hi = document.createElement("input");
      [lo, hi].forEach((input) => { input.type = "number"; input.min = "0"; input.max = "127"; input.className = "wa-vel-in"; });
      lo.value = String(layer.velLo); hi.value = String(layer.velHi);
      help(lo, "Lowest velocity this layer answers to (velocity-split mode)."); help(hi, "Highest velocity this layer answers to.");
      lo.addEventListener("change", () => { layer.velLo = Math.max(0, Math.min(127, Number(lo.value) || 0)); saveAll(); });
      hi.addEventListener("change", () => { layer.velHi = Math.max(0, Math.min(127, Number(hi.value) || 127)); saveAll(); });
      const tuneKnob = knob("Tune", -24, 24, layer.tune, 1, (v) => { layer.tune = v; saveAll(); });
      const gainKnob = knob("Gain", 0, 1.5, layer.gain, 0.05, (v) => { layer.gain = v; saveAll(); });
      const removeBtn = btn("✕", "wa-btn-sm");
      help(removeBtn, "Remove this layer.");
      removeBtn.addEventListener("click", () => {
        padLayers[pad].splice(i, 1); padLayerBuffers[pad].splice(i, 1); paintLayers(); saveAll();
      });
      row.append(name, el("span", "wa-lbl", "VEL"), lo, hi, tuneKnob.root, gainKnob.root, removeBtn);
      layerRows.append(row);
    });
    if (padLayers[pad].length < PAD_LAYER_MAX) {
      const addBtn = btn("+ Add layer", "wa-btn-sm");
      help(addBtn, "Load another sample onto this pad as a layer.");
      addBtn.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "audio/*";
        input.addEventListener("change", async () => {
          const file = input.files?.[0]; if (!file) return;
          const data = await readAsDataUrl(file);
          padLayers[pad].push({ data, name: file.name, tune: 0, gain: 1, velLo: 0, velHi: 127 });
          padLayerBuffers[pad].push(null);
          await hydratePadLayer(pad, padLayers[pad].length - 1);
          paintLayers(); saveAll();
        });
        input.click();
      });
      layerRows.append(addBtn);
    }
  }
  selectedSampleEditor.append(layersBlock);

  function selectedGlobalPad(localPad: number): number { return mpc.bank * PAD_BANK_SIZE + localPad; }
  function paintMpcPads(): void {
    padButtons.forEach((button, localPad) => {
      const pad = selectedGlobalPad(localPad), params = sampleParams[pad];
      button.classList.toggle("selected", pad === mpc.selectedPad);
      button.replaceChildren(
        el("span", "wa-mpc-pad-number", String(localPad + 1)),
        el("span", "wa-mpc-pad-name", params.name || `Pad ${pad + 1}`),
      );
    });
    selectedPadLabel.textContent = `Selected: ${sampleParams[mpc.selectedPad].name || `Pad ${mpc.selectedPad + 1}`}`;
    selectedSampleEditor.style.setProperty("--track-colour", padColour(mpc.selectedPad % PAD_BANK_SIZE));
    const selected = sampleParams[mpc.selectedPad];
    selectedInputs.forEach(({ key, set }) => set(Number(selected[key])));
    reverseSelectedBtn.classList.toggle("active", selected.reverse); loopSelectedBtn.classList.toggle("active", selected.loop);
    warpSelectedBtn.classList.toggle("active", selected.warp);
    muteSelectedBtn.classList.toggle("active", mpc.padMute[mpc.selectedPad]);
    soloSelectedBtn.classList.toggle("active", mpc.padSolo[mpc.selectedPad]);
    paintLayers();
    paintEventLane();
  }
  function variationFor(localPad: number): number {
    if (mpc.levelMode === "velocity") return localPad / 15;
    if (mpc.levelMode === "pitch") return localPad - 8;
    return localPad;
  }
  // Recording writes into the pads clip you can hear (the playing one), falling
  // back to the edit scene when the pads track is stopped.
  // Recording lands in the scene you're LOOKING at, not the playing clip —
  // the old playing-clip target silently recorded into off-screen scenes.
  // The transport's REC chip states the target.
  function recordTarget(): number { return clip.sel; }
  function recordPadEvent(pad: number, velocity: number): void {
    if (!mpc.recording || !playhead.playing) return;
    const target = recordTarget();
    const patternLength = patternLengths[target];
    const rawStep = playhead.lastHi >= 0 ? playhead.lastHi : playhead.schStep;
    const grid = mpc.quantize || patternLength;
    const snapped = Math.round(rawStep / (patternLength / grid)) * (patternLength / grid);
    const strength = mpc.quantizeStrength / 100;
    const step = Math.round(rawStep + (snapped - rawStep) * strength) % patternLength;
    if (!mpc.overdub) padEvents[target] = padEvents[target].filter((event) => event.step !== step);
    else padEvents[target] = padEvents[target].filter((event) => !(event.step === step && event.pad === pad));
    const playedOffset = playhead.lastStepStartedMs > 0 ? Math.max(-60, Math.min(60, performance.now() - playhead.lastStepStartedMs)) : 0;
    padEvents[target].push({ pad, step, velocity, offset: playedOffset, probability: 100, ratchets: 1 });
    paintEventLane(); saveAll();
  }
  function triggerPerformancePad(localPad: number, velocity: number): void {
    ensureNodes();
    const pad = selectedGlobalPad(localPad);
    const levelVelocity = 8 + localPad * 8;
    const finalVelocity = mpc.fullLevel ? 127 : (mpc.sixteenLevels && mpc.levelMode === "velocity" ? levelVelocity : velocity);
    mpc.selectedPad = pad; paintMpcPads();
    padButtons[localPad].style.setProperty("--wa-hit", (finalVelocity / 127).toFixed(2));
    playPad(ac(), pad, finalVelocity, ac().currentTime, variationFor(localPad));
    recordPadEvent(pad, finalVelocity);
    if (rackState.devices.player && rackState.noteEcho > 0) {
      for (let i = 1; i <= rackState.noteEcho; i++) {
        playPad(ac(), pad, finalVelocity * Math.pow(rackState.echoDecay, i), ac().currentTime + i * stepDur(), variationFor(localPad));
      }
    }
  }
  midiBtn.addEventListener("click", async () => {
    const nav = navigator as Navigator & {
      requestMIDIAccess?: () => Promise<{ inputs: Map<unknown, { onmidimessage: ((event: { data: Uint8Array }) => void) | null }> }>;
    };
    if (!nav.requestMIDIAccess) { performanceStatus.textContent = "Web MIDI is not supported"; return; }
    try {
      const access = await nav.requestMIDIAccess();
      access.inputs.forEach((input) => {
        input.onmidimessage = (event) => {
          if (!event.data) return;
          const [status, note, velocity] = event.data, command = status & 0xf0;
          if (command !== 0x90 || velocity === 0) return;
          const localPad = ((note - 36) % PAD_BANK_SIZE + PAD_BANK_SIZE) % PAD_BANK_SIZE;
          triggerPerformancePad(localPad, velocity);
          padButtons[localPad].classList.add("down");
          setTimeout(() => padButtons[localPad].classList.remove("down"), 90);
        };
      });
      midiBtn.classList.add("active"); performanceStatus.textContent = `${access.inputs.size} MIDI input${access.inputs.size === 1 ? "" : "s"} connected`;
    } catch { performanceStatus.textContent = "MIDI access was not granted"; }
  });
  for (let localPad = 0; localPad < PAD_BANK_SIZE; localPad++) {
    const pad = el("button", "wa-mpc-pad") as HTMLButtonElement; pad.type = "button";
    // MPC orientation: pad 1 sits BOTTOM-left and numbers run right then up —
    // the convention of every hardware pad controller. DOM/index order is
    // unchanged; only the grid placement flips.
    pad.style.gridRow = String(4 - Math.floor(localPad / 4));
    pad.style.gridColumn = String((localPad % 4) + 1);
    pad.style.setProperty("--track-colour", padColour(localPad));
    const press = (event: PointerEvent) => {
      event.preventDefault(); pad.setPointerCapture?.(event.pointerId); pad.classList.add("down");
      const rect = pad.getBoundingClientRect();
      const velocity = Math.max(20, Math.min(127, Math.round((1 - (event.clientY - rect.top) / rect.height) * 107 + 20)));
      triggerPerformancePad(localPad, velocity);
      if (mpc.noteRepeat) {
        const interval = Math.max(30, stepDur() * 1000 * (4 / mpc.repeatDivision));
        repeatTimers.set(localPad, window.setInterval(() => triggerPerformancePad(localPad, velocity), interval));
      }
    };
    const release = () => {
      pad.classList.remove("down");
      const timer = repeatTimers.get(localPad); if (timer) clearInterval(timer);
      repeatTimers.delete(localPad);
    };
    pad.addEventListener("pointerdown", press); pad.addEventListener("pointerup", release); pad.addEventListener("pointercancel", release); pad.addEventListener("pointerleave", release);
    pad.addEventListener("dragover", (event) => { event.preventDefault(); pad.classList.add("drop"); });
    pad.addEventListener("dragleave", () => pad.classList.remove("drop"));
    pad.addEventListener("drop", async (event) => {
      event.preventDefault(); pad.classList.remove("drop");
      const file = event.dataTransfer?.files?.[0]; if (!file?.type.startsWith("audio/")) return;
      ctx.checkpoint();
      const globalPad = selectedGlobalPad(localPad);
      try {
        sampleData[globalPad] = await readAsDataUrl(file); sampleParams[globalPad].name = file.name;
        await hydrateSample(globalPad); mpc.selectedPad = globalPad; paintMpcPads(); saveAll();
        performanceStatus.textContent = `${file.name} loaded on pad ${localPad + 1}`;
      } catch { performanceStatus.textContent = "Could not load dropped sample"; }
    });
    padButtons.push(pad); padGrid.append(pad);
  }
  fullLevelBtn.classList.toggle("active", mpc.fullLevel);
  fullLevelBtn.addEventListener("click", () => { mpc.fullLevel = !mpc.fullLevel; fullLevelBtn.classList.toggle("active", mpc.fullLevel); saveAll(); });
  levelsBtn.classList.toggle("active", mpc.sixteenLevels);
  levelsBtn.addEventListener("click", () => { mpc.sixteenLevels = !mpc.sixteenLevels; levelsBtn.classList.toggle("active", mpc.sixteenLevels); saveAll(); });
  repeatBtn.classList.toggle("active", mpc.noteRepeat);
  repeatBtn.addEventListener("click", () => { mpc.noteRepeat = !mpc.noteRepeat; repeatBtn.classList.toggle("active", mpc.noteRepeat); saveAll(); });
  recordBtn.classList.toggle("active", mpc.recording);
  recordBtn.addEventListener("click", () => {
    mpc.recording = !mpc.recording;
    if (mpc.recording) { ctx.checkpoint(); recordSnapshot = padEvents[recordTarget()].map((event) => ({ ...event })); }
    recordBtn.classList.toggle("active", mpc.recording); performanceStatus.textContent = mpc.recording ? "Recording pad events" : "Ready"; saveAll();
    ctx.updateRecChip();
  });
  overdubBtn.addEventListener("click", () => { mpc.overdub = !mpc.overdub; overdubBtn.classList.toggle("active", mpc.overdub); saveAll(); });
  undoPassBtn.addEventListener("click", () => {
    if (!recordSnapshot) return;
    padEvents[recordTarget()] = recordSnapshot.map((event) => ({ ...event })); recordSnapshot = null; paintEventLane(); saveAll(); performanceStatus.textContent = "Last recording pass undone";
  });
  repeatSel.addEventListener("change", () => { mpc.repeatDivision = Number(repeatSel.value); saveAll(); });
  quantSel.addEventListener("change", () => { mpc.quantize = Number(quantSel.value); saveAll(); });
  levelModeSel.addEventListener("change", () => { mpc.levelMode = levelModeSel.value as MpcState["levelMode"]; saveAll(); });
  rotateBtn.addEventListener("click", () => {
    if (!padEvents[clip.sel].length) { performanceStatus.textContent = "Pattern is empty — nothing to rotate"; return; }
    ctx.checkpoint();
    padEvents[clip.sel].forEach((event) => { event.step = (event.step + 1) % patternLengths[clip.sel]; }); paintEventLane(); saveAll();
    performanceStatus.textContent = "Pattern rotated one step later";
  });
  mutateBtn.addEventListener("click", () => {
    if (!padEvents[clip.sel].length) { performanceStatus.textContent = "Pattern is empty — nothing to mutate"; return; }
    ctx.checkpoint();
    padEvents[clip.sel].forEach((event) => {
      if (Math.random() < 0.35) event.step = (event.step + (Math.random() < 0.5 ? -1 : 1) + patternLengths[clip.sel]) % patternLengths[clip.sel];
      event.velocity = Math.max(20, Math.min(127, event.velocity + Math.round((Math.random() * 2 - 1) * 18)));
      if (Math.random() < 0.2) event.ratchets = 1 + Math.floor(Math.random() * 4);
    });
    paintEventLane(); saveAll();
    performanceStatus.textContent = "Pattern mutated";
  });
  fillBtn.addEventListener("click", () => {
    ctx.checkpoint();
    const pad = mpc.selectedPad;
    for (let step = Math.max(0, patternLengths[clip.sel] - 4); step < patternLengths[clip.sel]; step++) {
      padEvents[clip.sel] = padEvents[clip.sel].filter((event) => !(event.pad === pad && event.step === step));
      const fillIndex = step - Math.max(0, patternLengths[clip.sel] - 4);
      padEvents[clip.sel].push({ pad, step, velocity: 72 + fillIndex * 14, offset: 0, probability: 100, ratchets: step === patternLengths[clip.sel] - 1 ? 4 : 1 });
    }
    paintEventLane(); saveAll();
    performanceStatus.textContent = `Fill written for ${sampleParams[pad].name || `pad ${pad + 1}`}`;
  });
  ghostBtn.addEventListener("click", () => {
    ctx.checkpoint();
    const pad = mpc.selectedPad;
    let added = 0;
    Array.from({ length: Math.floor(patternLengths[clip.sel] / 4) }, (_, i) => i * 4 + 3).forEach((step, i) => {
      if (!padEvents[clip.sel].some((event) => event.pad === pad && event.step === step)) {
        padEvents[clip.sel].push({ pad, step, velocity: 34 + i * 5, offset: i % 2 ? 12 : -8, probability: 72, ratchets: 1 });
        added++;
      }
    });
    paintEventLane(); saveAll();
    performanceStatus.textContent = added ? `${added} ghost note${added === 1 ? "" : "s"} added` : "Ghost steps already occupied — nothing added";
  });
  extractGrooveBtn.addEventListener("click", () => {
    const events = padEvents[clip.sel];
    if (!events.length) { performanceStatus.textContent = "Pattern is empty — nothing to extract"; return; }
    const odd = events.filter((event) => event.step % 2 === 1);
    rackState.grooveTiming = Math.max(0, Math.min(0.75, odd.reduce((sum, event) => sum + Math.max(0, event.offset), 0) / Math.max(1, odd.length) / 80));
    const velocities = events.map((event) => event.velocity), mean = velocities.reduce((sum, value) => sum + value, 0) / velocities.length;
    rackState.grooveVelocity = Math.min(0.5, velocities.reduce((sum, value) => sum + Math.abs(value - mean), 0) / velocities.length / 127);
    performanceStatus.textContent = "Groove extracted from current pattern"; saveAll();
  });
  resampleBtn.addEventListener("click", async () => {
    performanceStatus.textContent = "Resampling pattern...";
    try {
      const rendered = await deps.renderBuffer("pattern");
      const buffer = resampleQuality.value === "12bit" ? crushBuffer(rendered, 12, 2)
        : resampleQuality.value === "8bit" ? crushBuffer(rendered, 8, 4)
        : resampleQuality.value === "jungle" ? crushBuffer(rendered, 10, 3) : rendered;
      const data = await blobAsDataUrl(encodeWav(buffer)), pad = mpc.selectedPad;
      sampleData[pad] = data; sampleBuffers[pad] = buffer;
      Object.assign(sampleParams[pad], { name: `Resample ${SCENE_LABELS[clip.sel]}`, start: 0, end: 1, tune: 0, reverse: false });
      paintMpcPads(); saveAll(); performanceStatus.textContent = `Pattern resampled to pad ${pad + 1}`;
    } catch { performanceStatus.textContent = "Resampling failed"; }
  });

  // All 16 pads in the current bank get their own lane, mirroring the legacy
  // drum grid's UX — switching the selected pad no longer swaps the lane's
  // contents out from under you, it just moves which row is highlighted.
  const eventLane = el("div", "wa-event-grid");
  eventLane.append(stepRuler());
  let paintingEvents = false, paintEventsOn = true, lanePointerType = "mouse";
  function paintEventLane(): void {
    eventRowLabels.forEach((label, localPad) => {
      const pad = selectedGlobalPad(localPad);
      label.textContent = sampleParams[pad].name || `Pad ${pad + 1}`;
      eventRows[localPad].classList.toggle("selected", pad === mpc.selectedPad);
    });
    eventCells.forEach((rowCells, localPad) => {
      const pad = selectedGlobalPad(localPad);
      rowCells.forEach((cell, step) => {
        const event = padEvents[clip.sel].find((item) => item.pad === pad && item.step === step);
        cell.classList.toggle("on", !!event);
        cell.style.setProperty("--wa-vel", event ? (event.velocity / 127).toFixed(2) : "1");
        cell.title = event
          ? `${eventRowLabels[localPad].textContent}, step ${step + 1}: velocity ${event.velocity}, chance ${event.probability}%, ratchets ${event.ratchets}, offset ${event.offset}ms`
          : `${eventRowLabels[localPad].textContent}, step ${step + 1}`;
      });
    });
  }
  for (let localPad = 0; localPad < PAD_BANK_SIZE; localPad++) {
    const rowEl = el("div", "wa-row");
    rowEl.style.setProperty("--track-colour", padColour(localPad));
    const label = el("span", "wa-drum wa-event-row-label");
    label.addEventListener("click", () => { mpc.selectedPad = selectedGlobalPad(localPad); paintMpcPads(); });
    rowEl.append(label);
    const rowCells: HTMLButtonElement[] = [];
    for (let step = 0; step < STEPS; step++) {
      const cell = el("button", "wa-cell wa-event-cell" + (isGridLine(step) ? " wa-beat" : "")) as HTMLButtonElement; cell.type = "button";
      const paint = () => {
        const pad = selectedGlobalPad(localPad);
        const existing = padEvents[clip.sel].findIndex((event) => event.pad === pad && event.step === step);
        if (paintEventsOn && existing < 0) padEvents[clip.sel].push({ pad, step, velocity: 100, offset: 0, probability: 100, ratchets: 1 });
        if (!paintEventsOn && existing >= 0) padEvents[clip.sel].splice(existing, 1);
        paintEventLane(); ctx.paintSession(); saveAll();
      };
      // Touch: tap toggles, drag SCROLLS. The old preventDefault-on-pointerdown
      // ate every scroll gesture that started on a cell — and the lane covers
      // the whole panel on a phone, so the Steps view could not scroll at all.
      // Mouse/pen keep the original drag-painting.
      cell.addEventListener("pointerdown", (event) => {
        lanePointerType = event.pointerType;
        if (event.pointerType === "touch") return; // tap arrives as click below
        event.preventDefault(); ctx.checkpoint(); paintingEvents = true;
        const pad = selectedGlobalPad(localPad);
        mpc.selectedPad = pad; paintMpcPads();
        paintEventsOn = !padEvents[clip.sel].some((item) => item.pad === pad && item.step === step); paint();
      });
      cell.addEventListener("click", () => {
        if (lanePointerType !== "touch") return; // mouse already painted on pointerdown
        ctx.checkpoint();
        const pad = selectedGlobalPad(localPad);
        mpc.selectedPad = pad; paintMpcPads();
        paintEventsOn = !padEvents[clip.sel].some((item) => item.pad === pad && item.step === step); paint();
      });
      cell.addEventListener("pointerenter", () => { if (paintingEvents) paint(); });
      cell.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const pad = selectedGlobalPad(localPad);
        const existing = padEvents[clip.sel].find((item) => item.pad === pad && item.step === step);
        if (!existing) return;
        showVelocityPopup(existing.velocity, (event as MouseEvent).clientX, (event as MouseEvent).clientY, (v) => {
          existing.velocity = v; paintEventLane(); saveAll();
        });
      });
      rowCells.push(cell); rowEl.append(cell);
    }
    eventCells.push(rowCells); eventRows.push(rowEl); eventRowLabels.push(label);
    eventLane.append(rowEl);
  }
  gridRepainters.push(() => eventCells.forEach((row) => row.forEach((cell, step) => {
    cell.classList.toggle("wa-beat", isGridLine(step)); cell.hidden = step >= patternLengths[clip.sel]; cell.disabled = step >= patternLengths[clip.sel];
  })));
  window.addEventListener("pointerup", () => { paintingEvents = false; });
  const eventEditor = el("div", "wa-event-editor");
  eventEditor.append(
    sliderRow("Velocity", 1, 127, 100, 1, (v) => { padEvents[clip.sel].filter((e) => e.pad === mpc.selectedPad).forEach((e) => { e.velocity = v; }); paintEventLane(); saveAll(); }),
    sliderRow("Chance", 1, 100, 100, 1, (v) => { padEvents[clip.sel].filter((e) => e.pad === mpc.selectedPad).forEach((e) => { e.probability = v; }); paintEventLane(); saveAll(); }),
    sliderRow("Micro", -60, 60, 0, 1, (v) => { padEvents[clip.sel].filter((e) => e.pad === mpc.selectedPad).forEach((e) => { e.offset = v; }); paintEventLane(); saveAll(); }),
    sliderRow("Ratchet", 1, 8, 1, 1, (v) => { padEvents[clip.sel].filter((e) => e.pad === mpc.selectedPad).forEach((e) => { e.ratchets = v; }); paintEventLane(); saveAll(); }),
  );
  // MPC/Maschine-style deck: the 4×4 pads dominate; the action controls (full
  // level, levels, repeat, record, quantise, resample…) live in a side column.
  const mpcPadArea = el("div", "wa-mpc-pad-area"); mpcPadArea.append(padBankRow, padGrid);
  type PadSequenceView = "selected" | "all";
  const padViewButtons: HTMLButtonElement[] = [];
  let padSequenceView = (localStorage.getItem("vv_studio_pad_sequence_view") as PadSequenceView | null) ?? "selected";
  if (padSequenceView !== "selected" && padSequenceView !== "all") padSequenceView = "selected";
  const padSeqPanel = el("div", "wa-panel wa-device-dock");
  padSeqPanel.dataset.track = "pads";
  const selectPadSequenceView = (view: PadSequenceView): void => {
    padSequenceView = view;
    padSeqPanel.dataset.sequenceView = view;
    padViewButtons.forEach((button) => {
      const selected = button.dataset.sequenceView === view;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    localStorage.setItem("vv_studio_pad_sequence_view", view);
  };
  const buildPadViewToggle = (): HTMLElement => {
    const toggle = el("div", "wa-pad-view-toggle");
    (["selected", "all"] as PadSequenceView[]).forEach((view) => {
      const button = btn(view === "selected" ? "Pads" : "All steps", "wa-subtab") as HTMLButtonElement;
      button.dataset.sequenceView = view;
      button.addEventListener("click", () => selectPadSequenceView(view));
      padViewButtons.push(button);
      toggle.append(button);
    });
    return toggle;
  };
  const mpcSide = el("div", "wa-mpc-side"); mpcSide.append(buildPadViewToggle(), mpcToolbar);
  const mpcDeck = el("div", "wa-mpc-deck"); mpcDeck.append(mpcPadArea, mpcSide);
  // The pad event lane belongs with the other sequencers on the Sequence tab
  // (Create stays a performance surface). Assembled into padSeqPanel, mounted
  // in the workspace section below.
  mpcPanel.append(mpcDeck);
  const padSequenceHead = el("div", "wa-pad-sequence-head");
  padSequenceHead.append(el("div", "wa-lbl", "Pad sequencer"), buildPadViewToggle());
  padSeqPanel.append(padSequenceHead, eventLane, eventEditor);
  selectPadSequenceView(padSequenceView);
  paintMpcPads();


  return { mpcPanel, padSeqPanel, padButtons, paintMpcPads, paintEventLane, triggerPerformancePad, padGrid, eventLane, selectedPadLabel, selectedSampleEditor, recordBtn, loadSelectedSample: () => selectedFileInput.click() };
}
