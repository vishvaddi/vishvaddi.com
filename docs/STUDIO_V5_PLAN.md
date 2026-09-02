# Studio v5 — visual and workflow rework plan

_Written 2026-09-02 by Claude from a full audit of the deployed `/studio/` (version `cb13a883`), Vish's desktop screenshots of 30/08 and 02/09, 27 harness screenshots (desktop 1440×900, phone 390×844, landscape 844×390 × 9 modes), the three studio stylesheets and the run log since 24/08. Status: **PLAN — not yet approved, nothing built.**_

**Brief (Vish, 02/09):** make Studio look significantly better — Cubasis and FL Studio Mobile as the aesthetic and UX/workflow references — and update all areas.

**Standing constraints that still apply:** no feature removals or hiding (16/08 ruling — reorganise only); deferred sound-depth items stay deferred; 4 h/week build cap; every phase ships behind the three studio harnesses (functional, responsive, density) plus `astro check`.

---

## TL;DR

The studio does not look like one product because it is wearing three skins at once. `studio.css` (5,658 lines) carries roughly twenty named passes stacked on each other, `studio-workflow.css` (978 lines, 157 `!important`) overrides that, and Codex's uncommitted `studio-redesign.css` (322 lines, 181 `!important`) overrides both. Every new pass has been additive, so knobs, borders, radii, type and colour differ by mode, and layout defects slip through. The plan is: collapse to one token-driven stylesheet first (P0), then rebuild the shell and transport (P1), then bring track colour and the FLM performance feel to Pads/Drums (P2), the Cubasis editor conventions to Synth, Arrange and Mix (P3–P5), de-skeuomorph DJ (P6), and close with a phone pass (P7). Each phase is one shippable commit.

---

## 1. What the screenshots say

### Shell and transport (all modes)
- App bar is a 46 px strip with 38 px grey play/stop icons and **no record button, no song position, no loop, no metronome**. The loudest element on screen is SAVE / EXPORT (an admin action). In both references the transport block, position counter and tempo are the visual anchor and Record is always present.
- Left rail shows seven keys of equal weight (MAKE / ARRANGE / DJ, then PADS / DRUMS / SYNTH / MIX). The two-level grouping (intent → instrument) is only implied by a gap.
- On phone the chrome is roughly 300 of 844 px: a two-row app bar (menu labels at 9 px are unusable), a two-row page sub-toolbar, and **two stacked bottom docks** (PADS·DRUMS·SYNTH·MIX above MAKE·ARRANGE·DJ). In landscape chrome takes about 230 of 390 px — Drums shows a row and a half of grid. FLM uses one top bar and one bottom bar.
- The "A demo is loaded — press ▶" toast floats over working content in every mode and never goes away on its own.

### Pads
- 4×4 deck is uncoloured grey boxes with numbers; no lit-on-hit, no velocity feedback, no track/pad colour. FLM's pads and steps are the channel colour and light when they fire.
- The left "controls" column is a vertical stack of text buttons and native selects (Full Level / 16 Levels / 16 Velocities / Note Repeat / 1/16 / Record / Overdub / Undo pass / 1/16 / More) — it reads as a form, not an instrument. These are toggles and should be an icon toggle row.
- Sample page: eight knobs spread as a two-column grid across 1,400 px with 500 px of empty space between columns, and Reverse / Loop / Warp / Mute / Solo as full-width bars. Layout defect.

### Drums
- Grid works but rows are oversized cards with wide gaps, steps are all orange regardless of lane, and there is no 4-step group shading beyond faint numerals. No velocity on steps.
- Inspector uses native range sliders for Punch/Body/Decay/Drive while the rest of the app uses knobs — inconsistent control vocabulary.
- Phone: RANDOM / CLEAR overlay sits on top of the Crash row.

### Synth
- Notes: keyboard column is a stack of white blocks with no black/white key pattern; notes are flat green; the roll stops at ~570 px and leaves 130 px of dead canvas above the velocity lane; the toolbar is nine small text buttons (Select / All / Copy / Paste / Note Accent / Note Slide …). Cubasis and FLM both use a tool palette (draw / select / erase / split) and keep the keyboard real.
- Sound: three stacked layers (bank tabs → permanent VV-1 hero with four modules → bank detail). The bank detail (e.g. OSC 3) is squeezed into a 460 px column and **every knob label in the module cards is clipped** (SHAPE, MOVEMENT, BRIGHTNESS, ATTACK … all cut at the bottom). Mod matrix rows are two giant native selects plus a knob.

### Arrange / Clips
- Structure is close to Cubasis (colour bar, number, name, type, ruler, coloured clips). Problems: clip labels render as "B · 1 b" truncated; every track starts with a salmon-red square that reads as an error state; the ruler ends at bar 16 with 250 px of unused timeline; Automation and Songs are collapsed bars at the bottom rather than inspector sections; header column is 170 px.
- Clip launcher is the cleanest surface in the app. Phone: grid is cut at the right edge with no scroll cue and half the screen is empty below.

### Mix
- Channel strips occupy 1,160 of 1,440 px and leave a blank right region; master fader reads **NaN**; meters are empty at rest; no insert/send slots on the strip; pan knobs are green while every other knob is orange/grey. The Lysergic sphere holds permanent real estate. Cubasis's MixConsole fills the width with colour-tagged strips and inserts.
- Phone: four strips visible, no horizontal-scroll affordance, 300 px empty below.

### DJ
- Two 300 px skeuomorphic vinyl platters with tonearms inside an otherwise flat graphite app. The performance mixer is a 130 px column of tiny sliders. "CROSSFADER" overlaps "FX WET / DRY" and "FX ON" (visible in both Vish's and the harness screenshots). Phone: the crossfader panel covers hot cues 5–8.
- The "1 CHOOSE TRACKS 2 LOAD A + B 3 MIX 4 RECORD" wizard header is copy, not UI.

### System-level
- **Colour has no semantics.** Orange means selected, active, step on, fader, save, scene A, tab. Track colour exists only in Arrange/Clips. Module cards carry purple / teal / orange / blue header stripes for no functional reason.
- **Type is noisy.** Letter-spaced small caps on every heading and label ("DRUM RACK SEQUENCER", "SELECTED PAD", "PERFORMANCE MIXER"), 8–9 px labels, three type voices (sans, mono LCD, spaced caps).
- **Controls differ by mode:** knobs at 40 / 52 / 58 px, buttons with 3 radii, native selects beside custom ones, native range sliders in Drums only.

### Defects to fix regardless of the redesign
| # | Defect | Where |
|---|---|---|
| D1 | Master fader value shows `NaN` | Mix, desktop + phone |
| D2 | CROSSFADER label overlaps FX WET/DRY and FX ON | DJ desktop |
| D3 | Crossfader panel covers hot cues 5–8 | DJ phone |
| D4 | RANDOM / CLEAR overlay covers Crash row | Drums phone |
| D5 | Knob labels clipped in every Sound module card | Synth Sound |
| D6 | Sample-page knobs spread across full width | Pads › Sample |
| D7 | Demo toast persists over content in every mode | All |
| D8 | Clip labels truncate to "B · 1 b" | Arrange |
| D9 | Menu labels 9 px on phone | Shell phone |

---

## 2. Root cause: three skins, not one

| File | Lines | `!important` | `@media` | Origin |
|---|---|---|---|---|
| `src/styles/studio.css` | 5,658 | 79 | 78 | Passes F, G, H, I, v3, v16, v4, v19 … stacked since July |
| `src/styles/studio-workflow.css` | 978 | 157 | 10 | Aug workflow rework |
| `src/styles/studio-redesign.css` (uncommitted, Codex) | 322 | 181 | 1 | "Studio v4 presentation", in progress today |

417 `!important` declarations across 89 media queries. Any fourth skin applied on top will inherit every inconsistency underneath it. That is why the 30/08 "one graphite system" pass and today's Codex pass both look partially applied: they are.

**Consequence for the plan:** P0 is CSS consolidation, before any visual work. It is the least glamorous phase and the only one that makes the rest stick.

---

## 3. Target design system (what "looks like Cubasis / FLM" means here)

Reference reading (evidence: MusicTech and Sound On Sound Cubasis 3 reviews; Image-Line FLM manual; the rest from memory — medium confidence on specifics):

- **FL Studio Mobile:** one canvas, one bottom toolbar, overlays for browser and track panel. Playlist is the hub; tapping a clip opens its editor. Steps and pads are lit in the channel colour. Big touch targets, flat surfaces, a single accent for interaction.
- **Cubasis 3:** arrange window is home; left inspector with sections (routing, instrument, inserts, sends, EQ, automation); MixConsole, keyboard and pads slide in from the bottom; tool palette (select / draw / erase / split) in the toolbar; transport with position counter centred; track headers carry colour tag, name, M / S / R / record-arm.

### Tokens (single source, top of `studio.css`)
- Surfaces: canvas `#07090d` · surface `#0d1118` · raised `#141a23` · control `#1a2230` · border `#293445` / soft `#1a2330` (Codex's v4 values are good; adopt them as the seed).
- Text: primary `#e8edf5` · muted `#8290a4` · faint `#536075`.
- **One accent:** orange `#ff914d` — used only for interaction state (selected, active, focus, playhead). Never for identity.
- **Track palette (8):** the identity colour of a track or pad, used everywhere that track appears: rail chip, pad, step, lane header, clip, mixer strip header, piano-roll notes.
- Signal colours: rec red · play green · warn amber · error red. Nothing else gets a colour.
- Type: 11 / 12 / 13 / 15 / 18 px; letter-spacing 0 except the LCD; small caps only on section labels, never on controls.
- Geometry: radius 4 (controls) / 6 (panels); knob 40 px desktop, 52 px touch; button 32 / 44 px; fader travel ≥ 160 px; gap 8, panel padding 10.
- One component set: button, icon-toggle, segmented tab, knob, fader, select, field, panel, card, strip. Modes compose these; no mode redefines a primitive.

---

## 4. Phases (each ships as one commit, harness-green, deployed)

### P0 — One stylesheet
Fold `studio-workflow.css` and `studio-redesign.css` into `studio.css` v5 with the token block at the top; delete every superseded named pass; replace `!important` with specificity or removal. Targets: ≤ 2,500 lines, 0 `!important`, ≤ 25 media queries, pixel-parity screenshots within tolerance where no visual change is intended. Fix D1–D9 here (they are mostly CSS). Add `scripts/studio-shots.mjs` (done) as the before/after baseline.

### P1 — Shell and transport
One 48 px app bar: menu ⋯ · project name · **position counter (bar.beat.tick + time)** · transport (■ ▶ ● loop metronome) · BPM · undo / redo · save (secondary weight). Desktop rail stays but is visibly two-level: MAKE with its four sub-keys indented and colour-chipped, ARRANGE, DJ. Phone: **one** bottom bar (Pads · Drums · Synth · Mix · Song · DJ), page sub-toolbars collapse into a single row with a ⋯ overflow, menus behind the ⋯. Landscape: bottom bar becomes a 44 px left strip. Demo toast becomes a dismissible banner inside the page header, shown once.

### P2 — Track colour, Pads and Drums (the FLM feel)
Track colour propagated to every surface. Pads: tinted cells, lit on hit with velocity brightness, name + number, bank tabs as segmented control; the controls column becomes an icon toggle row above the deck; sample page becomes a 4-column knob grid with segmented toggles. Drums: steps lit in lane colour, 4-step group shading, velocity as step brightness, lane header = colour chip + name (tap select, hold mute), inspector sliders replaced with the shared knob, row tools moved into the toolbar.

### P3 — Synth (Cubasis key editor)
Notes: real black/white keyboard column, notes in track colour, tool palette (draw / select / erase / split) bottom-left, roll fills the aperture, velocity lane fixed at 72 px. Sound: two levels only — bank tabs and bank content; the VV-1 hero becomes the top half of the OSC banks instead of a permanent third layer; module cards get room so labels stop clipping; matrix rows compact to source › destination › amount on one line.

### P4 — Arrange and Clips (Cubasis home)
Track header = colour tag · number · name · type icon · M / S / R / ●. Clip label = clip name only; the scene-A squares get a real identity (they are pattern references — draw them as clips). Timeline extends to song end + 8 bars; zoom and Fit live in the ruler. Automation and Songs move into a left inspector with sections instead of collapsed bars. Clip launcher keeps its look; phone gets a scroll cue and fills the height.

### P5 — Mix (MixConsole)
Strips fill the width with colour headers, insert slot, send knob, pan, fader + meter; NaN gone; device dock shows the selected strip's chain; the sphere becomes the Scope tab (not permanent). Phone: horizontal scroll with snap and a visible affordance.

### P6 — DJ
Vinyl platter and tonearm become an optional "Vinyl view" (the toggle already exists) with **compact as default**: flat waveform overview, jog ring, cue points on the waveform. Performance mixer reuses the Mix strip component. Wizard header becomes a one-line status. Fix D2 / D3 (done in P0 if CSS-only).

### P7 — Phone pass and regression baseline
Real Android pass (owed since 16/08), density suite re-baselined, tutorial overlay retargeted to the new selectors, `studio-shots.mjs` output stored once as the v5 reference.

---

## 5. Effort

| Phase | Claude-executed | At the 4 h/week cap |
|---|---|---|
| P0 | 1 day | 2 sessions |
| P1 + P2 | 1 day | 3 sessions |
| P3 + P4 | 1 day | 3 sessions |
| P5 + P6 + P7 | 1 day | 3 sessions |

Precedent: the 16/08 FLM workflow program (S0–S4, planned as 4–5 sessions) landed in one day when Claude executed it end to end. Under the cap this is a quarter's work.

---

## 6. Decisions needed before P0 starts

1. **Codex's v4 CSS (blocking).** Two agents editing `studio.css` concurrently will collide. Options: (a) *recommended* — adopt Codex's v4 tokens as the v5 seed, retire `studio-redesign.css`, Claude owns P0 end to end while Codex stays off the studio stylesheets; (b) let Codex finish v4, commit it, then run P0 on top (adds a fourth layer to remove).
2. **Desktop navigation.** Keep the left rail, made two-level (recommended: desktop has the width and the tutorial targets it), or switch to FLM-style top tabs.
3. **Skeuomorphism.** Vinyl/tonearm/sphere: demote to optional views (recommended) or remove outright. Removal contradicts the 16/08 "no feature removals" ruling; demotion does not.
4. **Home screen on open.** Currently Pads. Recommended: last-used mode; first run = Pads on phone, Arrange on desktop (both references open on the arrangement).
5. **Scope.** Full P0–P7, or a visual-only cut (P0 + P1 + P2 + P5) that leaves Synth, Arrange and DJ workflows as they are.

Decisions 2–5 are independent of each other; 1 gates everything.
