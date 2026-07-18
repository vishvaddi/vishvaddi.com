// Mode frame (layout take 3): DSN-12 × FL Studio Mobile. Six full-screen
// modes behind a row of chassis mode keys that live under the LCD — one
// function per screen, each sized to fit its viewport with no page scroll
// (SOUND is the sole browse-and-scroll exception, by design).
// This module RE-HOUSES panels built elsewhere — it builds no instruments.
import { el, btn, help } from "./helpers";

export type ModeId = "drums" | "pads" | "synth" | "song" | "mix";

export interface LayoutPanels {
  beat: HTMLElement;
  mpcPanel: HTMLElement;
  padSeqPanel: HTMLElement;
  padGrid: HTMLElement;
  pianoRoll: HTMLElement;
  synthKeys: HTMLElement;
  keysHeader: HTMLElement;
  synthPanel: HTMLElement;          // patch editor + presets (roll/keys pulled out in synthui)
  sessionGrid: HTMLElement;
  launchStatus: HTMLElement;
  song: HTMLElement;                // arrangement lanes + help (grid/status re-homed here)
  mixer: HTMLElement;
  devicePanel: HTMLElement;
  exp: HTMLElement;
  rack: HTMLElement;
  chop: HTMLElement;
  scratchPanel: HTMLElement;
  inspector: HTMLElement;
  onSynthVisible: () => void;       // canvases need a redraw once measurable
  onModeChange: (label: string) => void;
}

export interface Layout {
  modeBar: HTMLElement;
  workarea: HTMLElement;
  getActiveMode: () => ModeId;
  /** tutorial nav proxies — see navButtons construction at the bottom */
  navButtons: HTMLElement[];
  modeKeyBtns: HTMLElement[];
}

const MODES: Array<{ id: ModeId; label: string; helpText: string }> = [
  { id: "drums", label: "DRUMS", helpText: "Program the eight drum lanes on the step grid." },
  { id: "pads", label: "PADS", helpText: "Perform on the 16 pads, edit the selected pad, chop breaks and scratch." },
  { id: "synth", label: "SYNTH", helpText: "The VV-1: piano roll or patch editor above always-playable keys." },
  { id: "song", label: "SONG", helpText: "Launch scenes and arrange the full song." },
  { id: "mix", label: "MIX", helpText: "Mixer, master devices, project save and export." },
];

export function buildLayout(p: LayoutPanels): Layout {
  const workarea = el("div", "wa-pagehost");

  // ── overlays (chop / scratch open over the PADS page) ──
  const overlays: HTMLElement[] = [];
  const makeOverlay = (title: string, panel: HTMLElement) => {
    const host = el("div", "wa-overlay");
    host.hidden = true;
    const head = el("div", "wa-overlay-head");
    const closeBtn = btn("✕ Close", "wa-btn-sm");
    closeBtn.addEventListener("click", () => { host.hidden = true; });
    head.append(el("span", "wa-fx-title", title), closeBtn);
    const body = el("div", "wa-overlay-body");
    body.append(panel);
    host.append(head, body);
    workarea.append(host);
    overlays.push(host);
    return { host, open: () => { closeOverlays(); host.hidden = false; } };
  };
  const closeOverlays = () => overlays.forEach((o) => { o.hidden = true; });

  // ── DRUMS ── grid + a slim bar opening the sample rack as an overlay
  const drumsPage = el("div", "wa-page wa-page-drums");
  const drumsBar = el("div", "wa-subtabs");
  const rackBtn = btn("Rack", "wa-subtab");
  help(rackBtn, "The drum sampler rack — per-lane sample loading and shaping.");
  drumsBar.append(rackBtn);
  drumsPage.append(drumsBar, p.beat);

  // ── PADS ── deck + toolbar row; inspector column right (toggle on small screens)
  const padsPage = el("div", "wa-page wa-page-pads");
  const padsMain = el("div", "wa-pads-main");
  const padsBar = el("div", "wa-subtabs");
  const performBtn = btn("Perform", "wa-subtab active");
  const stepsBtn = btn("Steps", "wa-subtab");
  const chopBtn = btn("Chop", "wa-subtab");
  const scratchBtn = btn("Scratch", "wa-subtab");
  const editPadBtn = btn("Edit pad", "wa-subtab wa-editpad-toggle");
  help(performBtn, "The 4×4 pad deck for playing and recording.");
  help(stepsBtn, "The per-pad step lane for drawing and editing events.");
  help(chopBtn, "Load or record a break and slice it across the pads.");
  help(scratchBtn, "Drag the vinyl to scratch the selected pad's sample over the beat.");
  help(editPadBtn, "Show or hide the selected-pad editor.");
  let padsView: "perform" | "steps" = "perform";
  const paintPadsView = () => {
    performBtn.classList.toggle("active", padsView === "perform");
    stepsBtn.classList.toggle("active", padsView === "steps");
    p.mpcPanel.style.display = padsView === "perform" ? "" : "none";
    p.padSeqPanel.style.display = padsView === "steps" ? "" : "none";
  };
  performBtn.addEventListener("click", () => { padsView = "perform"; paintPadsView(); });
  stepsBtn.addEventListener("click", () => { padsView = "steps"; paintPadsView(); });
  editPadBtn.addEventListener("click", () => padsPage.classList.toggle("show-inspector"));
  padsBar.append(performBtn, stepsBtn, chopBtn, scratchBtn, editPadBtn);
  padsMain.append(padsBar, p.mpcPanel, p.padSeqPanel);
  padsPage.append(padsMain, p.inspector);
  paintPadsView();
  const chopOverlay = makeOverlay("CHOP — SAMPLE CAPTURE", p.chop);
  const scratchOverlay = makeOverlay("SCRATCH PAD", p.scratchPanel);
  chopBtn.addEventListener("click", chopOverlay.open);
  scratchBtn.addEventListener("click", scratchOverlay.open);

  // Side toolbar: performance essentials up front, pattern tools behind ⋯
  // (queried rather than passed — padsui owns the column, layout only folds it)
  const mpcSide = p.mpcPanel.querySelector(".wa-mpc-side");
  if (mpcSide) {
    mpcSide.classList.add("condensed");
    const moreBtn = btn("⋯ More", "wa-btn-sm wa-side-more");
    help(moreBtn, "Show the pattern tools — rotate, mutate, fill, ghosts, groove extraction, MIDI and resampling.");
    moreBtn.addEventListener("click", () => {
      const condensed = mpcSide.classList.toggle("condensed");
      moreBtn.textContent = condensed ? "⋯ More" : "⋯ Less";
    });
    mpcSide.append(moreBtn);
  }

  // All 16 pads visible at once: square deck sized to min(availW, availH).
  // Height is measured from the deck's own top to the page host's bottom —
  // position-based, so a stale flex pass can't feed back a wrong size.
  const deckStacked = window.matchMedia("(max-width: 700px)");
  const fitDeck = () => {
    const area = p.padGrid.parentElement;
    if (!area || padsPage.hidden) return;
    if (deckStacked.matches) {
      // stacked mobile layout: the narrow-viewport CSS flows the deck;
      // an explicit square here paints over the toolbar stacked below it
      p.padGrid.style.width = "";
      p.padGrid.style.height = "";
      return;
    }
    const availH = workarea.getBoundingClientRect().bottom - p.padGrid.getBoundingClientRect().top - 10;
    const w = area.clientWidth;
    // floor: on short viewports the deck holds min(w, 300) and the panel scrolls
    const side = Math.max(Math.min(w, availH), Math.min(w, 300));
    if (side > 80) {
      p.padGrid.style.width = `${side}px`;
      p.padGrid.style.height = `${side}px`;
    }
  };
  deckStacked.addEventListener("change", fitDeck);
  if (p.padGrid.parentElement) new ResizeObserver(fitDeck).observe(p.padGrid.parentElement);

  // ── SYNTH ── one instrument page (D1 merge): Roll ⇄ Patch views above the
  // always-pinned keys strip, so the VV-1 is playable whichever view is up
  const soundPage = el("div", "wa-page wa-page-synth");
  const synthBar = el("div", "wa-subtabs");
  const rollTab = btn("Roll", "wa-subtab");
  const patchTab = btn("Patch", "wa-subtab");
  help(rollTab, "The piano roll — sequence VV-1 notes over the keys.");
  help(patchTab, "The patch editor — oscillators, filter, envelopes, LFOs, mod matrix.");
  synthBar.append(rollTab, patchTab);
  const soundHost = el("div", "wa-sound-host");
  soundHost.append(p.synthPanel);
  p.synthPanel.hidden = false;
  const synthViewHost = el("div", "wa-synth-viewhost");
  synthViewHost.append(p.pianoRoll, soundHost);
  soundPage.append(synthBar, synthViewHost, p.keysHeader, p.synthKeys);
  let synthView: "roll" | "patch" = localStorage.getItem("vv_studio_synthview") === "patch" ? "patch" : "roll";
  const paintSynthView = () => {
    rollTab.classList.toggle("active", synthView === "roll");
    patchTab.classList.toggle("active", synthView === "patch");
    p.pianoRoll.style.display = synthView === "roll" ? "" : "none";
    soundHost.style.display = synthView === "patch" ? "" : "none";
    if (!soundPage.hidden) p.onSynthVisible();
    localStorage.setItem("vv_studio_synthview", synthView);
  };
  rollTab.addEventListener("click", () => { synthView = "roll"; paintSynthView(); });
  patchTab.addEventListener("click", () => { synthView = "patch"; paintSynthView(); });
  paintSynthView();
  const rackOverlay = makeOverlay("SAMPLE RACK", p.rack);
  p.rack.hidden = false;
  rackBtn.addEventListener("click", rackOverlay.open);

  // ── SONG ── session grid re-homed at the top of the arrangement panel
  const songPage = el("div", "wa-page wa-page-song");
  p.song.prepend(p.sessionGrid, p.launchStatus);
  songPage.append(p.song);

  // ── MIX ── mixer + export up front (export must not need a scroll to find),
  // devices flex below and scroll internally
  const mixPage = el("div", "wa-page wa-page-mix");
  p.devicePanel.classList.add("wa-mix-flex");
  mixPage.append(p.mixer, p.exp, p.devicePanel);

  const pages: Record<ModeId, HTMLElement> = {
    drums: drumsPage, pads: padsPage,
    synth: soundPage, song: songPage, mix: mixPage,
  };
  workarea.append(drumsPage, padsPage, soundPage, songPage, mixPage);

  // ── chassis mode keys ──
  const modeBar = el("div", "wa-modebar");
  const modeKeyBtns: HTMLElement[] = [];
  let activeMode = (localStorage.getItem("vv_studio_mode") as ModeId) || "drums";
  if ((activeMode as string) === "keys") activeMode = "synth";   // pre-D1 saved mode
  if (!MODES.some((m) => m.id === activeMode)) activeMode = "drums";

  function setMode(next: ModeId): void {
    activeMode = next;
    closeOverlays();
    modeKeyBtns.forEach((b, i) => b.classList.toggle("active", MODES[i].id === next));
    (Object.keys(pages) as ModeId[]).forEach((id) => { pages[id].hidden = id !== next; });
    if (next === "synth") p.onSynthVisible();
    if (next === "pads") fitDeck();
    p.onModeChange(MODES.find((m) => m.id === next)!.label);
    localStorage.setItem("vv_studio_mode", next);
  }

  MODES.forEach((m) => {
    const b = btn("", "wa-modekey");
    b.classList.remove("wa-btn");
    b.append(el("span", "wa-modekey-led"), document.createTextNode(m.label));
    help(b, m.helpText);
    b.addEventListener("click", () => setMode(m.id));
    modeKeyBtns.push(b);
    modeBar.append(b);
  });
  setMode(activeMode);

  // tutorial nav proxies — composite actions per tour stop:
  // 0 pads/perform+inspector · 1 pads/chop · 2 pads/steps · 3 synth/roll · 4 song · 5 mix · 6 synth/patch
  const nav = (fn: () => void): HTMLElement => {
    const b = el("button", "wa-nav-proxy") as HTMLButtonElement;
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  };
  const navButtons = [
    nav(() => { setMode("pads"); padsView = "perform"; paintPadsView(); padsPage.classList.add("show-inspector"); }),
    nav(() => { setMode("pads"); chopOverlay.open(); }),
    nav(() => { setMode("pads"); padsView = "steps"; paintPadsView(); }),
    nav(() => { setMode("synth"); synthView = "roll"; paintSynthView(); }),
    nav(() => setMode("song")),
    nav(() => setMode("mix")),
    nav(() => { setMode("synth"); synthView = "patch"; paintSynthView(); }),
  ];

  return { modeBar, workarea, getActiveMode: () => activeMode, navButtons, modeKeyBtns };
}
