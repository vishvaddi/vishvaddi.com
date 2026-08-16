# Run Log

## 2026-08-16 — Deep Swarm fast start, XP loop and durable careers

- Reframed the viewport around XP and levels. Reserve now powers equipment and triggers a recoverable brownout rather than masquerading as oxygen or directly draining hull; actual hypoxia follows life-support condition.
- Shortened opening protection to ten seconds for a first career and four thereafter. Added same-loadout retry on death, explicit fresh expeditions and a double-confirmed New Career reset.
- Added versioned local pilot profiles, rotating save backups, JSON export and twenty-second/visibility checkpoints with resume-or-new-dive title and Android controls.
- Added optional recovery-code cloud saves on Cloudflare D1 with hashed secrets, optimistic revision conflicts, disconnect and account deletion. Added a throwaway-account smoke harness covering the full API lifecycle and updated the privacy page.
- Cached large gradients, converted the title plate to WebP and added reduced/critical effect tiers with simplified distant normal contacts. The isolated forced 4,200 m late-wave soak rose from 31 to 43 fps average; core E2E covers boot readiness, XP HUD, opening grace, checkpoint round trips, brownout recovery and Android layouts.

## 2026-08-12 — Deep Swarm pressure cockpit and pursuit loop

- Centred compact desktop rails in the side bays, removed the duplicate desktop score/objective overlays and put detailed instruments behind `[I]`.
- Reduced NEREID routine cadence to one latest-useful queued line, suppressed it during close threats and moved short captions inside the viewport.
- Replaced loose ore-fall pursuit with denser sonar-surveyed mineral formations fixed to the trench; removed random P9 ladders, chains and hatches in favour of organic terrain.
- Replaced Acoustic Decoy with Cavitation Wake while retaining its internal save id. The weapon arms the next dash and lays a damage/knockback corridor.
- Added approach, hunt, crisis and relief encounter phases; relief gates narrative events and an untouched crisis awards escape score.
- Added D–ABYSSAL score ranks plus peak multiplier, longest chain and best-hit summaries. Hull damage clears the active chain.
- Made sonar an explicit reserve/exposure trade and added deterministic phase, substrate and ghost return feedback.
- Updated core, mining, dread and junction harnesses. The junction proof now replans around the arc's growing dead path rather than asserting a stale static route.
- Verified core E2E including Android portrait/landscape, mining, dread, events, junction and rig suites; responsive layouts at 1280×800, 1920×1080, 2560×1080, 1366×768 and 844×390; performance soak at 300/1200/2500/4200 m (59–60 fps average, worst p95 5.9 ms); `astro check` (154 files, zero errors) and production build.

## 2026-08-12 — Deep Swarm: compact dark cockpit and pilot options

- Reworked the side consoles into centred 250 × 460 px instrument pods so the porthole remains dominant at desktop, full-HD, ultrawide and short-desktop sizes.
- Removed the bright brass/orange framing in favour of worn gunmetal, oxidised steel and dim teal indicators.
- Renamed the shared survival reserve on the rim to O₂ / POWER: it drives life support but also feeds lights, weapons, mining and electrical systems, so calling it oxygen alone would be false.
- AUTO-PING now defaults off and persists as a pause option; manual F/click/tap sonar remains available. Added a persisted camera-motion option alongside the existing audio, zoom, text and contrast controls.

## 2026-08-10 — Deep Swarm: full-resolution render restored, and the junction becomes three faults

- Reverted the half-resolution post-processing upload. The justification for it — that the shader is low-frequency and resolves no detail the downscale would carry — was wrong about what the texture is: it is the entire scene, not an effect buffer, so halving it softened every sprite, glyph and HUD edge in the game.
- The cost it had been avoiding was never the pixel count. `texImage2D` reallocates GPU storage on every call; allocating once and uploading through `texSubImage2D` reuses it. Full resolution now runs *faster* than the half-res build did — 60 fps average across all four soak bands, minimum 54 at 4,200 m, against the half-res build's 55 average and 44 minimum. The blur had been paying for a problem it did not fix.
- Replaced the Power Junction. The Lights Out grid was abstract, cascading and mostly trial-and-error, with a hint key that simply solved it — it had no relationship to the fiction beyond its label. It is now three faults, and which one opens is decided by what actually failed, so the screen tells you something about the boat before you touch it.
- **ARC WALK** (a dead bay bus): the fault chases you across the terminal grid, one step for every step you take, and everything it leaves behind is dead and impassable. Flooded terminals cost you a beat, which is a free step for the arc — so the route matters more than the distance, and walking the boundary blindly loses. One shunt-to-ground per junction buys two steps back.
- **FAULT TRACE** (a broken system): an open circuit somewhere in a sixteen-segment run. Each probe reads continuity and tells you which side the break is on; binary search finds it in four, random poking runs out of the five-probe reserve. Then you have to commit and cut.
- **LOAD BALANCE** (a brownout): three buses and four loads whose draw cycles live — weapons ramping while the lamp and scrubbers sit under it. Keep every bus under its rating for the cycle without cooking one or dropping a critical. This is literally what the fault text already described.
- Failure costs battery and attention but never hull. Being cornered inside a junction box should not hole the boat, and a wall there would only make the player reload.
- Added `scripts/deep-swarm-junction.mjs` — 32 checks driving all three to both outcomes, including a solver that proves an ARC WALK board is actually winnable rather than assuming it.
- The new suite asserts an expected check count rather than an absence of failures, and that guard immediately caught its own miscount. The ARC WALK win test caught a real design property first: the naive boundary walk loses, because water on that route hands the arc enough free steps to catch you. That is the intended skill, so the harness now routes around it.

## 2026-08-10 — Deep Swarm: the archive assembles and NEREID declines an order

- Gave the forty-five codex fragments something to add up to. Five dossiers now assemble permanently once their fragment set is held: DSV-01's final forty seconds, LANTERN-3's photograph eleven, Meridian's internal report on the vent chain, the nine souls of MV Kestrel, and a review of what NEREID's unattributed code is actually shaped like.
- Reworked how fragments are handed out so one advancing a thread already in progress jumps the layer queue. Threads now complete across the run of collection rather than all in the final handful, and chasing one feels like chasing something.
- The field PDA lists assembled documents above the raw fragments and shows which threads are still open and how far along they are, since what is missing is as informative as what is held.
- Gave NEREID an arc with four stages rather than a corruption number. She reports; then she starts asking questions; then she starts asking for things; and at the end, once per save and never again, she declines an order. Giving it a second time is obeyed, with thanks for asking twice.
- Wrecks are now readable close aboard: register, the attitude she is lying in, and the cause the file attributes — which is rarely what the attitude says.
- Finished the opening sequence with a placed teaching rock twenty-six seconds in, sound seam and a single strike, so the first ore fall a pilot meets is the one that teaches the verb. The first situation now lands around ninety seconds, after the cold open and the first level-up.
- Added `scripts/deep-swarm-lore.mjs`. It caught a real defect: the first wreck-legibility hash mapped a uniform seed almost linearly onto five buckets, so attitude and cause moved together and distant wrecks read identically. Replaced with an independently salted hash, and the check now measures distribution across sixty wrecks instead of comparing two.

## 2026-08-10 — Deep Swarm: the event catalogue doubles and starts escalating

- Took the catalogue from twenty-three situations to forty, keeping the original rule that every option costs something and adding one of its own: each new situation reaches into a system that already exists rather than inventing a stat for itself.
- New ground includes a voice on the hydrophone using NEREID's own cadence and asking for a position fix, a clutch of eggs laid in the intake in a spiral that follows the impeller housing, a Meridian drone auditing the hold, a body still perfectly buoyant in an intact suit, a mooring chain under load where nothing was ever moored, a pressure hatch kept clean from the outside, a wreck with her running lights still lit after thirty-five years, a sounder that has stopped finding a floor, and a sweep that comes back in the boat's own format.
- Recovering the body silences NEREID for two minutes. Alarms still get through; nothing else does.
- Carrying the clutch instead of purging it costs speed for the rest of the dive and then hatches at twenty-two hundred metres, which is what she told you would happen.
- Taking the clean ascent window banks the dive early; refusing it closes that window permanently.
- Rewrote the picker. Situations can now gate on depth, hunt state and NEREID's condition, unseen ones are offered first, and weighting scales with how far past its gate the dive already is — so a deep, loud, unravelling run escalates instead of reshuffling the same deck.
- Added `scripts/deep-swarm-events.mjs`, which runs all eighty-two choices and all forty no-choice branches to catch options referencing helpers that do not exist, and checks gating and picker bias.
- The same script found three older situations carrying only a single line of text; DSV-01's shade, the drowned archive and the LANTERN-3 echo now carry the detail the rest of the catalogue does.

## 2026-08-10 — Deep Swarm: hands-on jobs and maintenance debt

- Added four jobs the existing maintenance minigame could not express, since it already owns keyed sequences: holding a drifting bubble inside a band that keeps narrowing, training an array onto a hidden null with nothing to steer by but return strength, holding two controls at once to purge a flooded lock, and swapping scrubber cartridges against a timer that is the air remaining.
- None of them offer an exit. Walking away is the failure, and each failure is paid in its own currency — a boat that rides bow-down and crabs until it is sorted, an array misalignment that broadcasts position, an open hull, or a third of the reserve gone.
- Added maintenance debt: every system left below par accrues on its own clock, and when it comes due it chooses the job and hands it over unasked. A pilot who only ever shoots gets handed a trim at the worst possible moment, and attending to the boat between fights is the only counterplay.
- Put a single cooldown across every entry point after finding that a close implosion could hand over a job while the previous one was still settling, which reads as the game taking the controls away rather than as pressure.
- Added `scripts/deep-swarm-rig.mjs` covering each grammar to both outcomes, plus debt firing, resolving and re-arming.
- Deliberately did not build a reactor scram: it is the same keyed sequence the maintenance minigame already runs, and would have been a second copy of an existing screen.

## 2026-08-10 — Deep Swarm: mining rework and the first in-dive material sinks

- Ore falls no longer surrender to a single dash. Rock now takes one to three strikes depending on size, wears visible fracture lines as it goes, and pays more the longer it holds out — a reason to work one rock instead of grazing three.
- The seam's shape is now the tell. A single clean vein is sound rock. A vein that forks is already broken through: it comes apart on the first strike, pays half, and lets out whatever had made a home in the fracture.
- Shattering sound rock throws a shock front that damages and scatters anything standing near it, so lining a boulder up with a pack is a legitimate way to fight.
- Below three kilometres some rock is holding back more pressure than it can carry. Cracking one collapses it inward instead of outward, dragging the submarine and nearby creatures toward the failure and opening the hull if it happens close.
- The mining laser now also cuts ore falls — slower, drawing power, broadcasting noise, and paying a third more than a dash. Two honest ways to take the same rock, reusing the existing module rather than inventing a second verb.
- Added the Field Bay: hull patch, thirty-second weapon overcharge, and a ballast dump that buys back silence, spent from mined material during the dive. Until now every material was banked for the Mooring, which made ore a collection rather than a decision.
- Added `scripts/deep-swarm-mining.mjs`, which places and strikes each rock type directly, because ore falls spawn on a random timer and need a dash landed on them.

## 2026-08-10 — Deep Swarm: the dread layer

- Added THE OPEN — once a dive, below 1,500 m, the trench walls recede, the sounder stops returning a floor, spawning stops and the music drops out. After twelve seconds of genuinely empty water one shape passes at the limit of the light, far too large, going the other way. The keel readout shows dashes throughout.
- Added a keel-clearance readout so the void is legible as a number, and a pressure peak that only ever climbs and stays on the glass for the rest of the dive.
- Added silence windows that cut everything to hull noise for twenty to forty seconds; about one in five is the prelude to a contact from every bearing at once, and the rest are nothing at all.
- Added the thing that follows: a single presence per dive that never attacks, matches depth, holds at the edge of the lamp, closes when the boat is loud, and is deliberately kept out of the enemy list so it cannot be shot, hit, or removed.
- Added a sweep that gets answered below 2,000 m in the boat's own pulse format, marked on a bearing at the radar rim because range never resolves.
- Added instruments that lie past MIND sixty: the radar invents contacts drawn exactly like real ones, and sometimes quietly stops drawing one that exists.
- Added a hypoxia layer on failing life support or a failing MIND — the view closes to a tube that breathes, with the pilot's own breathing in the mix.
- Added machinery that predates the expedition and still works: mooring chain under load running out of the dark above and into the dark below, ladders bolted to walls that are no longer there, and pressure hatches whose wheel is on the outside. Roughly one deep wreck in four now has its lights on.
- Bodies persist longer with depth, so the trench keeps a record of the route taken.
- Added `scripts/deep-swarm-dread.mjs`, which forces each beat and asserts its consequence, because every one of them fires on a long random timer and would otherwise go unverified for weeks of playtests.

## 2026-08-10 — Deep Swarm: depth-lag root cause, render perf and opening pacing

- Found the cause of the reported lag past 2,000 m: nothing bounded `g.enemies`, while the spawn interval floors at 0.4 s, fires up to four at a time, and ATTENTION shortens it further — so a loud deep run accumulated contacts faster than the pilot could clear them, and projectile-versus-enemy collision was a full O(projectiles × enemies) scan over every one of them.
- Added a shared spatial hash and routed collision, area-of-effect, arc, chain, overkill, pack-count, aggro and sonar-ring queries through it; the ecology sim had built one of these inline and combat had never used it.
- Added a depth-scaled standing contact quota with an off-screen cull that never removes bosses, aberrants, carriers, hooked, scanned or visible contacts, so an overloaded field drains back to quota without anything winking out on screen.
- Cached the darkness mask's drawing context and its four per-frame radial gradients, cached seeded obstacle geometry into per-obstacle sprites behind a context-parameter refactor of `drawObstacle`, and halved the resolution of the per-frame canvas upload feeding the post-processing shader.
- Measured with a new repeatable soak harness rather than by impression: a forced full field at 4,200 m went from 13 frames per second to a locked 60, with no console errors and no visual difference against the pre-change build.
- Made AUTO-PING standard fit from the first second instead of a level-three card or level-five grant, and rebuilt the freed upgrade slot into a three-card sonar line: wider aperture, longer-persisting returns, and density discrimination that flags wrecks and salvage on the sweep.
- Shortened the first four waves to 32 seconds and added an 18-second cold open — empty water, a pre-flight exchange with NEREID, and one large silhouette that passes and does not care — so the trench has a silence to break.

## 2026-08-10 — DJ audio engine, mixer and psychedelic performance pass

- Replaced coarse `timeupdate` loop seeking with beat-snapped `AudioBufferSourceNode` loops driven by the audio clock, including fractional beat lengths and genuine slip position recovery.
- Added a DJ-specific signed-playhead AudioWorklet so platter gestures reproduce decoded local audio forwards and backwards; guarded asynchronous play/stop intent against browser races.
- Rebuilt the wide composition as deck–mixer–deck, moving trim, HI, MID, LOW, filter and channel levels into readable central strips; stacked the rig before tablet and mobile controls can collide.
- Added eight audible master effects with wet/dry control, a connected pivot–tube–headshell–stylus assembly that lands on the record while playing, shorter hot-cue labels and a touch-accessible clear-cues action.
- Added psychedelic multicolour waveforms, reactive record-label glow, effect-state rings, illuminated meters, target light, quartz state and reduced-motion fallbacks.
- Expanded functional coverage for engine-clock loop wraps, forward and reverse scratch audio, connected tonearm structure, effects and mobile cue clearing; expanded responsive coverage to 1,024 px and verified the production build.

## 2026-08-10 — Direct-drive DJ deck rebuild

- Replaced the generic controller face with a physically grounded, branding-free SL-1200-inspired layout: brushed aluminium plinths, oversized grooved vinyl platters, strobe-dot rims, tonearms, stylus lamps, quartz indicators, 33/45 markers, start/stop keys and vertical pitch faders.
- Connected the visual states to the instrument rather than looping decoration: records spin only during playback, tonearms follow track progress, loaded tracks light the target/quartz lamps, hot cues and transport states illuminate, and dual 12-segment VU ladders read the actual Web Audio deck signals.
- Removed the visible embed warning and its help topic, while retaining the local-file privacy label and complete DJ control tutorial.
- Added reduced-motion fallbacks and browser assertions for loaded/playing/stopped light states, responsive platter size, vertical pitch geometry and live audio meter response.

## 2026-08-10 — Local-first DJ Studio

- Added DJ as Studio's sixth mode with two local-file Web Audio decks, decoded waveforms and BPM analysis, jog/needle seeking, main and eight hot cues, automatic/manual loops, slip, ±16% tempo, pitch preservation and deck sync.
- Routed trim, three-band isolator EQ, bipolar filters, channel levels and an equal-power crossfader into the existing Studio master chain; added local-bus recording and session-only browser library controls.
- Extended only the shared CSP `media-src` directive with `blob:` so browser-created local audio can play in production without relaxing script, connection, frame or upload policy.
- Kept YouTube, YouTube Music and SoundCloud embeds outside the audio bus and explained the licensed-provider boundary in the UI and searchable help instead of presenting a non-compliant fake mixer.
- Added DJ keyboard shortcuts, guided-tour coverage and five detailed help topics covering file privacy, deck workflow, tempo/loops, mixing/recording and streaming limits.
- Built separate desktop and stacked Android compositions, then fixed a landscape deck-squash and mobile library-overlap found by responsive browser testing.
- Extended Studio functional and four-viewport responsive suites to cover all six modes, local WAV decode/BPM/hot-cue/library behaviour, deck width, crossfader width, stacking and library clearance.

## 2026-08-09 — Unified tool navigation and deep Lattice nesting

- Made the edge-anchored desktop workspace automatic for every actual site tool rather than a Programme-only opt-in; all 19 tested routes place the rail at x=24 and content at x=248.
- Kept one identical 342×46 px compact tool picker across all tested phone routes and removed the duplicated Quick start group from the tool hub.
- Changed new Lattice subgrids from 2×2 to TreeSheets-style 1×1 cells and fixed zoom paths for cells nested below the current display root.
- Added `Ctrl+Enter` child creation, repeated arbitrary-depth nesting, `Alt+Enter` sibling creation, matching touch controls and updated help text.
- Expanded browser coverage for shared desktop/mobile navigation geometry, removal of Quick start, three-level keyboard nesting and sibling editing; verified type checks, the production build, all site tools and Programme responsiveness.

## 2026-08-09 — Programme desktop workspace

- Replaced the centred Programme breakout calculation with an explicit wide-workspace layout mode while preserving readable-width site chrome and prose.
- Anchored the searchable tools navigation 24 px from the left viewport edge and expanded the editor to fill the remaining desktop width; at 1,440 px it now spans 1,168 px instead of 1,024 px.
- Kept the compact mobile picker and full-width Android landscape editor unchanged.
- Strengthened the responsive regression to assert the rail's viewport position and complete use of the available workspace; verified Programme, all site-tool routes, type checks and the production build.

## 2026-08-09 — Studio Lysergic workflow overhaul

- Replaced the restrained flat-DAW finish with a graphite, acid, violet and pink performance identity: reactive pads and sequencer states, spectral Signal Garden, audio-reactive signal organism and animated clip activity.
- Rebuilt phone and short-landscape mode composition around usable instrument dimensions: horizontally scrolling drum steps, separated 4×4 pads, readable mixer strips and a visible CLIPS scene range.
- Made first use immediately playable with the `MIDNIGHT ACID` demo and a non-blocking hint; retained the full tutorial as an explicit action and corrected its stacking and small-screen fit.
- Added in-place blank/demo/project/song replacement, preserved navigation context and made project replacement undoable instead of reloading the application.
- Persisted mixer levels, master level, power, mute and solo with the project; synchronised the header master control and mixer control through one state model.
- Added visible and accessible accent/slide controls, named piano keys and drum cells, project shortcuts, delayed tooltips and improved CLIPS position feedback.
- Expanded Studio browser regression coverage for first-run content, mixer persistence, undoable project replacement, mobile control dimensions, scene visibility and tutorial stacking across desktop, laptop, Android portrait and Android landscape.

## 2026-07-26 — Deep Swarm colour and Electric Field hotfix

- Prevented dynamic effects with missing colour metadata from crashing the renderer while converting a hex colour to alpha.
- Fixed Electric Field damage being multiplied by a single frame interval despite firing only once per half-second cooldown; it now applies the intended three damage per pulse at level one.
- Added production-browser regressions for malformed dynamic colours and measurable Electric Field damage, plus Android portrait/landscape canvas, overflow, repair-blueprint and console coverage.

## 2026-07-26 — Deep Swarm bathysphere and dive pacing

- Fixed the reported flight-computer fault by initialising deployable-weapon state in every run and defensively recovering old or malformed sessions before a weapon fires.
- Rebuilt the repair artwork around a large spherical pressure vessel with a viewport, ballast, batteries, life support, propulsion, sonar and manipulator mechanisms; aligned interactive damage nodes with those assemblies.
- Added a distinct animated scientific plate and anatomical callouts for each of the six keystone species in the xenobiology PDA.
- Reduced ordinary sealed-wreck frequency, limited Power Junction scrambles to two or three moves and reserved guaranteed junctions for selected authored story sites.
- Queued routine NEREID dialogue at eight-second intervals while preserving urgent warnings.
- Added a depth-driven lo-fi, trip-hop, hip-hop, electronic, dubstep, techno, drum-and-bass and jungle arc using genre-specific generated rhythm layers over the existing licensed tonal tracks; documented the reviewed Pixabay shortlist without importing unverified audio.
- Extended production-browser coverage for deployable-state recovery, junction difficulty, NEREID pacing and the hadal music stage; verified the system and PDA artwork at 1,280 × 800.
- Bumped the scoped offline cache so installed copies receive the stabilised build.

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
