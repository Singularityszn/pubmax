# PUBMAXX UI/UX battle test

Date: 2026-08-14

Scope: `https://pubmaxxing.com` and local `npm run dev`, audited with Playwright at 390x844 CSS px with touch and device scale factor 3, and 1440x900 CSS px. Routes: `/`, `/today`, `/tonight`, `/near`, `/add/karan`, `/login`, `/u/karan`, `/map/london`, `/plan`, and `/crawls`. Light and dark local captures cover the same route set.

Repository evidence keeps 14 representative before-and-after stills in [`docs/proof/ui-ux-battle-test/`](../proof/ui-ux-battle-test/), under 10 MiB total. Full raw audits, remaining captures, and videos belong in the approved local archive at `/Users/karanmanoharan/karan-agent-workspace/data/ui-ux-battle-test/proof/`, outside Git. The baseline sweep found 92 findings. Most live findings remain visible because deployment is frozen. The local after sweep found no mobile tap-target, horizontal-overflow, or Axe violations.

## Defect table

| Severity | Route | Viewport | Element | Before | After | Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | `/`, `/today`, `/tonight`, `/u/karan` | Local mobile | Drinkaware, Open-Meteo, Wikipedia provenance links | 16 visible links measured below 44px high. | Shared provenance and footer link styles use a 44px minimum target. | Representative [`before/local-mobile-390-today.png`](../proof/ui-ux-battle-test/before/local-mobile-390-today.png) and [`after/local-mobile-390-today.png`](../proof/ui-ux-battle-test/after/local-mobile-390-today.png) | Fixed in branch. Live waits for release. |
| P1 | `/add/karan`, `/login` | Local mobile | Not now, auth legal links and magic-link controls | Four controls measured below 44px high. | Ghost action, legal links, inputs and login doors now meet the target floor. | [`before/local-mobile-390-login.png`](../proof/ui-ux-battle-test/before/local-mobile-390-login.png), [`after/local-mobile-390-login.png`](../proof/ui-ux-battle-test/after/local-mobile-390-login.png) | Fixed in branch. Live waits for release. |
| P1 | `/plan` | Local mobile | Stop count buttons, prompt input and plan action | Six controls measured at 37.6px to 42.8px high. | Stop controls, agent input, submit and actions use a 44px minimum height. | [`before/local-mobile-390-plan.png`](../proof/ui-ux-battle-test/before/local-mobile-390-plan.png), [`after/local-mobile-390-plan.png`](../proof/ui-ux-battle-test/after/local-mobile-390-plan.png) | Fixed in branch. Live waits for release. |
| P1 | `/near` | Local mobile | Find my pint CTA | CTA used paper text on coral. Contrast depended on theme surface tokens. | CTA uses the shared on-accent ink token. Near price-trust logic was not changed. | [`before/local-mobile-390-near.png`](../proof/ui-ux-battle-test/before/local-mobile-390-near.png), [`after/local-mobile-390-near.png`](../proof/ui-ux-battle-test/after/local-mobile-390-near.png) | Fixed mechanically. |
| P1 | `/`, `/today`, `/tonight`, `/near`, `/crawls`, `/u/karan` | Local mobile and desktop, light and dark review | Accent labels, prices, badges and disclosure links | Axe reported serious contrast failures on active labels, pint prices, crawl actions, badges and disclosure links. | Role tokens now use readable ink for page surfaces and hover states, price ink is tuned for small text, and coral actions use on-accent ink. | Representative [`before/local-mobile-390-crawls.png`](../proof/ui-ux-battle-test/before/local-mobile-390-crawls.png), [`after/local-mobile-390-crawls.png`](../proof/ui-ux-battle-test/after/local-mobile-390-crawls.png), [`before/local-mobile-390-profile.png`](../proof/ui-ux-battle-test/before/local-mobile-390-profile.png), and [`after/local-mobile-390-profile.png`](../proof/ui-ux-battle-test/after/local-mobile-390-profile.png) | Fixed in branch. Focused light and dark Axe violations: 0. |
| P1 | `/` | Local mobile and desktop | City search input `aria-controls` | Input named a results element before results could exist. | `aria-controls` is emitted only when the query can render the results list. | Before/after source: [`components/city/CityChooser.tsx`](../../components/city/CityChooser.tsx). | Fixed. |
| P1 | `/u/karan` | Local mobile and desktop | Profile statistics | `dl`, `dt` and `dd` were nested inside links, producing `definition-list` and `dlitem` violations. | Stats use an accessible list with ordinary label/value elements. | [`before/local-mobile-390-profile.png`](../proof/ui-ux-battle-test/before/local-mobile-390-profile.png), [`after/local-mobile-390-profile.png`](../proof/ui-ux-battle-test/after/local-mobile-390-profile.png) | Fixed. |
| P2 | `/map/london` and crawl planning surfaces | Local mobile and desktop | Crawl celebration link and dismiss action | Compact inline actions did not meet the touch target floor. | Both actions have a 44px minimum target without changing flow. | [`before/local-mobile-390-map.png`](../proof/ui-ux-battle-test/before/local-mobile-390-map.png), [`after/local-mobile-390-map.png`](../proof/ui-ux-battle-test/after/local-mobile-390-map.png) | Fixed in branch. |

## Measurements not treated as defects

- No audited local page had horizontal document overflow after fixes. The guard is [`e2e/ui-ux-battle-test.spec.ts`](../../e2e/ui-ux-battle-test.spec.ts), which passed against the dev server.
- The sweep reported text overflow on PUBMAXX wordmark glyph containers and a plan label. These are internal child measurements. Full page width stayed within the viewport, and screenshots show no clipped user text. No style change was made.
- Headless Chromium did not expose non-zero safe-area environment values. No safe-area defect was reproduced.
- The full dark sweep showed the same layout hierarchy and no additional Axe contrast failures. Reduced-motion behaviour was not changed.

## Needs decision

None. The live site still shows the old target and colour values until this branch is released. No deployment was performed.
