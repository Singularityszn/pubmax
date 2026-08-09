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
| `jsDecodedKB` | Decoded bytes of every same-origin script the route pulled in before it settled | Decoded, not transferred, because parse time is what a phone feels. |
| `requests` | Same-origin requests to the same point, the document included | A route can hold its bytes and still lose the night to a waterfall. |

## How a run is taken

Against the production build, at 390x844, with a 4x CPU throttle and every
cross-origin request refused, so a run measures what we ship and never a tile
server's morning. Each route gets a warm-up load that is thrown away, then the
median of the measured runs. The sample is anchored to the settled network
rather than to a wall clock, so the throttle cannot change what has arrived yet.

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

## What holds the numbers up

These are the seams a regression usually comes through. Each carries the reason
in its own file:

- **Every route is dynamic.** The per-request CSP nonce (`proxy.ts`) rules out
  static generation, ISR and PPR, so every page view is a function invocation
  with no CDN copy to serve instead. That is the single largest cost in the
  production figures and the one thing here that is a policy decision rather
  than an implementation detail.
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
