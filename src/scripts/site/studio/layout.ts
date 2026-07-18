// One-screen frame (Synth Parity Plan, layout rework): fixed chrome, session
// rail on the left (Ableton's launch-while-editing loop), track-tab editor in
// the centre sized to the viewport, inspector right, and an Ableton-style
// bottom drawer whose segments hold everything that used to force scrolling.
// This module RE-HOUSES panels built elsewhere — it builds no instruments.
import { el, btn, help } from "./helpers";
import type { TrackId } from "./state";

export interface LayoutPanels {
  beat: HTMLElement;
  mpcPanel: HTMLElement;
  padSeqPanel: HTMLElement;
  pianoRoll: HTMLElement;
  synthKeys: HTMLElement;
  synthPanel: HTMLElement;          // patch editor + presets + scope (roll/keys pulled out)
  sessionGrid: HTMLElement;
  launchStatus: HTMLElement;
  song: HTMLElement;                // arrangement lanes + help (sessionGrid pulled out)
  mixer: HTMLElement;
  devicePanel: HTMLElement;
  exp: HTMLElement;
  rack: HTMLElement;
  chop: HTMLElement;
  scratchPanel: HTMLElement;
  inspector: HTMLElement;
  onSynthVisible: () => void;       // canvases need a redraw once measurable
}

export interface Layout {
  workarea: HTMLElement;
  getActiveTrack: () => TrackId;
  /** tutorial nav: composite buttons mapping the old 4-workspace steps */
  navButtons: HTMLElement[];
  trackTabBtns: HTMLElement[];
}

const TRACKS_UI: Array<{ id: TrackId; label: string; helpText: string }> = [
  { id: "drums", label: "DRUMS", helpText: "Program the eight drum lanes on the step grid." },
  { id: "pads", label: "PADS", helpText: "Perform on the 16 pads or paint their event lane." },
  { id: "synth", label: "SYNTH", helpText: "Sequence the VV-1 in the piano roll and play the keys." },
];

const SEGMENTS = ["SOUND", "FX", "MIX", "SONG", "PROJECT"] as const;
type Segment = (typeof SEGMENTS)[number];

export function buildLayout(p: LayoutPanels): Layout {
  // ── zones ──
  const workarea = el("div", "wa-frame");
  const rail = el("aside", "wa-rail");
  const editor = el("section", "wa-editor");
  const drawerZone = el("div", "wa-drawerzone");

  // rail: compact always-visible session grid
  const railHead = el("div", "wa-rail-head");
  const railTitle = el("span", "wa-lbl", "Session");
  const railToggle = btn("⟨", "wa-btn-sm wa-rail-toggle");
  help(railToggle, "Collapse or expand the session rail.");
  railToggle.addEventListener("click", () => {
    const collapsed = rail.classList.toggle("collapsed");
    railToggle.textContent = collapsed ? "⟩" : "⟨";
  });
  railHead.append(railTitle, railToggle);
  rail.append(railHead, p.sessionGrid, p.launchStatus);

  // centre: track tabs + editor host
  const trackBar = el("div", "wa-tracktabs");
  const trackTabBtns: HTMLElement[] = [];
  let activeTrack = (localStorage.getItem("vv_studio_track") as TrackId) || "drums";
  if (!TRACKS_UI.some((t) => t.id === activeTrack)) activeTrack = "drums";
  const editorHost = el("div", "wa-editor-host");

  // pads sub-view: Perform (deck) ⇄ Steps (event lane)
  const padsWrap = el("div", "wa-pads-editor");
  const padsToggle = el("div", "wa-subtabs");
  const performBtn = btn("Perform", "wa-subtab active");
  const stepsBtn = btn("Steps", "wa-subtab");
  help(performBtn, "The 4×4 pad deck for playing and recording.");
  help(stepsBtn, "The per-pad step lane for drawing and editing events.");
  let padsView: "perform" | "steps" = "perform";
  const paintPadsView = () => {
    performBtn.classList.toggle("active", padsView === "perform");
    stepsBtn.classList.toggle("active", padsView === "steps");
    p.mpcPanel.style.display = padsView === "perform" ? "" : "none";
    p.padSeqPanel.style.display = padsView === "steps" ? "" : "none";
  };
  performBtn.addEventListener("click", () => { padsView = "perform"; paintPadsView(); });
  stepsBtn.addEventListener("click", () => { padsView = "steps"; paintPadsView(); });
  padsToggle.append(performBtn, stepsBtn);
  padsWrap.append(padsToggle, p.mpcPanel, p.padSeqPanel);
  paintPadsView();

  const synthWrap = el("div", "wa-synth-editor");
  synthWrap.append(p.pianoRoll, p.synthKeys);

  const editors: Record<TrackId, HTMLElement> = { drums: p.beat, pads: padsWrap, synth: synthWrap };
  editorHost.append(p.beat, padsWrap, synthWrap);

  // ── bottom drawer ──
  const segBar = el("div", "wa-segbar");
  const segBtns = new Map<Segment, HTMLButtonElement>();
  let activeSeg: Segment = (localStorage.getItem("vv_studio_seg") as Segment) || "SOUND";
  if (!SEGMENTS.includes(activeSeg)) activeSeg = "SOUND";
  let drawerOpen = localStorage.getItem("vv_studio_drawer") !== "0";
  const drawerHost = el("div", "wa-drawer-host");

  const soundHost = el("div", "wa-seg-panel");     // per-track contents swapped below
  soundHost.append(p.rack, p.chop, p.scratchPanel, p.synthPanel);
  const segPanels: Record<Segment, HTMLElement> = {
    SOUND: soundHost,
    FX: p.devicePanel,
    MIX: p.mixer,
    SONG: p.song,
    PROJECT: p.exp,
  };
  Object.values(segPanels).forEach((panel) => drawerHost.append(panel));

  function paintSound(): void {
    // SOUND follows the track: drum/pads sound tools vs the synth patch editor
    const synthMode = activeTrack === "synth";
    p.synthPanel.style.display = synthMode ? "" : "none";
    p.rack.style.display = synthMode ? "none" : "";
    p.chop.style.display = synthMode ? "none" : "";
    p.scratchPanel.style.display = synthMode ? "none" : "";
    if (synthMode) p.onSynthVisible();
  }
  function paintDrawer(): void {
    drawerZone.classList.toggle("closed", !drawerOpen);
    segBtns.forEach((b, seg) => b.classList.toggle("active", drawerOpen && seg === activeSeg));
    (Object.keys(segPanels) as Segment[]).forEach((seg) => {
      segPanels[seg].style.display = seg === activeSeg ? "" : "none";
    });
    if (activeSeg === "SOUND") paintSound();
    localStorage.setItem("vv_studio_seg", activeSeg);
    localStorage.setItem("vv_studio_drawer", drawerOpen ? "1" : "0");
  }
  const segHelp: Record<Segment, string> = {
    SOUND: "Sound design for the active track — sample rack and chop for drums/pads, the full VV-1 patch editor for synth.",
    FX: "The master device chain: groove player, EQ, compressor, delay, reverb, limiter.",
    MIX: "Channel, synth and master levels with mute/solo.",
    SONG: "Per-track arrangement lanes — chain scenes into a full song.",
    PROJECT: "Save or open editable projects; export WAV or MP3.",
  };
  SEGMENTS.forEach((seg) => {
    const b = btn(seg, "wa-seg");
    b.classList.remove("wa-btn");
    help(b, segHelp[seg]);
    b.addEventListener("click", () => {
      if (drawerOpen && activeSeg === seg) { drawerOpen = false; }
      else { drawerOpen = true; activeSeg = seg; }
      paintDrawer();
    });
    segBtns.set(seg, b);
    segBar.append(b);
  });
  drawerZone.append(segBar, drawerHost);

  // ── track switching (also retargets the keyboard + SOUND segment) ──
  function paintTracks(): void {
    trackTabBtns.forEach((b, i) => b.classList.toggle("active", TRACKS_UI[i].id === activeTrack));
    (Object.keys(editors) as TrackId[]).forEach((t) => {
      editors[t].style.display = t === activeTrack ? "" : "none";
    });
    if (activeTrack === "synth") p.onSynthVisible();
    if (activeSeg === "SOUND") paintSound();
    localStorage.setItem("vv_studio_track", activeTrack);
  }
  TRACKS_UI.forEach((t) => {
    const b = btn(t.label, "wa-tab wa-tracktab");
    b.classList.remove("wa-btn");
    help(b, t.helpText);
    b.addEventListener("click", () => { activeTrack = t.id; paintTracks(); });
    trackTabBtns.push(b);
    trackBar.append(b);
  });
  editor.append(trackBar, editorHost);

  workarea.append(rail, editor, p.inspector, drawerZone);
  paintTracks();
  paintDrawer();

  // tutorial nav: composite actions standing in for the old 4 workspaces
  const nav = (fn: () => void): HTMLElement => {
    const b = el("button", "wa-nav-proxy") as HTMLButtonElement;
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  };
  const setTrack = (t: TrackId) => { activeTrack = t; paintTracks(); };
  const openSeg = (s: Segment) => { drawerOpen = true; activeSeg = s; paintDrawer(); };
  const navButtons = [
    nav(() => { setTrack("pads"); openSeg("SOUND"); }),   // old Create
    nav(() => { setTrack("drums"); }),                    // old Sequence
    nav(() => { openSeg("SONG"); }),                      // old Arrange
    nav(() => { openSeg("PROJECT"); }),                   // old Mix
  ];

  return { workarea, getActiveTrack: () => activeTrack, navButtons, trackTabBtns };
}
