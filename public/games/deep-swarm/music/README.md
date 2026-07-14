# Deep Swarm — music & sampled SFX

All files OGG Vorbis. Loaded lazily by name from `MUSIC` / `SFX_SAMPLES` in index.html;
a missing file fails silent (game never breaks over audio).

## Current sources (owned packs, royalty-free, no attribution required)

- `bed_*` — Shapeforms Audio "Dystopia – Ambience and Drone" free pack (license PDF in the pack folder, Downloads)
- `pc_*` — **Purrple Cat** via Pixabay (Vish's pick, 16/07) — Pixabay Content Licence: commercial OK, NO attribution needed. Ocean EP (low tide/seashells/heart of the ocean/underwater cavern/drifting) + dark set (dark forest/ghost town/stranded/silent wood/a place to hide/mystic mountain/discovery).
- `sfx_ping/torpedo/explode/implode/dash/levelup/growl*/killconfirm/harpoon/zap/alert` — Shapeforms Sci Fi Weapons + Future UI + Fly By + Arcane packs (sci-fi SFX pass, 16/07). All play via sampleOr() with procedural fallback.
- (Stellardrone amb_* removed 16/07 — re-downloadable from archive.org if ever wanted.)
- `beat_*` — Epic Stock Media "Hybrid Game" Music_Loops (retired from default slots 16/07 — Vish: "glitchy"; files kept as spares)
- `sfx_glitch*`, `sfx_ui`, `sfx_impact`, `sfx_stinger`, `sfx_tear` — Shapeforms free packs (Glitch and Noise / Future UI / Hit and Punch / Dystopia)

## Slot map (index.html `MUSIC`)

| Slot | Bed | Beat candidates ([N] in pause cycles) |
|---|---|---|
| title/menus | bed_signal | beat_looming |
| sunlight | bed_signal | beat_discovery, beat_rabbit |
| twilight | bed_tundra | beat_tribe, beat_timesensitive |
| midnight | bed_hold | beat_twisted, beat_redflag |
| abyssal | bed_wind | beat_looming, beat_trust |
| hadal | bed_heartbeat | beat_faultering |
| P3 (Scar) | bed_powerstation | beat_alerting, beat_twisted |

## Dropping in better beats (trip-hop / jungle / dubstep)

1. **White Bat Audio (Karl Casey)** — whitebataudio.com. Dark electronic/DnB/dubstep.
   Game use allowed WITH credit: "Music by Karl Casey @ White Bat Audio" (add to title
   screen bottom strip + site page when first track ships). No soundtrack resale.
   Good albums to browse: the darker White Bat volumes (synthwave/DnB ones).
2. **Pixabay Music** — pixabay.com/music, search "dark trip hop", "dark dubstep",
   "jungle breaks". Pixabay licence: commercial OK, NO attribution needed.
3. **OpenGameArt CC0 music** — opengameart.org, dark ambient / DnB tags.

Convert: `ffmpeg -i in.mp3 -c:a libvorbis -q:a 4 out.ogg`, drop in this folder,
add the name to a slot's `beats` array in index.html. [N] in pause auditions.
