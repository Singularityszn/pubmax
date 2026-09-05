# verify-preview-4: the ambers and the three layout reds

What the verification scout of 5 September 2026 found on the shipped build, and
what the same surfaces do after the fix. Every figure is read off the DOM of a
local production build (`next build`, `next start`), never inferred from CSS.

`before/` and `after/` hold the same file names, one pair per surface.
`after/onboarding-measurements.json` and `after/surface-measurements.json` are
the raw boxes the tables below are drawn from.

## 1. One row of button tokens (amber 4)

| | Before | After |
|---|---|---|
| Landmark story, `Start a crawl here` | 16px / 400 | 13.76px / 700, radius 14px, min-height 44px |
| Venue sheet text buttons | 13.76px / 700 | unchanged |
| `Save to a list` | 8px radius, 13px / 600 | `--control-radius`, `--control-font-size`, `--control-font-weight` |
| `Save for a night` | 8px radius, brass fill on the Overview | the same row, secondary surface beside the price door |

Cause: the primitive carried Tailwind's `text-sm font-bold`, which live in
`@layer utilities`, while `app/globals.css` declares `button { font: inherit }`
unlayered. An unlayered declaration outranks every layered one, so the primitive
lost its type on every surface. `components/ui/button.css` is now a plain sheet
outside every layer, reading the `--control-*` row.

## 2. Every venue section on screen (layout red)

| Viewport | Before | After |
|---|---|---|
| 390 | `scrollWidth` 379 vs `clientWidth` 318; `Train` at x 368-412, past the edge | 318 vs 318, 2 rows, 0 tabs past the viewport, widest right edge 320 |
| 320 | 379 vs 248; `Lore`, `Ask` and `Train` off screen | 248 vs 248, 2 rows, 0 tabs past the viewport |

## 3. The story is a surface the reader is on (amber 2, layout red)

| | Before | After |
|---|---|---|
| `Describe the outing` pill while the story is open | painted beneath the opaque sheet (box y 710-758 inside the sheet's band) | not rendered (`.mobilePlanActivation` count 0) |
| A pub opened from the story | `/map?sel=…`, no Back control | sheet carries `Back to Covent Garden` |
| Browser Back from that pub | bare `/map`, nothing open | the Covent Garden story, `?landmark=covent-garden` |

## 4. The pill names the crawl in hand (amber 3)

| | Before | After |
|---|---|---|
| Pill after one `Plan stop` | `6-stop plan · Edit route` | `1 stop picked · Add stops` |
| Planner sheet's first screen | `Area King's Cross / Stops 3`, the picked pub under a form | the built crawl leads; `The Sir Christopher Hatton` is inside the sheet body's visible box |
| `Make it Stop 1` | nothing visible on one tap | lands on `/plan` with the pub held |

## 5. No primary action under chrome on a short phone (check 7, red 2)

Onboarding with the analytics consent card unset, measured at four viewports.
`Use London` is the one primary action; the rows are the reviewed areas.

| Viewport | Consent card | `Use London` | Fully in viewport | Overlaps card | Gap | Rows over card / over primary |
|---|---|---|---|---|---|---|
| 320x568 | y 440-556 | y 376-420 | yes | no | 20 px | 0 / 0 |
| 360x640 | y 512-628 | y 448-492 | yes | no | 20 px | 0 / 0 |
| 390x844 | y 716-832 | y 634-684 | yes | no | 32 px | 0 / 0 |
| 430x932 | y 804-920 | y 722-772 | yes | no | 32 px | 0 / 0 |

Before, at 320x568, `Use London` sat at y 545 under a card at y 440-556: a gap
of -155 px, inside a scroller no phone draws a bar for.

Night mode at 320x568: the tab bar owned the centre of the lower `Get me home`
slab (bar 514-568 over a slab at y 490-554) and the consent card owned
`We are here`. Both step aside for the surface now, and every one of the four
night-mode controls owns the point at its own centre.

## 6. The first thread (red 1, amber 5)

| | Before | After |
|---|---|---|
| 390, first-run reader, one message | bubble y -26 to 34 (under the head), `scrollY` 192, composer at y 532 with 268 px of nothing below | bubble below the head, composer in view above the card |
| 1440 desktop thread | consent bar over the composer row | the split gives the card's lane back; composer bottom above the card top |

## Regression tests

`__tests__/buttonPrimitive.test.tsx`, `__tests__/planActivationPill.test.ts`,
`e2e/venue-tabs-fit.spec.ts`, `e2e/night-mode-chrome.spec.ts`,
`e2e/map-plan-stop-pill.spec.ts`, and new cases in `__tests__/pubMap.test.ts`,
`__tests__/mapSurfaceHistory.test.ts`, `__tests__/venueTabsEdgeFade.test.ts`,
`__tests__/nightCrawlCss.test.ts`,
`__tests__/nativeFirstRunConsentPlacement.test.ts`,
`e2e/landmark-story-sheet.spec.ts`, `e2e/messages-thread.spec.ts` and
`e2e/ux-consent-chrome.spec.ts`.
