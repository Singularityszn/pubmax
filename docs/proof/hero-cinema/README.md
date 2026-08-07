# Hero scroll cinema + aperture splash proof

Browser evidence for `feat(landing): hero scroll cinema with aperture splash`
(motion tokens, the scroll-linked hero, and the aperture splash).

## How the shots were made

```bash
NEXT_DIST_DIR=.next-prod npm run build
NEXT_DIST_DIR=.next-prod PORT=3199 npm run start -- --port 3199
```

Playwright (`chromium.launch`), one fresh `BrowserContext` per shot with an
explicit `viewport`, `colorScheme`, and `reducedMotion`, matching
`GATE_PRESENTATIONS` in `e2e/gateEvidence.ts`. Scroll-scrub frames call
`window.scrollTo(0, y)` then wait 650ms (past the 480ms cinema-settle
transition) before `page.screenshot()`. Splash frames override
`navigator.webdriver` to `false` (same pattern as `e2e/aperture-splash.spec.ts`)
and screenshot at a fixed delay after navigation.

## Shots

| File | State |
|---|---|
| `01`-`05` | Desktop 1440px, light theme, scroll-scrub at 0/25/50/75/100% of the 520px cinema scroll distance (`CINEMA_SCROLL_DISTANCE` in `components/landing/LandingPage.tsx`) |
| `06`-`10` | Desktop 1440px, dark theme, same five scrub points |
| `11` | Desktop 1440px, light theme, `prefers-reduced-motion: reduce` - static composed hero, no scroll transform |
| `12` | Desktop 1440px, dark theme, `prefers-reduced-motion: reduce` - static composed hero |
| `13` | Mobile 390px, light theme, static-composed hero (the `<=700px` gate) |
| `14` | Mobile 390px, dark theme, static-composed hero |
| `15`-`16` | Mobile 390px, both themes, scrolled 520px to prove no scroll-scrub fires on phone (card presentation is unchanged from `13`/`14`) |
| `17` | Aperture splash at t=0ms - coral X, full hold |
| `18` | Aperture splash at t=180ms - end of hold, before the aperture scale begins |
| `19` | Aperture splash at t=400ms - mid-reveal, X scaling through the hero |
| `20` | Aperture splash at t=700ms - hard ceiling, resolved into the hero cinema's dark-start frame |

## What they show

- The hero card opens full-bleed with square edges and a near-black wash
  (`01`, `06`) and settles to a rounded, contained card with the wash faded
  (`05`, `10`) as `--cinema-progress` advances 0 to 1 over scroll - every
  step (border-radius, scale, wash opacity) transitions on
  `var(--duration-cinema-settle)` / `var(--ease-cinema-weighted)`
  (`components/landing/heroCinema.css`).
- The transition is scroll-linked, not scroll-pinned: the hero card moves
  with the page as it settles, so by 100% scroll (`05`, `10`) the card has
  moved most of the way under the sticky nav - the real effect of a normal
  (non-sticky) scroll transform, not a bug.
- `11`/`12` and `13`/`14` are pixel-identical in composition to a settled
  scrub frame (rounded card, faded wash) with zero scroll transform
  attached - the reduced-motion and phone gates land on the same static
  target the JS effect animates toward.
- `17`-`20` show the full-screen coral X holding, then expanding through
  its aperture reveal, landing exactly on the hero's dark-start frame with
  no visible seam.

A pre-existing cookie-consent banner and onboarding chip overlap the lower
part of several shots. Not part of this change.

## LCP

Matched methodology from PR #813 (production build, fresh navigation per
sample, 3 samples, compare medians). The main-branch column is #813's own
recorded baseline (not re-measured this session); the branch column is
measured fresh against this branch's production build:

| Sample | main (#813's recorded baseline) | fm/hero-cinema-splash (measured now) |
|---|---|---|
| 1 | 475ms | 204ms |
| 2 | 546ms | 296ms |
| 3 | 408ms | 228ms |
| **Median** | **~475ms** | **228ms** |

No regression from the #813 baseline of ~318ms (this branch's own after
median) - LCP improves further. CLS held at 0 on all 3 samples. Measured
via a `PerformanceObserver` on
`largest-contentful-paint` / `layout-shift` with `buffered: true`,
registered through `page.addInitScript` before navigation (the same rig as
`e2e/gateEvidence.ts`'s `samplePagePerformance`).
