# Five bugs from the live walk, fixed and measured

Astra's live walk of pubmaxxing.com (7 September 2026, `docs/proof/astra-live-walk/report.md`)
root-caused eleven findings. Five of them landed on a line of source. This is what
each one cost, what changed, and how the numbers were taken.

**Before** is production at commit `74e68891`, the deployment the walk itself measured.
**After** is a local production build of this branch (`NEXT_DIST_DIR=.next-prod npm run build`,
`next start -p 3300`). Both were driven by the same scripts, in `scripts/`, at the walk's
own phone rig: 390x844, device scale factor 3, Chromium.

The two rigs are not identical. Production serves over a CDN with a durable rate limiter;
the local build serves from a laptop with the keyless in-memory one, which refuses the
image proxy after three requests, so the local page-level counts are lower. Where that
matters, section 5 below gives a per-image comparison over identical source photographs,
which is unaffected.

---

## B2. Five London patches answered 400

`GET /api/area-news?area=<slug>` refused balham, barnes, bermondsey-london-bridge,
piccadilly-soho and victoria. The map's "New round here" block went quiet over Soho,
Victoria, London Bridge, Balham and Barnes.

| | Patches answering 200 | Body for an uncovered patch |
|---|---|---|
| Before | 15 of 20 | `400 {"error":"Unknown area."}` |
| After | 20 of 20 | `200 {"status":"unavailable","entries":[]}` |

Sixteen of the twenty now read a real lane. The other four hold no lane at all, and say
so as unavailable rather than as an empty list, because no fact can ever be filed under
them. Pin: `__tests__/areaNewsNightAreaSlugs.test.ts`.

## B5a. The ranking could not reach its own lens

Every door off `/spoons-value` landed on the ordinary pint map: the primary read
`href="/map"`, and all 805 row links read `/map?sel=<id>`.

| | Primary | Row link |
|---|---|---|
| Before | `/map` | `/map?sel=venue-uk-n1` |
| After | `/map?lens=spoons` | `/map?sel=venue-uk-n1&lens=spoons` |

Pin: `__tests__/spoonsValueSurfaces.test.tsx`.

## B5b. 805 unguarded prefetches, and the fence that missed them

The fence resolved an allow-list of twelve helper names. `spoonsValueMapHref` was not on
it, and its result was assigned to a const called `href`, so neither of the fence's two
checks saw it.

| | Unguarded heavy links the fence reports |
|---|---|
| Before | 0 found (the fence could not see them) |
| After | 4 found and fixed, `/crawls` off the backlog |

The fence now reads the call site's own name, so a helper named `…MapHref` or `…MapUrl`
is a heavy link whatever the caller assigns it to. Pin:
`__tests__/linkPrefetchFence.test.ts`, including a helper the allow-list has never heard of.

## B6. `/onboarding` shipped a document and threw it away

The route is the native shell's one-time first-run surface. Its gate consumes a
native-only, session-scoped handoff, so a web visit has always failed closed to `/`. It
did that in the browser, after rendering a full document.

| | `/onboarding` response | Main-frame navigations | Title |
|---|---|---|---|
| Before (production) | `200`, 50,977 bytes | 3 | `PUBMAXX: listed pint prices…` |
| After (local) | `307`, 0 bytes | 2 | (the homepage's, as before) |

The redirect reads `Accept`. Measured on a production build: a browser document
navigation sends `text/html,…` and every RSC navigation and prefetch sends `*/*`, so the
shell's own `router.replace` arrival is untouched. Next strips both its `RSC` header and
its `_rsc` query before middleware, which is why neither could be the signal; `Accept`
also fails safe, since an RSC fetch cannot start claiming to want HTML.

Shots: `shots/b6-onboarding-before-production.png`, `shots/b6-onboarding-after-local.png`.

## B7. The 404's 17 unused stylesheet preloads

None of them were the page's own. Next prefetches a `<Link>` on sight, and this page's
two doors are `/map` and `/tonight`, so it pulled one CSS chunk per segment of both and
used none of them. The same rule as B5b, on the loudest console on the site.

| | Style preloads | Used | Title |
|---|---|---|---|
| Before (production) | 17 | 0 | `PUBMAXX: listed pint prices…` |
| After (local) | 0 | 0 | `Page not found \| PUBMAXX` |

Measured on the same build: `/today` has no style preloads at all and `/pal` has two.
`/pal`'s two come from the same rule and its files are still on the fence's documented
backlog; they are not fixed here, because that is a sweep of two files rather than this
finding.

Shots: `shots/b7-404-before-production.png`, `shots/b7-404-after-local.png`.

## B8. `/pubs` shipped its photographs at their natural size

Five photographs at 1632x636 and 680x453 natural into a 344x168 box. Nothing had ever
asked the source for a smaller one: the proxy took no width and the cards emitted no
`srcset`.

Per photograph, over identical sources, at the width a 390px phone asks for:

| Source | Natural | Served |
|---|---|---|
| `lh3.googleusercontent.com/p/AF1QipOXXIp6…` | 152,792 B | 73,988 B |
| `lh3.googleusercontent.com/p/AF1QipOepg3s…` | 142,413 B | 59,884 B |
| `lh3.googleusercontent.com/p/AF1QipNNTCNJ…` | 140,822 B | 63,480 B |

Whole page, three photographs each time:

| Rig | Width asked for | Bytes | Per photograph |
|---|---|---|---|
| Production before, phone | none | 934.9 KB over 6 | 155.8 KB |
| After, phone 390 at 3x | 640 | 164.3 KB over 3 | 54.8 KB |
| After, desktop 1440 at 1x | 384 | 66.0 KB over 3 | 22.0 KB |

The firstmate target was under 80 KB for five. The desktop box the finding measured now
costs about 110 KB for five, and the 3x phone about 274 KB, against 779 KB before at the
same count. The target is not met at either rig and the gap is honest: a 640px-wide WebP
photograph is about 55 KB, and there is no quality left to give without the picture
showing it.

The widths offered are next/image's own candidate widths, so a `srcset` descriptor and
the width the proxy really answers name the same number. A set of our own invention made
the desktop card ask for 384 and be handed 688: the first measured build served w=688 at
every viewport and every density.

Shots: `shots/b8-pubs-before-production.png`, `shots/b8-pubs-after-local.png`.
Pins: `__tests__/imageProxy.test.ts`.

---

## Reproducing

```
NEXT_DIST_DIR=.next-prod npm run build
NEXT_DIST_DIR=.next-prod npx next start -p 3300

node docs/proof/walk-bugs-one-liners/scripts/walk-probe.mjs              # B6, B7, B8, and the shots
BASE=https://pubmaxxing.com TAG=before-production node …/walk-probe.mjs  # the same, against production
node docs/proof/walk-bugs-one-liners/scripts/pubs-image-ab.mjs           # B8, per photograph
WIDTH=1440 DPR=1 node docs/proof/walk-bugs-one-liners/scripts/pubs-page-bytes.mjs
```

Restart the server between `/pubs` runs. The image proxy's rate limiter is per IP, and a
second run inside its window measures the limiter rather than the page.
