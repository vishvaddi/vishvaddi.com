# Run Log

## 2026-07-26 — Deep Swarm expedition campaign

- Added a five-act, five-sector expedition spine built around authored physical discovery sites, persistent survey evidence and a biosphere that changes under repeated extraction and disturbance.
- Replaced the old Codex route with a unified field PDA covering expedition progress, four-tier scientific records for six keystone species, surveyed geology, fabrication, playable archive transcripts and the NEREID-II’s installed configuration.
- Added three fabricated components, a research- and geology-gated mining laser, sonar-surveyed deposits and held-interaction extraction with battery, noise, resource and ecological consequences.
- Made installed upgrades visible on the playable submarine and in its blueprint from one canonical assembly manifest.
- Added a Blender socket/action contract plus a validator-export script for future animated GLB assemblies.
- Extended the production-browser suite through PDA state, component fabrication and mining extraction; retained passing coverage for all depth boundaries, random system incidents, render-fault recovery, cargo and Module Bay behaviour.
- Bumped the scoped offline cache so installed copies receive the campaign build.

## 2026-07-26 — Deep Swarm render-fault recovery

- Reset the Canvas 2D drawing state after an animation-loop fault so a leaked porthole clip or transform cannot hide the diagnostic screen behind a black frozen viewport.
- Made the fault screen fit Android landscape and changed its primary action from discarding the run to clearing transient event state and resuming the dive.
- Added a browser regression that deliberately throws while a viewport clip is active, verifies the full canvas recovers, then resumes the same dive.
- Bumped the scoped offline cache so installed copies receive the recovery immediately.

## 2026-07-26 — Deep Swarm Systems control hotfix

- Removed the conflicting `S` Systems binding; holding `S` now remains normal downward movement and cannot interrupt a dive.
- Restricted the Systems blueprint to explicit hull, reactor, ballast and life-support fault events; hard impacts can damage systems but no longer open repair UI.
- Replaced the flat diagnostic list with an interactive pseudo-3D NEREID-II blueprint: layered wireframe hull, cutaway rings, system leaders, condition cards and a pulsing fault hotspot.
- Extended browser coverage to hold `S` during live play and trigger a controlled random incident; the complete local suite and production build pass with a clean console.

## 2026-07-26 — Deep Swarm systems-and-horror overhaul

- Added deterministic run diagnostics, a recoverable flight-computer fault screen, rolling local traces and explicit impact, power, crush-depth and creature loss causes.
- Verified every depth boundary from 0–6,000 m, including the reported 1,999→2,000 m transition, in headless Chrome with a clean console.
- Rebuilt the Module Bay feedback, responsive Mooring spacing and Power Junction teaching; made ordinary rubble depth-lock while pursued and shatter under dash.
- Added six degradable submersible systems, HUD status, inspection and circuit, breach, valve and signal repair interactions.
- Replaced the flat 50-item inventory with an 8×6 shaped cargo hold supporting selection, movement, rotation and exact jettisoning; all loot paths now enforce physical capacity.
- Routed ordinary incidents through five event-specific interaction grammars while preserving existing bespoke breach and junction minigames.
- Added six authored biome pockets, instrument-driven false-contact and blackout horror beats, five functional utility weapons and four system-focused upgrades.
- Added `npm run test:deep-swarm`, bumped the scoped offline cache and verified the production build.

## 2026-07-23 — Credential containment, Astro 7 security and Programme rail clearance

- Revoked the historical GitHub personal access token and confirmed the historical ElevenLabs key was already inactive; both now return HTTP 401.
- Scanned 19,960 profile files for credential patterns with no findings. The vault privacy audit passed its `_private/`, Git ignore, tracked-file, hook, repository-visibility and filesystem checks; the canonical credential file remains restricted to the user, Administrators and SYSTEM.
- Upgraded Astro 6 to Astro 7 and `astro-og-canvas` to its compatible release, restored the global type gate and reduced `npm audit` from nine findings to zero.
- Excluded independently built static game snapshots from the Astro source scan, added Playwright as an explicit development dependency and resolved migration and latent type/runtime faults exposed by the stricter check.
- Kept the Programme Builder clear of the desktop tools rail: at 1,440 px the rail ends at 384 px and the 1,024 px editor begins at 400 px. Android landscape still uses 812 px of an 844 px viewport without document overflow.
- Verified the production build, Programme responsive suite, Studio responsive suite and Studio functional suite with clean browser consoles.

## 2026-07-21 — Programme landscape and Studio density

- Broke the Programme Builder editor out of the 38 rem prose column while preserving fullscreen and print layouts; Android landscape now uses 812 px of an 844 px viewport without document overflow.
- Expanded Studio's 4×4 performance pads to use the available desktop/laptop height.
- Repacked MIX into one unwrapped ten-channel bank with compact export and device panels alongside it.
- Added Programme landscape coverage and strengthened Studio responsive checks for workspace use, compact panels and channel wrapping.
- Verified Programme landscape, Studio responsive and Studio functional browser suites with clean consoles. `astro check` remains blocked by pre-existing `astro.config.mjs` typing errors and then exhausts the default Node heap while scanning the generated Carromancy bundle.

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
