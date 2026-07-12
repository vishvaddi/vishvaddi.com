# Project State

_Last updated: 2026-07-11 — Big 2 now has Standard mode as the default and opt-in Roguelike/Daily modes for ongoing development._

## Current Position

- `src/pages/games/big2.astro` hosts the Big 2 UI.
- `public/scripts/big2.js` contains the full browser game logic.
- Standard mode is the default: one classic Big 2 deal, win/loss record, no run economy.
- Roguelike mode is opt-in: 12-table run, score targets, coins, wagers, Charms, Mastery, Markets and boss rules.
- Daily run is opt-in: same roguelike structure with a date seed.

## Next Actions

- Play 5-10 real Roguelike runs and tune target curve, coin rewards and Charm prices.
- Add a visible post-run summary card once enough balance feedback exists.
- Decide whether feedback packets should stay copy/email-only or post to a lightweight backend.

## Open Questions

- Should Roguelike runs be 8 tables instead of 12 for faster repeat play?
- Should Standard mode keep the quick legal-move buttons, or should it be even cleaner?
- Should Daily run persist best daily score separately from best all-time run?
