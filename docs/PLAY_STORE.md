# Google Play listing — Site Tools (Trusted Web Activity)

Plan agreed 16/09/26: list the existing site tools on Google Play as an Android app wrapping `https://vishvaddi.com/site` (Trusted Web Activity), positioned as a free Construction Master Pro alternative. Nothing here is built or submitted yet.

## Hard requirements (checked 16/09/26)

- **New personal developer accounts** (created after 13 Nov 2023) must run a **closed test with at least 12 testers opted in for 14 continuous days** before applying for production access. Organisation accounts are exempt but need a D-U-N-S number. Source: Play Console Help, "App testing requirements for new personal developer accounts".
- One-off US$25 registration + Google identity verification. Vish does this; Claude never creates accounts.
- Digital Asset Links: `https://vishvaddi.com/.well-known/assetlinks.json` must list the app's package name and the SHA-256 fingerprint of the **Play App Signing** key (from Play Console → Setup → App signing), not only the upload key. Without it the app shows a browser URL bar.
- Valid web manifest (exists: `public/manifest.webmanifest`, start_url `/site`, maskable 512 icon) and a **service worker with an offline fallback**. Today `public/sw.js` unregisters itself (retired with the PIN gate on 14/09) and `scripts/auth.test.mjs` asserts `chrome.js` never registers one. That needs a deliberate change: a minimal network-first SW that serves `/offline/` for failed navigations and caches nothing else, so no saved data or private pages are cached. Built after the paywall work merges, since it touches `chrome.js`.
- Privacy policy URL: `https://vishvaddi.com/privacy/` (exists).

## Order of work

1. **Site (Claude, ~½ session):** offline fallback page + minimal SW + update the auth test's assertion to "registers only `/sw.js`, which caches only the offline page". Deploy on Vish's go.
2. **Vish (~30 min):** Play Console account (personal), US$25, identity verification.
3. **Package (Claude + Vish, ~½ session):** `npx @bubblewrap/cli init --manifest https://vishvaddi.com/manifest.webmanifest`, application id `com.vishvaddi.sitetools`. Bubblewrap creates a signing keystore; **Vish types the keystore passwords** and the keystore lives outside the repo and outside OneDrive (e.g. `C:\Users\vishv\.config\secondbrain\android\sitetools.keystore`, backed up, since losing it means a new app listing). `bubblewrap build` → `app-release-bundle.aab`.
4. **Vish:** create the app in Play Console, upload the AAB to a **closed testing** track, fill the store listing (copy below), content rating questionnaire, data safety form (collects nothing; payments happen on the website).
5. **Claude:** add the Play App Signing SHA-256 to `public/.well-known/assetlinks.json`, deploy, verify with `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://vishvaddi.com&relation=delegate_permission/common.handle_all_urls`.
6. **Vish:** 12 testers opted in (colleagues, estimators, friends with Android phones) → 14 days → apply for production.

## Payments inside the app

Google Play's payments policy requires Play Billing for digital goods sold *inside* an app. The TWA opens `/site` only. Keep Pro checkout out of the app: hide plan buttons and upsell panels when running as the TWA (detect `document.referrer` starting `android-app://com.vishvaddi.sitetools`, stored for the session), and show "Pro is available at vishvaddi.com" as plain text without a link. **Confidence: medium.** Google is changing the Play payments policy after the Epic settlement: alternative billing and linking out to the web arrive in **Australia on 30 Sep 2026**, possibly with a service fee on linked-out sales (Android Authority; Coda, 2026). Re-read the Payments policy (Play Console Help answer 10281818) when submitting. Hiding checkout in the app is the safe default whatever the fees turn out to be; this is the step most likely to get the listing rejected.

## Store listing draft

- **App name (30):** Site Tools — Estimating Calcs
- **Short description (80):** Free cut lists, programmes, material quantities and PDF tools for AU trades.
- **Full description:**

  Free calculators and tools for estimators, builders and tradies in Australia. Built by an estimator, not a software company.

  • Cut list optimiser: linear stock and sheet nesting, kerf and end trim
  • Programme builder: critical-path scheduling with FS/SS/FF links, lag and working-day calendars
  • Material quantities: plasterboard, tiles, paint, concrete, footings, timber, roofing, with waste allowances
  • PDF toolkit: merge, split, rotate, watermark and compare drawings, all on your phone
  • Unit rate and charge-out rate builders, site records register, unit converter, quick reference

  No account, no ads. Your numbers stay on your device.

- **Category:** Tools. **Tags:** construction, calculator, estimating.
- **Screenshots:** 4–6 phone screenshots (cut list result, programme Gantt, plasterboard answer, PDF compare). Claude can capture these with Playwright at 1080×2400.
