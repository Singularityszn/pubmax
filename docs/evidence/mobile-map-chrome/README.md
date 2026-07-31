# Mobile map chrome evidence

`mobile-map-chrome.webm` illustrates the 390x844 phone journey covered by
`e2e/mobile-map-chrome-fit.spec.ts`: open map, open Filters, select Wine,
dismiss Filters, move through painted clusters, and tap a painted venue pin.
The test passes only when the venue sheet opens after that canvas tap.

## Recording provenance

This is the recording from the passing local Playwright run on 31 July 2026,
before the later capture retries. Its test name was
`390px recorded map journey reaches Filters and a painted pin`. Chromium reports
WebM, 390x844, and 48.52 seconds. SHA-256:

```text
aa4d1facddab9ae521e69f0f6a8c50109b9ec0e9fe84b77fd1d4497377fd6a18
```

Two later reruns both received HTTP 200 from `/map` but did not mount
`.mobileMapTopbar` within 45 seconds. Those were capture-harness failures, not
passing journeys, so this file is deliberately retained from the earlier good
run. It is not presented as a fresh capture.

## Regression guarantee

Video is illustration. Rendered Playwright assertions are the guarantee. The
focused test reads actual boxes, checks the centre hit owner with
`document.elementFromPoint()`, and sends a real Playwright mouse tap. It covers
Area, Search, Pub Pal, More, all five Tonight Arc controls, Near me, Tonight,
and Filters. Every tested control has a 44px minimum hit box.

Passing measurements:

| Viewport | Shared left | Shared right | Shared width | Chrome top | Chrome bottom | Chrome height |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 390x844 | 12px | 378px | 366px | 10px | 174px | 164px |
| 430x932 | 12px | 418px | 406px | 10px | 174px | 164px |
| 320x568 | 12px | 308px | 296px | 10px | 174px | 164px |

Topbar, contextual rail, Tonight Arc shell, and Describe your night share those
outer edges. This is one centred alignment system with balanced 12px gutters.
At 390px the Filters control ends at 299.813px inside the 378px boundary. At
320px it ends at 299.813px inside the 308px boundary.

## Red-first record

Pre-fix measurements were taken before production CSS changed:

| Viewport | Topbar | Rail, Arc, action | Filters right | Chrome height | Failing contract |
| --- | --- | --- | ---: | ---: | --- |
| 390x844 | 10px to 380px | 12px to 322px | 276.625px | 166px | shared edges, alignment, budget |
| 430x932 | 10px to 420px | 12px to 362px | 398.594px | 166px | clipped Filters, shared edges, alignment, budget |
| 320x568 | 10px to 310px | 12px to 252px | 297.813px | 166px | clipped Filters, shared edges, alignment, budget |

The focused geometry cases failed against pre-fix code at all three widths.
Source-contract tests also failed before the CSS correction. Direct rail taps
were already deliverable after horizontal scrolling, so tap ownership alone was
not a red differentiator. Initial rendered geometry was the defect. The expanded
post-fix tap contract independently proves every top-row control receives its
own tap.

`components/PubMap.tsx` and `components/PubMapCanvas.tsx` were not changed.
Complexity delta for both files is zero.
