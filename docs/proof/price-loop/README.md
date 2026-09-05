# The log-what-you-paid loop at 390x844

Rendered proof for the two faults the mobile store-readiness audit (4 September
2026) found in the core loop. Shot against a production build at 390x844,
device scale 2, with analytics consent already answered so no card owns the
lane. The measurements below are `getBoundingClientRect` in CSS pixels.

## GAP 18 - the log intent left the composer below the fold

`gap18-log-intent-composer-390-before.png`, `gap18-log-intent-composer-390-after.png`.
Journey: `/map?log=1`, then the pub the nearby picker leads with.

| | price step top | price step bottom | viewport |
| --- | --- | --- | --- |
| before | 696 | 933 | 844 |
| after | 391 | 628 | 844 |

Before, the price field sat on the bottom edge and "Log it" was off screen
behind the sheet's own action bar. After, the whole price step, the drink and
the handle are on screen. The fix is a reveal (`lib/logIntentReveal.ts`) and
changes nothing the sheet renders; focus is deliberately not moved, so no
keyboard is raised. Pins: `__tests__/logIntentReveal.test.ts`,
`e2e/log-intent-composer.spec.ts`.

## GAP 19 - the create action stood on a /near price

`gap19-near-fab-over-price-390-before.png`, `gap19-near-fab-over-price-390-after.png`.
Journey: `/near?patch=soho`, at rest.

| | create action | the price under it |
| --- | --- | --- |
| before | x 322-378, y 712-768 | £5.80 at x 310-360, y 740-762 (overlapping) |
| after | x 322-378, y 712-768 | £5.80 at x 260-310, y 740-762 (clear) |

The after run also measured every scroll offset from 0 to 240 in steps of 24,
so each row passes through the control's band, and no price cell intersected it
at any offset. Pins: `__tests__/createFabClearance.test.ts`, and the rendered
assertion at 320, 390 and 430 in `e2e/mobile-map-chrome-fit.spec.ts`.
