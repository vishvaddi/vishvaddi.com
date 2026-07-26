# Deep Swarm — music & sampled SFX

All files OGG Vorbis. Loaded lazily by name from `MUSIC` / `SFX_SAMPLES` in `game.js`;
a missing file fails silent (game never breaks over audio).

## Current sources (owned packs, royalty-free, no attribution required)

- `bed_*` — Shapeforms Audio "Dystopia – Ambience and Drone" free pack (license PDF in the pack folder, Downloads)
- `pc_*` — **Purrple Cat** via Pixabay (Vish's pick, 16/07) — Pixabay Content Licence: commercial OK, NO attribution needed. Ocean EP (low tide/seashells/heart of the ocean/underwater cavern/drifting) + dark set (dark forest/ghost town/stranded/silent wood/a place to hide/mystic mountain/discovery).
- `sfx_ping/torpedo/explode/implode/dash/levelup/growl*/killconfirm/harpoon/zap/alert` — Shapeforms Sci Fi Weapons + Future UI + Fly By + Arcane packs (sci-fi SFX pass, 16/07). All play via sampleOr() with procedural fallback.
- (Stellardrone amb_* removed 16/07 — re-downloadable from archive.org if ever wanted.)
- `beat_*` — Epic Stock Media "Hybrid Game" Music_Loops (retired from default slots 16/07 — Vish: "glitchy"; files kept as spares)
- `sfx_glitch*`, `sfx_ui`, `sfx_impact`, `sfx_stinger`, `sfx_tear` — Shapeforms free packs (Glitch and Noise / Future UI / Hit and Punch / Dystopia)

## Dive arc (`game.js` `MUSIC`)

Existing Purrple Cat tracks supply the tonal beds. A generated PCM rhythm layer changes
tempo, swing and drum grammar by depth so escalation does not depend on another audio
download.

| Depth | Stage | BPM |
|---|---|---:|
| 0–249 m | lo-fi | 76 |
| 250–849 m | trip-hop | 84 |
| 850–1,449 m | hip-hop | 94 |
| 1,450–2,199 m | electronic | 112 |
| 2,200–2,999 m | dubstep | 140 |
| 3,000–3,899 m | techno | 128 |
| 3,900–4,899 m | drum & bass | 174 |
| 4,900 m+ | jungle | 168 |

## Pixabay shortlist reviewed 26/07/26

No new file from this shortlist has been imported. Verify the individual item licence
and retain its source URL beside any future asset.

- Genre searches: [lo-fi](https://pixabay.com/music/search/lofi-hip-hop/),
  [trip-hop](https://pixabay.com/music/search/trip-hop/),
  [hip-hop](https://pixabay.com/music/search/hiphop/),
  [electronic](https://pixabay.com/music/search/electronic/),
  [dubstep](https://pixabay.com/music/search/dubstep/),
  [techno](https://pixabay.com/music/search/techno/) and
  [drum & bass](https://pixabay.com/music/search/drum%20and%20bass/).
- Candidate tracks:
  [Trip Hop](https://pixabay.com/music/beats-trip-hop-278457/),
  [Downtempo Chill Electronic](https://pixabay.com/music/beats-downtempo-chill-electronic-528322/),
  [Melodic Techno 09](https://pixabay.com/music/electro-melodic-techno-09-513318/) and
  [Neon Sky — Liquid Jungle Breakbeat Drum and Bass](https://pixabay.com/music/drum-n-bass-neon-sky-liquid-jungle-breakbeat-drum-and-bass-356503/).

## Dropping in licensed tracks

Convert: `ffmpeg -i in.mp3 -c:a libvorbis -q:a 4 out.ogg`, drop in this folder,
add the name to a stage's `beats` array in `game.js`. [N] in pause auditions.
