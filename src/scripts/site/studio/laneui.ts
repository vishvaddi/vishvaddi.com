// Drum lane inspector (D2) — a Grace-style per-lane sampler in the DRUMS
// sidebar: waveform, sample load / synth fallback, the full SamplerP knob set
// (playDrum already routes through playSample, so every knob is live), and
// the lane's synth-drum design sliders. Replaces both the inline sound-design
// panels and the old SAMPLE RACK overlay.
import { DRUMS, dp, DP_DEF, DP_SPECS, sampleParams, sampleBuffers, sampleData } from "./state";
import type { SamplerP } from "./state";
import { ac, ensureNodes, trackGain, playDrum, hydrateSample } from "./engine";
import { saveAll } from "./persistence";
import { el, btn, help, readAsDataUrl, drawWaveform, download, askText } from "./helpers";
import { knob } from "./knob";
import { ctx } from "./ctx";

export interface LaneInspector {
  panel: HTMLElement;
  selectLane: (r: number) => void;
  getSelected: () => number;
}

export function buildLaneInspector(): LaneInspector {
  let lane = 0;
  const panel = el("div", "wa-selected-sample wa-lane-inspector");

  type Kit = { dp: typeof DP_DEF; params: SamplerP[] };
  const kitKey = "vv_studio_user_kits";
  const kitFromState = (): Kit => ({ dp: dp.map((item) => ({ ...item })), params: sampleParams.slice(0, DRUMS.length).map((item) => ({ ...item, name: item.name || "" })) });
  const factoryKits: Record<string, Kit> = {
    "VISHAMP DEFAULT": { dp: DP_DEF.map((item) => ({ ...item })), params: sampleParams.slice(0, DRUMS.length).map((item) => ({ ...item })) },
    "HOUSE 909": { dp: DP_DEF.map((item, i) => ({ ...item, decay: i === 0 ? 0.34 : item.decay, filter: i === 2 ? 9800 : item.filter })), params: sampleParams.slice(0, DRUMS.length).map((item) => ({ ...item })) },
    "DUST & TAPE": { dp: DP_DEF.map((item) => ({ ...item, filter: item.filter ? item.filter * 0.72 : 0, decay: item.decay * 0.82 })), params: sampleParams.slice(0, DRUMS.length).map((item) => ({ ...item, filter: 9200 })) },
    "WAREHOUSE": { dp: DP_DEF.map((item, i) => ({ ...item, decay: i === 0 || i === 7 ? item.decay * 1.4 : item.decay, toneLevel: Math.min(1, item.toneLevel + 0.15) })), params: sampleParams.slice(0, DRUMS.length).map((item) => ({ ...item })) },
  };
  let userKits: Record<string, Kit> = {};
  try { userKits = JSON.parse(localStorage.getItem(kitKey) || "{}"); } catch { userKits = {}; }
  const kitRow = el("div", "wa-kit-library");
  const kitSelect = document.createElement("select"); kitSelect.setAttribute("aria-label", "Drum kit");
  const refreshKits = () => {
    const current = kitSelect.value; kitSelect.replaceChildren();
    Object.keys(factoryKits).forEach((name) => kitSelect.append(new Option(name, `factory:${name}`)));
    Object.keys(userKits).sort().forEach((name) => kitSelect.append(new Option(`★ ${name}`, `user:${name}`)));
    if (Array.from(kitSelect.options).some((option) => option.value === current)) kitSelect.value = current;
  };
  const loadKit = (kit: Kit) => {
    ctx.checkpoint(); kit.dp.forEach((item, i) => Object.assign(dp[i], item)); kit.params.forEach((item, i) => Object.assign(sampleParams[i], item));
    saveAll(); paint();
  };
  const loadKitBtn = btn("Load", "wa-btn-sm"), saveKitBtn = btn("＋", "wa-btn-sm"), deleteKitBtn = btn("Delete", "wa-btn-sm"), exportKitBtn = btn("↓", "wa-btn-sm"), importKitBtn = btn("↑", "wa-btn-sm");
  const kitInput = document.createElement("input"); kitInput.type = "file"; kitInput.accept = ".json,application/json"; kitInput.hidden = true;
  loadKitBtn.addEventListener("click", () => { const value = kitSelect.value; const kit = value.startsWith("user:") ? userKits[value.slice(5)] : factoryKits[value.slice(8)]; if (kit) loadKit(kit); });
  saveKitBtn.addEventListener("click", async () => { const name = await askText("Save drum kit", "My kit"); if (!name) return; userKits[name] = kitFromState(); localStorage.setItem(kitKey, JSON.stringify(userKits)); refreshKits(); kitSelect.value = `user:${name}`; });
  deleteKitBtn.addEventListener("click", () => { if (!kitSelect.value.startsWith("user:")) return; delete userKits[kitSelect.value.slice(5)]; localStorage.setItem(kitKey, JSON.stringify(userKits)); refreshKits(); });
  exportKitBtn.addEventListener("click", () => download("vishamp-kit.json", new Blob([JSON.stringify({ format: "vishamp-kit", version: 1, kit: kitFromState() }, null, 2)], { type: "application/json" })));
  importKitBtn.addEventListener("click", () => kitInput.click());
  kitInput.addEventListener("change", async () => { const file = kitInput.files?.[0]; if (!file) return; try { const parsed = JSON.parse(await file.text()) as { kit?: Kit }; if (parsed.kit) loadKit(parsed.kit); } catch { /* keep current kit */ } kitInput.value = ""; });
  refreshKits(); kitRow.append(el("span", "wa-lbl", "KIT"), kitSelect, loadKitBtn, saveKitBtn, deleteKitBtn, exportKitBtn, importKitBtn, kitInput);

  const title = el("div", "wa-inspector-title", "KICK");
  const testBtn = btn("▶", "wa-btn-sm");
  help(testBtn, "Audition this lane.");
  const titleRow = el("div", "wa-lane-title-row");
  titleRow.append(title, testBtn);

  const waveCanvas = document.createElement("canvas");
  waveCanvas.className = "wa-lane-wave";
  const waveEmpty = el("div", "wa-lane-wave-empty", "SYNTH DRUM — load a sample to see its waveform");

  const fileName = el("span", "wa-sample-name", "");
  const fileInput = document.createElement("input");
  fileInput.type = "file"; fileInput.accept = "audio/*"; fileInput.hidden = true;
  const loadBtn = btn("Load sample", "wa-btn-sm"), synthBtn = btn("Use synth", "wa-btn-sm");
  const reverseBtn = btn("Reverse", "wa-toggle wa-btn-sm");
  help(loadBtn, "Replace this lane's synthesized drum with your own sample.");
  help(synthBtn, "Drop the sample and go back to the synthesized drum.");
  help(reverseBtn, "Play the sample backwards.");
  const actions = el("div", "wa-pad-actions");
  actions.append(loadBtn, synthBtn, reverseBtn, fileInput);

  // Reaper-style debounced audition so knob drags don't machine-gun the lane
  let auditionTimer = 0;
  const audition = (): void => {
    window.clearTimeout(auditionTimer);
    auditionTimer = window.setTimeout(() => { ensureNodes(); playDrum(ac(), trackGain[lane], lane, 0.9, ac().currentTime); }, 140);
  };

  const knobs: Array<{ key: keyof SamplerP; set: (v: number) => void; sampleOnly: boolean; root: HTMLElement }> = [];
  const laneKnob = (label: string, key: keyof SamplerP, min: number, max: number, step: number, sampleOnly = false): HTMLElement => {
    const k = knob(label, min, max, min, step, (v) => {
      (sampleParams[lane][key] as number) = v;
      if (key === "start") sampleParams[lane].start = Math.min(v, sampleParams[lane].end - 0.01);
      if (key === "end") sampleParams[lane].end = Math.max(v, sampleParams[lane].start + 0.01);
      saveAll(); audition(); paintWave();
    });
    knobs.push({ key, set: k.set, sampleOnly, root: k.root });
    return k.root;
  };
  const knobRow = el("div", "wa-lane-knobs");
  knobRow.append(
    laneKnob("Tune", "tune", -24, 24, 1),
    laneKnob("Start", "start", 0, 0.95, 0.01, true),
    laneKnob("End", "end", 0.05, 1, 0.01, true),
    laneKnob("Filter", "filter", 200, 18000, 100),
    laneKnob("Attack", "attack", 0, 0.5, 0.01, true),
    laneKnob("Decay", "decay", 0.02, 2, 0.02, true),
    laneKnob("Choke", "choke", 0, 8, 1),
  );

  // Synth-drum design sliders — specs differ per lane, so this rebuilds on select
  const sdBlock = el("div", "wa-lane-sd");

  function paintWave(): void {
    const buffer = sampleBuffers[lane];
    waveCanvas.style.display = buffer ? "" : "none";
    waveEmpty.style.display = buffer ? "none" : "";
    if (buffer) {
      // start/end shown as a single highlighted slice over the waveform
      drawWaveform(waveCanvas, buffer, [[sampleParams[lane].start, sampleParams[lane].end]], 0);
    }
  }

  function paintSd(): void {
    sdBlock.replaceChildren(el("div", "wa-fx-title", "SYNTH DRUM"));
    const specs = DP_SPECS[lane] ?? [];
    specs.forEach((spec) => {
      const item = el("div", "wa-sd-item");
      const inp = document.createElement("input");
      inp.type = "range"; inp.min = String(spec.min); inp.max = String(spec.max); inp.step = String(spec.step); inp.value = String(dp[lane][spec.key]);
      const vout = el("span", "wa-sd-val", `${dp[lane][spec.key]}${spec.unit ?? ""}`);
      inp.addEventListener("input", () => {
        const v = Number(inp.value); (dp[lane][spec.key] as number) = v; vout.textContent = `${v}${spec.unit ?? ""}`; saveAll(); audition();
      });
      item.append(el("span", "wa-sd-lbl", spec.label), inp, vout);
      sdBlock.append(item);
    });
    const resetBtn = btn("Reset", "wa-btn-sm");
    help(resetBtn, "Restore this lane's synthesized drum to its defaults.");
    resetBtn.addEventListener("click", () => { Object.assign(dp[lane], DP_DEF[lane]); saveAll(); paintSd(); audition(); });
    sdBlock.append(resetBtn);
  }

  function paint(): void {
    const p = sampleParams[lane];
    title.textContent = (DRUMS[lane] || `Lane ${lane + 1}`).toUpperCase();
    fileName.textContent = p.name || "Synth drum";
    const hasSample = !!sampleData[lane];
    knobs.forEach(({ key, set, sampleOnly, root }) => {
      set(Number(p[key]));
      root.classList.toggle("wa-off", sampleOnly && !hasSample);
    });
    reverseBtn.classList.toggle("active", p.reverse);
    reverseBtn.disabled = !hasSample;
    reverseBtn.classList.toggle("wa-off", !hasSample);
    paintWave();
    paintSd();
  }

  testBtn.addEventListener("click", () => { ensureNodes(); playDrum(ac(), trackGain[lane], lane, 1, ac().currentTime); });
  loadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    try {
      ctx.checkpoint();
      sampleData[lane] = await readAsDataUrl(file);
      sampleParams[lane].name = file.name;
      await hydrateSample(lane);
      paint(); saveAll(); audition();
    } catch { fileName.textContent = "Could not load sample"; }
  });
  synthBtn.addEventListener("click", () => {
    ctx.checkpoint();
    sampleData[lane] = null; sampleBuffers[lane] = null; sampleParams[lane].name = "";
    fileInput.value = "";
    paint(); saveAll(); audition();
  });
  reverseBtn.addEventListener("click", () => {
    sampleParams[lane].reverse = !sampleParams[lane].reverse;
    paint(); saveAll(); audition();
  });

  panel.append(kitRow, titleRow, waveCanvas, waveEmpty, fileName, actions, knobRow, sdBlock);
  paint();

  return {
    panel,
    selectLane: (r: number) => { lane = Math.max(0, Math.min(DRUMS.length - 1, r)); paint(); },
    getSelected: () => lane,
  };
}
