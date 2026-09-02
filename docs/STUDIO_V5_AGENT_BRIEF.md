# Studio v5 — mode rewrite brief (for parallel agents)

You are rewriting ONE Studio mode's presentation and workflow for the v5 skin. Read `docs/STUDIO_V5_PLAN.md` §1 (findings for your mode), §3 (target design system) and §4 (your phase) first. This brief is the contract.

## The situation
- The old skin (`src/styles/_legacy/studio.css`, `studio-workflow.css`, `studio-redesign.css`) is **no longer imported**. It is reference only: read it to learn which structural layouts the harness depends on (scroll ownership, grid shapes, drawer behaviour), then write your own rules. Do not copy its visual rules, its `!important`s or its `.immersive-page` specificity hacks.
- The new foundation is loaded for every mode: `src/styles/studio/tokens.css` (all colours, sizes, type — consume only), `base.css` (primitives: `.wa-btn`, `.wa-btn-sm`, `.wa-toggle`, `.wa-subtabs`/`.wa-subtab`, `.wa-lbl`, `.wa-fx-title`, `.wa-panel`, `.wa-inspector`, inputs, `.wa-knob-row`, `.wa-keys`, dialogs, tooltips, tutorial), `shell.css` (app bar, rail, phone dock, `.wa-pagehost`/`.wa-page`). Read all three before writing a line.
- Your mode currently renders unstyled inside a correct shell. Everything below the page toolbar is yours.

## Files you own (edit nothing else)
| Mode | CSS partial | TS modules | Harness lines |
|---|---|---|---|
| pads | `src/styles/studio/pads.css` | `padsui.ts`, `chopui.ts` | PADS/BEAT/all-pad checks |
| drums | `src/styles/studio/drums.css` | `drumgrid.ts`, `laneui.ts` | DRUMS checks |
| synth | `src/styles/studio/synth.css` | `synthui.ts`, `roll.ts`, `keys.ts`, `xyfield.ts`, `orb.ts`, `bandscan.ts` | synth / Sound / keyboard / bank checks |
| arrange | `src/styles/studio/arrange.css` | `session.ts` | Arrange / clip launcher / automation checks |
| mix | `src/styles/studio/mix.css` | `mixerui.ts`, `fxrack.ts` | MIX / macro / sphere checks |
| dj | `src/styles/studio/dj.css` | `dj.ts`, `scratch.ts` | DJ checks |

- `layout.ts` builds the page frames (`.wa-page-*`, sub-toolbars, drawers). You may style every class it creates for your page, but do not edit `layout.ts`, `index.ts`, `state.ts`, `tokens.css`, `base.css` or `shell.css`. If a primitive genuinely needs a change, put the rule in your partial scoped under your page class and say so in your report.
- Harness edits: `scripts/studio-responsive-e2e.mjs`, `scripts/studio-e2e.mjs`, `scripts/studio-density-e2e.mjs` — change only the checks for your mode, only where the plan deliberately changes behaviour (say which in your report). Never delete a check to make it pass; rewrite it to assert the new intended behaviour.

## Design rules (non-negotiable)
1. **Colours come from tokens.** No hex literals in your partial except inside `color-mix()` with a token. Surfaces: `--wa-canvas` < `--wa-surface` < `--wa-raised` < `--wa-control` < `--wa-control-hi`. Borders: `--wa-border`, `--wa-border-soft`.
2. **Orange (`--wa-accent`) means interaction state only**: selected, active, focus, playhead. Never identity.
3. **Track colour means identity.** Set `data-track="drums|pads|bass|lead|harmony|audio"` on the element that represents a track (tokens.css maps it to `--track-colour`); inside it use `var(--track-colour)` for the tag, lit steps, notes, clip fills, strip headers. For per-lane or per-pad identity inside one track, set `--track-colour` inline to one of `--wa-track-1…8` cycling by index.
4. **Signal colours**: `--wa-rec`, `--wa-play`, `--wa-warn`. Nothing else is coloured.
5. **Type**: sizes `--wa-fs-xs/sm/md/lg/xl` only. No letter-spacing above `0.06em`. Uppercase only on `.wa-lbl`/`.wa-fx-title`-class section labels, never on controls or data.
6. **Geometry**: radius `--wa-radius` (panels) / `--wa-radius-sm` (controls); gaps `--wa-gap` / `--wa-gap-in`; knob `--wa-knob`; control height `--wa-control-h`; touch targets ≥ `--wa-touch` (44 px) when `(pointer: coarse)`.
7. **Zero `!important`.** Zero `.immersive-page` prefixes. Win specificity with your page class (`.wa-page-drums .wa-cell`), never with repetition.
8. **Scroll ownership is explicit**: the page never scrolls the document; exactly one element per region has `overflow: auto` and `overscroll-behavior: contain`. The density harness fails on document scroll and on trailing void.
9. **Every knob label must be fully visible** — give `.wa-knob-row` room (min-width ≥ knob + 16 px) and let labels wrap to two lines if needed (`white-space: normal; line-height: 1.1`).
10. **Flat, not skeuomorphic.** No gradients except the knob face (base.css), no glows, no bevels, no wood, no scanlines.

## Reference behaviour (what "Cubasis / FL Studio Mobile" means for you)
- Pads: FLM pads — square, tinted with `--track-colour`, name + number, brighten on hit (`.hit`/`.down` class exists — check padsui.ts) scaled by velocity. Controls are icon toggles in one row above the deck. Sample page: 4-column knob grid, segmented toggles.
- Drums: FLM step sequencer — lane header = colour chip + name (tap select, hold mute); steps lit in lane colour, opacity = velocity, 4-step group shading; shared knob for every parameter (replace the four native range sliders in laneui.ts's synth-drum block with `knob()` from `./knob`); RANDOM/CLEAR into the toolbar.
- Synth: Cubasis key editor — real black/white keyboard column, notes in track colour, tool palette (draw / select / erase / split) as a segmented `.wa-subtabs` at the bottom-left, roll fills the aperture, velocity lane fixed 72 px. Sound: two levels only — bank tabs then bank content; the VV-1 hero becomes the top half of the OSC banks; matrix rows are one line each.
- Arrange: Cubasis project window — track header = colour tag · number · name · type icon · M / S / ● ; clip label = name only; scene squares drawn as clips; timeline runs to song end + 8 bars; zoom/Fit in the ruler; Automation and Songs become a left inspector with sections. Clip launcher keeps its look; phone gets a scroll cue.
- Mix: Cubasis MixConsole — strips fill the width, colour header, pan knob, M / S, fader with meter beside it, reverb/send knob; fix the `NaN` master readout; device dock below; the sphere becomes the Scope tab (update the "permanently visible" check to "Scope tab shows the sphere").
- DJ: compact view by default (flat waveform overview + jog ring, cue points on the waveform); vinyl view stays available via the existing toggle; performance mixer strips match Mix; the wizard header becomes a one-line status; fix the CROSSFADER/FX overlap and the phone crossfader-over-hot-cues overlap. Update the harness so vinyl checks run only when vinyl view is selected.

## Gates (run all; your report must quote the numbers)
```
npm ci                                   # first time in a fresh worktree
npx astro check                          # 0 errors
npm run build
node scripts/studio-responsive-e2e.mjs dist          # all five viewports
node scripts/studio-e2e.mjs dist
node scripts/studio-density-e2e.mjs dist
node scripts/studio-shots.mjs shots      # then READ shots/*-<yourmode>*.png at desktop, phone, landscape and judge them against the design rules
```
Other modes will still fail their checks in your worktree — that is expected; report your mode's checks only, but do not break the shell checks (intents, menus, app bar ≤ 48 px, rail ≤ 56 px, no document overflow, dock keys ≥ 44 px).

## Report format
Files changed · harness checks for your mode (before/after counts, any check you rewrote and why) · screenshots judged (what still looks wrong, if anything) · anything you needed from the foundation that you could not do in your partial.
