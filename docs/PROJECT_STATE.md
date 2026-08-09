# Project State

_Last updated: 2026-08-09 — Programme Builder now uses a true desktop sidebar workspace._

## Current Position

- `/studio/` is an immersive, viewport-filling browser workstation with a graphite-and-neon Lysergic identity, audio-reactive signal displays and mode-specific mobile compositions rather than a scaled desktop layout. Its primary modes are drums, pads, synth, clips/arrangement and mix.
- Studio supports 4–32-step straight/triplet patterns; drums and sliced/recorded samples; Bass, Lead and Harmony synth lanes; accent/slide; Web MIDI; patch, kit and song libraries; scene chains; automation; effects; Morph/Terrain performance; project persistence; WAV/MP3 and stem export.
- Studio opens with a playable `MIDNIGHT ACID` demo and one non-modal hint. New blank/demo replacement, imported projects, songs and patches apply in place with confirmation; arrangement, tempo, title and mixer state participate in persistence/history rather than forcing a reload.
- Studio source and browser suites cover first-run state, core edit/undo/autosave/playback/export, mixer synchronisation/persistence, in-place project replacement, the five modes, three synth lanes, Signal Garden keyboard control, arrangement automation, viewport fit, mobile control dimensions and tutorial stacking.
- `/site/programme/` uses a true desktop workspace: the searchable tools rail is anchored 24 px from the viewport edge and the editor fills all remaining width. At 1,440 px the editor spans 1,168 px from x=248 to x=1,416; Android landscape retains an 812 px editor in an 844 px viewport. Focused browser coverage checks rail position, full workspace use, overflow, fullscreen, tutorial restoration and chart-first mode.
- On phones and short Android landscape, DRUMS preserves full-sized sequencing cells in a horizontal instrument surface, PADS presents a separated 4×4 performance deck, MIX uses readable channel strips and CLIPS exposes the visible scene range.
- The site runs on Astro 7 with zero known npm vulnerabilities and a global type check with zero errors. Independently built game snapshots under `public/games/` are excluded from the Astro source scan.
- `/games/deep-swarm/` now exposes deterministic diagnostics and explicit loss causes, with automated boundary coverage through 6,000 m.
- Deep Swarm has six degradable submersible systems with an event-only interactive bathysphere damage blueprint and hands-on repairs, spatial shaped cargo, readable Module Bay feedback, destructible rubble, event-specific interaction grammars, additional biome pockets and five utility weapons. Render faults reset leaked canvas clipping and offer an in-dive resume instead of leaving a black frozen viewport; deployable weapons now initialise their run state defensively.
- Its persistent expedition campaign now spans five ecological sectors and five story acts. A six-section field PDA joins dive history, four-tier xenobiology for six keystone species, distinct animated scientific plates, geology, component fabrication, recovered audio logs and the NEREID-II’s current blueprint.
- Power Junctions are rarer and start two or three moves from a valid circuit. Routine NEREID observations are paced through a dialogue queue, while depth drives a lo-fi-to-jungle music arc with genre-specific procedural rhythm layers.
- Dynamic effect colours now fall back safely instead of crashing the flight computer, and Electric Field applies its intended damage on each half-second pulse.
- Surveyed mineral deposits can be extracted with a fabricated mining laser. Extraction and disturbance persist per sector and alter later population pressure, while authored wreck sites carry the campaign’s evidence and archive fragments.
- A canonical vessel-assembly manifest drives both the in-game submarine attachments and PDA drawing. The matching Blender socket/action contract and validator-export script define the path to animated GLB assemblies without duplicating upgrade placement rules.
- `/games/carromancy/` hosts the production Carromancy build and is listed on `/games`.
- Carromancy remains developed in its own `vishvaddi/carromancy` repository; the site carries a built snapshot under `public/games/carromancy/`.
- The current snapshot uses a dual Power-and-clearance victory model: rivals require 5/7/9 own-colour coins, Guardians require a settled Queen, and misses act as the limited life economy. Successful own-colour pots retain the table; opponent coins and foul debts are respotted.
- Scoring retains the readable Power × Mult model, focused 24-Charm pool and five core Ragas. Early burst scoring and permanent scaling have been reduced so physical clearance cannot be bypassed by a three-pot build.
- Each Ante opens with a two-map route choice and an optional one-shot Shrine trial. Legacy progression records discovered Charms, stamped maps and wins, unlocking options without permanent stat inflation.
- The one-screen layout now centres a larger rival portrait, identity and quote in the left rail, with scoring forecast and Last Shot information moved into the right rail. Board-specific cached shadows drift almost imperceptibly and respect reduced-motion preferences.
- Local telemetry records win rate, clearance, Queen state, match duration, pot rate, spin use and shot-type frequency for balance tuning.
- `src/pages/games/big2.astro` hosts the Big 2 UI.
- `public/scripts/big2.js` contains the full browser game logic.
- Standard mode is the default: one classic Big 2 deal, win/loss record, no run economy.
- Roguelike mode is opt-in: 12-table run, score targets, coins, wagers, Charms, Mastery, Markets and boss rules.
- Daily run is opt-in: same roguelike structure with a date seed.

## Next Actions

- Playtest Deep Swarm’s expedition pacing, mining yields, sector disturbance and PDA readability across desktop and Android landscape; use the session trace if a long run fails.
- Playtest Carromancy on the live domain across mouse and landscape touch, then tune cushion restitution and spin against filmed real-board references.
- Play 10-20 real runs and review the local telemetry before changing target curves, rewards or Charm prices again.
- Add a visible post-run summary card once enough balance feedback exists.
- Decide whether feedback packets should stay copy/email-only or post to a lightweight backend.

## Open Questions

- Should Roguelike runs be 8 tables instead of 12 for faster repeat play?
- Should Standard mode keep the quick legal-move buttons, or should it be even cleaner?
- Should Daily run persist best daily score separately from best all-time run?
