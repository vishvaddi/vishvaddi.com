import { el, btn } from "./helpers";
import type { TrackId } from "./state";
import type { Shell } from "./shell";
import { ctx } from "./ctx";

interface TutorialTargets { padGrid: HTMLElement; selectedSampleEditor: HTMLElement; waveform: HTMLElement; eventLane: HTMLElement; pianoRoll: HTMLElement; sessionGrid: HTMLElement; chain: HTMLElement; devicePanel: HTMLElement; exp: HTMLElement }

export function buildTutorial(shell: Shell, targets: TutorialTargets): void {
  const tutorial = el("div", "wa-tutorial"); tutorial.hidden = true; const shade = el("div", "wa-tutorial-shade"), card = el("div", "wa-tutorial-card"), stepLabel = el("span", "wa-tutorial-step"), title = el("h2", "wa-tutorial-title"), text = el("p", "wa-tutorial-text"), actions = el("div", "wa-tutorial-actions");
  const previous = btn("Previous", "wa-btn-sm"), next = btn("Next", "wa-btn-sm"), close = btn("Skip tutorial", "wa-btn-sm"); actions.append(close, previous, next); card.append(stepLabel, title, text, actions); tutorial.append(shade, card); document.body.append(tutorial);
  const steps: Array<{ tab: number; track?: TrackId; target: HTMLElement; title: string; text: string }> = [
    { tab: 0, target: targets.sessionGrid, title: "Launch clips", text: "Select a clip to arm it and open that track's editor." },
    { tab: 0, target: targets.chain, title: "Arrange scenes", text: "Build a linear song from the same scenes." },
    { tab: 0, track: "drums", target: shell.transportBar, title: "Transport", text: "Playback and tempo stay visible everywhere." },
    { tab: 0, track: "pads", target: targets.padGrid, title: "Pads", text: "Perform, record and edit the selected pad clip." },
    { tab: 0, track: "pads", target: targets.waveform, title: "Chop", text: "Slice longer audio into the active pad bank." },
    { tab: 0, track: "synth", target: targets.pianoRoll, title: "Piano roll", text: "Draw, move, resize and velocity-edit synth notes." },
    { tab: 1, target: targets.devicePanel, title: "Mix", text: "Balance ten channels and shape the master chain." },
    { tab: 1, target: targets.exp, title: "Save and export", text: "Preserve the editable project before rendering audio." },
  ];
  let index = 0, target: HTMLElement | null = null;
  const finish = (): void => { tutorial.hidden = true; target?.classList.remove("wa-tutorial-target"); target = null; localStorage.setItem("vv_studio_tutorial_seen2", "1"); };
  const show = (nextIndex: number): void => { index = Math.max(0, Math.min(steps.length - 1, nextIndex)); const step = steps[index]; target?.classList.remove("wa-tutorial-target"); shell.tabBtns[step.tab].click(); if (step.track) ctx.selectTrack(step.track); target = step.target; target.classList.add("wa-tutorial-target"); target.scrollIntoView({ block: "center", behavior: "smooth" }); stepLabel.textContent = `${index + 1} / ${steps.length}`; title.textContent = step.title; text.textContent = step.text; previous.disabled = index === 0; next.textContent = index === steps.length - 1 ? "Finish" : "Next"; tutorial.hidden = false; };
  previous.addEventListener("click", () => show(index - 1)); next.addEventListener("click", () => index === steps.length - 1 ? finish() : show(index + 1)); close.addEventListener("click", finish); shade.addEventListener("click", finish); shell.tutorialBtn.addEventListener("click", () => show(0));
}
