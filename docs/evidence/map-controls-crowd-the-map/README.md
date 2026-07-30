# Mobile map chrome evidence

Playwright Chromium capture from this isolated worktree at
`http://localhost:37651/map`, viewport `390x844`, device scale factor `1`.
Returning-visitor state dismissed onboarding and declined analytics before
navigation. Both screenshots were verified on disk with `ls -la`.

| Rendered measurement | Before | After | Change |
| --- | ---: | ---: | ---: |
| Chrome stack top | 10px | 10px | 0px |
| Tonight Arc bottom | 243.40625px | 174px | -69.40625px |
| Chrome stack height | 233.40625px | 164px | -69.40625px |
| Tonight Arc panel height | 123.40625px | 54px | -69.40625px |

Stack height is `Tonight Arc bottom - mobile topbar top`. Result reclaims
`69.40625px`, or `29.7362431383%` of previous stack height.

After capture measured all five chip boxes at `44px` high and `top: 125px`.
Row `clientWidth` and `scrollWidth` were both `292px`, so all five controls fit
without scrolling at 390px. Rendered Playwright coverage separately asserts one
row and equal heights at 390px and 320px, with horizontal overflow at 320px.

Collapsed attribution measured `24x20px` at `(356, 670)`. Expanded attribution
measured `366x44px` at `(14, 646)`, with its text box measuring `330px` for both
`clientWidth` and `scrollWidth`. Full visible text remained:

> Pub data © OpenStreetMap contributors (ODbL) | OpenFreeMap © OpenMapTiles Data from OpenStreetMap

Expanded credit ended at `y=690`; `Describe your night` began at `y=710`.
Measured clearance: `20px`.

`components/PubMap.tsx` ESLint complexity stayed at `233` before and after.
Complexity delta: `0`.

## Captures

- [Before, 390x844](before-390x844.png)
- [After, 390x844](after-390x844.png)
