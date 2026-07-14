# Run Log

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
