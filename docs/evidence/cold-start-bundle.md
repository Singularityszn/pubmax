# Cold-start function bundle evidence

Measured 30 July 2026. Bundle reduction is deliberately deferred to a separate task. This file records the baseline and two failed probes so the next attempt starts from evidence.

## Finding

Both `/` and `/map` production route traces contained 3,751 files and about 278.65 MiB at build time. The traced set included the source tree, Android project, documentation, screenshots, raw CSV files, raw OSM files, generated detail data, and runtime data packs unrelated to either page's first response.

The route-specific compiled files were small by comparison:

| Route | Files unique against the other route | Unique bytes |
| --- | ---: | ---: |
| `/` | 9 | 126,723 |
| `/map` | 9 | 125,104 |

The deployable trace, not HTML payload or route-specific JavaScript, is the dominant cold-start risk found in this investigation.

## Production request baseline

Command:

```bash
for route_path in / /map; do
  for sample_number in 1 2 3; do
    curl -sS -o /dev/null -w "route=${route_path} sample=${sample_number} status=%{http_code} ttfb=%{time_starttransfer}s total=%{time_total}s bytes=%{size_download}\n" "https://pubmaxxing.com${route_path}"
  done
done
```

Output:

```text
route=/ sample=1 status=200 ttfb=2.813088s total=2.890380s bytes=74342
route=/ sample=2 status=200 ttfb=0.507839s total=0.612744s bytes=74342
route=/ sample=3 status=200 ttfb=0.368392s total=0.505124s bytes=74342
route=/map sample=1 status=200 ttfb=2.327069s total=2.404465s bytes=49925
route=/map sample=2 status=200 ttfb=0.195478s total=0.273945s bytes=49925
route=/map sample=3 status=200 ttfb=0.404862s total=0.417503s bytes=49925
```

Header command:

```bash
curl -sSI https://pubmaxxing.com/ | rg -i '^(cache-control|x-vercel-cache|x-vercel-id|server|age):'
```

Output:

```text
age: 0
cache-control: private, no-cache, no-store, max-age=0, must-revalidate
server: Vercel
x-vercel-cache: MISS
x-vercel-id: lhr1::iad1::l8kd5-1785405326084-9ca63bdb2787
```

The first request in each sequence is cold-looking and later requests are much faster. A production sequence cannot force independent cold starts, so do not describe these as three cold samples.

## Build and trace measurement

Baseline build:

```bash
NEXT_DIST_DIR=.next-perf-before npm run build
```

Next completed the production build with Turbopack. It also emitted:

```text
./next.config.mjs
Encountered unexpected file in NFT list
A file was traced that indicates that the whole project was traced unintentionally.
```

The warning's import trace named:

```text
./next.config.mjs
./lib/venueDetailIndex.ts
./app/api/plans/[id]/getin/route.ts
```

Exact size command run immediately after the build:

```bash
node - <<'NODE'
const fs = require('fs');
const path = require('path');
for (const route of ['app/page.js.nft.json', 'app/map/page.js.nft.json']) {
  const trace = path.resolve('.next-perf-before/server', route);
  const json = JSON.parse(fs.readFileSync(trace, 'utf8'));
  const base = path.dirname(trace);
  const rows = [...new Set(json.files)].map(file => {
    const absolute = path.resolve(base, file);
    let bytes = 0;
    try { bytes = fs.statSync(absolute).size; } catch {}
    return { file: path.relative(process.cwd(), absolute), bytes };
  }).sort((a, b) => b.bytes - a.bytes);
  const total = rows.reduce((sum, row) => sum + row.bytes, 0);
  console.log(JSON.stringify({
    route: route.startsWith('app/map') ? '/map' : '/',
    files: rows.length,
    bytes: total,
    mib: +(total / 1048576).toFixed(3),
    largest: rows.slice(0, 12),
  }, null, 2));
}
NODE
```

The build-time totals were:

```text
/     files=3751 bytes=292185944 MiB=278.650
/map  files=3751 bytes=292184325 MiB=278.649
```

Deleting an untracked 8,537-byte plan document after the build changed a later sum of the same trace to 292,177,407 and 292,175,788 bytes. The trace still listed 3,751 paths, but one path no longer existed. This proves the oversized trace was following workspace content, not a stable route dependency set. Use a clean worktree for the next baseline and capture sizes immediately after build.

## Largest traced files

This command read the `/` trace, resolved each path relative to its `.nft.json`, and sorted by actual file size:

```bash
node - <<'NODE'
const fs = require('fs');
const path = require('path');
const trace = path.resolve('.next-perf-before/server/app/page.js.nft.json');
const base = path.dirname(trace);
const rows = [...new Set(JSON.parse(fs.readFileSync(trace, 'utf8')).files)].map(file => {
  const absolute = path.resolve(base, file);
  try { return [path.relative(process.cwd(), absolute), fs.statSync(absolute).size]; }
  catch { return [path.relative(process.cwd(), absolute), 0]; }
}).sort((left, right) => right[1] - left[1]).slice(0, 12);
for (const [file, bytes] of rows) console.log(`${bytes}\t${file}`);
NODE
```

Output:

```text
18258514	data/borough_embedded_pint_prices.json
14487242	data/pint_prices_builder_master.csv
13664744	data/osm/uk/uk_osm_pubs.json
9808644	data/borough_embedded_pint_prices.csv
7254615	data/generated/venue_details.jsonl
7034773	public/data/pint_prices_app_dataset.json
4307802	data/pint_prices_app_dataset.csv
3023654	data/pint_prices_canonical_enriched.csv
2212121	docs/screenshots/landing-light-1280.png
2201312	data/osm/uk/raw/chunk_lat50.80_lon-0.70.json
2148827	public/data/wetherspoons/pubs.json
1972926	docs/screenshots/design-craft/before-sheet-390-dark.png
```

These files dominate the measured trace. Most are source or build inputs, not files `/` or plain `/map` opens while rendering. Any next fix should prove why each included file is needed before adding another exclusion layer.

## Deliberate tracing contract

This repository already has deliberate route tracing. `lib/venueIndexTracing.mjs` exports `runtimeDataPackRouteIncludes()`. `next.config.mjs` calls it to derive `outputFileTracingIncludes` from the source import graph and `RUNTIME_DATA_PACKS`.

The evaluated config was checked with:

```bash
node --input-type=module - <<'NODE'
const config = (await import('./next.config.mjs')).default;
for (const route of ['/', '/map']) {
  console.log(route, JSON.stringify(config.outputFileTracingIncludes?.[route] ?? null, null, 2));
}
NODE
```

Output:

```text
/ null
/map [
  "./public/data/uk_base/places.json"
]
```

So the intentional per-route table does not explicitly add any data pack to `/`, and adds only the 375,876-byte UK place index to `/map`. That table does not explain 278.65 MiB on both routes. The next investigation should still start there because it owns the deliberate contract, then establish why Next's final `.nft.json` is much broader than the evaluated values.

Do not add `excludeFiles` in `vercel.json`. Vercel does not support that escape hatch for Next.js functions, and it would sit on top of the repository's existing tracing contract rather than fixing it.

## Route request work

### Landing

At module scope, `app/page.tsx` imports `lib/aboutStats.ts`. That module statically imports `lib/historic.ts`, `lib/venuePriceIndex.ts`, `lib/cities.ts`, and `lib/venues.ts`.

The data is not parsed at module scope, but `Home()` calls `loadAboutStats()` on every request:

- `getPricedVenues()` reads and parses `public/data/pint_prices_app_dataset.json`, 7,034,773 bytes, once per warm process because it memoises the grouped result.
- `loadPriceRows()` reads and parses the same 7,034,773-byte file again on every landing request.
- `loadHistoricPubs()` reads and parses `public/data/historic_pubs.json`, 186,113 bytes, on every landing request.

This establishes why warm landing work exceeds warm plain-map work. A compact build-derived statistics file remains a valid later optimisation, but it is much smaller than the whole-project trace problem and was not implemented here.

### Map

At module scope, `app/map/page.tsx` imports the map shell, share metadata helpers, and `lib/ukPlaceIndex.server.ts`. The UK place module computes its file path at module load but calls `readFileSync()` only after `parseUkPlaceMapArrival()` accepts a complete `place`, `lat`, and `lng` query. Plain `/map` returns before parsing `public/data/uk_base/places.json`, 375,876 bytes.

The evaluated tracing contract includes the place index for `/map` because a query variant may need it. That is deliberate and bounded.

## Local fresh-process request measurement

Method:

- build once with `NEXT_DIST_DIR=.next-perf-before`;
- start a fresh `next start` process for each cold sample;
- wait for the server's `Ready in` output without making an HTTP request;
- make the first route request;
- make three more requests in the same process;
- stop the process;
- repeat three times per route.

Exact harness:

```bash
node <<'NODE'
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');

function curl(url) {
  const raw = execFileSync('curl', [
    '-sS', '-o', '/dev/null', '-w',
    '%{time_starttransfer} %{time_total} %{size_download}',
    url,
  ], { encoding: 'utf8' });
  const [ttfb, total, bytes] = raw.trim().split(/\s+/);
  return { ttfb: Number(ttfb), total: Number(total), bytes: Number(bytes) };
}

async function startServer(port) {
  const child = spawn('./node_modules/.bin/next', ['start', '-p', String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_DIST_DIR: '.next-perf-before' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`server ${port} timeout: ${output}`)),
      30000,
    );
    const onData = chunk => {
      output += chunk.toString();
      if (/Ready in/.test(output)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once(
      'exit',
      code => reject(new Error(`server ${port} exited ${code}: ${output}`)),
    );
  });
  await ready;
  return child;
}

async function stopServer(child) {
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise(resolve => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

(async () => {
  const results = [];
  let port = 38100;
  for (const route of ['/', '/map']) {
    for (let trial = 1; trial <= 3; trial += 1) {
      const child = await startServer(port);
      try {
        const cold = curl(`http://127.0.0.1:${port}${route}`);
        const warm = [1, 2, 3].map(
          () => curl(`http://127.0.0.1:${port}${route}`),
        );
        results.push({ build: 'before', route, trial, cold, warm });
      } finally {
        await stopServer(child);
      }
      port += 1;
    }
  }
  console.log(JSON.stringify(results, null, 2));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
NODE
```

Exact TTFB / total output:

| Route | Trial | First request | Warm 1 | Warm 2 | Warm 3 | Bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 1 | 0.961687s / 0.963339s | 0.080344s / 0.081181s | 0.070697s / 0.071473s | 0.073747s / 0.074408s | 67,791 |
| `/` | 2 | 0.932527s / 0.934324s | 0.083505s / 0.084454s | 0.071759s / 0.072574s | 0.074404s / 0.075075s | 67,791 |
| `/` | 3 | 0.949939s / 0.951599s | 0.080306s / 0.081163s | 0.072113s / 0.072886s | 0.074312s / 0.074985s | 67,791 |
| `/map` | 1 | 0.751368s / 0.753159s | 0.013283s / 0.014297s | 0.011174s / 0.011990s | 0.010893s / 0.011616s | 44,543 |
| `/map` | 2 | 0.752308s / 0.754126s | 0.013434s / 0.017323s | 0.012754s / 0.013370s | 0.010686s / 0.011391s | 44,543 |
| `/map` | 3 | 0.750696s / 0.752486s | 0.013260s / 0.016766s | 0.011190s / 0.011986s | 0.011298s / 0.012012s | 44,543 |

This is a local fresh-process proxy, not Vercel cold-start time. It reproduces a stable 180ms to 211ms first-request gap between landing and map and a much larger same-process warm gap. The request-time landing dataset work is the established reason for that route difference.

## Failed probe 1: ignore the scanner's filesystem arguments

Change tried:

```js
existsSync(/* turbopackIgnore: true */ directory)
readdirSync(/* turbopackIgnore: true */ directory, { withFileTypes: true })
readFileSync(/* turbopackIgnore: true */ file, "utf8")
```

The markers were added only inside `lib/venueIndexTracing.mjs` source discovery. The intentional route-pack test remained green:

```text
npx vitest run __tests__/venueIndexTracing.test.ts
Test Files  1 passed
Tests       5 passed
```

Build:

```bash
NEXT_DIST_DIR=.next-perf-trace-fixed npm run build
```

Result:

- Turbopack emitted the same whole-project NFT warning.
- `/` stayed at 3,751 files and 292,187,625 bytes, 278.652 MiB.
- `/map` stayed at 3,751 files and 292,186,006 bytes, 278.650 MiB.
- The change was reverted.

Lesson: ignoring the nested `existsSync`, `readdirSync`, and `readFileSync` arguments does not stop the broader config trace. Do not repeat this placement.

## Failed probe 2: ignore the tracing module import

Change tried:

```js
const { runtimeDataPackRouteIncludes } = await import(
  /* turbopackIgnore: true */ "./lib/venueIndexTracing.mjs"
);
```

This replaced the static import in `next.config.mjs`. Node still evaluated the config and returned 43 derived route keys. The five tracing tests still passed.

Build:

```bash
NEXT_DIST_DIR=.next-perf-trace-fixed-2 npx next build
```

Result:

- Turbopack emitted the same whole-project NFT warning during compilation.
- The run was intentionally stopped after the repeated failure signal, under the lane's two-attempt safety rule.
- No completed `.nft.json` size exists for this probe. Do not report one.
- The change was reverted.

Lesson: ignoring the dynamic module import also did not prevent Next from identifying `next.config.mjs` as the unexpected traced file. Do not repeat this shape.

## Next investigation

Start with the deliberate machinery, not an exclusion list:

1. Run a clean baseline build and inspect evaluated `outputFileTracingIncludes` beside final route NFTs.
2. Establish why a config whose explicit `/` value is `null` and `/map` value is one 375,876-byte file produces identical 3,751-file traces.
3. Isolate whether one route such as `/api/plans/[id]/getin` poisons shared traces, whether Next always carries the config's own filesystem reads, or whether another dynamic path broadens the root. Change one variable per build.
4. Keep `__tests__/venueIndexTracing.test.ts` green so required runtime packs never disappear while removing accidental files.
5. Re-run fresh-process timings only after the trace is materially smaller.

## Function-size question

QUESTION: does the actual packaged `/` or `/map` Vercel function sit near or above the platform limit?

The local `.nft.json` sum is about 278.65 MiB, but that sum is not the packaged Vercel function size. Packaging may deduplicate shared files, add runtime layers, compress files, or use the newer Large Functions path. Do not compare the local number directly to a limit and claim deployment failure.

Vercel currently documents a 250 MB standard uncompressed function limit and a Large Functions public beta for eligible Fluid Compute projects. See [Vercel function limits](https://vercel.com/docs/functions/limitations) and [Vercel's function-size troubleshooting guide](https://vercel.com/kb/guide/troubleshooting-function-250mb-limit).

Check through the normal git-driven Vercel build, not a crewmate deployment:

- run one preview build with `VERCEL_ANALYZE_BUILD_OUTPUT=1` to print function sizes and largest contributors;
- if more detail is needed, run one preview build with `VERCEL_BUILDER_DEBUG=1` and read `uncompressedLayerBytes`;
- record whether the project used the standard or Large Functions path;
- compare packaged `/` and `/map` bytes with the applicable project limit.

This is a deployment-risk question as well as a speed question. It is deliberately unresolved here.
