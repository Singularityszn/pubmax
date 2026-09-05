# The first pin on a cold, throttled /map

`docs/perf/baseline-2026-09-05.md` measured the first tappable pin on the
audit's own rig at about 14.6 s and named the eight seconds between "everything
needed is in hand" and "a thumb can hit a pin" as the next lane. This is that
lane: the profile, the rule that came out of it, and the interleaved A/B that
carries the causal claim.

The rule and the closed set of held lanes are `lib/mapFirstPinStreams.ts`. The
prose, both tables and the caveat are `docs/PERFORMANCE_BUDGETS.md`, "The first
pin on a cold, throttled /map".

## The rig

| | |
| --- | --- |
| Build | two local production builds (`.next-prod` for the before arm, `.next-prod-after` for the after arm), keyless, each served by its own `next start` on its own port |
| Browser | Playwright Chromium with SwiftShader, so the map gets a real WebGL2 context |
| Phone | 390x844, 4x CPU throttle, Slow 4G (150 ms RTT, 188,743 B/s down, 86,400 B/s up), the same figures `e2e/helpers/webVitals.ts` pins |
| Cold | HTTP cache cleared before every sample; storage cleared on the app's own origin before the page leaves it, so every sample of the first-visit table is a first-ever visit |
| Signal | `window.__pubmaxPaintedMapTapPoints().length > 0`, polled every 250 ms, the same probe the recorded baseline uses |
| Session | ONE CDP session per page, opened once and reused |
| Init script | every arm served through the same interception of `public/map-first-paint-init.js`, because Playwright fulfils an intercepted request from the harness rather than from the browser cache |
| Idle arm | the arm not being measured is parked on `about:blank`; an arm left on `/map` keeps MapLibre rendering under the same throttle and taxes whichever arm measures next |

## Files

| File | What it holds |
| --- | --- |
| `trace-cold-before.txt` | two cold `/map` runs on the before arm: marks, the request timeline grouped by lane, and the shard cells per second |
| `trace-cold-after.txt` | the same two runs on the after arm |
| `ab-first-visit.txt` | the interleaved A/B, five pairs, every sample a first-ever visit |
| `ab-returning-visitor.txt` | the interleaved A/B, five pairs, the cold-open warm firing at load |

## The finding, in one paragraph

The venue rows are merged and the scene is built inside eight seconds, and the
first pin is not. What sits between them is not the data and not the engine's
size: it is the ORDER. Between the scene being built and MapLibre's own worker
module landing, the map opened 57 shard-cell requests, a 190 KB ambient POI read
and the UK base manifest with its packs, and the 133 KB worker module queued
behind them for 3,775 ms on a wire that carries it in about 720 ms. Only once
that module lands can the worker parse the pubs source, ask the style for a
glyph range and place a symbol. Holding those three lanes until the pins have
painted moved the first tappable pin from 15,589 ms to 10,679 ms (median, five
interleaved pairs, first visit), and it moved `pubmax:pubs-source-loaded`, the
engine's own gate, from 15,425 ms to 8,264 ms.

## What this rig overstates

`next start` serves HTTP/1.1, so six connections per origin turn 59 queued
shard requests into head-of-line blocking; production serves HTTP/2, where they
multiplex. The ORDERING win holds on both, because a held request is not on the
wire at all until the pins have painted, but a production figure will be
smaller than 4.9 s. Nothing here is written into `perf/route-budgets.json` or
`perf/cwv-baseline.json`: no ceiling moved, and `e2e/cwv-baseline.spec.ts`
remains the only writer of the recorded table.
