// Mode frame (layout take 3): DSN-12 × FL Studio Mobile. Six full-screen
// modes behind a row of chassis mode keys that live under the LCD — one
// function per screen, each sized to fit its viewport with no page scroll
// (SOUND is the sole browse-and-scroll exception, by design).
// This module RE-HOUSES panels built elsewhere — it builds no instruments.
import { el, btn, help } from "./helpers";
import { buildOrb } from "./orb";

export type ModeId = "drums" | "pads" | "synth" | "song" | "dj" | "mix";
export type WorkspaceId = "arrange" | "edit" | "mix" | "play";

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
  djPanel: HTMLElement;
  mixer: HTMLElement;
  devicePanel: HTMLElement;
  chop: HTMLElement;
  inspector: HTMLElement;
  laneInspector: HTMLElement;
  loadSelectedSample: () => void;
  loadBreak: () => void;
  addCurrentToSong: (source: "beat" | "synth") => void;
  openProjectMenu: () => void;
  openTutorial: () => void;
  cycleScale: () => void;
  toggleFullscreen: () => void;
  togglePower: () => void;
  onSynthVisible: () => void;       // canvases need a redraw once measurable
  onModeChange: (label: string) => void;
  /** "what am I editing for" line shown in overlay headers (chop/scratch) —
   *  the overlays cover the page that gives them context. */
  overlayContext: () => string;
}

export interface Layout {
  modeBar: HTMLElement;
  menu: HTMLElement;
  workarea: HTMLElement;
  getActiveMode: () => ModeId;
  selectMode: (mode: ModeId, workspace?: WorkspaceId) => void;
  /** tutorial nav proxies — see navButtons construction at the bottom */
  navButtons: HTMLElement[];
}

const MODES: Array<{ id: ModeId; label: string; helpText: string }> = [
  { id: "drums", label: "BEAT", helpText: "Program drums on the step grid." },
  { id: "pads", label: "BEAT", helpText: "Finger-drum, sequence, load one-shots or chop a break." },
  { id: "synth", label: "SYNTH", helpText: "Write notes or shape a synth sound." },
  { id: "song", label: "SONG", helpText: "Build the finished song on the arrangement timeline." },
  { id: "dj", label: "DJ", helpText: "Mix local audio across two decks with cues, loops, EQ, sync and recording." },
  { id: "mix", label: "MIX", helpText: "Mixer, master devices, project save and export." },
];

export function buildLayout(p: LayoutPanels): Layout {
  const workarea = el("div", "wa-pagehost");

  const closeOverlays = () => {};

  // BEAT is the front door: finger-drumming, FL-style sequencing and sample
  // capture are views of one instrument, not separate destinations.
  const beatPage = el("div", "wa-page wa-page-beat wa-page-pads wa-page-drums");
  const beatMain = el("div", "wa-beat-main");
  const beatBar = el("div", "wa-subtabs wa-beat-tabs");
  const playBtn = btn("Play", "wa-subtab active");
  const stepsBtn = btn("Steps", "wa-subtab");
  const sampleBtn = btn("Sample", "wa-subtab");
  const quickSampleBtn = btn("Load sample", "wa-btn-sm wa-beat-primary");
  const quickBreakBtn = btn("Chop break", "wa-btn-sm");
  const addBeatBtn = btn("Add to song", "wa-btn-sm wa-add-song");
  const editLaneBtn = btn("Edit sound", "wa-btn-sm wa-edit-lane");
  const playHost = el("div", "wa-beat-view wa-beat-play"); playHost.append(p.mpcPanel);
  const stepsHost = el("div", "wa-beat-view wa-beat-steps"); stepsHost.append(p.beat, p.laneInspector);
  const sampleHost = el("div", "wa-beat-view wa-beat-sample");
  const oneShot = el("section", "wa-sample-card"); oneShot.append(p.inspector);
  const breakCard = el("section", "wa-sample-card wa-break-card"); breakCard.append(el("div", "wa-fx-title", "CHOP A BREAK"), p.chop);
  sampleHost.append(oneShot, breakCard);
  type BeatView = "play" | "steps" | "sample";
  const showBeatView = (view: BeatView) => {
    playBtn.classList.toggle("active", view === "play"); stepsBtn.classList.toggle("active", view === "steps"); sampleBtn.classList.toggle("active", view === "sample");
    playHost.hidden = view !== "play"; stepsHost.hidden = view !== "steps"; sampleHost.hidden = view !== "sample";
    editLaneBtn.hidden = view !== "steps";
    localStorage.setItem("vv_studio_beat_view", view);
  };
  playBtn.addEventListener("click", () => showBeatView("play"));
  stepsBtn.addEventListener("click", () => showBeatView("steps"));
  sampleBtn.addEventListener("click", () => showBeatView("sample"));
  quickSampleBtn.addEventListener("click", () => { showBeatView("sample"); oneShot.scrollIntoView({ block: "start" }); p.loadSelectedSample(); });
  quickBreakBtn.addEventListener("click", () => { showBeatView("sample"); breakCard.scrollIntoView({ block: "start" }); p.loadBreak(); });
  addBeatBtn.addEventListener("click", () => p.addCurrentToSong("beat"));
  editLaneBtn.addEventListener("click", () => stepsHost.classList.toggle("show-inspector"));
  beatBar.append(playBtn, stepsBtn, sampleBtn, el("span", "wa-toolbar-spacer"), quickSampleBtn, quickBreakBtn, addBeatBtn, editLaneBtn);
  beatMain.append(beatBar, playHost, stepsHost, sampleHost); beatPage.append(beatMain);
  showBeatView((localStorage.getItem("vv_studio_beat_view") as BeatView | null) ?? "play");

  // Side toolbar: performance essentials up front, pattern tools behind ⋯
  // (queried rather than passed — padsui owns the column, layout only folds it)
  const mpcSide = p.mpcPanel.querySelector(".wa-mpc-side");
  if (mpcSide) {
    mpcSide.classList.add("condensed");
    const moreBtn = btn("More", "wa-btn-sm wa-side-more");
    help(moreBtn, "Show the pattern tools — rotate, mutate, fill, ghosts, groove extraction, MIDI and resampling.");
    moreBtn.addEventListener("click", () => {
      const condensed = mpcSide.classList.toggle("condensed");
      moreBtn.textContent = condensed ? "More" : "Less";
    });
    mpcSide.append(moreBtn);
  }

  // Deck sizing is pure CSS since the un-squash (E): natural width up to
  // 720px, chunky pads, the page scrolls if it must.

  // SYNTH has two questions only: which notes, and what sound.
  const soundPage = el("div", "wa-page wa-page-synth");
  const synthBar = el("div", "wa-subtabs");
  const rollTab = btn("Notes", "wa-subtab");
  const patchTab = btn("Sound", "wa-subtab");
  const addSynthBtn = btn("Add to song", "wa-btn-sm wa-add-song");
  help(rollTab, "Write notes in the piano roll or play the keyboard.");
  help(patchTab, "Choose a preset or shape the essential sound controls.");
  addSynthBtn.addEventListener("click", () => p.addCurrentToSong("synth"));
  synthBar.append(rollTab, patchTab, el("span", "wa-toolbar-spacer"), addSynthBtn);
  const soundHost = el("div", "wa-sound-host");
  soundHost.append(p.synthPanel);
  p.synthPanel.hidden = false;
  const synthViewHost = el("div", "wa-synth-viewhost");
  synthViewHost.append(p.pianoRoll, soundHost);
  const synthMain = el("div", "wa-synth-main");
  const synthSide = el("div", "wa-synth-side");
  // WAVE ⇄ SPHERE share one screen slot: the waveform reads the synth bus,
  // the sphere the master bus, so they answer different questions.
  const scopeWrap = el("div", "wa-xy-wrap");
  const scopeHead = el("div", "wa-scope-head");
  const scopeTab = btn("WAVE", "wa-btn-sm active"), orbTab = btn("SPHERE", "wa-btn-sm");
  help(orbTab, "The Lysergic geodesic sphere — the whole mix pushes, tears and chromatically splits its wireframe.");
  const orb = buildOrb();
  orb.canvas.hidden = true;
  scopeHead.append(el("div", "wa-fx-title", "SCREEN"), scopeTab, orbTab);
  const showOrb = (on: boolean): void => {
    p.scope.hidden = on; orb.canvas.hidden = !on;
    scopeTab.classList.toggle("active", !on); orbTab.classList.toggle("active", on);
    orb.setActive(on && !soundPage.hidden);
    localStorage.setItem("vv_studio_screen", on ? "orb" : "scope");
  };
  scopeTab.addEventListener("click", () => showOrb(false));
  orbTab.addEventListener("click", () => showOrb(true));
  scopeWrap.append(scopeHead, p.scope, orb.canvas);
  showOrb(localStorage.getItem("vv_studio_screen") === "orb");
  const chordFold = el("details", "wa-synth-extra") as HTMLDetailsElement;
  chordFold.append(el("summary", "wa-fold-head", "Chords"), p.chordPanel);
  const performFold = el("details", "wa-synth-extra") as HTMLDetailsElement;
  performFold.append(el("summary", "wa-fold-head", "Perform"), p.xyPanel, scopeWrap);
  synthSide.append(chordFold, performFold);
  synthMain.append(synthViewHost, synthSide);
  soundPage.append(synthBar, synthMain, p.keysHeader, p.synthKeys);
  let synthView: "roll" | "patch" = localStorage.getItem("vv_studio_synthview") === "patch" ? "patch" : "roll";
  const paintSynthView = () => {
    rollTab.classList.toggle("active", synthView === "roll");
    patchTab.classList.toggle("active", synthView === "patch");
    p.pianoRoll.style.display = synthView === "roll" ? "" : "none";
    soundHost.style.display = synthView === "patch" ? "" : "none";
    soundPage.dataset.view = synthView;
    if (!soundPage.hidden) p.onSynthVisible();
    localStorage.setItem("vv_studio_synthview", synthView);
  };
  rollTab.addEventListener("click", () => { synthView = "roll"; paintSynthView(); });
  patchTab.addEventListener("click", () => { synthView = "patch"; paintSynthView(); });
  paintSynthView();

  // SONG stays out of the way until an idea needs structure.
  const songPage = el("div", "wa-page wa-page-song");
  const trackButtons: HTMLButtonElement[] = [];
  const arrangeMain = el("div", "wa-arrange-main"); arrangeMain.append(p.song); songPage.append(arrangeMain);

  // ── DJ ── two local-file decks. Provider embeds deliberately stay outside
  // this audio graph: their public APIs do not license extraction or mixing.
  const djPage = el("div", "wa-page wa-page-dj");
  djPage.append(p.djPanel);

  // ── MIX ── one console faceplate: channel strips fill the upper aperture
  // beside a master scope well, devices span the bottom as a rail. Export is
  // a rare terminal action, so it lives behind a transport key, not here.
  const mixPage = el("div", "wa-page wa-page-mix");
  p.mixer.classList.add("wa-mix-channels");
  p.devicePanel.classList.add("wa-mix-flex");
  const scopeWell = el("div", "wa-panel wa-mix-scope");
  const mixOrb = buildOrb();
  help(scopeWell, "Master output — the finished mix, post-limiter.");
  scopeWell.append(el("div", "wa-fx-title", "LYSERGIC SPHERE"), mixOrb.canvas);
  mixPage.append(p.mixer, scopeWell, p.devicePanel);

  const pages: Record<ModeId, HTMLElement> = {
    drums: beatPage, pads: beatPage,
    synth: soundPage, song: songPage, dj: djPage, mix: mixPage,
  };
  workarea.append(beatPage, soundPage, songPage, djPage, mixPage);

  // ── Flat FLM navigation (S2) ──
  // Six stable keys, no workspace layer: SONG is home, every surface is one
  // tap away, and the dock never changes height. The old workspace concept
  // survives only as an optional intent hint to setMode ("edit" opens pads on
  // Steps with the inspector; "play" opens Perform) — used by the track rail
  // and clip double-taps, never by the nav keys themselves.
  const modeBar = el("nav", "wa-modebar");
  modeBar.setAttribute("aria-label", "Studio screens");
  const primaryNav = el("div", "wa-primary-nav wa-primary-nav-flat");
  modeBar.append(primaryNav);

  // New visitors meet an instrument immediately; existing projects resume
  // where their owner left off, defaulting to the arranger when no view was
  // previously persisted.
  const savedMode = localStorage.getItem("vv_studio_last_mode") as ModeId | null;
  const validModes: ModeId[] = ["drums", "pads", "synth", "song", "dj", "mix"];
  let activeMode: ModeId = localStorage.getItem("vv_studio_v2")
    ? savedMode && validModes.includes(savedMode) ? savedMode : "pads"
    : "pads";
  localStorage.removeItem("vv_studio_workspace");                // retired layer (S2)
  localStorage.removeItem("vv_studio_mode");                     // retired legacy key
  let lastEditMode: ModeId = (["drums", "pads", "synth"] as ModeId[]).includes(activeMode) ? activeMode : "drums";
  const modeButtons = new Map<ModeId, HTMLButtonElement>();

  function setMode(next: ModeId, workspace?: WorkspaceId): void {
    activeMode = next;
    if ((["drums", "pads", "synth"] as ModeId[]).includes(next)) lastEditMode = next;
    closeOverlays();
    modeButtons.forEach((button, id) => button.classList.toggle("active", id === next || (id === "pads" && next === "drums")));
    new Set(Object.values(pages)).forEach((page) => { page.hidden = true; }); pages[next].hidden = false;
    trackButtons.forEach((button) => button.classList.toggle("active", button.dataset.mode === lastEditMode));
    // Intent hints: an explicit edit/play ask still shapes the pads page.
    if (next === "pads" && workspace === "play") showBeatView("play");
    if ((next === "pads" && workspace === "edit") || next === "drums") showBeatView("steps");
    if (next === "synth") p.onSynthVisible();
    orb.setActive(next === "synth" && !orb.canvas.hidden);
    mixOrb.setActive(next === "mix");
    localStorage.setItem("vv_studio_last_mode", next);
    p.onModeChange(MODES.find((m) => m.id === next)!.label);
  }

  ([
    ["pads", "BEAT", "◆"],
    ["synth", "SYNTH", "♪"],
    ["song", "SONG", "▤"],
    ["mix", "MIX", "≡"],
  ] as const).forEach(([id, label, icon]) => {
    const button = btn("", "wa-modekey") as HTMLButtonElement;
    button.classList.remove("wa-btn"); button.dataset.mode = id;
    button.append(el("span", "wa-mode-icon", icon), el("span", "wa-mode-label", label));
    button.addEventListener("click", () => setMode(id));
    help(button, MODES.find((m) => m.id === id)!.helpText);
    modeButtons.set(id, button); primaryNav.append(button);
  });
  const studioMenu = el("details", "wa-studio-menu") as HTMLDetailsElement;
  const menuSummary = el("summary", "wa-modekey wa-menu-key");
  menuSummary.append(el("span", "wa-mode-icon", "•••"), el("span", "wa-mode-label", "MENU"));
  const menuBody = el("div", "wa-studio-menu-body");
  const djMenuBtn = btn("DJ decks", "wa-menu-action"), projectMenuBtn = btn("Project & export", "wa-menu-action"), helpMenuBtn = btn("Help & shortcuts", "wa-menu-action");
  const scaleMenuBtn = btn("Interface scale", "wa-menu-action"), fullscreenMenuBtn = btn("Full screen", "wa-menu-action"), powerMenuBtn = btn("Audio power", "wa-menu-action");
  djMenuBtn.addEventListener("click", () => { studioMenu.open = false; setMode("dj"); });
  projectMenuBtn.addEventListener("click", () => { studioMenu.open = false; p.openProjectMenu(); });
  helpMenuBtn.addEventListener("click", () => { studioMenu.open = false; p.openTutorial(); });
  scaleMenuBtn.addEventListener("click", () => { studioMenu.open = false; p.cycleScale(); });
  fullscreenMenuBtn.addEventListener("click", () => { studioMenu.open = false; p.toggleFullscreen(); });
  powerMenuBtn.addEventListener("click", () => { studioMenu.open = false; p.togglePower(); });
  menuBody.append(djMenuBtn, projectMenuBtn, helpMenuBtn, el("div", "wa-menu-section", "DISPLAY & AUDIO"), scaleMenuBtn, fullscreenMenuBtn, powerMenuBtn); studioMenu.append(menuSummary, menuBody);
  setMode(activeMode);

  // tutorial nav proxies — composite actions per tour stop:
  // 0 pads/perform+inspector · 1 pads/chop · 2 pads/steps · 3 synth/roll · 4 song · 5 mix · 6 synth/patch · 7 dj
  const nav = (fn: () => void): HTMLElement => {
    const b = el("button", "wa-nav-proxy") as HTMLButtonElement;
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  };
  const navButtons = [
    nav(() => { setMode("pads"); showBeatView("play"); }),
    nav(() => { setMode("pads"); showBeatView("sample"); }),
    nav(() => { setMode("pads"); showBeatView("steps"); }),
    nav(() => { setMode("synth"); synthView = "roll"; paintSynthView(); }),
    nav(() => setMode("song")),
    nav(() => setMode("mix")),
    nav(() => { setMode("synth"); synthView = "patch"; paintSynthView(); }),
    nav(() => setMode("dj")),
  ];

  return { modeBar, menu: studioMenu, workarea, getActiveMode: () => activeMode, selectMode: (mode, workspace) => setMode(mode, workspace), navButtons };
}
