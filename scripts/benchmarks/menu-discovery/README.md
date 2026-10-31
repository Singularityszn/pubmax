# Official London pub menu discovery benchmark

This experiment compares two crawlers on the same frozen set of 60 London pub websites.
It has no production writer, database connection, deployment step, or application dependency change.

Arm A uses breadth-first traversal, with conventional URL and anchor keywords first within each depth.
Arm B uses the unchanged PageSift 0.81.0 executable and its native relevance-guided crawler through its local API.
Both arms use one access transport and one candidate detector.

The [protocol](protocol.json) fixes the query, keywords, limits, cost assumptions, and adoption gates before the final run.
The [manifest](manifest.json) fixes the venues, source snapshots, arm order, and 12 primary review venues.
The [rubric](RUBRIC.md) defines a verified menu, a price record, and a missing result.
The [licence review](LICENCE_REVIEW.md) records the integration limits.
The [input provenance](INPUT_PROVENANCE.md) records OpenStreetMap attribution and the website identity limits.

## Run the experiment

Use Node.js 26 and Python 3 on macOS or Linux. The recorded run uses Node.js 26.13.0 and Python 3.15.2.
The operating system must provide `/usr/bin/time`.
No API key, paid service, browser, or model is required.

1. From the repository root, download the pinned executable.

   ```sh
   python3 scripts/benchmarks/menu-discovery/bootstrap.py
   ```

2. Run the CLI checks against the synthetic local website.

   ```sh
   node --test scripts/benchmarks/menu-discovery/benchmark.test.mjs
   ```

3. Run both arms against the frozen manifest.

   ```sh
   node scripts/benchmarks/menu-discovery/run.mjs live --out /tmp/pubmax-menu-run
   ```

4. Extract PDF text offline and generate the review packet.

   ```sh
   node scripts/benchmarks/menu-discovery/extract.mjs /tmp/pubmax-menu-run
   node scripts/benchmarks/menu-discovery/review.mjs /tmp/pubmax-menu-run
   ```

5. Review the packet against the rubric and save the annotation JSON.

6. Recompute the comparison from the responses and annotations.

   ```sh
   node scripts/benchmarks/menu-discovery/evaluate.mjs /tmp/pubmax-menu-run /path/to/annotations.json
   ```

`PAGESIFT_BIN` can select another copy of the exact 0.81.0 executable.
The runner rejects a different version and records the executable hash.
Live runs always use all 60 manifest venues. Partial live cohorts are not supported.
Use a new output directory for every run. Keep the original run and its hashes.

`prepare.mjs` recreates the manifest from the committed OSM and London app snapshots.
It is a deliberate sample regeneration command, not a prerequisite for each run.
It joins names and coordinates within 150 metres. It does not join on names alone.
The source records contain OSM attribution and licence metadata in their original files.

## What the cap counts

Each arm has at most 12 upstream HTTP request attempts per venue.
Robots requests, redirect hops, linked terms pages, PDFs, timeouts, and failed attempts all consume the cap.
There are no automatic retries. A policy refusal before an HTTP attempt consumes no request.
DNS failures count as attempts. DNS queries themselves are not HTTP requests.
Repeated reads within one arm use its captured response and consume no additional upstream request.
The two arms have separate response caches and separate robots caches.

The transport validates the production source policy before every request and redirect.
It checks public DNS addresses and pins the validated address for the connection.
It asks live robots rules before each origin's pages.
It applies the repository's crawler identities, the benchmark identity, and PageSift restrictions.
Unreadable robots rules fail closed. Ordinary HTML at robots.txt follows the repository's existing absent-rules decision.

Both arms first read up to three linked terms pages when the homepage exposes them, including an explicitly linked external legal host.
A detected automation restriction stops that host. An unreadable linked terms page also stops that host.
This check records its text evidence. It does not establish a complete legal interpretation of every site's terms.
Known commercial-use prohibitions in the source registry remain binding.
The benchmark also applies the stricter, evidenced restrictions in `access-review.json` before any request.

The minimum host delay is 1.5 seconds, or a longer published crawl delay or request rate.
The coordinator serialises requests to an actual host across all four venue workers, including shared PDF hosts.
The delay also follows completion of the preceding request.
The scheduler retains the longest observed delay for a host across arms, workers, and later robots reads.
A challenge, rate-limit response, or Retry-After response stops further requests to that host within the arm.
The crawler does not bypass challenges, use browser impersonation, or use authenticated access.

## How the comparison stays bounded

PageSift receives an inert local HTTP copy through the shared access transport.
The gateway keeps each own-host URL path. It rewrites permitted links to the local copy.
An explicitly linked external menu PDF keeps its path under `/__menu_asset__/host/`.
This allows native PageSift ordering while the transport enforces the real upstream request cap.
PageSift's page limit alone would not count robots, redirects, or failed requests.
Synthetic gateway refusals and failed upstream responses become empty local HTTP 200 responses.
This prevents native retries or cooldowns for the gateway's synthetic responses. The upstream ledger retains the true status and failure.
The comparison therefore measures one-attempt crawling. It does not compare native retry strategies.

The gateway removes executable scripts and remote resource attributes.
The native crawler uses its local HTTP API with maxConcurrency=1 and HTTP mode.
It disables sitemap seeds, adaptive early stop, and persistent caching.
The API binds only to 127.0.0.1. Each B arm starts a fresh process and private state directory.
The measured B profile includes startup and shutdown, even for refused seeds. It does not model a persistent shared service.
The CLI conservative profile overrides worker counts, so the final benchmark uses the API to set concurrency explicitly.
Both arms pay for the initial root and legal checks. B completes these checks before it starts the native loopback crawl.
An explicit native timeout preserves its 30-second first-byte limit instead of the CLI conservative 12-second default.
The audit rejects any native fetch error, including a gateway timeout. It does not treat a locally timed-out request as a relevance result.
Both arms start at the same venue URL and use maximum discovery depth four.
Both arms can explore the shared host, so another pub's menu is a possible false positive.
Both arms can follow explicitly linked external menu PDFs. They cannot explore an arbitrary external website.
External HTML menu services and extensionless external documents are outside this protocol.

The gateway changes hostname signals and external PDF prefixes. It can affect PageSift's relevance scores.
B also pays for HTML rewriting. This is a controlled, policy-constrained comparison, not unrestricted native performance.
The report must retain these limits when it describes the outcome.

## Keep the evidence

Each arm writes `result.json`, request logs, access decisions, and response-body hashes.
Every captured page has its source URL, crawl path, format, read time, and response hash.
B also keeps the native JSON output, exact command, stderr, and process measurements.
The run manifest records the code head, runtime, hardware, executable hash, and crawler file hashes.

Full response bodies stay in ignored `runs/` directories or the selected private output directory.
Do not publish menu documents or full website copies as a benchmark dataset without permission.
The committed results contain metadata, short evidence excerpts, and price facts.
The same response snapshot and annotations reproduce the evaluation without network requests.
Live crawl results can change because websites and access rules change.

The latency includes policy checks, rate-limit waits, downloads, parsing, and B's local gateway.
When the upstream cap blocks a new fetch, the runner stops PageSift's process group and retains its partial output.
This prevents native error cooldowns from extending the measured run after the request budget ends.
The process measurements remain available after this planned interruption.
The sum of venue durations differs from the elapsed cohort duration because four venues can run together.
Node CPU, Python parser CPU, and native child CPU have separate measurements.
B Node CPU includes driver polling, serialisation, and gateway rewriting.
Memory figures are process maxima, not a simultaneous process-tree peak.
The cost estimate uses explicit scenario rates. It excludes review labour and unknown commercial licence costs.

The source policy modules are read-only imports. No production crawl or ingestion command runs here.

## Additional evidence commands

`reference.mjs RUN TARGETS.json` reads explicitly selected menu links for the separate reference review.
It refuses to run before the paired crawl finishes. It has a separate cap of 40 requests per venue.
`sensitivity.mjs RUN` compares offline extraction of original HTML and gateway HTML for three named cases.
`audit.mjs RUN` checks request caps, body hashes, path edges, rate limits, access holds, and source hashes.
`export.mjs RUN OUTPUT` writes the compact machine-readable dataset and comparison report after the audit passes.
These commands do not publish any production data.

## Re-evaluate the committed result

The compact result retains the fields needed for offline evaluation. It omits response bodies and full menu text.
Copy the result directory before re-evaluating it, so the original result remains unchanged.

```sh
cp -R scripts/benchmarks/menu-discovery/results/2026-10-31 /tmp/pubmax-menu-result-copy
node scripts/benchmarks/menu-discovery/evaluate.mjs /tmp/pubmax-menu-result-copy /tmp/pubmax-menu-result-copy/annotations.json
```

The reference stage can run after a crawl with `node scripts/benchmarks/menu-discovery/reference.mjs RUN scripts/benchmarks/menu-discovery/reference-targets.json`.
Each reference venue has a separate 40-request maximum. These requests do not enter either arm's figures.
Reference reads retain their actual timestamps and can predate a later corrected crawl.
Do not retry a challenge or access refusal to complete the reference inventory.

## Export a completed comparison

After you save the annotations, use these commands. The export refuses an incomplete cohort or a failed archive audit.

```sh
node scripts/benchmarks/menu-discovery/audit.mjs /tmp/pubmax-menu-run
node scripts/benchmarks/menu-discovery/sensitivity.mjs /tmp/pubmax-menu-run
node scripts/benchmarks/menu-discovery/export.mjs /tmp/pubmax-menu-run /tmp/pubmax-menu-results
```

The export contains the report, gold labels, price facts, request records, page records, access decisions, and compute readings.
The local review page stays beside the private response archive.

## Historical runtime and corrected runtime

The measured archive records runtime head `c350c09b785f4e5798665751606ed0466a5ff213` and its original crawler hashes.
The current transport fixes unreadable terms, retained host delays, and redirect cache reuse for future runs.
This corrected runtime has not received a live measurement. The historical timing and request counts remain unchanged.
Offline evaluation merges only aliases supported by recorded redirects. It does not assume every trailing slash is interchangeable.
Complete price yields require conclusive review of every successful fetched page, including noncandidates.
The archive auditor checks historical crawler hashes against the recorded Git commit, independently of current runtime files.
The report discloses the recorded cohort impact of the terms and delay defects.
