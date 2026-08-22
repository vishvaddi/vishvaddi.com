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
  synthPanel: HTMLElement;          // patch editor (roll/keys and properties are separate surfaces)
  synthInspector: HTMLElement;
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
  { id: "drums", label: "RACK", helpText: "Sequence a synthesised or sampled drum kit." },
  { id: "pads", label: "PADS", helpText: "Sample vinyl, finger-drum one-shots or chop a break." },
  { id: "synth", label: "SYNTH", helpText: "Write notes or shape a synth sound." },
  { id: "song", label: "SONG", helpText: "Build the finished song on the arrangement timeline." },
  { id: "dj", label: "DJ", helpText: "Mix local audio across two decks with cues, loops, EQ, sync and recording." },
  { id: "mix", label: "MIX", helpText: "Mixer, master devices, project save and export." },
];

export function buildLayout(p: LayoutPanels): Layout {
  const workarea = el("div", "wa-pagehost");

  const closeOverlays = () => {};

  // BEAT is the front door. Detailed sequencing lives in DRUMS so neither
  // performance pads nor the eight-lane editor has to share a small aperture.
  const beatPage = el("div", "wa-page wa-page-beat wa-page-pads");
  const beatMain = el("div", "wa-beat-main");
  const beatBar = el("div", "wa-subtabs wa-beat-tabs");
  const playBtn = btn("Play", "wa-subtab active");
  const sampleBtn = btn("Sample", "wa-subtab");
  const quickSampleBtn = btn("Load sample", "wa-btn-sm wa-beat-primary");
  const quickBreakBtn = btn("Chop break", "wa-btn-sm");
  const addBeatBtn = btn("Add to song", "wa-btn-sm wa-add-song");
  const editPatternBtn = btn("Edit pattern", "wa-btn-sm wa-edit-pattern");
  const beatControlsBtn = btn("Controls", "wa-btn-sm wa-beat-controls-toggle");
  const playHost = el("div", "wa-beat-view wa-beat-play"); playHost.append(p.mpcPanel);
  const sampleHost = el("div", "wa-beat-view wa-beat-sample");
  const sampleTabs = el("div", "wa-sample-tabs");
  const oneShotBtn = btn("One-shot", "wa-subtab active"), chopBtn = btn("Chop", "wa-subtab");
  const oneShot = el("section", "wa-sample-card"); oneShot.append(p.inspector);
  const breakCard = el("section", "wa-sample-card wa-break-card"); breakCard.append(el("div", "wa-fx-title", "CHOP A BREAK"), p.chop);
  type SampleView = "one-shot" | "chop";
  const showSampleView = (view: SampleView) => {
    oneShotBtn.classList.toggle("active", view === "one-shot"); chopBtn.classList.toggle("active", view === "chop");
    oneShot.hidden = view !== "one-shot"; breakCard.hidden = view !== "chop";
    sampleHost.dataset.sampleView = view;
    localStorage.setItem("vv_studio_sample_view", view);
  };
  oneShotBtn.addEventListener("click", () => showSampleView("one-shot"));
  chopBtn.addEventListener("click", () => showSampleView("chop"));
  sampleTabs.append(oneShotBtn, chopBtn); sampleHost.append(sampleTabs, oneShot, breakCard);
  showSampleView(localStorage.getItem("vv_studio_sample_view") === "chop" ? "chop" : "one-shot");
  type BeatView = "play" | "sample";
  const showBeatView = (view: BeatView) => {
    playBtn.classList.toggle("active", view === "play"); sampleBtn.classList.toggle("active", view === "sample");
    playHost.hidden = view !== "play"; sampleHost.hidden = view !== "sample";
    localStorage.setItem("vv_studio_beat_view", view);
  };
  playBtn.addEventListener("click", () => showBeatView("play"));
  sampleBtn.addEventListener("click", () => showBeatView("sample"));
  quickSampleBtn.addEventListener("click", () => { showBeatView("sample"); showSampleView("one-shot"); p.loadSelectedSample(); });
  quickBreakBtn.addEventListener("click", () => { showBeatView("sample"); showSampleView("chop"); p.loadBreak(); });
  addBeatBtn.addEventListener("click", () => p.addCurrentToSong("beat"));
  beatControlsBtn.addEventListener("click", () => beatPage.classList.toggle("show-controls"));
  beatBar.append(playBtn, sampleBtn, el("span", "wa-toolbar-spacer"), beatControlsBtn, quickSampleBtn, quickBreakBtn, editPatternBtn, addBeatBtn);
  beatMain.append(beatBar, playHost, sampleHost); beatPage.append(beatMain);
  showBeatView(localStorage.getItem("vv_studio_beat_view") === "sample" ? "sample" : "play");

  // DRUMS owns one roomy editor plus one selected-lane property rail.
  const drumsPage = el("div", "wa-page wa-page-drums");
  const drumsBar = el("div", "wa-subtabs wa-drums-tabs");
  const drumPropsBtn = btn("Properties", "wa-btn-sm wa-drum-properties-toggle");
  const addDrumsBtn = btn("Add to song", "wa-btn-sm wa-add-song");
  addDrumsBtn.addEventListener("click", () => p.addCurrentToSong("beat"));
  drumPropsBtn.addEventListener("click", () => drumsPage.classList.toggle("show-inspector"));
  drumsBar.append(el("span", "wa-view-title", "DRUM RACK SEQUENCER"), el("span", "wa-toolbar-spacer"), drumPropsBtn, addDrumsBtn);
  const drumsWorkspace = el("div", "wa-drums-workspace");
  const closeDrumPropsBtn = btn("Close properties", "wa-btn-sm wa-properties-close");
  closeDrumPropsBtn.addEventListener("click", () => drumsPage.classList.remove("show-inspector"));
  p.laneInspector.prepend(closeDrumPropsBtn);
  drumsWorkspace.append(p.beat, p.laneInspector);
  drumsPage.append(drumsBar, drumsWorkspace);

  // Side toolbar: performance essentials up front, pattern tools behind ⋯
  // (queried rather than passed — padsui owns the column, layout only folds it)
  const mpcSide = p.mpcPanel.querySelector(".wa-mpc-side");
  if (mpcSide) {
    mpcSide.classList.add("condensed");
    const closeControlsBtn = btn("Close controls", "wa-btn-sm wa-properties-close wa-beat-controls-close");
    closeControlsBtn.addEventListener("click", () => beatPage.classList.remove("show-controls"));
    mpcSide.prepend(closeControlsBtn);
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
  const keyboardBtn = btn("Keyboard", "wa-btn-sm wa-keyboard-toggle");
  const addSynthBtn = btn("Add to song", "wa-btn-sm wa-add-song");
  const synthPropsBtn = btn("Properties", "wa-btn-sm wa-synth-properties-toggle");
  help(rollTab, "Write notes in the piano roll or play the keyboard.");
  help(patchTab, "Choose a preset or shape the essential sound controls.");
  addSynthBtn.addEventListener("click", () => p.addCurrentToSong("synth"));
  synthPropsBtn.addEventListener("click", () => soundPage.classList.toggle("show-inspector"));
  synthBar.append(rollTab, patchTab, el("span", "wa-toolbar-spacer"), keyboardBtn, synthPropsBtn, addSynthBtn);
  const soundHost = el("div", "wa-sound-host");
  soundHost.append(p.synthPanel);
  p.synthPanel.hidden = false;
  const synthViewHost = el("div", "wa-synth-viewhost");
  synthViewHost.append(p.pianoRoll, soundHost);
  const synthMain = el("div", "wa-synth-main");
  const synthSide = p.synthInspector;
  synthSide.classList.add("wa-synth-side");
  const closeSynthPropsBtn = btn("Close properties", "wa-btn-sm wa-properties-close");
  closeSynthPropsBtn.addEventListener("click", () => soundPage.classList.remove("show-inspector"));
  synthSide.prepend(closeSynthPropsBtn);
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
  const presetPane = el("div", "wa-synth-property-pane wa-synth-preset-pane");
  Array.from(synthSide.children)
    .filter((child) => child !== closeSynthPropsBtn && !child.classList.contains("wa-inspector-title"))
    .forEach((child) => presetPane.append(child));
  const chordPane = el("div", "wa-synth-property-pane"); chordPane.append(p.chordPanel);
  const performPane = el("div", "wa-synth-property-pane"); performPane.append(p.xyPanel, scopeWrap);
  const synthPropertyTabs = el("div", "wa-property-tabs");
  const presetPropsBtn = btn("Preset", "wa-subtab active"), chordPropsBtn = btn("Chords", "wa-subtab"), performPropsBtn = btn("Perform", "wa-subtab");
  const showSynthProperties = (view: "preset" | "chords" | "perform") => {
    presetPropsBtn.classList.toggle("active", view === "preset"); chordPropsBtn.classList.toggle("active", view === "chords"); performPropsBtn.classList.toggle("active", view === "perform");
    presetPane.hidden = view !== "preset"; chordPane.hidden = view !== "chords"; performPane.hidden = view !== "perform";
    localStorage.setItem("vv_studio_synth_properties", view);
  };
  presetPropsBtn.addEventListener("click", () => showSynthProperties("preset")); chordPropsBtn.addEventListener("click", () => showSynthProperties("chords")); performPropsBtn.addEventListener("click", () => showSynthProperties("perform"));
  synthPropertyTabs.append(presetPropsBtn, chordPropsBtn, performPropsBtn);
  synthSide.append(synthPropertyTabs, presetPane, chordPane, performPane);
  const savedSynthProperties = localStorage.getItem("vv_studio_synth_properties");
  showSynthProperties(savedSynthProperties === "chords" || savedSynthProperties === "perform" ? savedSynthProperties : "preset");
  synthMain.append(synthViewHost, synthSide);
  p.keysHeader.classList.add("wa-keys-header");
  soundPage.append(synthBar, synthMain, p.keysHeader, p.synthKeys);
  let synthView: "roll" | "patch" = localStorage.getItem("vv_studio_synthview") === "patch" ? "patch" : "roll";
  const keyboardPreference = () => localStorage.getItem(`vv_studio_keyboard_${synthView}`);
  let keyboardVisible = keyboardPreference() ? keyboardPreference() !== "hidden" : synthView === "roll";
  const paintKeyboard = () => {
    soundPage.classList.toggle("keyboard-hidden", !keyboardVisible);
    keyboardBtn.classList.toggle("active", keyboardVisible);
    keyboardBtn.setAttribute("aria-pressed", String(keyboardVisible));
  };
  keyboardBtn.addEventListener("click", () => {
    keyboardVisible = !keyboardVisible;
    localStorage.setItem(`vv_studio_keyboard_${synthView}`, keyboardVisible ? "visible" : "hidden");
    paintKeyboard();
  });
  const paintSynthView = () => {
    rollTab.classList.toggle("active", synthView === "roll");
    patchTab.classList.toggle("active", synthView === "patch");
    p.pianoRoll.style.display = synthView === "roll" ? "" : "none";
    soundHost.style.display = synthView === "patch" ? "" : "none";
    soundPage.dataset.view = synthView;
    keyboardVisible = keyboardPreference() ? keyboardPreference() !== "hidden" : synthView === "roll";
    paintKeyboard();
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
  const mixTabs = el("div", "wa-mix-tabs");
  const channelsBtn = btn("Channels", "wa-subtab active"), devicesBtn = btn("Devices", "wa-subtab"), scopeBtn = btn("Scope", "wa-subtab");
  p.mixer.classList.add("wa-mix-channels");
  p.devicePanel.classList.add("wa-mix-flex");
  const scopeWell = el("div", "wa-panel wa-mix-scope");
  const mixOrb = buildOrb();
  help(scopeWell, "Master output — the finished mix, post-limiter.");
  scopeWell.append(el("div", "wa-fx-title", "LYSERGIC SPHERE"), mixOrb.canvas);
  const showMixView = (view: "channels" | "devices" | "scope") => {
    mixPage.dataset.mobileView = view;
    channelsBtn.classList.toggle("active", view === "channels"); devicesBtn.classList.toggle("active", view === "devices"); scopeBtn.classList.toggle("active", view === "scope");
    localStorage.setItem("vv_studio_mix_view", view);
  };
  channelsBtn.addEventListener("click", () => showMixView("channels")); devicesBtn.addEventListener("click", () => showMixView("devices")); scopeBtn.addEventListener("click", () => showMixView("scope"));
  mixTabs.append(channelsBtn, devicesBtn, scopeBtn);
  mixPage.append(mixTabs, p.mixer, scopeWell, p.devicePanel);
  const savedMixView = localStorage.getItem("vv_studio_mix_view");
  showMixView(savedMixView === "devices" || savedMixView === "scope" ? savedMixView : "channels");
  editPatternBtn.addEventListener("click", () => setMode("drums"));

  const pages: Record<ModeId, HTMLElement> = {
    drums: drumsPage, pads: beatPage,
    synth: soundPage, song: songPage, dj: djPage, mix: mixPage,
  };
  workarea.append(beatPage, drumsPage, soundPage, songPage, djPage, mixPage);

  // Six stable destinations, no workspace layer. The mobile dock and desktop
  // rail share these exact controls, with BEAT as the immediate front door.
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
    modeButtons.forEach((button, id) => button.classList.toggle("active", id === next));
    new Set(Object.values(pages)).forEach((page) => { page.hidden = true; }); pages[next].hidden = false;
    trackButtons.forEach((button) => button.classList.toggle("active", button.dataset.mode === lastEditMode));
    // Intent hints: an explicit edit/play ask still shapes the pads page.
    if (next === "pads" && workspace === "play") showBeatView("play");
    if (next === "pads" && workspace === "edit") { setMode("drums"); return; }
    if (next === "synth") p.onSynthVisible();
    orb.setActive(next === "synth" && !orb.canvas.hidden);
    mixOrb.setActive(next === "mix");
    localStorage.setItem("vv_studio_last_mode", next);
    p.onModeChange(MODES.find((m) => m.id === next)!.label);
  }

  ([
    ["pads", "BEAT", "◆"],
    ["drums", "DRUMS", "▦"],
    ["synth", "SYNTH", "♪"],
    ["song", "SONG", "▤"],
    ["dj", "DJ", "◉"],
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
  const projectMenuBtn = btn("Project & export", "wa-menu-action"), helpMenuBtn = btn("Help & shortcuts", "wa-menu-action");
  const scaleMenuBtn = btn("Interface scale", "wa-menu-action"), fullscreenMenuBtn = btn("Full screen", "wa-menu-action"), powerMenuBtn = btn("Audio power", "wa-menu-action");
  projectMenuBtn.addEventListener("click", () => { studioMenu.open = false; p.openProjectMenu(); });
  helpMenuBtn.addEventListener("click", () => { studioMenu.open = false; p.openTutorial(); });
  scaleMenuBtn.addEventListener("click", () => { studioMenu.open = false; p.cycleScale(); });
  fullscreenMenuBtn.addEventListener("click", () => { studioMenu.open = false; p.toggleFullscreen(); });
  powerMenuBtn.addEventListener("click", () => { studioMenu.open = false; p.togglePower(); });
  menuBody.append(projectMenuBtn, helpMenuBtn, el("div", "wa-menu-section", "DISPLAY & AUDIO"), scaleMenuBtn, fullscreenMenuBtn, powerMenuBtn); studioMenu.append(menuSummary, menuBody);
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
    nav(() => setMode("drums")),
    nav(() => { setMode("synth"); synthView = "roll"; paintSynthView(); }),
    nav(() => setMode("song")),
    nav(() => setMode("mix")),
    nav(() => { setMode("synth"); synthView = "patch"; paintSynthView(); }),
    nav(() => setMode("dj")),
  ];

  return { modeBar, menu: studioMenu, workarea, getActiveMode: () => activeMode, selectMode: (mode, workspace) => setMode(mode, workspace), navButtons };
}
