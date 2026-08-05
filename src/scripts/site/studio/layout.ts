// Mode frame (layout take 3): DSN-12 × FL Studio Mobile. Six full-screen
// modes behind a row of chassis mode keys that live under the LCD — one
// function per screen, each sized to fit its viewport with no page scroll
// (SOUND is the sole browse-and-scroll exception, by design).
// This module RE-HOUSES panels built elsewhere — it builds no instruments.
import { el, btn, help } from "./helpers";
import { buildOrb } from "./orb";

export type ModeId = "drums" | "pads" | "synth" | "song" | "mix";

export interface LayoutPanels {
  beat: HTMLElement;
  mpcPanel: HTMLElement;
  padSeqPanel: HTMLElement;
  padGrid: HTMLElement;
  pianoRoll: HTMLElement;
  synthKeys: HTMLElement;
  keysHeader: HTMLElement;
  xyPanel: HTMLElement;
  scope: HTMLElement;
  chordPanel: HTMLElement;
  synthPanel: HTMLElement;          // patch editor + presets (roll/keys pulled out in synthui)
  sessionGrid: HTMLElement;
  launchStatus: HTMLElement;
  song: HTMLElement;                // arrangement lanes + help (grid/status re-homed here)
  mixer: HTMLElement;
  devicePanel: HTMLElement;
  exp: HTMLElement;
  chop: HTMLElement;
  scratchPanel: HTMLElement;
  inspector: HTMLElement;
  laneInspector: HTMLElement;
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
  { id: "song", label: "CLIPS", helpText: "The clip launcher — every track's clips across the eight scenes." },
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

  // ── DRUMS ── grid + the per-lane sampler sidebar (click a drum name)
  const drumsPage = el("div", "wa-page wa-page-drums");
  const drumsMain = el("div", "wa-drums-main");
  const drumsBar = el("div", "wa-subtabs");
  const editLaneBtn = btn("Edit drum", "wa-subtab wa-editpad-toggle");
  help(editLaneBtn, "Show or hide the selected drum's sampler.");
  editLaneBtn.addEventListener("click", () => drumsPage.classList.toggle("show-inspector"));
  drumsBar.append(editLaneBtn);
  drumsMain.append(drumsBar, p.beat);
  drumsPage.append(drumsMain, p.laneInspector);

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

  // Deck sizing is pure CSS since the un-squash (E): natural width up to
  // 720px, chunky pads, the page scrolls if it must.

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
  // XY field column on the left of whichever view is up (LYSERGIC, F)
  const synthMain = el("div", "wa-synth-main");
  const synthSide = el("div", "wa-synth-side");
  // SCOPE ⇄ ORB share one screen slot; the orb reads the master bus, the
  // scope the synth bus, so they answer different questions.
  const scopeWrap = el("div", "wa-xy-wrap");
  const scopeHead = el("div", "wa-scope-head");
  const scopeTab = btn("SCOPE", "wa-btn-sm active"), orbTab = btn("ORB", "wa-btn-sm");
  help(orbTab, "The geodesic orb — a wireframe sphere the whole mix pushes around.");
  const orb = buildOrb();
  orb.canvas.hidden = true;
  scopeHead.append(el("div", "wa-fx-title", "SCREEN"), scopeTab, orbTab);
  const showOrb = (on: boolean): void => {
    p.scope.hidden = on; orb.canvas.hidden = !on;
    scopeTab.classList.toggle("active", !on); orbTab.classList.toggle("active", on);
    orb.setActive(on);
    localStorage.setItem("vv_studio_screen", on ? "orb" : "scope");
  };
  scopeTab.addEventListener("click", () => showOrb(false));
  orbTab.addEventListener("click", () => showOrb(true));
  scopeWrap.append(scopeHead, p.scope, orb.canvas);
  showOrb(localStorage.getItem("vv_studio_screen") === "orb");
  synthSide.append(p.xyPanel, scopeWrap, p.chordPanel);
  synthMain.append(synthSide, synthViewHost);
  soundPage.append(synthBar, synthMain, p.keysHeader, p.synthKeys);
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

  // ── ARRANGE ── session.ts owns the panel order (scenes fold + timeline)
  const songPage = el("div", "wa-page wa-page-song");
  songPage.append(p.song);

  // ── MIX ── mixer + export up front (export must not need a scroll to find),
  // devices flex below and scroll internally
  const mixPage = el("div", "wa-page wa-page-mix");
  p.mixer.classList.add("wa-mix-channels");
  p.exp.classList.add("wa-mix-export");
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
