# /tonight: the first listing row above the mobile tab bar

Measured 6 September 2026 on a local production build (`next build`, `next start`,
Playwright Chromium, `deviceScaleFactor: 2`, reduced motion). The What's-On spine
is the acceptance spec's own mocked answer (`e2e/tonight-trusted-ui.spec.ts`), so
the row count and the row heights are the same in both arms.

Every figure is a rendered `getBoundingClientRect()` reading in CSS pixels from
the top of the viewport.

## The finding

`e2e/tonight-trusted-ui.spec.ts` "keeps the main list before Deals/Music and above
the mobile tab bar" asserts `firstRow.y < mobileTabBar.y`. It failed, and the two
narrower phones failed by much more:

| Viewport | First row top | Tab bar top | Above the bar |
| --- | --- | --- | --- |
| 320x568 | 972 | 514 | -458 |
| 360x640 | 972 | 586 | -386 |
| 390x844 | 868 | 788 | -80 |

The cause is the order of the phone stack, not one tall block. `/tonight` put its
head, the head's two way-onward doors, the freshness credits, the share control
and nine vibe chips in front of the listings:

| Block | Top at 390x844 | Height |
| --- | --- | --- |
| Site nav bar | 10 | 52 |
| Day / Tonight segment | 78 | 50 |
| Screen head (kicker, heading, lede) | 142 | 211 |
| Screen head actions (map, Find my pint) | 357 | 116 |
| Freshness credits and Share | 481 | 67 |
| Vibe chips (9 chips, 4 wrapped rows) | 568 | 222 |
| Kind filter chips | 808 | 44 |
| **First listing row** | **868** | 235 |

At 320x568 the same stack reads 274 for the vibe chips and 96 for the kind filters,
because both wrap one row further.

## The fix

The listings are the answer, so nothing that acts on them stands in front of them.
Three DOM moves and one phone rule:

- The way-onward row ends the screen (`actionsAfterContent`, `components/ui/screen.tsx`).
- The freshness stamp and the share control follow the listings they are about.
- The vibe chips follow the list. They are a mood ask, not the list's filter.
- The kind filter IS the list's filter, so it stays above the list, and on a phone
  it scrolls sideways rather than wrapping to a second row. Every chip keeps its
  44px target and stays a tab stop.

Each move is a DOM move and not a CSS `order`, so the reading order, the tab order
and the paint order stay one order at every width.

## After

| Viewport | Lede top | Filter top | First row top | Tab bar top | Above the bar |
| --- | --- | --- | --- | --- | --- |
| 320x568 | 265 | 353 | 413 | 514 | 101 |
| 360x640 | 265 | 353 | 413 | 586 | 173 |
| 390x844 | 265 | 353 | 413 | 788 | 375 |

The first row is 235px tall, so 390x844 shows the whole card and starts the next
one. The lede is unmoved at 265 and ends at 337 at every phone width.

Wide widths keep their composition and gain the same room. The context rail sits
beside the primary column as before:

| Viewport | First row before | First row after |
| --- | --- | --- |
| 768x1024 | 684 | 389 |
| 1440x900 | 741 | 446 |

## Shots

`before-` and `after-` at 320, 390, 768 and 1440, light and dark.

In this capture, the analytics consent bar covered part of the first card at
320x568 on a first visit. The checks then were `e2e/ux-consent-chrome.spec.ts`
and the now-retired `__tests__/analyticsConsentDesktopClearance.test.ts`. The bar
answered to one tap and covered the same band before this change. This proof
recorded that overlap without fixing it. Current placement and regression owners
live in the [consent placement contract](../../rules/components-design-system-and-launch-primitives.md#the-product-answers-first-and-the-consent-card-arrives-after-the-answer-docked).
