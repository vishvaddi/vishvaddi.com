// Drum rack / sampler — per-drum sample loading, tune/start/end/reverse with
// debounced audition. Extracted verbatim from index.ts (Phase 0 split).
import { DRUMS, sampleParams, sampleBuffers, sampleData } from "./state";
import { ac, ensureNodes, trackGain, playDrum, hydrateSample } from "./engine";
import { saveAll } from "./persistence";
import { el, btn, sliderRow, readAsDataUrl } from "./helpers";
import { ctx } from "./ctx";

export function buildRack(): HTMLElement {
  const rack = el("div", "wa-panel");
  const rackGrid = el("div", "wa-rack");
  DRUMS.forEach((name, r) => {
    const pad = el("div", "wa-pad");
    const trigger = btn(name, "wa-pad-trigger");
    trigger.addEventListener("click", () => { ensureNodes(); playDrum(ac(), trackGain[r], r, 1, ac().currentTime); });
    const fileName = el("span", "wa-sample-name", sampleParams[r].name || "Synth drum");
    const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = "audio/*"; fileInput.hidden = true;
    const load = btn("Load sample", "wa-btn-sm"), remove = btn("Use synth", "wa-btn-sm");
    // Hear edits as you make them — Reaper-style param audition, debounced so
    // dragging a slider doesn't machine-gun the row.
    let auditionTimer = 0;
    const auditionRow = (): void => {
      window.clearTimeout(auditionTimer);
      auditionTimer = window.setTimeout(() => { ensureNodes(); playDrum(ac(), trackGain[r], r, 0.9, ac().currentTime); }, 140);
    };
    const startRow = sliderRow("Start", 0, 0.95, sampleParams[r].start, 0.01, (v) => {
      sampleParams[r].start = Math.min(v, sampleParams[r].end - 0.01); saveAll(); auditionRow();
    });
    const endRow = sliderRow("End", 0.05, 1, sampleParams[r].end, 0.01, (v) => {
      sampleParams[r].end = Math.max(v, sampleParams[r].start + 0.01); saveAll(); auditionRow();
    });
    const reverse = btn("Reverse", "wa-toggle wa-btn-sm");
    // Start/End/Reverse only exist for samples; grey them out on synth rows so
    // dead sliders don't masquerade as broken ones.
    const syncSampleState = (): void => {
      const hasSample = !!sampleData[r];
      [startRow, endRow].forEach((row) => {
        row.classList.toggle("wa-off", !hasSample);
        row.querySelectorAll("input").forEach((input) => { input.disabled = !hasSample; });
      });
      reverse.classList.toggle("wa-off", !hasSample);
      reverse.disabled = !hasSample;
    };
    load.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0]; if (!file) return;
      try {
        ctx.checkpoint();
        sampleData[r] = await readAsDataUrl(file);
        sampleParams[r].name = file.name;
        await hydrateSample(r);
        fileName.textContent = file.name;
        syncSampleState(); saveAll(); auditionRow();
      } catch { fileName.textContent = "Could not load sample"; }
    });
    remove.addEventListener("click", () => {
      ctx.checkpoint();
      sampleData[r] = null; sampleBuffers[r] = null; sampleParams[r].name = "";
      fileName.textContent = "Synth drum"; fileInput.value = ""; syncSampleState(); saveAll();
    });
    const controls = el("div", "wa-pad-controls");
    controls.append(
      sliderRow("Tune", -24, 24, sampleParams[r].tune, 1, (v) => { sampleParams[r].tune = v; saveAll(); auditionRow(); }),
      startRow, endRow,
    );
    reverse.classList.toggle("active", sampleParams[r].reverse);
    reverse.addEventListener("click", () => {
      sampleParams[r].reverse = !sampleParams[r].reverse; reverse.classList.toggle("active", sampleParams[r].reverse); saveAll(); auditionRow();
    });
    const actions = el("div", "wa-pad-actions"); actions.append(load, remove, reverse, fileInput);
    syncSampleState();
    pad.append(trigger, fileName, controls, actions); rackGrid.append(pad);
  });
  rack.append(el("p", "wa-help", "Each pad uses its generated drum until you load a local audio file. Tune works on both — it repitches samples and synth drums alike. Samples stay in this session and are embedded when you save a project."), rackGrid);


  return rack;
}
