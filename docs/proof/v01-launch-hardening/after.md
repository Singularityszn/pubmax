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

**What this pass can claim.** `/pubs`: server render 183 → 58 ms on the iPhone
profile and 161 → 35 ms on the Pixel one. Its TTFB movement is larger than the
observed non-`/pubs` TTFB spread and has a direct mechanism: removal of the
per-request 6.7 MB parse. Every other delta, including the Pixel `/about` rise,
is inside the observed spread of this single-sample run and is unattributed,
not reported as an improvement or regression. No route moved in bytes or
requests because this pass added no JavaScript.

**What is not in this table.** The caching, install and touch fixes below do
not show up in a single cold loopback load by construction — an edge window is
about the SECOND visit and about the CDN, a manifest `id` is about install
identity, and a 44px floor is about a thumb. Each is held by its own executable
contract instead.

## Cache headers, after

Same `curl -I` against `next start`.

| Path | Cache-Control |
| --- | --- |
| `/fonts/*`, `/landing/*`, `/night-signals/*` | `public, max-age=31536000, immutable` |
| `/vendor/*`, `/store-assets/*` | `public, max-age=3600, s-maxage=31536000, stale-while-revalidate=604800` |
| `/theme-init.js` | `public, max-age=3600, s-maxage=31536000, stale-while-revalidate=604800` |
| `/splash-init.js` | same |
| `/manifest.webmanifest` | same |
| `/favicon.ico`, `/favicon-x.svg` | same |
| `/apple-touch-icon-v2.png` | same |
| `/icon-192.png`, `/icon-x-512.png` | same |
| `/brand/*` | same |
| `/data/*` | same (unchanged) |
| `/llms.txt` | `public, max-age=0, s-maxage=3600, stale-while-revalidate=86400` |
| `/sw.js` | `public, max-age=0, must-revalidate` |
| `/sw-plan-cache.js` | `public, max-age=0, must-revalidate` |
| `/offline.html` | `public, max-age=0, must-revalidate` |
| `/og.png` | unchanged: it is a route and answers with its own header |

Caching follows change rate. Stable assets replaced by adding a file take a
year-long immutable browser window. Fixed URLs edited in place take one hour in
the browser and one year at the edge, which Vercel purges on deploy. This
includes MapLibre worker modules and store PNG exports because their build
scripts overwrite fixed paths. `llms.txt` always revalidates in the browser and
uses a short edge window. A service worker and its offline document take
neither, because a stale worker keeps answering from its own cache and a purge
does not reach it.

## Executable contracts added

| Contract | What it holds |
| --- | --- |
| `__tests__/publicAssetCaching.test.ts` | Evaluates `next.config.mjs`, keeps immutable, edited-in-place, crawler and worker classes separate, classifies every shipped public file outside data, and refuses immutable caching for build-written fixed URLs. |
| `__tests__/iosFormZoomFloor.test.ts` | The floor was already enforced globally and the measured sweep found zero controls below 16px; this fence protects the existing shared `!important` rule and its phone-reachable media context. |
| `e2e/launch-phone-controls.spec.ts` | `/about`, `/discover`, `/pubs`, `/social`, `/login`, `/messages` at 360, 390 and 430 with touch emulation: every fixed control row must render and clear 44 × 24, the generic sweep catches other small controls, and no route overflows horizontally. A link flowing inside a sentence is exempt, by WCAG's own inline exception. |
| `perf/route-budgets.json` | `/about` and `/pubs` join the enforced budget. `/pubs` is there so the per-request dataset parse cannot come back unnoticed. |

## Pre-existing red on main (#1042), not from this pass

CI has not run since 2026-08-10 (issue #1042), so two things landed on `main`
unseen. Both were verified at the merge base `c9d915f9` with every change in
this branch stashed, and neither is touched by this pass.

**Two unit tests fail at the merge base.**

| Test file | Failing case |
| --- | --- |
| `__tests__/socialSignInButtons.test.ts` | `hides Clerk login when no product Supabase session exists` — expected `''`, got a rendered `<span hidden data-auth-configured…>` |
| `__tests__/trustedSigning.test.ts` | `assigns contribution E2E to matching auth projects` — `testMatch` is now an array of two globs where the test expects the single `**/price-contribution-entry.spec.ts` |

`git stash push -u` then `vitest run` on those two files reproduces both with
none of this branch's changes present. Both files are in the diff of the lane
editing the landing, map-sheet, Tonight, Near, Area and planner surfaces, so
they are that lane's to fix.

**Two routes are past their tracked performance ceilings.**

| Route | Metric | Measured | Ceiling | Over by |
| --- | --- | ---: | ---: | ---: |
| `/today` | JS decoded (KB) | 1936 | 1300 | +49% |
| `/today` | requests | 58 | 52 | +12% |
| `/tonight` | JS decoded (KB) | 1886 | 1280 | +47% |
| `/tonight` | requests | 63 | 56 | +13% |

`/tonight` measures 1886 KB here and measured **1886 KB in the baseline run
taken before any change in this pass** — byte for byte identical. `/today` was
not in the baseline set, but it shares the same shell, and this pass adds no
JavaScript to any route: every change here is CSS, two image attributes, a
manifest key, header rules and a server-side memo.

Neither is papered over. Raising a ceiling to cover another lane's regression
is the mute button `docs/PERFORMANCE_BUDGETS.md` exists to refuse, and the two
test files belong to a branch in flight.
