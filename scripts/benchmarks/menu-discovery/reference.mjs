import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transport, canonical, sha256 } from './transport.mjs';
import { loadResults } from './evaluate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [runInput, targetsInput] = process.argv.slice(2);
if (!runInput || !targetsInput) throw new Error('Usage: node reference.mjs RUN_DIRECTORY REVIEW_TARGETS.json');
const run = resolve(runInput);
const meta = JSON.parse(readFileSync(resolve(run, 'run.json')));
if (!meta.finishedAt) throw new Error('Finish the benchmark before separate reference fetches. Shared hosts need one rate-limit owner.');
const manifest = JSON.parse(readFileSync(resolve(here, 'manifest.json')));
const protocol = JSON.parse(readFileSync(resolve(here, 'protocol.json')));
const targets = JSON.parse(readFileSync(resolve(targetsInput))).targets;
const results = loadResults(run);
const clocks = new Map();
const summaries = [];
for (const venueId of [...new Set(targets.map((r) => r.venueId))]) {
  const venue = manifest.venues.find((v) => v.venueId === venueId);
  if (!venue) throw new Error(`Unknown reference venue ${venueId}`);
  const out = resolve(run, 'reference', venueId.replace('/', '-'));
  if (existsSync(out)) throw new Error(`Reference evidence already exists. Preserve it and do not retry its refusals: ${out}`);
  mkdirSync(out, { recursive: true });
  const transport = new Transport({ venue, arm: 'REFERENCE', out, protocol: { ...protocol, requestBudgetPerArmPerVenue: 40 }, clocks });
  const start = performance.now();
  await transport.fetch(venue.website);
  for (const target of targets.filter((r) => r.venueId === venueId)) {
    const captured = results.flatMap((r) => r.venueId === venueId ? r.pages : []).find((p) => p.url === target.sourceUrl && p.status === 200);
    if (!captured) throw new Error(`Reference source was not captured: ${target.sourceUrl}`);
    const source = await transport.fetch(target.sourceUrl);
    if (!source || source.status !== 200) continue;
    const parsed = transport.parse(readFileSync(resolve(out, source.bodyFile)).toString('utf8'), source.url);
    const link = parsed.links.find((l) => canonical(l.url) === canonical(target.url));
    if (!link) { transport.event(target.url, 'reference-link-no-longer-present'); continue; }
    if (!transport.keywords.test(link.anchor + ' ' + link.url) && target.reviewedMenuLink !== true) {
      throw new Error(`Reference needs an explicit reviewed menu link: ${target.url}`);
    }
    transport.documentGrants.add(canonical(target.url));
    transport.paths.set(canonical(target.url), [...source.path, canonical(target.url)]);
    await transport.fetch(target.url);
  }
  const summary = { venueId, arm: 'REFERENCE', note: 'Separate manual-review evidence. Exclude all requests, pages, and latency from arms A and B.',
    budget: 40, networkRequests: transport.used, wallSeconds: (performance.now() - start) / 1000,
    requests: transport.requests, pages: transport.pages, events: transport.events };
  writeFileSync(resolve(out, 'result.json'), `${JSON.stringify(summary, null, 2)}\n`);
  summaries.push({ venueId, networkRequests: transport.used, wallSeconds: summary.wallSeconds });
  console.log(JSON.stringify(summaries.at(-1)));
}
writeFileSync(resolve(run, 'reference-summary.json'), `${JSON.stringify(summaries, null, 2)}\n`);

writeFileSync(resolve(run, 'reference-origin.json'), `${JSON.stringify({
  sourceArchiveId: basename(run), crawlBaseCodeHead: meta.codeHead,
  transportSha256: sha256(readFileSync(resolve(here, 'transport.mjs'))),
  scope: 'Separate official-link reference requests, excluded from both paired arms.',
  requestsCount: summaries.reduce((n, r) => n + r.networkRequests, 0),
  timingNote: 'The reference reader retains observed host delays across venues and applies them after response completion.',
}, null, 2)}\n`);
