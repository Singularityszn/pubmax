# The opening prices before the map engine

Rule: [`docs/rules/components-map-canvas-and-pins.md`](../../rules/components-map-canvas-and-pins.md#the-document-draws-the-opening-prices-before-the-engine-and-only-the-ones-it-wil).

The shots below are a cold first visit to `/map` on a production build.

- `preview-phone-pre.png` and `preview-desk-pre.png` (390×844 and 1440×900): the
  prerendered document's discs before MapLibre has drawn anything.
- `preview-phone-post.png` and `preview-desk-post.png`: the engine's own discs
  after the reveal, in the same places, with the preview gone.

The timings were taken by a throwaway Playwright script against two `next start`
servers: origin/main at 2d9586bd and this branch. Every sample is a fresh context with the cache
disabled and service workers blocked, on Chrome DevTools' Slow 4G (150 ms,
188743 B/s down). The phone runs with 4× CPU throttling and the desktop with
none. The basemap style is stubbed to a plain background and its tiles to 204.

- `pins` is the `pubmax:pins-visible` mark.
- `element` is the element timing of the first price (`map-first-price`). It
  is null on main because main has no such element.

First price (ms; the engine's pins on main, the document's first price on this branch):

| Device | main: pins-visible | branch: first price | branch: pins-visible | main FCP | branch FCP |
| --- | --- | --- | --- | --- | --- |
| Phone, Slow 4G, 4× CPU | 10657 / 9093 / 9782 / 10302 | 1188 / 1220 / 840 / 816 | 10606 / 9531 / 9098 / 9708 | 1148 / 932 / 1032 / 920 | 1188 / 896 / 780 / 816 |
| Desktop, Slow 4G | 12002 / 11110 / 11256 / 10976 | 996 / 736 / 748 / 744 | 12253 / 11065 / 11182 / 11000 | 1452 / 844 / 820 / 828 | 996 / 736 / 748 / 744 |

LCP did not move (phone about 3.1 to 3.5 s on both, desktop about 7.7 to 8.2 s on both).
This box renders WebGL in SwiftShader, so the engine's own reveal is slower here than on a
real device (the brief quoted 9.4 s phone, 4.3 s desktop); the document's price does not
depend on WebGL, which is the point.
