# Tonight reachability on the mobile home (#1488)

What this directory holds and how it was taken, so the claim can be re-checked
rather than believed.

## The finding

GrokBot's production battle test of 5 September 2026 (deployment
`dpl_GxALEDJWFtmk59JbgJ5U9K9Xm74N`, `e8dfd8d`) recorded that Tonight had no tap
on the phone's home screen. Every observation was re-taken against
`origin/main` at `94bdffd1c`, two commits later, before anything changed.

Measured on a production build of `94bdffd1c`, at four phone widths, on the
rendered box rather than on the markup:

| width | `.lpPrimaryNav` | dock tab | Tonight links on `/` | Tonight >= 44x44 above the fold |
| --- | --- | --- | --- | --- |
| 320x844 | `display: none`, 0x0 | Now, 49.3x44 | one at 0x0, one at y 3833 | 0 |
| 360x800 | `display: none`, 0x0 | Now, 56x44 | one at 0x0, one at y 3615 | 0 |
| 390x844 | `display: none`, 0x0 | Now, 60.7x44 | one at 0x0, one at y 3588 | 0 |
| 430x932 | `display: none`, 0x0 | Now, 66.7x44 | one at 0x0, one at y 3551 | 0 |

The 0x0 link is the landing bar's own `/tonight` link, in the DOM and painted
nowhere. The second is the footer's, thousands of pixels below the fold. The
dock's first tab is Now, whose href is `/today` before 17:00 London and
`/tonight` after (`nowTabHref`), so it is not a Tonight tap either.

## Why the header could not take it

The first of the two options was a compact header subset. It does not fit. On
live production at 390px the fixed landing bar is 370px wide, its content box
350px, and it already holds a 53.2px wordmark and a 249.6px action island
(three 44px icon buttons plus a 96.6px Sign in). That leaves **39.2px** of free
width, against about 72px for a "Tonight" pill at the bar's own 13px/650 type.
At 320px the Sign in button is already hidden by an existing rule, which frees
72.8px: a fit at one width and an overflow at the next is not a fix.

## What shipped

Tonight rides the hero's quiet row beside the Pub Pal door, which is the last
thing above the consent bar on a first visit. Nothing else moved: the primary
action, the dock's six tabs and `nowTabHref` are untouched, and `.lpPrimaryNav`
is still hidden under 960px.

## Shots

`before-<width>x<height>.png` and `after-<width>x<height>.png`, taken at
deviceScaleFactor 2 against a local production build with the analytics consent
bar undecided, which is the first-visit state the fold has to survive.

## Re-taking them

```
NEXT_PUBLIC_SW_VERSION=local NEXT_DIST_DIR=.next-prod \
  PUBMAX_TRACKED_OUTPUTS=public/data \
  node scripts/run-with-restored-next-env.mjs npm run build
NEXT_PUBLIC_SW_VERSION=local NEXT_DIST_DIR=.next-prod npx next start -p 3477
npx playwright test e2e/mobile-landing-entry.spec.ts -g "Tonight is one tap"
```

Restore `public/data` afterwards: the keyless build stamps every venue pack
`"revision":"local"`, which is a build artifact and not a data change.
