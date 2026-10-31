import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadResults } from './evaluate.mjs';
import { sha256 } from './transport.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const run = resolve(process.argv[2]);
const out = resolve(process.argv[3] ?? resolve(here, 'results/2026-10-31'));
const meta = JSON.parse(readFileSync(resolve(run, 'run.json')));
const comparison = JSON.parse(readFileSync(resolve(run, 'comparison.json')));
const audit = JSON.parse(readFileSync(resolve(run, 'audit.json')));
if (!meta.finishedAt || comparison.completeArms !== 120 || !audit.passed) throw new Error('Export requires a finished 60-site run and a passing archive audit');
const results = loadResults(run);
const manifest = JSON.parse(readFileSync(resolve(here, 'manifest.json')));
const annotations = JSON.parse(readFileSync(resolve(run, 'annotations.json')));
mkdirSync(out, { recursive: true });
const json = (name, value) => writeFileSync(resolve(out, name), `${JSON.stringify(value, null, 2)}\n`);
const jsonl = (name, rows) => writeFileSync(resolve(out, name), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
for (const name of ['comparison.json', 'audit.json', 'annotations.json', 'sensitivity.json']) copyFileSync(resolve(run, name), resolve(out, name));
json('run.json', { ...meta, privateResponseArchive: run, responseArchivePublished: false,
  note: 'The captured code head is the base checkout. The harness file hashes identify the exact uncommitted source bytes used by this run. No application build or ingestion ran.' });
jsonl('requests.jsonl', results.flatMap((arm) => arm.requests.map((request) => ({ venueId: arm.venueId, arm: arm.arm, ...request }))));
jsonl('access-events.jsonl', results.flatMap((arm) => arm.events.map((event) => ({ venueId: arm.venueId, arm: arm.arm, ...event }))));
jsonl('pages.jsonl', results.flatMap((arm) => arm.pages.map(({ text, headings, ...page }) => ({ venueId: arm.venueId, arm: arm.arm,
  ...page, headings: headings.slice(0, 240), textCharacters: text.length, textSha256: sha256(text),
  note: 'Full response and text stay in the private archive. Links, paths, status, format, read time, and content hash remain reviewable.' }))));
jsonl('venue-results.jsonl', results.map(({ pages, requests, events, ...arm }) => ({ ...arm, pagesFetched: pages.length,
  candidatePages: pages.filter((p) => p.candidate).length, httpFailures: requests.filter((r) => r.status >= 400).length,
  redirects: requests.filter((r) => r.status >= 300 && r.status < 400).length, eventCount: events.length })));
const fmt = (number, places = 2) => number == null ? 'Unknown' : Number(number.toFixed(places)).toLocaleString('en-GB');
const percent = (number) => number == null ? 'Unknown' : `${fmt(number * 100, 1)}%`;
const dollars = (number) => number == null ? 'Unknown' : `$${number.toFixed(5)}`;
const a = comparison.summary.find((row) => row.arm === 'A');
const b = comparison.summary.find((row) => row.arm === 'B');
const fields = [
  ['Venues', 'venues'], ['Upstream request attempts', 'requests'], ['Verified menu URLs discovered', 'verifiedMenuUrlsDiscovered'],
  ['Verified menu URLs downloaded', 'verifiedMenusFetched'], ['Verified PDF URLs discovered', 'verifiedPdfUrlsDiscovered'],
  ['Verified HTML URLs discovered', 'verifiedHtmlUrlsDiscovered'], ['Verified PDF menus downloaded', 'verifiedPdfMenus'],
  ['Verified HTML menus downloaded', 'verifiedHtmlMenus'], ['Judged false-positive URLs', 'falsePositives'],
  ['Missing reviewed gold URLs', 'falseNegatives'], ['Unjudged candidate URLs', 'unjudgedCandidates'],
  ['Relevant pages per 100 requests, lower bound', 'relevantPagesPer100RequestsLowerBound'],
  ['Verified price records', 'verifiedPriceRecords'], ['Verified price records per 100 requests, lower bound', 'verifiedPriceRecordsPer100RequestsLowerBound'],
  ['Transport failures', 'fetchFailures'], ['HTTP failures', 'httpFailures'], ['Redirect hops', 'redirects'],
  ['Blocked venue and URL pairs', 'blockedVenueUrlPairs'], ['Sum of venue durations, seconds', 'wallSecondsSum'],
  ['Median venue duration, seconds', 'wallSecondsMedian'], ['95th percentile venue duration, seconds', 'wallSecondsP95'],
  ['Node CPU seconds', 'nodeCpuSeconds'], ['Python parser CPU seconds', 'parserCpuSeconds'], ['Native child CPU seconds', 'nativeChildCpuSeconds'],
  ['Downloaded bytes', 'downloadBytes'],
];
const table = fields.map(([title, key]) => `| ${title} | ${fmt(a[key])} | ${fmt(b[key])} |`).join('\n');
const primary = comparison.primaryGoldSummary;
const goldA = primary.find((r) => r.arm === 'A');
const goldB = primary.find((r) => r.arm === 'B');
const examples = comparison.summary.flatMap((arm) => arm.falsePositiveUrls.slice(0, 3).map((row) => `- Arm ${arm.arm}: [${row.url}](${row.url}). ${row.evidence ?? 'The recorded reviewer classified this URL as not a menu.'}`));
const misses = comparison.summary.flatMap((arm) => arm.missingUrls.map((row) => `- Arm ${arm.arm}: ${row.venueId}, [reviewed menu](${row.url}). ${row.fetched ? 'The arm fetched the page but did not identify it.' : 'The arm did not identify this reviewed menu URL.'}`));
const menuCount = annotations.labels.filter((l) => l.verdict === 'menu').length;
const notMenuCount = annotations.labels.filter((l) => l.verdict === 'not-menu').length;
const unresolvedCount = annotations.labels.filter((l) => l.verdict === 'unresolved').length;
const markdown = `# London official menu discovery comparison

Recorded on 31 October 2026. Recommendation: **reject production adoption of PageSift 0.81.0 on this evidence**.
Keep production ingestion unchanged. The benchmark provides a separate experiment and a review packet.

PageSift's native relevance crawler does not establish a complete, verified yield advantage in this experiment.
The gold labels remain provisional agent review. A human has not approved the reference inventory.
Complete relevant-page and price-yield figures remain unknown where review is incomplete.
The AGPL integration decision and repeat-run gate also remain open.

## Sample and controls

The input contains exactly 60 websites, with 12 in each geographic stratum.
Each stratum includes four shared-host and eight venue-host websites.
The source snapshots provide ${manifest.eligibleVenues} eligible London pub records with a website and postcode.
The sample limits each host to three venues and keeps blocked sites in the cohort.
This balanced stress sample does not estimate the prevalence of menu formats across all London pubs.

A uses breadth-first traversal with conventional URL and anchor keywords first at each depth.
B uses the unchanged PageSift 0.81.0 executable with query \`${meta.protocol.query}\`.
Both arms start at the same venue URL and receive at most ${meta.protocol.requestBudgetPerArmPerVenue} upstream attempts per venue.
Robots, redirects, terms pages, failures, and PDFs all consume that cap. Neither arm retries a failed upstream attempt.
The manifest fixes the arm order before crawling. Neither arm receives the other's response cache.

The shared transport applies the repository's source policy, live robots checks, public-address checks, and host rate limits.
It stops at access challenges and rate-limit responses. A linked terms restriction also stops the host.
Four venue workers share one host scheduler, including menu asset hosts.
The minimum host delay is ${meta.protocol.minIntervalMs / 1000} seconds, or a longer published delay.
The archive audit checked ${audit.requests} attempts across all 120 arms and passed.

## Measured comparison

Verified figures below use the supplied annotations. Unreviewed results do not count as verified menus or prices.
Discovery includes eligible menu links on captured pages. Downloads require a successful body fetch by that arm.
The gold review can verify a linked document separately without adding a request to either arm.

| Metric | A: breadth-first | B: PageSift 0.81.0 |
| --- | ---: | ---: |
${table}
| Judged-candidate precision | ${percent(a.precision)} | ${percent(b.precision)} |
| Recall against all reviewed inventory URLs | ${percent(a.recall)} | ${percent(b.recall)} |
| Measured-component cost scenario | ${dollars(a.estimatedMeasuredComponentCost.total)} | ${dollars(b.estimatedMeasuredComponentCost.total)} |

The cohort took ${fmt(meta.wallSeconds)} seconds of elapsed time.
The sum of venue durations includes overlapping workers and therefore differs from cohort elapsed time.
The native process stops when a new fetch would exceed the upstream cap.
Its planned SIGINT termination is distinct from a transport failure or a blocked website.

## Gold sample and review limits

The primary sample contains 12 venues selected before the crawl.
The annotation set currently contains ${menuCount} verified menu labels, ${notMenuCount} negative labels, and ${unresolvedCount} unresolved labels.
Those labels include a separate diagnostic sample outside the primary 12 venues.
Primary-sample discovery recall is ${percent(goldA?.recall)} for A and ${percent(goldB?.recall)} for B.
Primary-sample judged precision is ${percent(goldA?.precision)} for A and ${percent(goldB?.precision)} for B.
Both precision figures omit unjudged candidates. They are not complete-cohort precision estimates.
The reference inventory is bounded by recorded reads and reviewed navigation. It does not establish full-site recall.
Blocked primary venues stay unresolved. They do not become zero-menu venues.

The review separates actual menus, menu hubs, navigation, other branches, bus timetables, and cigar catalogues.
Menu hubs count as HTML discovery. A separate downloaded-document count prevents a hub from implying a readable menu document.
Image menu links and external HTML menu services fall outside this crawl protocol.
Reference-only image evidence stays in the review packet and outside HTML and PDF recall.

## Missing URLs and false positives

${misses.length ? misses.join('\n') : 'No missing URL appears in the currently verified inventory. This does not establish complete recall.'}

These reviewed false positives illustrate the errors. The machine-readable file contains every judged false-positive URL.

${examples.join('\n')}

The Old Ship is a useful retrieval case.
A downloaded six PDFs there. B downloaded no PDF and returned two native HTML documents.
The PDF set includes food, wine, and cocktail menus, alongside a cigar catalogue that does not qualify.
An offline sensitivity check also extracted little main content from the original Old Ship HTML.
This supports the extraction-failure explanation for this case, but it does not isolate the gateway's full effect on all websites.

## Compute and estimated cost

Node CPU and sampled RSS come from each venue worker.
Each Python parser reports its own CPU and peak RSS.
The operating system's time tool measures PageSift CPU and maximum RSS.
These memory figures are separate process maxima, not one simultaneous process-tree peak.
Other machine activity was not controlled. Treat the wall-time comparison as one observation.

The scenario uses USD 0.05 per CPU-hour, USD 0.01 per GiB-hour of memory, and USD 0.09 per downloaded GiB.
These assumed rates are not a supplier quote or an actual bill.
The memory scenario charges each arm's summed duration at the sum of its measured component maxima.
The estimate excludes coordinator CPU, retained storage, review labour, and an unknown commercial licence price.
There are no paid API or model calls in either arm.
Separate reference fetches and offline review extraction stay outside the benchmark request and latency totals.

## Licence and adoption decision

The [PageSift 0.81.0 release](https://github.com/YOLOW92/pagesift/releases/tag/v0.81.0) states AGPL-3.0-only and offers commercial licensing.
The [licence review](../../LICENCE_REVIEW.md) records the release commit and the relevant obligations.
This experiment runs the unchanged CLI locally. It does not distribute the executable or integrate it with the app.
Process isolation alone does not settle whether a future combined or hosted integration meets AGPL requirements.

The declared gates require 12 human-reviewed venue inventories, 95 percent precision, and 10 percent gains in recall and verified price yield.
They also require latency and cost ratios at or below 1.5, a repeated run, an access audit, and a licence decision.
The current gate results are in \`comparison.json\`. At least one gate is false or unknown.
Reject integration now. Keep A as the benchmark baseline and use the review packet to resolve the remaining evidence.

## Reproduce and inspect

The [benchmark instructions](../../README.md) provide the installation, CLI checks, live run, and offline evaluation commands.
The [input manifest](../../manifest.json), [protocol](../../protocol.json), and [rubric](../../RUBRIC.md) define the experiment.
The response archive remains private at \`${run}\`.
The committed request, page, and access-event files preserve URLs, crawl paths, read times, and response hashes.
The exact crawler source hashes appear in \`run.json\`.
The recorded run started at ${meta.startedAt} and finished at ${meta.finishedAt}.
The recorded base head is \`${meta.codeHead}\`. The harness file hashes identify the run's exact source bytes.

Calibration runs exposed the native post-budget timing problem and are excluded from this comparison.
They consumed additional permitted reads under separate per-run caps. Their latency is not mixed into this run.
No production crawl, ingestion, migration, application build, or deployment ran as part of this benchmark.
`;
writeFileSync(resolve(out, 'REPORT.md'), markdown);
console.log(JSON.stringify({ out, arms: results.length, requestAttempts: audit.requests }));
