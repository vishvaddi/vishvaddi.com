import { STEPS, MAX_STEPS, SONG_SLOTS, PAD_BANK_SIZE, TRACKS, clip, clipLen, transport, stepDur, allPats, allVels, synthNotes, padEvents, songChain, rackState, vsynthPatch } from "./state";
import { ac, ensureNodes, trackGain, metroClick, playDrum, playPad } from "./engine";
import * as engine from "./engine";
import { playNote } from "./vsynth";
import { ctx } from "./ctx";
import type { Shell } from "./shell";

export function buildPlayback(shell: Shell, cells: HTMLElement[][], synthCells: HTMLElement[][]): void {
  let playing = false, timer = 0, nextTime = 0, step = 0, songPos = 0, songStep = 0, last = -1, lastStarted = 0;
  ctx.isPlaying = () => playing;
  ctx.currentSchedStep = () => step;
  ctx.lastHighlightedStep = () => last;
  ctx.lastStepStartedMs = () => lastStarted;

  const highlight = (current: number): void => {
    if (last >= 0) cells.forEach((row) => row[last]?.classList.remove("play"));
    if (last >= 0) synthCells.forEach((row) => row[last]?.classList.remove("play"));
    if (clip.play.drums === clip.sel) cells.forEach((row) => row[current]?.classList.add("play"));
    if (clip.play.synth === clip.sel) synthCells.forEach((row) => row[current]?.classList.add("play"));
    lastStarted = performance.now(); last = current;
    shell.lcdState.textContent = `▶ ${String(current + 1).padStart(2, "0")}`;
  };
  const scheduleStep = (current: number, baseWhen: number): void => {
    const audio = ac();
    const groove = current % 2 === 1 ? rackState.grooveTiming * stepDur() * 0.5 : 0;
    const random = (Math.random() * 2 - 1) * rackState.grooveRandom / 1000;
    const when = baseWhen + (current % 2 === 1 ? transport.swing * stepDur() : 0) + groove + random;
    const drumClip = clip.play.drums, padClip = clip.play.pads, synthClip = clip.play.synth;
    const drumStep = drumClip === null ? 0 : current % clipLen[drumClip].drums;
    const padStep = padClip === null ? 0 : current % clipLen[padClip].pads;
    const synthStep = synthClip === null ? 0 : current % clipLen[synthClip].synth;
    if (drumClip !== null) for (let row = 0; row < 8; row++) if (allPats[drumClip][row][drumStep]) playDrum(audio, trackGain[row], row, allVels[drumClip][row][drumStep] / 127, when);
    if (padClip !== null) padEvents[padClip].filter((event) => event.step === padStep).forEach((event) => {
      if (Math.random() * 100 > event.probability) return;
      const velocity = Math.max(1, Math.min(127, event.velocity * (1 + (Math.random() * 2 - 1) * rackState.grooveVelocity)));
      const ratchets = Math.max(1, event.ratchets), spacing = stepDur() / ratchets;
      for (let index = 0; index < ratchets; index++) {
        const eventWhen = Math.max(baseWhen, when + event.offset / 1000 + index * spacing);
        playPad(audio, event.pad, velocity, eventWhen, event.pad % PAD_BANK_SIZE);
        for (let echo = 1; echo <= rackState.noteEcho; echo++) playPad(audio, event.pad, velocity * Math.pow(rackState.echoDecay, echo), eventWhen + echo * stepDur(), event.pad % PAD_BANK_SIZE);
      }
    });
    if (synthClip !== null) synthNotes[synthClip].forEach((note) => { if (note.step === synthStep) playNote(audio, engine.synthGain!, vsynthPatch, note.note, note.vel, when, stepDur() * note.len * 0.98); });
    if (transport.metro && current % 4 === 0) metroClick(audio, engine.master!, baseWhen, current === 0);
    window.setTimeout(() => { if (playing) highlight(current % MAX_STEPS); }, Math.max(0, (baseWhen - audio.currentTime) * 1000));
  };
  const applyQueued = (): boolean => {
    let changed = false;
    TRACKS.forEach((track) => { if (clip.queued[track] !== undefined) { clip.play[track] = clip.queued[track] as number | null; clip.queued[track] = undefined; changed = true; } });
    return changed;
  };
  const scheduler = (): void => {
    const audio = ac();
    while (nextTime < audio.currentTime + 0.1) {
      scheduleStep(step, nextTime); nextTime += stepDur(); step++;
      songStep++;
      if (step % STEPS === 0) {
        if (applyQueued()) {
          transport.songMode = false; shell.songBtn.textContent = "Session"; shell.songBtn.classList.remove("active"); ctx.renderSel.value = "pattern"; ctx.launchStatus.textContent = "Launched";
        }
        ctx.paintSession();
      }
      if (transport.songMode) {
        const scene = songChain[songPos], sceneLength = Math.max(...TRACKS.map((track) => clipLen[scene][track]));
        if (songStep >= sceneLength) { songStep = 0; songPos = (songPos + 1) % SONG_SLOTS; const nextScene = songChain[songPos]; TRACKS.forEach((track) => { clip.play[track] = nextScene; }); ctx.paintSession(); }
      }
    }
  };
  shell.playBtn.addEventListener("click", () => {
    if (playing) return;
    ensureNodes(); playing = true; step = 0; songPos = 0; songStep = 0; applyQueued();
    if (transport.songMode) { const scene = songChain[0]; TRACKS.forEach((track) => { clip.play[track] = scene; }); }
    ctx.paintSession(); nextTime = ac().currentTime + 0.06; timer = window.setInterval(scheduler, 25);
  });
  shell.stopBtn.addEventListener("click", () => {
    playing = false; if (timer) { clearInterval(timer); timer = 0; }
    cells.forEach((row) => row.forEach((cell) => cell.classList.remove("play"))); synthCells.forEach((row) => row.forEach((cell) => cell.classList.remove("play")));
    TRACKS.forEach((track) => { clip.queued[track] = undefined; }); ctx.paintSession(); last = -1; shell.lcdState.textContent = "■ STOP";
  });
}
