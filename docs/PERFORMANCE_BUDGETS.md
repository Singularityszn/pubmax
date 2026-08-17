# Performance budgets

Speed is the promise this product makes. A promise nobody counts is a wish, so
every budgeted route has a number, the number is tracked in the repository, and
CI refuses a change that goes past it.

- The ceilings: [`perf/route-budgets.json`](../perf/route-budgets.json)
- The rules and the failure table: [`lib/performanceBudgets.ts`](../lib/performanceBudgets.ts)
- The measuring: [`e2e/performance-budget.spec.ts`](../e2e/performance-budget.spec.ts)
- The gate: the `performance-budget` job in `.github/workflows/ci.yml`

## What each metric means

| Metric | What it is | Why this one |
| --- | --- | --- |
| `serverRenderMs` | `responseStart - requestStart` on the document's own navigation entry | Over loopback there is no network in that figure, so it is the part of a production TTFB the code owns. |
| `jsDecodedKB` | Decoded bytes of every same-origin script the route asked for before it was interactive | Decoded, not transferred, because parse time is what a phone feels. |
| `requests` | Same-origin requests to the same point, the document included | A route can hold its bytes and still lose the night to a waterfall. |

## How a run is taken

Against the production build, at 390x844, with a 4x CPU throttle and every
cross-origin request refused, so a run measures what we ship and never a tile
server's morning. Each route gets a warm-up load that is thrown away, then the
median of the measured runs.

Counting stops at an APP-DEFINED moment, not a wall clock: the route's own
readiness gate, no earlier than the window load event. A resource counts if it
started before that moment; the run then waits for the network to go quiet so
every counted entry carries its final size.

That distinction is the difference between a gate and a coin toss. `networkidle`
catches or misses the post-paint background warmup
(`lib/backgroundWarmup.ts`, which loads the OTHER tab destinations on purpose)
depending on how fast the box is: the first CI run of this spec measured
`/today` at 2726 KB and the retry at 1186 KB, on one build. Under the current
anchor three consecutive local runs agree byte for byte, and CI agrees with
them to within about 4 KB.

Run it locally the same way CI does:

```
PUBMAX_PERF_BUDGET=1 npx playwright test e2e/performance-budget.spec.ts --project=chromium
```

A failing run prints one row per breach: route, metric, measured, budget, and
how far past the ceiling it went.

## Changing a number

A budget is a ratchet. Take one DOWN whenever the measured figure has been
comfortably below it for a while: that is the point of the exercise.

Take one UP only deliberately, in the same commit as the change that needs it,
with the reason in the commit message and the new figure measured rather than
guessed. A budget raised to make a red build green is not a budget.

Adding a route is cheap: one entry with a `readySelector` the route really
renders and one sentence of `why`. Removing one needs a reason, because an
unmeasured route reads as a pass and never fails again.

## The second navigation

The budgeted numbers above are about ARRIVING. They say nothing about the
navigation a drinker does far more often: tapping between tabs inside a session
that is already open. That one has its own shape, and it had its own defect.

Method, and it is deliberately not the budget spec's: one phone profile
(390x844, 4x CPU throttle, 10 Mbps at 40 ms RTT, cross-origin refused), a lap
around the bottom nav, and the clock started on the tap itself with `pointerdown`
fired immediately before the click, so intent-warm gets no head start a fast
thumb would not give it. A switch has ARRIVED when the destination route's own
root element is in the DOM and the browser has painted twice. For `/map` that
root is the map screen, not the pins: the WebGL init that follows is the map's
own cold-start lane. COLD is the first landing on a route in the session; WARM is
every later one. Both arms of a comparison run alternating in one process so
machine drift lands on both, and the first two laps are dropped as the server's
own warm-up - the same rule `warmupRuns` states above.

Measured on 2026-08-09, before and after the client-cache work:

| Tab switch | p50 before | p50 after | p95 before | p95 after |
| --- | --- | --- | --- | --- |
| Today, warm | 314 ms | 46 ms | 328 ms | 60 ms |
| Tonight, warm | 317 ms | 35 ms | 319 ms | 39 ms |
| You, warm | 314 ms | 30 ms | 316 ms | 44 ms |
| Map, warm | 31 ms | 32 ms | 49 ms | 66 ms |
| Tonight, cold | 327 ms | 329 ms | 334 ms | 334 ms |
| Social, cold | 328 ms | 329 ms | 330 ms | 331 ms |
| You, cold | 330 ms | 326 ms | 332 ms | 348 ms |
| Map, cold | 401 ms | 395 ms | 409 ms | 414 ms |

Read it as one finding: a warm switch was a flat ~314 ms because it was a full
RSC round trip and a fresh server render for a document the browser was still
holding, and it is now the remount alone. A COLD switch is unchanged, which is
the right answer - there was nothing held to reuse. The map was already instant
in both arms because its document is one of the two the CDN holds.

The seams:

- **`experimental.staleTimes` in `next.config.mjs`** is the window. It is safe
  only because no page server-renders per-account content and nothing calls
  `router.refresh()`; `__tests__/clientRouterCache.test.ts` fences both.
  `/admin` is the one argued exception to the first invariant, named in that
  fence as `PER_SESSION_SERVER_PAGES`: it server-renders the console or a 401
  token form off the caller's own credential, nothing links to it, and every
  `/api/admin` read re-gates. A second exception re-derives the whole window
  rather than adding a list entry.
- **`lib/surfaceDataCache.ts`** is the data half: one browser-only
  stale-while-revalidate store, so a return paints its last answer and refreshes
  behind it. It refuses auth and identity keys outright and empties at an
  account boundary. On the same lap set, Tonight's LISTINGS - not just its shell
  - reached the screen on a return in 197 ms p50 / 344 ms p95, from 417 / 660.
- **`components/nav/IntentLink.tsx`** warms a dynamic destination on intent
  instead of prefetching it on sight. A Tonight arrival used to fire about twenty
  `/plan?occasion=…` and `/pal/chat?ask=…` server renders in front of the
  listings it was still fetching.

Keeping tabs MOUNTED instead - parallel-route slots rather than navigations -
was considered and rejected on the same numbers. The remount is what is left of
a warm switch, and it now measures 30-46 ms; against that, every other page
would carry the map's tree, its effects and a live WebGL context all session.
The JS heap over one lap reads 8.8 MB on arrival at `/today` and 15.8 MB after
visiting every tab, of which the map step alone is +3.3 MB. Route JS is retained
once loaded either way, so persistence would buy back tens of milliseconds and
charge the heaviest route to every surface.

## What holds the numbers up

These are the seams a regression usually comes through. Each carries the reason
in its own file:

- **Two documents are prerendered; every other route is dynamic.** The
  per-request CSP nonce (`proxy.ts`) rules out static generation, ISR and PPR,
  so a nonce'd page view is a function invocation with no CDN copy to serve
  instead. That was the single largest cost in the production figures, and it
  is a policy decision rather than an implementation detail: on 2026-08-09 the
  captain took the exception named in `CDN_CACHED_DOCUMENT_PATHS`, so `/` and
  `/map` drop the nonce, prerender, and are held by the CDN. Both are public
  and anonymous, and their documents are asserted to name nobody. Every other
  route - identity, social, profile, admin, every API - keeps the nonce and
  keeps paying the invocation.
- **A prerendered document reads nothing per request.** `force-static` on those
  two pages turns a per-request read into a build error rather than a silent
  fall back to dynamic rendering, and it is also what stops the root layout's
  nonce read (`headers()`) from pulling them back. A `/map` request whose
  document really does differ - a town arrival, national browse, a curated
  share card - is rewritten to `app/map/arrival` and rendered per request with
  the nonce intact; `lib/mapDocumentTwin.ts` owns that split, and widening its
  key list takes those requests off the CDN.
- **Bundled data is read once per instance, never once per request.**
  `lib/aboutStats.ts` and `lib/venuePriceIndex.ts` memoize; the price dataset is
  6.7 MB of JSON and parsing it per request is the difference between a fast
  landing and a slow one.
- **No third party is on a render path without a deadline.**
  `WEATHER_TOP_UP_RENDER_DEADLINE_MS` in `lib/weatherFreshness.server.ts` bounds
  the live weather top-up; past it the reader gets the cached reading with its
  honest staleness line and the top-up finishes in the background.
- **No share card lives at the root segment.** Next folds a segment's
  `opengraph-image` into a metadata module that every descendant page's server
  function carries, and at the root that is every page on the site. A
  `import()` inside the handler does not help, because the tracer follows it.
  The homepage card is therefore a route (`app/api/home-card/route.tsx`) named
  by the homepage's own metadata. A card that only some subtree pays for may
  stay a file convention.
- **The map's eager JS has its own older fence**,
  `e2e/map-perf-budget.spec.ts`, kept because it states the map-specific
  regression cliff the audit measured.
