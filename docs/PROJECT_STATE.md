# Project State

_Last updated: 2026-07-26 — Deep Swarm has a recoverable systems-and-horror overhaul._

## Current Position

- `/studio/` is now an immersive, viewport-filling browser workstation with a modern flat DAW shell: vertical desktop workspace rail, unified transport, track-coloured clip matrix and persistent mobile navigation. Its primary modes are drums, pads, synth, clips/arrangement and mix.
- Studio supports 4–32-step straight/triplet patterns; drums and sliced/recorded samples; Bass, Lead and Harmony synth lanes; accent/slide; Web MIDI; patch, kit and song libraries; scene chains; automation; effects; Morph/Terrain performance; project persistence; WAV/MP3 and stem export.
- Studio source and responsive browser suites cover core edit/undo/autosave/playback/export plus the five modes, three synth lanes, Terrain keyboard control, arrangement automation, viewport fit and touch target sizing.
- `/site/programme/` keeps its prose introduction in the editorial column but breaks the interactive editor out to near-full viewport width, including Android landscape. On desktop it clears the fixed tools rail while retaining a 1,024 px editor at 1,440 px; focused browser coverage checks rail clearance, width, overflow and chart-first mode.
- Studio PADS expands its performance grid to the available desktop height. MIX keeps all ten channels on one row and stacks compact export/device panels beside them; the responsive suite measures these layout contracts.
- The site runs on Astro 7 with zero known npm vulnerabilities and a global type check with zero errors. Independently built game snapshots under `public/games/` are excluded from the Astro source scan.
- `/games/deep-swarm/` now exposes deterministic diagnostics and explicit loss causes, with automated boundary coverage through 6,000 m.
- Deep Swarm has six degradable submersible systems with an event-only interactive 3D damage blueprint and hands-on repairs, spatial shaped cargo, readable Module Bay feedback, destructible rubble, event-specific interaction grammars, additional biome pockets and five utility weapons. Render faults now reset leaked canvas clipping and offer an in-dive resume instead of leaving a black frozen viewport.
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

- Playtest Deep Swarm’s new cargo shapes, repair timing and utility-weapon balance across desktop and Android landscape; use the session trace if a long run fails.
- Playtest Carromancy on the live domain across mouse and landscape touch, then tune cushion restitution and spin against filmed real-board references.
- Play 10-20 real runs and review the local telemetry before changing target curves, rewards or Charm prices again.
- Add a visible post-run summary card once enough balance feedback exists.
- Decide whether feedback packets should stay copy/email-only or post to a lightweight backend.

## Open Questions

- Should Roguelike runs be 8 tables instead of 12 for faster repeat play?
- Should Standard mode keep the quick legal-move buttons, or should it be even cleaner?
- Should Daily run persist best daily score separately from best all-time run?
