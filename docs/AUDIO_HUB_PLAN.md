# /audio hub — programme and ownership

_Approved by Vish 2026-09-06. Claude builds this on branch `audio-hub` in a separate worktree; Codex should stay out of `src/pages/audio/`, `src/scripts/site/audio/`, `src/data/audio-tools.ts`, `src/styles/audio.css` and `scripts/audio-tools-e2e.mjs` until it merges._

Decisions: new `/audio` hub on the `/site` shell · commit after each tool, **one deploy at the end** (Vish approves it) · Camelot + musical key, streaming + club loudness targets · ear training = shared engine + six exercises with staff, keyboard **and fretboard** views, own SVG staff · MIDI export per clip and whole song, no import · WebAssembly already allowed site-wide by the CSP (`wasm-unsafe-eval` is in `_headers`), so no CSP change is needed for Demucs or Basic Pitch.

Order (one session each, harness-gated):
1. ✅ Track Analyser
2. ✅ Studio MIDI export — selected clip and whole-song multitrack `.mid` (drums ch10 GM map; bass/lead/harmony tracks; tempo, velocities)
3. ✅ Chord + scale lab (+ studio keys: scale lock, chord/inversion mode — Reason Scales & Chords parity)
4. Sample prep — trim, normalise, fade, reverse, pitch/stretch, convert, batch; crude vocal remover (L−R, sub kept mono < 150 Hz); slice-quantize in the chopper
5. FX parity session — The Echo (ducking, ping-pong, roll, triplet/dotted), Scream 4 damage types + body, RV7000 IR upload, MClass-style look-ahead limiter with GR meter and "master to −14 LUFS", SONG section markers
6. BPM maths + tuner / polyrhythm metronome
7. Lo-fi processor page — 16 one-knob Audiomatic-style transforms with dry/wet
8. Ear training — six exercises on one engine
9. Demucs WASM spike — gated on a 4-minute track separating on Vish's phone

Backlog: monophonic pitch correction (Vocal Edit), Kong choke groups + pad synth models, GM SoundFont player, Basic Pitch audio-to-MIDI, kit exporter (SFZ / Decent Sampler), DJ set prep + Rekordbox XML, beatmatch trainer.
