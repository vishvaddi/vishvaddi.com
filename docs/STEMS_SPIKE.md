# Stem separation spike — in-browser Demucs

_2026-09-07, Claude. Item 9 of the /audio programme. The gate set on 06/09 was: "a 4-minute track separates on Vish's phone without crashing". This spike establishes whether that gate can be met before any integration work._

## Verdict

**No-go for the phone gate with Demucs v4 in WebAssembly.** The evidence below puts a four-minute track at tens of minutes on a desktop single thread and at roughly 100–150 MB of weights plus working memory in the tab; on a phone that is a crash or an abandoned wait, not a tool. **A desktop-only, clearly labelled experimental separator with a smaller model is viable** if wanted later; the crude centre-channel remover in Sample Prep stays the phone-friendly answer.

## What was checked

| Fact | Source | Confidence |
|---|---|---|
| free-music-demixer runs Demucs v4 (`htdemucs`, `htdemucs_6s`) fully client-side via Emscripten-compiled `demucs.cpp` with Web Workers | project README | high |
| Weights: `htdemucs` 81 MB, `htdemucs_6s` 53 MB (float16 ggml) | project README | high |
| Speed: ~7-minute track ≈ 9 minutes with 8 workers; ≈ 40 minutes single-worker (desktop) | project README | high |
| `demucs.cpp` is MIT; weights are converted from Meta's official Demucs checkpoints; pre-converted ggml files are on Hugging Face | demucs.cpp README | high |
| Meta's Demucs code and released weights are MIT | facebookresearch/demucs licence, from memory | medium-high (verify before shipping) |
| The site CSP already carries `wasm-unsafe-eval` site-wide | `public/_headers` | high |
| Cloudflare Workers static assets cap a single file at 25 MiB, so an 81 MB weight file must be chunked or served from R2 | Cloudflare docs, from memory | medium-high |
| The free-music-demixer repo is archived (read-only since April 2025); the live site moved on | GitHub | high |

Not found: any published phone benchmark for the WASM build. Phones have a fraction of desktop single-thread throughput and Chrome for Android caps a tab's memory well below desktop, so the single-worker desktop figure (40 min for 7 min of audio) is the optimistic bound for a phone, which fails the gate on time alone.

## If a desktop-only separator is wanted later

Pick one of these, in order of least effort:

1. **ONNX Runtime Web + a small MDX-Net or Open-Unmix model.** Runs on WebGPU where present and falls back to WASM. Model files in the 30–70 MB range (sizes vary by checkpoint; confirm before choosing). Loads from R2 on demand, never precached by the service worker. Vocals/instrumental only is the right first scope.
2. **demucs.cpp WASM** rebuilt from source with Emscripten, weights chunked under 25 MiB each. Best quality of the three, slowest, largest.
3. **Spotify Basic Pitch** is not a separator, but it is the other model the plan mentions; TF.js, Apache-2, runs in the official web demo, and is the right engine for the audio-to-MIDI backlog item.

Ship gates for any of them: desktop-only banner with an estimated time before starting, hard refusal on phones or on files over ten minutes, weights hosted off the Workers asset bundle, `git lfs` or a download script for the weights so the repo stays small, and a licence note on the page.

## Decision needed from Vish

- Park stem separation (recommended for now: the programme's other eight tools shipped, and the crude remover covers the phone case), or
- schedule a desktop-only ONNX Runtime Web separator as a two-session item, starting with a vocals/instrumental model.
