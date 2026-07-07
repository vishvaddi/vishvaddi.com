import { el, btn } from "./helpers";
import type { Shell } from "./shell";

interface TutorialTargets { padGrid: HTMLElement; selectedSampleEditor: HTMLElement; waveform: HTMLElement; eventLane: HTMLElement; pianoRoll: HTMLElement; sessionGrid: HTMLElement; chain: HTMLElement; devicePanel: HTMLElement; exp: HTMLElement }

export function buildTutorial(shell: Shell, targets: TutorialTargets): void {
  const tutorial = el("div", "wa-tutorial"); tutorial.hidden = true;
  const shade = el("div", "wa-tutorial-shade"), card = el("div", "wa-tutorial-card"), stepLabel = el("span", "wa-tutorial-step"), title = el("h2", "wa-tutorial-title"), text = el("p", "wa-tutorial-text"), actions = el("div", "wa-tutorial-actions");
  const previous = btn("Previous", "wa-btn-sm"), next = btn("Next", "wa-btn-sm"), close = btn("Skip tutorial", "wa-btn-sm");
  actions.append(close, previous, next); card.append(stepLabel, title, text, actions); tutorial.append(shade, card); document.body.append(tutorial);
  const steps = [
    [0, shell.tabBtns[0], "Create", "Start here when building a new beat."], [0, targets.padGrid, "Play the pads", "Use mouse, touch, keyboard or MIDI; drop audio onto a pad to replace it."],
    [0, targets.selectedSampleEditor, "Shape the selected pad", "Trim, tune, filter, choke, reverse, loop or warp it here."], [0, targets.waveform, "Chop a break", "Load or record audio, slice it, then assign slices to the active bank."],
    [1, targets.eventLane, "Sequence pad events", "Paint hits and edit velocity, chance, microtiming and ratchets."], [1, targets.pianoRoll, "Add musical parts", "Program synth notes in the piano roll or play them live."],
    [2, targets.sessionGrid, "Launch clips and scenes", "Launch changes wait for the next bar."], [2, targets.chain, "Arrange the song", "Choose scenes for song slots, then enable Song mode."],
    [3, targets.devicePanel, "Process the sound", "Use groove controls and device switches to shape the signal chain."], [3, targets.exp, "Save and export", "Save editable project data before rendering audio."],
    [3, shell.transportBar, "Transport stays available", "Playback, tempo and project controls remain visible in every workspace."],
  ] as const;
  let index = 0, target: HTMLElement | null = null;
  const finish = (): void => { tutorial.hidden = true; target?.classList.remove("wa-tutorial-target"); target = null; localStorage.setItem("vv_studio_tutorial_seen", "1"); };
  const show = (nextIndex: number): void => { index = Math.max(0, Math.min(steps.length - 1, nextIndex)); const current = steps[index]; target?.classList.remove("wa-tutorial-target"); shell.tabBtns[current[0]].click(); target = current[1]; target.classList.add("wa-tutorial-target"); target.scrollIntoView({ block: "center", behavior: "smooth" }); stepLabel.textContent = `${index + 1} / ${steps.length}`; title.textContent = current[2]; text.textContent = current[3]; previous.disabled = index === 0; next.textContent = index === steps.length - 1 ? "Finish" : "Next"; tutorial.hidden = false; };
  previous.addEventListener("click", () => show(index - 1)); next.addEventListener("click", () => index === steps.length - 1 ? finish() : show(index + 1)); close.addEventListener("click", finish); shade.addEventListener("click", finish); shell.tutorialBtn.addEventListener("click", () => show(0));
}
