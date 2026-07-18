// Help + tutorial overlay — one overlay, two views: the guided spotlight
// tour and Browse Help (searchable reference + shortcuts). Extracted verbatim
// from index.ts (Phase 0 split); every tour step's DOM target arrives via the
// targets object because the tour points at elements from every section.
import { el, btn, help } from "./helpers";

export interface TutorialTargets {
  tabBtns: HTMLElement[];
  padGrid: HTMLElement;
  selectedSampleEditor: HTMLElement;
  waveform: HTMLElement;
  eventLane: HTMLElement;
  pianoRoll: HTMLElement;
  gridSel: HTMLElement;
  presetRow: HTMLElement;
  sessionGrid: HTMLElement;
  arrangeLanes: HTMLElement;
  devicePanel: HTMLElement;
  exp: HTMLElement;
  transportBar: HTMLElement;
  tutorialBtn: HTMLElement;
}

export function buildTutorial(t: TutorialTargets): { showTutorialStep: (index: number) => void } {
  const { tabBtns, padGrid, selectedSampleEditor, waveform, eventLane, pianoRoll, gridSel, presetRow, sessionGrid, arrangeLanes, devicePanel, exp, transportBar, tutorialBtn } = t;
  const shortcutsBox = el("div", "wa-help-shortcuts");
  shortcutsBox.append(el("div", "wa-fx-title", "KEYBOARD SHORTCUTS"));
  ([
    ["Space", "Play / stop"],
    ["Ctrl+Z", "Undo"],
    ["Ctrl+Shift+Z or Ctrl+Y", "Redo"],
    ["1-4, Q-R, A-F, Z-V", "Play MPC pads (Create tab)"],
    ["Z–M row", "Play synth notes C3–B3 (Sequence tab)"],
    ["Q–P row", "Play synth notes C4–E5 (Sequence tab)"],
    ["− / =", "Shift synth keyboard octave (Sequence tab)"],
    ["Enter", "Confirm the typed BPM"],
  ] as const).forEach(([key, desc]) => {
    const row = el("div", "wa-help-shortcut-row");
    row.append(el("span", "wa-help-key", key), el("span", "wa-help-desc", desc));
    shortcutsBox.append(row);
  });

  const helpSearch = document.createElement("input");
  helpSearch.type = "text"; helpSearch.placeholder = "Search help…"; helpSearch.className = "wa-preset-search";
  const helpTopics: Array<{ section: string; title: string; text: string }> = [
    { section: "Create", title: "Pads & sampling", text: "Drop an audio file onto any pad, or record from the mic. The inspector on the right shows the selected pad's tune, start/end, filter, attack/decay, choke group, loop and warp controls." },
    { section: "Create", title: "Chopping breaks", text: "Load or record a longer break, then slice it equally, by transient detection, or manually. Sync BPM matches the project tempo to the break; Assign + pattern replays the chop across the pads." },
    { section: "Create", title: "Scratch pad", text: "Drag the vinyl left/right to scratch the selected pad's sample (or the loaded break) over the beat. Forward and backward both play; release to stop." },
    { section: "Create", title: "MPC performance tools", text: "Full Level forces max velocity; 16 Levels maps the pad bank across velocity, pitch, filter or start. Note Repeat retriggers a held pad. Rotate, Mutate, Fill and Ghosts generate variations on the selected pad's pattern; Extract Groove captures its timing/velocity feel into the Player device." },
    { section: "Sequence", title: "Drum sequencer", text: "Click a step to toggle a hit, right-click (or long-press) for velocity. Click a drum's name to open its sound-design panel below the row." },
    { section: "Sequence", title: "Pad sequence grid", text: "Every pad in the current bank gets its own row — switching the selected pad highlights its row instead of swapping what you're looking at. Velocity/Chance/Micro/Ratchet sliders apply to whichever pad is selected." },
    { section: "Sequence", title: "Piano roll", text: "Drag empty space to draw a note and set its length. Drag a note's body to move it (drag vertically to change pitch), drag its right edge to resize, click without dragging to delete, right-click for velocity. Notes snap to the Grid setting in the transport bar." },
    { section: "Sequence", title: "Grid / quantize", text: "The Grid selector in the transport bar (1/4, 1/8, 1/16) sets the snap resolution for the piano roll, and the beat-line grouping shown on the drum and pad grids." },
    { section: "Synth", title: "Oscillators & wavetables", text: "Each oscillator picks a table (Basic, PWM, Harmonic, Vocal, Digital) and a position that morphs through it. The mini waveform above each oscillator shows the current shape live." },
    { section: "Synth", title: "Text-to-wavetable", text: "Type a word into an oscillator's text box and hit Generate — it hashes into a unique, reproducible wavetable shape, saved as part of the patch." },
    { section: "Synth", title: "Filter & envelopes", text: "The filter has low/high/band-pass/notch types with resonance and envelope amount. Drag the envelope shape directly (attack peak, decay/sustain point, release end) or use the sliders below it — both stay in sync." },
    { section: "Synth", title: "LFOs & mod matrix", text: "Two LFOs and a 6-slot mod matrix route sources (LFOs, envelope 2, velocity, macros) to destinations (pitch, cutoff, amp, pan, oscillator position). A small MOD badge appears on the Cutoff and Position sliders when something is modulating them." },
    { section: "Synth", title: "Presets, Randomize & Simple view", text: "Search or filter presets by category. Randomize jitters the current patch within musical ranges. Simple view collapses the editor to Wave/Filter/Envelope/Volume for quick sound design; Advanced view shows everything including the mod matrix and macros." },
    { section: "Arrange", title: "Session view", text: "Each column is a track (drums/pads/synth), each row a scene. Launch single clips or a whole scene — changes land on the next bar so transitions stay in time." },
    { section: "Arrange", title: "Arrangement", text: "Each track keeps its own ordered list of blocks (scene + bar length), independent of the other tracks. Add, resize (+/-) or reassign a block's scene, then enable Arrange mode in the transport to play the full arrangement." },
    { section: "Mix", title: "Mixer & device rack", text: "The Mixer sets channel/synth/master levels. The Devices panel is the actual signal chain — Channel EQ, Bus Compressor, Feedback Delay, Convolution Reverb and Master Limiter each have their own editable parameters plus a bypass toggle." },
    { section: "Mix", title: "Metronome & BPM", text: "Type an exact BPM directly, or use the – / + buttons. The Metro toggle enables the click (included in export while on); its volume slider sits right beside the toggle." },
    { section: "Mix", title: "Save, export & undo", text: "Save Project downloads an editable file with all patterns, sounds and settings; Open Project loads one back. Export WAV/MP3 renders either the launched clips or the full arrangement. Undo/Redo (or Ctrl+Z / Ctrl+Shift+Z) cover pattern, sample, synth-patch and arrangement edits." },
  ];
  const helpList = el("div", "wa-help-topics");
  function renderHelpTopics(query: string): void {
    helpList.replaceChildren();
    const q = query.trim().toLowerCase();
    const matches = helpTopics.filter((t) => !q || t.title.toLowerCase().includes(q) || t.text.toLowerCase().includes(q) || t.section.toLowerCase().includes(q));
    if (!matches.length) { helpList.append(el("p", "wa-help", "No matching topics.")); return; }
    let lastSection = "";
    matches.forEach((t) => {
      if (t.section !== lastSection) { helpList.append(el("div", "wa-fx-title", t.section.toUpperCase())); lastSection = t.section; }
      const item = el("div", "wa-help-topic");
      item.append(el("h3", "wa-help-topic-title", t.title), el("p", "wa-help", t.text));
      helpList.append(item);
    });
  }
  helpSearch.addEventListener("input", () => renderHelpTopics(helpSearch.value));
  renderHelpTopics("");


  const tutorial = el("div", "wa-tutorial"); tutorial.hidden = true;
  const tutorialShade = el("div", "wa-tutorial-shade");
  const tutorialCard = el("div", "wa-tutorial-card");
  const tutorialStep = el("span", "wa-tutorial-step"), tutorialTitle = el("h2", "wa-tutorial-title"), tutorialText = el("p", "wa-tutorial-text");
  const tourView = el("div", "wa-tutorial-tour-view");
  tourView.append(tutorialStep, tutorialTitle, tutorialText);
  const browseView = el("div", "wa-tutorial-browse-view"); browseView.hidden = true;
  browseView.append(el("h2", "wa-tutorial-title", "Help"), shortcutsBox, el("div", "wa-sep-h"), helpSearch, helpList);
  const tutorialActions = el("div", "wa-tutorial-actions");
  const tutorialPrev = btn("Previous", "wa-btn-sm"), tutorialNext = btn("Next", "wa-btn-sm"), tutorialClose = btn("✕ Close", "wa-btn-sm");
  const browseHelpBtn = btn("Browse Help ▤", "wa-btn-sm"), takeTourBtn = btn("▶ Take the Tour", "wa-btn-sm");
  tutorialActions.append(tutorialClose, browseHelpBtn, takeTourBtn, tutorialPrev, tutorialNext);
  tutorialCard.append(tourView, browseView, tutorialActions);
  tutorial.append(tutorialShade, tutorialCard); document.body.append(tutorial);
  function setTutorialMode(mode: "tour" | "browse"): void {
    tourView.hidden = mode !== "tour";
    browseView.hidden = mode !== "browse";
    tutorialCard.classList.toggle("wa-tutorial-browsing", mode === "browse");
    tutorialPrev.hidden = mode !== "tour"; tutorialNext.hidden = mode !== "tour";
    browseHelpBtn.hidden = mode !== "tour"; takeTourBtn.hidden = mode !== "browse";
  }
  help(browseHelpBtn, "Switch to a searchable reference covering every section, plus keyboard shortcuts.");
  help(takeTourBtn, "Switch back to the guided step-by-step tour.");
  const tutorialSteps: Array<{ workspace: number; target: HTMLElement; title: string; text: string }> = [
    { workspace: 0, target: padGrid, title: "Create", text: "This is the sampling and performance workspace. Start here whenever you are building a new beat." },
    { workspace: 0, target: padGrid, title: "Play the pads", text: "Use the mouse, touch, computer keyboard or MIDI controller. Drop an audio file directly onto any pad to replace it." },
    { workspace: 0, target: selectedSampleEditor, title: "Shape the selected pad", text: "The inspector follows your selected pad across every workspace. Trim, tune, filter, choke, reverse, loop or warp it here." },
    { workspace: 0, target: waveform, title: "Chop a break", text: "Load or record audio, choose equal, transient or manual slicing, then assign the slices to the active pad bank." },
    { workspace: 1, target: eventLane, title: "Sequence pad events", text: "Drag across the lane to paint or erase hits. Use velocity, chance, microtiming and ratchets to make the pattern move." },
    { workspace: 1, target: pianoRoll, title: "Add musical parts", text: "Program synth notes in the piano roll or play them from the on-screen and computer keyboards. Drag a note to move it, its right edge to resize, or click without dragging to delete it." },
    { workspace: 1, target: gridSel, title: "Grid & quantize", text: "Sets the snap resolution for the piano roll, and the beat-line grouping shown on the drum and pad grids. Coarser (1/4) locks notes to the beat; 1/16 allows free placement." },
    { workspace: 1, target: presetRow, title: "The VV-1 synth", text: "Search or randomize a patch, or drag the envelope shape and watch the live waveform preview react. Simple view collapses the editor to the essentials — Advanced view reveals the full mod matrix." },
    { workspace: 2, target: sessionGrid, title: "Launch clips and scenes", text: "Each column is a track and each row a scene. Launch single clips or a whole row — changes wait for the next bar so transitions stay in time." },
    { workspace: 2, target: arrangeLanes, title: "Arrange the song", text: "Each track keeps its own list of blocks (scene + bar length) — add, resize or reassign them, then enable Arrange mode in the transport to play them back independently." },
    { workspace: 3, target: devicePanel, title: "Process the sound", text: "Use macros, groove controls and device bypass switches to shape the complete signal chain." },
    { workspace: 3, target: exp, title: "Save and export", text: "Save an editable project before exporting. WAV preserves full quality; MP3 is smaller for sharing." },
    { workspace: 3, target: transportBar, title: "Transport stays available", text: "Playback, BPM, grid, metronome, undo and tutorial controls remain visible in every workspace. Space plays/stops; Ctrl+Z undoes." },
    { workspace: 3, target: tutorialBtn, title: "Come back anytime", text: "This same button reopens things later — Browse Help (top of this card) is a searchable reference for every section plus the full keyboard-shortcut list, or replay this tour from the start." },
  ];
  let tutorialIndex = 0, tutorialTarget: HTMLElement | null = null;
  function closeTutorial(): void {
    tutorial.hidden = true; tutorialTarget?.classList.remove("wa-tutorial-target"); tutorialTarget = null;
    localStorage.setItem("vv_studio_tutorial_seen", "1");
  }
  function showTutorialStep(index: number): void {
    setTutorialMode("tour");
    tutorialIndex = Math.max(0, Math.min(tutorialSteps.length - 1, index));
    const step = tutorialSteps[tutorialIndex];
    tutorialTarget?.classList.remove("wa-tutorial-target"); tabBtns[step.workspace].click();
    tutorialTarget = step.target; tutorialTarget.classList.add("wa-tutorial-target");
    tutorialTarget.scrollIntoView({ block: "center", behavior: "smooth" });
    tutorialStep.textContent = `${tutorialIndex + 1} / ${tutorialSteps.length}`;
    tutorialTitle.textContent = step.title; tutorialText.textContent = step.text;
    tutorialPrev.disabled = tutorialIndex === 0;
    tutorialNext.textContent = tutorialIndex === tutorialSteps.length - 1 ? "Finish" : "Next";
    tutorial.hidden = false;
  }
  function showHelpBrowse(): void {
    tutorialTarget?.classList.remove("wa-tutorial-target"); tutorialTarget = null;
    setTutorialMode("browse");
    tutorial.hidden = false;
  }
  tutorialPrev.addEventListener("click", () => showTutorialStep(tutorialIndex - 1));
  tutorialNext.addEventListener("click", () => {
    if (tutorialIndex === tutorialSteps.length - 1) closeTutorial(); else showTutorialStep(tutorialIndex + 1);
  });
  tutorialClose.addEventListener("click", closeTutorial);
  tutorialShade.addEventListener("click", closeTutorial);
  browseHelpBtn.addEventListener("click", showHelpBrowse);
  takeTourBtn.addEventListener("click", () => showTutorialStep(0));

  return { showTutorialStep };
}
