// Transport scheduler — the 25ms lookahead loop, per-track arrangement
// playback, queued-clip application, step highlighting, play/stop wiring.
// Extracted verbatim from index.ts (Phase 0 split). Owns ctx.playhead writes.
import { STEPS, PAD_BANK_SIZE, TRACKS, clip, transport, stepDur, audible, mpc, rackState, allPats, allVels, synthNotes, padEvents, blockAt, songPos, songLoop, songEndBar, vsynthPatch } from "./state";
import type { TrackId } from "./state";
import { ac, ensureNodes, trackGain, playDrum, playPad, metroClick } from "./engine";
import * as engine from "./engine";
import { playNote } from "./vsynth";
import { ctx, playhead } from "./ctx";

export interface PlaybackDeps {
  cells: HTMLElement[][];
  rollPlayheadBar: HTMLElement;
  launchStatus: HTMLElement;
  lcdState: HTMLElement;
  playBtn: HTMLElement;
  stopBtn: HTMLElement;
  getCountIn: () => boolean;
  isSynthRec: () => boolean;
}

export function buildPlayback(deps: PlaybackDeps): void {
  let schedTimer = 0, nextTime = 0;
  // Arrangement playback (C5, Ableton-style): one global song bar; each track
  // plays whichever block covers the bar — no block means silence. The loop
  // brace wraps within its region; otherwise the song wraps at its end.
  function applySongBar(): void {
    TRACKS.forEach((track) => { clip.play[track] = blockAt(track, songPos.bar)?.scene ?? null; });
  }
  function advanceSongBar(): void {
    songPos.bar++;
    if (songLoop.on && songPos.bar >= songLoop.endBar) songPos.bar = songLoop.startBar;
    else if (songPos.bar >= songEndBar()) songPos.bar = songLoop.on ? songLoop.startBar : 0;
    applySongBar();
  }
  function highlight(s: number): void {
    if (playhead.lastHi >= 0) for (let r = 0; r < 8; r++) deps.cells[r][playhead.lastHi].classList.remove("play");
    if (clip.play.drums === clip.sel) for (let r = 0; r < 8; r++) deps.cells[r][s].classList.add("play");
    deps.rollPlayheadBar.classList.toggle("on", clip.play.synth === clip.sel);
    deps.rollPlayheadBar.style.left = `${(s / STEPS) * 100}%`;
    playhead.lastStepStartedMs = performance.now();
    playhead.lastHi = s; deps.lcdState.textContent = `▶ ${String(s + 1).padStart(2, "0")}`;
  }
  function scheduleStep(s: number, baseWhen: number): void {
    const a = ac();
    const groove = rackState.devices.player && s % 2 === 1 ? rackState.grooveTiming * stepDur() * 0.5 : 0;
    const random = rackState.devices.player ? (Math.random() * 2 - 1) * rackState.grooveRandom / 1000 : 0;
    const when = baseWhen + (s % 2 === 1 ? transport.swing * stepDur() : 0) + groove + random;
    const drumClip = clip.play.drums, padClip = clip.play.pads, synthClip = clip.play.synth;
    if (drumClip !== null) {
      for (let r = 0; r < 8; r++) {
        if (allPats[drumClip][r][s] && audible(r)) playDrum(a, trackGain[r], r, allVels[drumClip][r][s] / 127, when);
      }
    }
    if (padClip !== null) {
      padEvents[padClip].filter((event) => event.step === s).forEach((event) => {
        if (Math.random() * 100 > event.probability) return;
        const velocity = Math.max(1, Math.min(127, event.velocity * (1 + (rackState.devices.player ? (Math.random() * 2 - 1) * rackState.grooveVelocity : 0))));
        const ratchets = Math.max(1, event.ratchets), spacing = stepDur() / ratchets;
        for (let i = 0; i < ratchets; i++) {
          const eventWhen = Math.max(baseWhen, when + event.offset / 1000 + i * spacing);
          playPad(a, event.pad, velocity, eventWhen, event.pad % PAD_BANK_SIZE);
          if (rackState.devices.player && rackState.noteEcho > 0) for (let echo = 1; echo <= rackState.noteEcho; echo++) {
            playPad(a, event.pad, velocity * Math.pow(rackState.echoDecay, echo), eventWhen + echo * stepDur(), event.pad % PAD_BANK_SIZE);
          }
        }
      });
    }
    if (synthClip !== null) {
      synthNotes[synthClip].forEach((n) => {
        // float steps (unquantized roll): schedule anything landing inside this step window
        if (n.step >= s && n.step < s + 1) playNote(a, engine.synthGain!, vsynthPatch, n.note, n.vel, when + (n.step - s) * stepDur(), stepDur() * n.len * 0.98);
      });
    }
    if (transport.metro && s % 4 === 0) metroClick(a, engine.master!, baseWhen, s === 0);
    window.setTimeout(() => { if (playhead.playing) highlight(s); }, Math.max(0, (baseWhen - a.currentTime) * 1000));
  }
  function applyQueued(): boolean {
    let changed = false;
    TRACKS.forEach((track) => {
      if (clip.queued[track] !== undefined) {
        clip.play[track] = clip.queued[track] as number | null;
        clip.queued[track] = undefined;
        changed = true;
      }
    });
    return changed;
  }
  function scheduler(): void {
    const a = ac();
    while (nextTime < a.currentTime + 0.1) {
      scheduleStep(playhead.schStep, nextTime);
      nextTime += stepDur();
      playhead.schStep++;
      if (playhead.schStep >= STEPS) {
        playhead.schStep = 0;
        const launched = applyQueued();
        if (launched) {
          transport.songMode = false;
          ctx.songBtn.textContent = "Session"; ctx.songBtn.classList.remove("active"); ctx.renderSel.value = "pattern";
          deps.launchStatus.textContent = "Launched";
        } else if (transport.songMode) {
          advanceSongBar();
        }
        ctx.paintSession();
      }
    }
  }
  deps.playBtn.addEventListener("click", () => {
    if (playhead.playing) return;
    ensureNodes(); playhead.playing = true; playhead.schStep = 0;
    songPos.bar = songLoop.on ? songLoop.startBar : 0;
    applyQueued();
    if (transport.songMode) applySongBar();
    ctx.paintSession();
    nextTime = ac().currentTime + 0.06;
    // 1-bar count-in when recording is armed: four clicks, then the loop starts.
    if (deps.getCountIn() && (mpc.recording || deps.isSynthRec())) {
      const beat = stepDur() * 4;
      for (let b = 0; b < 4; b++) metroClick(ac(), engine.master!, nextTime + b * beat, b === 0);
      nextTime += 4 * beat;
      deps.lcdState.textContent = "COUNT";
    }
    schedTimer = window.setInterval(scheduler, 25);
  });
  deps.stopBtn.addEventListener("click", () => {
    playhead.playing = false; if (schedTimer) { clearInterval(schedTimer); schedTimer = 0; }
    if (playhead.lastHi >= 0) for (let r = 0; r < 8; r++) deps.cells[r][playhead.lastHi].classList.remove("play");
    deps.rollPlayheadBar.classList.remove("on");
    TRACKS.forEach((track) => { clip.queued[track] = undefined; });
    ctx.paintSession();
    playhead.lastHi = -1; deps.lcdState.textContent = "■ STOP";
  });


}
