# V0.1 launch hardening: baseline

What the site measured BEFORE the fixes in this pass, on the surfaces outside
the map, landing, Tonight, Near, Area and planner lanes (those were being
edited on another branch at the same time and are measure-only here).

## How this was measured

- Production build (`next build`) served by `next start` on loopback. Never
  `next dev`: a dev measurement is a number about the bundler.
- One warm-up load per route is thrown away, then one measured load. The first
  hit on a route pays a module load the second visitor never pays.
- Bytes and requests are cut at the window `load` event, so the deliberate
  post-paint tab warmup (`lib/backgroundWarmup.ts`) is excluded. This is the
  same cut `perf/route-budgets.json` states in words.
- LCP and CLS are read from `PerformanceObserver` registered before the
  document runs. A plain `getEntriesByType` after load reports neither.
- Two device profiles: Playwright's `iPhone 15` and `Pixel 7` descriptors.

**Stated limitation.** No WebKit build is installed on this machine, so the
iPhone pass runs the iPhone viewport, DPR, touch and user agent over Blink. It
is a phone-shaped Chromium, not Safari. At baseline, the iOS form-zoom floor was
enforced by a shared `!important` rule in `app/globals.css`, and the measured
sweep found zero controls below 16px. The final fence replaced that broad rule
with same-file component floors so desktop density stays unchanged.

**Noise.** One sample per route per device on a shared 8 GB machine with other
agents running. Across the two tables, non-`/pubs` run-to-run movement reaches
21 ms for TTFB, 336 ms for FCP and 384 ms for LCP. One sample cannot separate
a regression from machine contention inside those observed spreads.

## Document metrics

Source: `docs/proof/v01-launch-hardening/` measurement harness, build of
`fm/v01-launch-hardening` at its merge base.

### iPhone 15 (Chromium)

| Route | TTFB ms | FCP ms | LCP ms | CLS | JS KB | Reqs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/about` | 12 | 168 | 236 | 0 | 1745 | 53 |
| `/discover` | 30 | 260 | 260 | 0 | 2048 | 68 |
| `/login` | 7 | 160 | 160 | 0 | 1565 | 46 |
| `/messages` | 10 | 108 | 228 | 0 | 1754 | 53 |
| `/pubs` | 183 | 508 | 508 | 0 | 1831 | 58 |
| `/social` | 8 | 160 | 160 | 0 | 2048 | 67 |
| `/founders` | 7 | 160 | 160 | 0 | 1745 | 53 |
| `/contributors` | 8 | 152 | 152 | 0 | 1745 | 52 |
| `/u/karan` | 34 | 288 | 608 | 0 | 2276 | 77 |
| `/` | 2 | 208 | 208 | 0 | 1183 | 43 |
| `/near` | 8 | 160 | 160 | 0 | 1909 | 55 |
| `/tonight` | 8 | 120 | 268 | 0 | 1886 | 62 |

### Pixel 7

| Route | TTFB ms | FCP ms | LCP ms | CLS | JS KB | Reqs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/about` | 11 | 180 | 244 | 0 | 1745 | 53 |
| `/discover` | 21 | 196 | 196 | 0 | 2048 | 68 |
| `/login` | 12 | 200 | 200 | 0 | 1565 | 46 |
| `/messages` | 8 | 104 | 212 | 0 | 1754 | 53 |
| `/pubs` | 161 | 400 | 400 | 0 | 1831 | 58 |
| `/social` | 8 | 152 | 152 | 0 | 2048 | 67 |
| `/founders` | 8 | 164 | 164 | 0 | 1745 | 53 |
| `/contributors` | 8 | 156 | 156 | 0 | 1745 | 52 |
| `/u/karan` | 13 | 192 | 192 | 0 | 2276 | 77 |
| `/` | 5 | 316 | 316 | 0 | 1183 | 43 |
| `/near` | 11 | 128 | 128 | 0 | 1909 | 55 |
| `/tonight` | 7 | 160 | 480 | 0 | 1886 | 62 |

`/` and `/map` are prerendered CDN documents; every other route is dynamic by
policy (the per-request CSP nonce). So a TTFB here is server think time with no
network in it, which is the part of a production TTFB the code owns.

## Cache headers, before

`curl -I` against `next start`. Everything under `/_next/static` carries a
content hash and is already immutable, so it is not the question. Everything in
`public/` has a fixed URL:

| Path | Cache-Control |
| --- | --- |
| `/theme-init.js` | `public, max-age=0` |
| `/splash-init.js` | `public, max-age=0` |
| `/manifest.webmanifest` | `public, max-age=0` |
| `/favicon.ico` | `public, max-age=0` |
| `/apple-touch-icon-v2.png` | `public, max-age=0` |
| `/icon-192.png` | `public, max-age=0` |
| `/sw.js` | `public, max-age=0` |
| `/offline.html` | `public, max-age=0` |
| `/data/venues_slim.json` | `public, max-age=3600, s-maxage=31536000, stale-while-revalidate=604800` |
| `/og.png` (a route, not a file) | `public, max-age=0, s-maxage=3600, stale-while-revalidate=86400` |

The dataset already had a considered rule. Nothing else did: the two
render-blocking boot scripts in `<head>`, every brand mark, the manifest and
the offline document each cost a conditional round trip per page view, and none
of them was cached at the edge at all.

## Findings the fixes answer

1. **No edge caching for most unhashed public assets.** The dataset was the
   existing exception. Above.
2. **`/pubs` re-parsed the 6.7 MB price dataset on every request.** It was the
   only launch surface whose server render was not a shell: 161-183 ms against
   about 10 ms everywhere else. `lib/venuePriceIndex.ts` already held exactly
   that grouping for every other surface.
3. **The iOS form-zoom floor was already enforced globally.** The measured
   sweep found zero controls below 16px. The final change replaced that broad
   rule with same-file component floors and a stylesheet fence.
4. **Five control rows painted under the house 44px floor**, measured at 360,
   390 and 430: the Discover brand chips (35px), the Pubs jump chips (32px),
   the Find-your-lot invite link (16px), the About press-kit download links
   (24px) and the Discover leaderboard pub name (20px, and the only thing in
   that row a thumb can open).
5. **The manifest had no `id`.** Android then derives install identity from
   `start_url`, which moved from `/tonight` to `/` this month, so a later move
   would register as a different app.
6. **Four list images had no `loading`/`decoding`.** The house standard beside
   them (`components/drinks/MenuCategoryGrid.tsx`) already sets both.

No horizontal overflow was found at 360, 390 or 430 on any measured route, and
CLS was 0 everywhere a signed-out visitor can reach.
