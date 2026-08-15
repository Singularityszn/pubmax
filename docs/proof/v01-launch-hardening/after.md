# V0.1 launch hardening: after

Same harness, same method and the same machine as
[`baseline.md`](./baseline.md), against a production build of this branch.
Read that file first: it states how the numbers were taken, what the iPhone
profile really is, and how much movement is noise.

## Document metrics, before → after

A single figure means it did not move.

### iPhone 15 (Chromium)

| Route | TTFB ms | FCP ms | LCP ms | CLS | JS KB | Reqs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/about` | 12 → 23 | 168 → 304 | 236 → 424 | 0 | 1745 | 53 |
| `/discover` | 30 → 33 | 260 → 324 | 260 → 324 | 0 | 2048 | 68 |
| `/login` | 7 → 19 | 160 → 304 | 160 → 304 | 0 | 1565 | 46 |
| `/messages` | 10 → 17 | 108 → 168 | 228 → 332 | 0 | 1754 | 53 |
| `/pubs` | **183 → 58** | **508 → 280** | **508 → 280** | 0 | 1831 | 58 |
| `/social` | 8 → 9 | 160 | 160 | 0 | 2048 | 67 |
| `/founders` | 7 → 18 | 160 → 232 | 160 → 232 | 0 | 1745 | 53 |
| `/contributors` | 8 → 9 | 152 → 164 | 152 → 164 | 0 | 1745 | 52 |
| `/u/karan` | 34 → 13 | 288 → 224 | 608 → 224 | 0 | 2276 | 77 |
| `/` | 2 → 7 | 208 → 256 | 208 → 256 | 0 | 1183 | 43 |
| `/near` | 8 | 160 → 108 | 160 → 108 | 0 | 1909 | 55 |
| `/tonight` | 8 → 11 | 120 → 164 | 268 → 424 | 0 | 1886 | 62 |

### Pixel 7

| Route | TTFB ms | FCP ms | LCP ms | CLS | JS KB | Reqs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/about` | 11 → 18 | 180 → 516 | 244 → 620 | 0 | 1745 | 53 |
| `/discover` | 21 → 18 | 196 → 164 | 196 → 164 | 0 | 2048 | 68 |
| `/login` | 12 → 9 | 200 → 184 | 200 → 184 | 0 | 1565 | 46 |
| `/messages` | 8 | 104 → 116 | 212 → 260 | 0 | 1754 | 53 |
| `/pubs` | **161 → 35** | **400 → 188** | **400 → 188** | 0 | 1831 | 58 |
| `/social` | 8 | 152 → 156 | 152 → 156 | 0 | 2048 | 67 |
| `/founders` | 8 → 15 | 164 → 204 | 164 → 204 | 0 | 1745 | 53 |
| `/contributors` | 8 | 156 → 196 | 156 → 196 | 0 | 1745 | 52 |
| `/u/karan` | 13 → 12 | 192 → 196 | 192 → 196 | 0 | 2276 | 77 |
| `/` | 5 → 2 | 316 → 212 | 316 → 212 | 0 | 1183 | 43 |
| `/near` | 11 → 9 | 128 → 160 | 128 → 160 | 0 | 1909 | 55 |
| `/tonight` | 7 → 8 | 160 → 124 | 480 → 292 | 0 | 1886 | 62 |

**What actually moved.** `/pubs`: server render 183 → 58 ms on the iPhone
profile and 161 → 35 ms on the Pixel one, with LCP following it down. Nothing
else moved past the noise floor stated in the baseline, and no route got worse
in bytes or requests: this pass added no JavaScript.

**What is not in this table.** The caching, install and touch fixes below do
not show up in a single cold loopback load by construction — an edge window is
about the SECOND visit and about the CDN, a manifest `id` is about install
identity, and a 44px floor is about a thumb. Each is held by its own executable
contract instead.

## Cache headers, after

Same `curl -I` against `next start`.

| Path | Cache-Control |
| --- | --- |
| `/theme-init.js` | `public, max-age=3600, s-maxage=31536000, stale-while-revalidate=604800` |
| `/splash-init.js` | same |
| `/manifest.webmanifest` | same |
| `/favicon.ico`, `/favicon-x.svg` | same |
| `/apple-touch-icon-v2.png` | same |
| `/icon-192.png`, `/icon-x-512.png` | same |
| `/brand/*` | same |
| `/data/*` | same (unchanged) |
| `/sw.js` | `public, max-age=0, must-revalidate` |
| `/sw-plan-cache.js` | `public, max-age=0, must-revalidate` |
| `/offline.html` | `public, max-age=0, must-revalidate` |
| `/og.png` | unchanged: it is a route and answers with its own header |

The deal is deliberately asymmetric. A year at the EDGE, which Vercel purges on
every deploy, and one hour in the BROWSER, which no deploy can reach — so
`immutable` is refused outright for a file whose URL never changes. A worker
and its offline document take neither, because a stale worker keeps answering
from its own cache and a purge does not reach it.

## Executable contracts added

| Contract | What it holds |
| --- | --- |
| `__tests__/publicAssetCaching.test.ts` | Every asset a page view asks for has an edge window; none is `immutable` or cached in a browser for over a day; every worker revalidates. Evaluates `next.config.mjs` the way Next does, so it also proves the config still runs. |
| `__tests__/iosFormZoomFloor.test.ts` | Sweeps every stylesheet for a focusable control under 16px with no coarse-pointer override. Four files are named as a documented exception because another lane owns them; the list may only shrink, and a fixed file must leave it. |
| `e2e/launch-phone-controls.spec.ts` | `/about`, `/discover`, `/pubs`, `/social`, `/login`, `/messages` at 360, 390 and 430 with touch emulation: no horizontal overflow, and every standalone control clears 44 × 24. A link flowing inside a sentence is exempt, by WCAG's own inline exception. |
| `perf/route-budgets.json` | `/about` and `/pubs` join the enforced budget. `/pubs` is there so the per-request dataset parse cannot come back unnoticed. |

## Pre-existing breach, not from this pass

Running the existing budget spec over this build reports `/today` and
`/tonight` past their tracked JS and request ceilings by 47-49% and 12-13%.
`/tonight` measures 1886 KB here and measured 1886 KB in the baseline run taken
before any change in this pass; `/today` was not in the baseline set, but it
shares the same shell and this pass adds no JavaScript to any route. CI has
not run since 2026-08-10 (issue #1042), which is how the regression landed
unseen. It is reported rather than papered over: raising a ceiling to cover
another lane's regression is the mute button that
`docs/PERFORMANCE_BUDGETS.md` exists to refuse.
