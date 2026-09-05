# Four e2e reds on main, 5 September 2026: what was the page and what was the spec

Proof for the pull request that closes #1489, #1490, #1503 and #1504. Every
shot is a production build served on a private port with the config's own
keyless env, light theme, reduced motion, Chromium under SwiftShader. Phone
shots are 390x844 at device scale 2, tablet shots 768x1024 at scale 2, desktop
shots 1440x900 at scale 1. `before` is origin/main at `2d00af6d2`; `after` is
this branch rebased onto `0ae222859`. `notes.json` in each directory carries the figures read off the
DOM at the moment of each shot.

## The one page defect: the phone sheet mounted before its stylesheet (#1490)

`venue-sheet-early-390.png` is `/map?sel=venue-nyowgc` at 390, captured the
frame the venue sheet's portal attaches. Read off the portal at that frame:

| | before | after |
| --- | --- | --- |
| `position` | `static` | `fixed` |
| `z-index` | `auto` | `1300` |
| top edge | 844px (below the viewport) | 0px |
| height | 20px | 780px |

PubMap renders the phone's sheet through a static import of
`MobileSharedSheet`, and the rules that position and stack it lived only in
`mobileMapShell.css`, imported by the dynamically loaded `MobileMapShell`. The
sheet was in the document about 240ms after navigation; its stylesheet arrived
with the shell chunk one to four seconds later. `venue-sheet-settled-390.png`
is the same page six seconds on, identical before and after, which is the whole
point: the fix moves no rule, it moves who imports the file. The 768 and 1440
shots are the tablet and desktop drawers, which never rode the phone portal and
are unchanged.

No design pass had anything to alter here: the incumbent look is preserved to
the pixel in the settled state, and the early state now looks like the settled
one instead of like nothing.

## The landing hero: three doors, read off one table (#1503)

`landing-{390,768,1440}.png` show the hero's action row before and after. The
row is the same at every width: the receipt primary, then the two quiet doors,
the Pal and Tonight. The spec had counted two anchors since before #1488 added
Tonight. The doors are now one table in `lib/landingHero.ts` that the hero
renders, the hierarchy test pins and the browser spec counts against, so the
shots are the evidence that the refactor changed nothing on screen:

```
Still £6.50? -> /map?sel=venue-eltcmh&log=1&price=6.50
Meet your Pub Pal -> /pal
Tonight -> /tonight
```

## The two specs that rotted against the page (#1504, #1489)

Both governed brand landings typed the collection day, and the bundled pint
dataset was honestly re-collected to 4 September 2026. The specs now derive
the day from `data/freshness_registry.json` through `PINT_DATASET_OBSERVED_AT`,
formatted the way the page formats it. No shot, because the page was right.

The log-intent spec's picker never arrived inside 20 seconds. Measured on a
production build at 390 under SwiftShader, time to `.logIntentNearbyBtn` on
`/map?log=1`:

| basemap | sheet blur | picker arrives |
| --- | --- | --- |
| live tile host | on | 65s to 80s |
| live tile host | stripped in the page | 11s |
| house fixture (`installDeterministicMapBasemap`) | on | 11s to 17s |

The nearby picker is a blurred sheet standing over the map for the whole load,
and every one of the hundred-odd frames the live tiles paint beneath it is
composited in software through that blur; a CPU profile put 88 per cent of
the time in the browser's own compositor commits, one to 2.6 seconds each.
The spec takes the fixture the map's own specs already use, and its wait for
the venue index says what it is waiting for. The 422px ceiling on the price
step did not move: over nine serial runs the reveal put the step at 180px in
eight, and the one 422 was the sheet's scroll range clamped by the content
beneath a different first pub.

## Method

Shots and DOM reads: a Playwright script over `chromium.launch()` with the
SwiftShader flags the specs use, one context per viewport, the tour, consent
and first-visit keys pre-dismissed. The early sheet frame is captured at
`waitForSelector(..., { state: "attached" })` on the portal; the settled frame
six seconds later.
