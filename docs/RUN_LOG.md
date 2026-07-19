# Run Log

## 2026-07-19 — Studio visual redesign

- Replaced the retained retro VishAmp chassis with a materially different modern DAW workspace inspired by Ableton and Bitwig rather than merely reskinning the existing controls.
- Added a vertical desktop mode rail, unified flat transport, high-density grid canvas, clearer active/inactive hierarchy and track-coloured clip/arrangement surfaces.
- Rebuilt the phone frame around a compact project/status header, horizontally scrollable transport and persistent bottom mode navigation; retained a vertical rail in short landscape view.
- Rebranded the application shell as `VISHVADDI / STUDIO` and moved the primary palette to graphite with a high-contrast lime action colour.
- Verified the production build and responsive browser suite at desktop, laptop, phone and landscape sizes with clean consoles and no document overflow.

## 2026-07-18 — Studio workstation parity rebuild

- Reworked `/studio/` into an immersive full-viewport application with compact and comfortable densities, sticky workstation controls and responsive phone/landscape navigation.
- Expanded sequencing to 4–32 steps with straight/triplet divisions, three independent synth lanes, note accent/slide and multi-lane playback/export.
- Added Web MIDI input, searchable factory/user synth patches, factory/user drum kits and factory/user songs, with JSON import/export for each library.
- Added pattern-chain arrangement editing, block repeats/reordering and automation ramps for synth cutoff/volume and master volume/reverb.
- Added Morph/Terrain performance modes, scale-aware touch/WASD Terrain play, glitch effects, random/clear tools and separate drum/pad/synth stem export.
- Updated project persistence/migration, tutorial/help content and immersive site layout integration.
- Verified the production Astro build, core Studio browser E2E and responsive browser E2E at 1440×900, 1280×720, 390×844 and 844×390 with clean consoles and touch targets at least 44 px.

## 2026-07-16 — Carromancy presentation and balance upgrade

- Replaced score-only wins with dual Power-and-clearance goals: 5 coins for rivals, 7 for champions and all 9 plus a settled Queen for Guardians.
- Replaced finite total shots with a miss-life economy. Own-colour pots retain the table; misses, fouls and opponent-only pots consume a life.
- Added opponent-coin respotting, foul debt respotting and Queen exposure/cover/respotted states.
- Reduced Single Arrow, Kohinoor and permanent Bank/Combo scaling; removed the unused-shot reward and recalibrated targets around longer physical matches.
- Rebuilt the left rail around a large centred rival portrait, name, title, intent and quote; moved scoring forecast and Last Shot information into the right rail.
- Added cached, reduced-motion-safe venue shadows including canopy, palm, reed, cloth, cloud, temple, rooftop and stepwell silhouettes.
- Expanded telemetry and browser tests for clearance quotas, Guardian Queen gates, match duration, shadow caches and all responsive viewports.
- Rebuilt scoring around one visible Power × Mult equation and removed Boost/Resonance vocabulary from the active game.
- Focused the build system on 24 active Charms and five core Ragas, with left-to-right Charm order determining multiplicative resolution.
- Replaced continuous spin with readable left/centre/right choices that physically curve the first cushion rebound and reward deliberate bank shots.
- Added two-map route choices, three optional one-shot Shrine trials and Legacy unlock progression without permanent power inflation.
- Removed the obsolete Powder Board and boss-vow waits so progression moves directly through Bazaar, route and Shrine decisions.
- Increased target pressure, reduced the default shot allowance and tightened rewards, interest and unused-shot bonuses.
- Expanded local telemetry with spin use and shot-type frequency for evidence-based balance work.
- Updated the embedded `/games/carromancy/` production snapshot from the standalone game repository.
- Added the one-screen desktop layout, readable venue and Charm information, scalable UI text and a rustic courtyard presentation.
- Shipped upgraded board, coin and shadow rendering plus stronger default difficulty and local encounter telemetry.
- Changed aiming to a deliberate two-step interaction: drag/release locks the line, while Strike or Space fires it.
- Restored the venue name to the board, moved the venue rule into the match HUD, added surface wear and fixed rival quote clipping.
- Returned the venue label to printed timber ink, split the placement guide around the striker and cached the wood texture to reduce strike-time rendering work.
- Removed hidden continuous Charm forces and the unclear Resonance multiplier; centred the venue name as translucent printed ink.
- Verified the standalone production build and its 12-encounter desktop/mobile/landscape browser campaign before site integration.

## 2026-07-15 — Carromancy site integration

- Added Carromancy to the public Games index.
- Embedded its path-portable production build at `/games/carromancy/`.
- Excluded the large game bundle from the global service-worker precache so it loads on demand.

## 2026-07-11 — Big 2 mode split and roguelike foundation

- Added Standard, Roguelike and Daily mode selection to Big 2.
- Restored Standard as the default simple single-deal experience.
- Kept Roguelike as an opt-in development surface with targets, wagers, Charms, Mastery, Markets and boss rules.
- Added Daily run seeding for repeatable roguelike deals.
- Added a feedback packet panel with current game state, hand, pile, mode, seed, run state and browser details.
- Added the minimum viable project memory spine: `PROJECT_STATE.md`, `RUN_LOG.md`, `DECISIONS/` protocol and `AGENTS.md` pointer.
