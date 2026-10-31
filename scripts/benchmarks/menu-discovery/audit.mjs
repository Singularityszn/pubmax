import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadResults } from './evaluate.mjs';
import { canonical, sha256 } from './transport.mjs';
import { isHarvestableOperatorUrl } from '../../../lib/harvest/sourcePolicy.ts';

const here = dirname(fileURLToPath(import.meta.url));
const run = resolve(process.argv[2]);
const manifest = JSON.parse(readFileSync(resolve(here, 'manifest.json')));
const meta = JSON.parse(readFileSync(resolve(run, 'run.json')));
const results = loadResults(run);
const accessReview = JSON.parse(readFileSync(resolve(here, 'access-review.json')));
const failures = [];
const check = (name, fn) => { try { fn(); } catch (error) { failures.push({ name, detail: error.message }); } };
check('complete paired cohort', () => {
  assert.equal(results.length, 120);
  assert.equal(meta.completeCohort, true);
  assert.equal(meta.failures.length, 0);
  for (const venue of manifest.venues) assert.deepEqual(results.filter((r) => r.venueId === venue.venueId).map((r) => r.arm).sort(), ['A', 'B']);
});
check('input and protocol hashes', () => {
  assert.equal(sha256(readFileSync(resolve(here, 'manifest.json'))), meta.manifestSha256);
  assert.equal(sha256(readFileSync(resolve(here, 'protocol.json'))), manifest.protocolSha256);
});
for (const [name, hash] of Object.entries(meta.harnessFiles)) check(`crawler file ${name}`, () => {
  assert.equal(sha256(readFileSync(resolve(here, name))), hash);
});
for (const arm of results) {
  const name = `${arm.venueId}/${arm.arm}`;
  const venue = manifest.venues.find((r) => r.venueId === arm.venueId);
  check(`${name} request cap`, () => {
    assert.equal(arm.budget, meta.protocol.requestBudgetPerArmPerVenue);
    assert.equal(arm.requests.length, arm.networkRequests);
    assert.ok(arm.networkRequests <= arm.budget);
    assert.deepEqual(arm.requests.map((r) => r.sequence), Array.from({ length: arm.networkRequests }, (_, i) => i + 1));
  });
  check(`${name} native termination`, () => {
    if (arm.arm !== 'B') return;
    const noContent = !arm.pages.some((p) => p.status === 200);
    const refused = arm.events.some((e) => /refused|unreadable|challenge|fetch-failed/.test(e.reason))
      || arm.requests.some((r) => r.error || r.status >= 400);
    assert.ok(arm.exitCode === 0 || (arm.budgetStopped && arm.exitSignal === 'SIGINT') || (arm.exitCode === 1 && noContent && refused));
    assert.ok(!arm.events.some((r) => r.reason === 'native-venue-timeout' || r.reason === 'gateway-error'));
    const records = readFileSync(resolve(run, arm.venueId.replace('/', '-'), arm.arm, 'native-audit.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    for (const record of records) {
      assert.equal(new URL(record.url).hostname, '127.0.0.1');
      assert.equal(record.engine, 'http');
      assert.equal(record.version, '0.81.0');
    }
  });
  check(`${name} no request after a terms refusal`, () => {
    for (const event of arm.events.filter((r) => r.reason === 'terms-restrict-automation')) {
      assert.ok(arm.requests.every((r) => Date.parse(r.at) < Date.parse(event.at)));
    }
  });
  for (const request of arm.requests) check(`${name} ${request.sequence} source and body`, () => {
    assert.ok(isHarvestableOperatorUrl(request.url));
    const host = new URL(request.url).hostname.replace(/^www\./, '');
    assert.ok(!accessReview.blockedHosts.some((row) => host === row.host || host.endsWith(`.${row.host}`)));
    if (request.bodyFile) {
      const body = readFileSync(resolve(run, arm.venueId.replace('/', '-'), arm.arm, request.bodyFile));
      assert.equal(sha256(body), request.bodySha256);
      assert.equal(body.length, request.bytes);
      assert.ok(body.length <= meta.protocol.maxResponseBytes);
      if (request.kind === 'robots') assert.ok(body.length <= 512 * 1024, 'Recorded robots body exceeded the repository checker limit');
    }
  });
  for (const page of arm.pages) check(`${name} page provenance ${page.url}`, () => {
    assert.equal(page.path[0], canonical(venue.website));
    assert.equal(page.path.at(-1), page.url);
    if (page.sourceUrl) assert.ok(page.path.includes(page.sourceUrl));
    assert.ok(arm.requests.some((r) => r.url === page.url && r.bodySha256 === page.bodySha256));
    for (let i = 1; i < page.path.length; i++) {
      const from = page.path[i - 1];
      const to = page.path[i];
      const link = arm.pages.some((p) => p.url === from && (p.links.some((l) => l.url === to) || p.termsLinks?.includes(to)));
      const redirect = arm.requests.some((r) => r.url === from && r.location && canonical(new URL(r.location, from).href) === to);
      assert.ok(link || redirect, `Unexplained path edge: ${from} -> ${to}`);
    }
  });
}
const requests = results.flatMap((arm) => arm.requests.map((r) => ({ ...r, arm: arm.arm, venueId: arm.venueId })));
const byHost = new Map();
for (const request of requests) {
  const host = new URL(request.url).host;
  byHost.set(host, [...(byHost.get(host) ?? []), request]);
}
for (const [host, rows] of byHost) check(`shared rate limit ${host}`, () => {
  rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (let i = 1; i < rows.length; i++) {
    assert.ok(Date.parse(rows[i].at) - Date.parse(rows[i - 1].at) >= meta.protocol.minIntervalMs - 10,
      `Requests started too close: ${rows[i - 1].at}, ${rows[i].at}`);
  }
});
const audit = { schemaVersion: 1, passed: failures.length === 0, arms: results.length, requests: requests.length,
  checkedAt: new Date().toISOString(), failures,
  scope: 'Recorded request caps, source policy, body hashes, observed robots body limits, provenance edges, native termination, shared minimum host spacing, and input/code hashes. This does not establish human gold approval or legal permission beyond the recorded checks.' };
writeFileSync(resolve(run, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit));
if (failures.length) process.exitCode = 1;
