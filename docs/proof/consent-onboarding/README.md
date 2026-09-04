# The consent card and the first-run onboarding surface

Evidence for the fix in `app/onboarding/onboarding.css` and the four cases added
to `e2e/ux-consent-chrome.spec.ts`.

## What was wrong

The analytics consent card outranks every other prompt, so on a first native
launch it is on screen over `/onboarding`. That surface sizes every one of its
blocks to the viewport, and PR #1456 answered the overlap by making the surface
its own scroller ending where the card's lane begins.

Containment alone was not enough. The surface ended at 704px on a 390pt phone
while the "Use London" button was laid out at 768px, so the one primary action
on the first native screen was not on it. The reviewed-area rows were cut in the
same place. Measured on a production build at four phone widths:

| width | surface ends | rows end | primary | card top |
| --- | --- | --- | --- | --- |
| 320 x 844 | 704 | 813 | 833-883 | 716 |
| 360 x 844 | 704 | 818 | 838-888 | 716 |
| 390 x 844 | 704 | 748 | 768-818 | 716 |
| 430 x 932 | 792 | 784 | 804-854 | 804 |

## The fix

The photograph is what yields. While the card holds the lane, the stage stops
giving the picture a share of the viewport and gives it the space the panel does
not need, and the panel's own rhythm is trimmed so the narrowest phones keep a
band rather than a stripe. Take the card away and none of it matches, so the
designed 31dvh band returns.

| width | surface ends | rows end | primary | card top |
| --- | --- | --- | --- | --- |
| 320 x 844 | 704 | 620 | 634-684 | 716 |
| 360 x 844 | 704 | 620 | 634-684 | 716 |
| 390 x 844 | 704 | 620 | 634-684 | 716 |
| 430 x 932 | 792 | 708 | 722-772 | 804 |

Nothing scrolls: the surface's `scrollHeight` equals its `clientHeight` at every
width, so every row and the primary action are on screen at rest.

## Shots

`before-<width>.png` and `after-<width>.png`, light theme, reduced motion,
production build, consent undecided, the native bridge present.

The simulator shot this started from is
`docs/proof/ios-shell-build/simulator-scripted-run.png` (PR #1470).
