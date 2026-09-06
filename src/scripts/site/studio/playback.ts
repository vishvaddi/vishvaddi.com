// Transport scheduler — the 25ms lookahead loop, per-track arrangement
// playback, queued-clip application, step highlighting, play/stop wiring.
// Extracted verbatim from index.ts (Phase 0 split). Owns ctx.playhead writes.
import { STEPS, PAD_BANK_SIZE, TRACKS, ARRANGE_TRACKS, clip, transport, stepDur, patternStepDur, audible, mpc, rackState, allPats, allVels, synthLaneNotes, synthPatches, SYNTH_LANES, activeSynth, patternLengths, laneLength, laneRate, glitchLane, padEvents, blockAt, songPos, songLoop, songEndBar, audioTracks } from "./state";
import { ac, ensureNodes, trackGain, playDrum, playPad, metroClick } from "./engine";
import * as engine from "./engine";
import { playNote } from "./vsynth";
import { ctx, playhead } from "./ctx";
import { dataUrlToBytes } from "./helpers";

export interface PlaybackDeps {
  cells: HTMLElement[][];
  rollPlayheadBar: HTMLElement;
  launchStatus: HTMLElement;
  lcdState: HTMLElement;
  position: HTMLElement;
  playBtn: HTMLElement;
  stopBtn: HTMLElement;
  getCountIn: () => boolean;
  isSynthRec: () => boolean;
}

export function buildPlayback(deps: PlaybackDeps): void {
  let schedTimer = 0, nextTime = 0;
  const audioBuffers = new Map<string, AudioBuffer>();
  const hydrateAudio = async (): Promise<void> => {
    const context = ac();
    await Promise.all(audioTracks.flatMap((track) => track.clips.map(async (item) => {
      if (audioBuffers.has(item.id)) return;
      try { audioBuffers.set(item.id, await context.decodeAudioData(dataUrlToBytes(item.data))); } catch { /* keep the timeline editable */ }
    })));
  };
  void hydrateAudio();
  window.addEventListener("vv-studio-tracks-change", () => { void hydrateAudio(); });
  const scheduleAudioBar = (bar: number, when: number): void => {
    if (!transport.songMode || !engine.master) return;
    const secondsPerBar = 60 / transport.bpm * 4;
    audioTracks.forEach((track) => track.clips.forEach((item) => {
      if (bar < item.startBar || bar >= item.startBar + item.bars) return;
      const buffer = audioBuffers.get(item.id); if (!buffer) return;
      const offset = Math.max(0, item.offset + (bar - item.startBar) * secondsPerBar);
      if (offset >= buffer.duration) return;
      const source = ac().createBufferSource(), gain = ac().createGain(); source.buffer = buffer; gain.gain.value = item.gain; source.connect(gain).connect(engine.master!);
      if (offset < buffer.duration) source.start(when, offset, Math.min(secondsPerBar, buffer.duration - offset));
    }));
  };
  // Arrangement playback (C5, Ableton-style): one global song bar; each track
  // plays whichever block covers the bar — no block means silence. The loop
  // brace wraps within its region; otherwise the song wraps at its end.
  function applySongBar(): void {
    ARRANGE_TRACKS.forEach((track) => { clip.play[track] = blockAt(track, songPos.bar)?.scene ?? null; });
  }
  function advanceSongBar(): void {
    songPos.bar++;
    if (songLoop.on && songPos.bar >= songLoop.endBar) songPos.bar = songLoop.startBar;
    else if (songPos.bar >= songEndBar()) songPos.bar = songLoop.on ? songLoop.startBar : 0;
    applySongBar();
  }
  function highlight(s: number, arrangedBar: number | null, arrangedCycleLength: number): void {
    if (playhead.lastHi >= 0) for (let r = 0; r < 8; r++) deps.cells[r][playhead.lastHi].classList.remove("play");
    if (clip.play.drums === clip.sel && s < STEPS) for (let r = 0; r < 8; r++) deps.cells[r][s].classList.add("play");
    const activeClip = clip.play[activeSynth.lane];
    deps.rollPlayheadBar.classList.toggle("on", activeClip === clip.sel);
    deps.rollPlayheadBar.style.left = `${(s / Math.max(1, patternLengths[activeClip ?? clip.sel])) * 100}%`;
    if (arrangedBar !== null) {
      window.dispatchEvent(new CustomEvent("vv-studio-arrange-playhead", { detail: { bar: arrangedBar + s / arrangedCycleLength } }));
    }
    playhead.lastStepStartedMs = performance.now();
    playhead.lastHi = s; deps.lcdState.textContent = `▶ ${String(s + 1).padStart(2, "0")}`;
    // A song "bar" is one pattern cycle; a 32-step scene spans two real bars.
    const bar = (arrangedBar !== null ? arrangedBar * Math.max(1, Math.ceil(arrangedCycleLength / 16)) + Math.floor(s / 16) : Math.floor(playhead.absStep / 16)) + 1;
    deps.position.textContent = `${bar}.${Math.floor((s % 16) / 4) + 1}.${(s % 4) + 1}`;
  }
  function scheduleStep(s: number, baseWhen: number): void {
    const arrangedBar = transport.songMode ? songPos.bar : null;
    const arrangedCycleLength = transport.songMode
      ? Math.max(1, ...ARRANGE_TRACKS.map((track) => blockAt(track, songPos.bar)?.scene ?? null).filter((scene): scene is number => scene !== null).map((scene) => patternLengths[scene]))
      : 1;
    const a = ac();
    const groove = rackState.devices.player && s % 2 === 1 ? rackState.grooveTiming * stepDur() * 0.5 : 0;
    const random = rackState.devices.player ? (Math.random() * 2 - 1) * rackState.grooveRandom / 1000 : 0;
    const when = baseWhen + (s % 2 === 1 ? transport.swing * stepDur() : 0) + groove + random;
    if (s === 0) scheduleAudioBar(songPos.bar, baseWhen);
    const drumClip = transport.songMode ? blockAt("drums", songPos.bar)?.scene ?? null : clip.play.drums;
    const padClip = transport.songMode ? blockAt("pads", songPos.bar)?.scene ?? null : clip.play.pads;
    const synthClips = Object.fromEntries(SYNTH_LANES.map((lane) => [lane, transport.songMode ? blockAt(lane, songPos.bar)?.scene ?? null : clip.play[lane]])) as Record<(typeof SYNTH_LANES)[number], number | null>;
    // Lanes are independent now (S1): a ramp lives on whichever lane's block
    // the user attached it to, so search every track's block at this bar.
    const automationBlocks = transport.songMode
      ? ARRANGE_TRACKS.map((track) => blockAt(track, songPos.bar)).filter((block): block is NonNullable<typeof block> => block !== null)
      : [];
    const blockProgress = (block: NonNullable<ReturnType<typeof blockAt>>): number =>
      Math.max(0, Math.min(1, (songPos.bar - block.startBar + s / Math.max(1, patternLengths[block.scene])) / block.bars));
    const automatedValue = (lane: string, param: string): number | null => {
      for (const block of automationBlocks) {
        const ramp = block.automation?.find((item) => item.lane === lane && item.param === param);
        if (ramp) return ramp.from + (ramp.to - ramp.from) * blockProgress(block);
      }
      return null;
    };
    const masterVolume = automatedValue("master", "volume");
    if (masterVolume !== null && engine.master) engine.master.gain.setValueAtTime(Math.max(0, Math.min(1, masterVolume)), baseWhen);
    const masterReverb = automatedValue("master", "reverb");
    if (masterReverb !== null) engine.initReverb(Math.max(0, Math.min(1, masterReverb)));
    if (drumClip !== null) {
      // Polymeter: each lane runs its own length and rate, so instead of one
      // index we ask which of THIS lane's steps fall inside this global step's
      // time window. Handles triplet rates against straight ones exactly.
      const glitch = rackState.devices.player ? rackState.glitch / 100 : 0;
      const globalDur = patternStepDur(drumClip), absStep = playhead.absStep;
      const windowStart = absStep * globalDur, windowEnd = windowStart + globalDur;
      for (let r = 0; r < 8; r++) {
        if (!audible(r)) continue;
        const len = laneLength(drumClip, r), rateDur = 60 / transport.bpm / laneRate(drumClip, r);
        const isGlitchLane = r === glitchLane.row;
        const first = Math.ceil(windowStart / rateDur - 1e-9), last = Math.ceil(windowEnd / rateDur - 1e-9);
        for (let k = first; k < last; k++) {
          const localStep = ((k % len) + len) % len;
          const at = when + (k * rateDur - windowStart);
          if (!allPats[drumClip][r][localStep]) {
            // ghost hits: the glitch lane fires on empty steps as glitch rises
            if (isGlitchLane && glitch > 0 && Math.random() < glitch * 0.14) {
              playDrum(a, trackGain[r], r, 0.5, at + Math.random() * rateDur, { decayMul: 0.6 });
            }
            continue;
          }
          if (glitch > 0 && Math.random() < glitch * 0.12) continue;   // dropouts
          const vel = allVels[drumClip][r][localStep] / 127;
          const jitter = (Math.random() - 0.5) * glitch * rateDur * (isGlitchLane ? 1.3 : 0.7);
          const hitAt = Math.max(baseWhen, at + jitter);
          if (glitch > 0 && Math.random() < glitch * 0.42) {
            const n = 2 + Math.floor(Math.random() * (isGlitchLane ? 4 : 2));
            for (let i = 0; i < n; i++) {
              const sub = hitAt + i * (rateDur / n) * (0.5 + Math.random() * 0.6);
              playDrum(a, trackGain[r], r, vel * Math.pow(0.88, i), sub, {
                pitchMul: 1 + (Math.random() - 0.5) * glitch, decayMul: 0.35 + Math.random() * 0.5,
              });
            }
          } else {
            playDrum(a, trackGain[r], r, vel, hitAt, { pitchMul: 1 + (Math.random() - 0.5) * glitch * 0.5 });
          }
        }
      }
    }
    if (padClip !== null) {
      const localStep = s % patternLengths[padClip];
      padEvents[padClip].filter((event) => Math.floor(event.step) === localStep).forEach((event) => {
        if (Math.random() * 100 > event.probability) return;
        const velocity = Math.max(1, Math.min(127, event.velocity * (1 + (rackState.devices.player ? (Math.random() * 2 - 1) * rackState.grooveVelocity : 0))));
        const glitchExtra = rackState.devices.player && Math.random() < (rackState.glitch / 100) * 0.35 ? 1 + Math.floor(Math.random() * 3) : 0;
        const ratchets = Math.max(1, event.ratchets + glitchExtra), spacing = patternStepDur(padClip) / ratchets;
        for (let i = 0; i < ratchets; i++) {
          const eventWhen = Math.max(baseWhen, when + event.offset / 1000 + i * spacing);
          playPad(a, event.pad, velocity, eventWhen, event.pad % PAD_BANK_SIZE);
          if (rackState.devices.player && rackState.noteEcho > 0) for (let echo = 1; echo <= rackState.noteEcho; echo++) {
            playPad(a, event.pad, velocity * Math.pow(rackState.echoDecay, echo), eventWhen + echo * stepDur(), event.pad % PAD_BANK_SIZE);
          }
        }
      });
    }
    SYNTH_LANES.forEach((lane) => {
      const laneClip = synthClips[lane];
      if (laneClip === null) return;
      const localStep = s % patternLengths[laneClip];
      synthLaneNotes[lane][laneClip].forEach((n) => {
        if (n.step < localStep || n.step >= localStep + 1) return;
        const cutoff = automatedValue(lane, "cutoff"), volume = automatedValue(lane, "volume");
        const patch = { ...synthPatches[lane], filter: { ...synthPatches[lane].filter } };
        if (n.slide && (patch.glide ?? 0) < 0.08) patch.glide = 0.08;
        if (cutoff !== null) patch.filter.cutoff = 60 * Math.pow(16000 / 60, Math.max(0, Math.min(1, cutoff)));
        if (volume !== null) patch.volume = Math.max(0, Math.min(1, volume));
        const velocity = Math.min(127, n.accent ? Math.round(n.vel * 1.22) : n.vel);
        playNote(a, engine.synthGain!, patch, n.note, velocity, when + (n.step - localStep) * patternStepDur(laneClip), patternStepDur(laneClip) * n.len * 0.98);
      });
    });
    if (transport.metro && s % 4 === 0) metroClick(a, engine.master!, baseWhen, s === 0);
    window.setTimeout(() => { if (playhead.playing) highlight(s, arrangedBar, arrangedCycleLength); }, Math.max(0, (baseWhen - a.currentTime) * 1000));
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
      const clockScene = TRACKS.map((track) => clip.play[track]).find((scene) => scene !== null) ?? clip.sel;
      nextTime += patternStepDur(clockScene);
      playhead.schStep++; playhead.absStep++;
      let launched = clip.quantization === "beat" && playhead.schStep % 4 === 0 ? applyQueued() : false;
      const activeScenes = transport.songMode
        ? ARRANGE_TRACKS.map((track) => blockAt(track, songPos.bar)?.scene ?? null)
        : TRACKS.map((track) => clip.play[track]);
      const cycleLength = Math.max(1, ...activeScenes.filter((v): v is number => v !== null).map((scene) => patternLengths[scene]));
      if (playhead.schStep >= cycleLength) {
        playhead.schStep = 0;
        if (clip.quantization === "bar") launched = applyQueued() || launched;
        if (launched) {
          transport.songMode = false;
          ctx.songBtn.textContent = "Clips"; ctx.songBtn.classList.remove("active"); ctx.renderSel.value = "pattern";
          deps.launchStatus.textContent = "Launched";
        } else if (transport.songMode) {
          advanceSongBar();
        }
        ctx.paintSession();
      }
    }
  }
  deps.playBtn.addEventListener("click", () => {
    deps.playBtn.classList.add("active");
    if (playhead.playing) return;
    ensureNodes(); playhead.playing = true; playhead.schStep = 0; playhead.absStep = 0;
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
    deps.position.textContent = "1.1.1"; deps.playBtn.classList.remove("active");
  });


}
