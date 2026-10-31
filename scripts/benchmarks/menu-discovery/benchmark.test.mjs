import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { coordinateHosts } from './transport.mjs';

const here = dirname(fileURLToPath(import.meta.url));
function fixture(budget, scenario = 'normal') {
  const out = mkdtempSync(join(tmpdir(), 'pubmax-menu-benchmark-check-'));
  try {
    execFileSync(process.execPath, [join(here, 'run.mjs'), 'fixture', '--out', out, '--budget', String(budget), '--scenario', scenario], {
      env: process.env, timeout: 60000, stdio: 'pipe',
    });
    return JSON.parse(readFileSync(join(out, 'fixture-check.json')));
  } finally { rmSync(out, { recursive: true, force: true }); }
}

test('the CLI enforces one total request cap including robots and redirects', () => {
  const result = fixture(3);
  for (const arm of result.arms) {
    assert.ok(arm.networkRequests <= 3);
    assert.equal(arm.requests.filter((r) => r.kind === 'robots').length, 1);
    assert.equal(arm.budget, 3);
  }
  assert.equal(result.forbiddenHits, 0);
  assert.equal(result.arms.find((r) => r.arm === 'B').budgetStopped, true);
  assert.ok(result.arms.every((r) => r.wallSeconds < 3), 'The exhausted budget must stop native work promptly');
});

test('the CLI refuses unsafe sources and unreadable robots before page requests', () => {
  for (const arm of fixture(9, 'source-refused').arms) {
    assert.equal(arm.networkRequests, 0);
    assert.equal(arm.pages.length, 0);
    assert.ok(arm.events.some((e) => e.reason === 'source-policy-refused'));
  }
  for (const arm of fixture(9, 'robots-refused').arms) {
    assert.equal(arm.networkRequests, 1);
    assert.equal(arm.pages.length, 0);
    assert.ok(arm.events.some((e) => e.reason === 'robots-unreadable'));
  }
});

test('the CLI checks a redirect target before any request reaches it', () => {
  for (const arm of fixture(9, 'redirect-refused').arms) {
    assert.equal(arm.requests.filter((r) => r.status === 302).length, 1);
    assert.ok(arm.requests.every((r) => !r.url.includes('169.254.169.254')));
    assert.ok(arm.events.some((e) => e.reason === 'source-policy-refused'));
  }
});

test('the CLI stops after terms explicitly say shall not scrape', () => {
  for (const arm of fixture(9, 'terms-refused').arms) {
    assert.equal(arm.networkRequests, 3);
    assert.ok(arm.events.some((e) => e.reason === 'terms-restrict-automation'));
    assert.ok(arm.requests.every((r) => !r.url.endsWith('/old-menu') && !r.url.endsWith('/food-menu')));
    assert.ok(arm.wallSeconds < 3);
  }
});

test('the CLI handles a large menu body without waiting for pipe input to close', () => {
  for (const arm of fixture(9, 'large-page').arms) {
    const menu = arm.pages.find((p) => p.url.endsWith('/large-menu'));
    assert.ok(menu?.text.includes('Vegetable soup £6.50'));
    assert.ok(menu.bytes > 1000000);
    assert.ok(arm.wallSeconds < 10);
  }
});

test('the CLI retains source paths and refuses blocked URLs before requesting them', () => {
  const result = fixture(9);
  for (const arm of result.arms) {
    const menu = arm.pages.find((p) => p.url.endsWith('/food-menu'));
    assert.ok(menu, `${arm.arm} must reach the menu`);
    assert.ok(menu.path.length >= 2);
    assert.ok(menu.sourceUrl.endsWith('/'));
    assert.equal(menu.status, 200);
    assert.ok(arm.requests.some((r) => r.status === 302));
    assert.ok(arm.events.some((r) => r.reason === 'robots-disallowed'));
    assert.ok(arm.events.some((r) => r.reason === 'challenge-page'));
  }
  assert.equal(result.forbiddenHits, 0);
});

test('the CLI evaluates literal gold labels without turning pending reviews into false positives', () => {
  const result = fixture(9);
  for (const arm of result.evaluation) {
    assert.equal(arm.truePositives, 1);
    assert.equal(arm.falsePositives, 1);
    assert.equal(arm.falseNegatives, 1);
    assert.equal(arm.precision, 0.5);
    assert.equal(arm.recall, 0.5);
    assert.equal(arm.verifiedPriceRecords, 1);
    assert.equal(arm.unjudgedCandidates, 1);
  }
});

test('the evaluation CLI does not transfer prices onto different downloaded menu bytes', () => {
  const captured = fixture(9);
  const out = mkdtempSync(join(tmpdir(), 'pubmax-menu-price-hash-'));
  try {
    for (const arm of captured.arms) {
      mkdirSync(join(out, 'fixture', arm.arm), { recursive: true });
      writeFileSync(join(out, 'fixture', arm.arm, 'result.json'), JSON.stringify(arm));
    }
    const page = captured.arms[0].pages.find((p) => p.url.endsWith('/food-menu'));
    const labels = { humanApproved: false, labels: [{ venueId: 'fixture', url: page.url, verdict: 'menu', format: 'html',
      reviewer: 'fixture-truth', evidence: 'Soup £6.50', officialEvidence: { sourceUrl: page.url },
      bodySha256: 'different-reviewed-document', priceRecords: [{ id: 'soup', item: 'Soup', amountGbp: 6.5, currency: 'GBP', evidence: 'Soup £6.50' }] }] };
    writeFileSync(join(out, 'labels.json'), JSON.stringify(labels));
    execFileSync(process.execPath, [join(here, 'evaluate.mjs'), out, join(out, 'labels.json')], { stdio: 'pipe' });
    const result = JSON.parse(readFileSync(join(out, 'comparison.json')));
    for (const arm of result.summary) {
      assert.equal(arm.verifiedPriceRecords, 0);
      assert.equal(arm.priceBodyMismatches.length, 1);
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('the native CLI waits for a permitted menu beyond its conservative twelve-second default', () => {
  for (const arm of fixture(9, 'slow-menu').arms) {
    assert.ok(arm.pages.some((p) => p.url.endsWith('/food-menu') && p.status === 200));
    assert.ok(!arm.events.some((e) => e.reason === 'native-venue-timeout'));
    if (arm.arm === 'B') assert.deepEqual(arm.nativeFetchErrors, []);
  }
});

test('the CLI retains a published host delay across both arms, including the next robots read', () => {
  const arms = fixture(9, 'published-delay').arms;
  const requests = arms.flatMap((r) => r.requests);
  for (let i = 1; i < requests.length; i++) {
    const previous = requests[i - 1];
    const current = requests[i];
    assert.ok(Date.parse(current.at) - Date.parse(previous.at) - previous.elapsedMs >= 90);
  }
});

test('the CLI stops exploration for unsuccessful, empty, or unparsed linked terms', () => {
  for (const scenario of ['terms-404', 'terms-empty', 'terms-pdf', 'terms-plain']) {
    for (const arm of fixture(9, scenario).arms) {
      assert.equal(arm.networkRequests, 3, scenario);
      assert.ok(arm.events.some((e) => e.reason === 'terms-unreadable'), scenario);
      assert.ok(arm.requests.every((r) => !r.url.endsWith('/old-menu') && !r.url.endsWith('/food-menu')), scenario);
    }
  }
  for (const arm of fixture(9, 'terms-readable').arms) {
    assert.ok(arm.events.some((e) => e.reason === 'terms-no-automation-bar-found'));
    assert.ok(arm.pages.some((p) => p.url.endsWith('/food-menu') && p.status === 200));
  }
});

test('the CLI retains published delays when robots disallows every page', () => {
  for (const scenario of ['delay-disallowed', 'rate-disallowed']) {
    const arms = fixture(9, scenario).arms;
    for (const arm of arms) {
      assert.equal(arm.networkRequests, 1);
      assert.equal(arm.pages.length, 0);
      assert.ok(arm.events.some((e) => e.reason === 'robots-disallowed'));
    }
    const before = arms[0].requests[0];
    const after = arms[1].requests[0];
    assert.ok(Date.parse(after.at) - Date.parse(before.at) - before.elapsedMs >= (scenario === 'delay-disallowed' ? 790 : 990));
  }
});

test('the shared host scheduler applies delay increases to workers already waiting', async () => {
  const queues = new Map();
  const completions = new Map([['menu-host', Date.now()]]);
  const delays = new Map();
  const workers = [new EventEmitter(), new EventEmitter()];
  const grants = [];
  for (const worker of workers) {
    worker.connected = true;
    worker.send = (message) => {
      grants.push({ id: message.id, at: Date.now() });
      worker.emit('message', { type: 'host-release', host: 'menu-host', id: message.id, minDelay: 150 });
    };
    coordinateHosts(worker, queues, completions, delays);
  }
  const began = Date.now();
  workers[0].emit('message', { type: 'host-acquire', host: 'menu-host', id: 1, minDelay: 40 });
  await new Promise((r) => setTimeout(r, 10));
  workers[1].emit('message', { type: 'host-acquire', host: 'menu-host', id: 2, minDelay: 150 });
  await queues.get('menu-host');
  assert.deepEqual(grants.map((g) => g.id), [1, 2]);
  assert.ok(grants[0].at - began >= 140);
  assert.ok(grants[1].at - grants[0].at >= 140);
});

test('the CLI reuses fetched destinations through multiple redirect aliases', () => {
  for (const arm of fixture(9, 'redirect-cache').arms) {
    assert.equal(arm.requests.filter((r) => r.url.endsWith('/food-menu')).length, 1);
    assert.equal(arm.pages.filter((p) => p.url.endsWith('/food-menu')).length, 1);
    assert.ok(arm.requests.some((r) => r.url.endsWith('/old-menu') && r.status === 302));
    assert.ok(arm.requests.some((r) => r.url.endsWith('/second-old-menu') && r.status === 302));
  }
});

function evaluationFixture(pages, labels, requests = []) {
  const out = mkdtempSync(join(tmpdir(), 'pubmax-menu-evaluation-'));
  mkdirSync(join(out, 'fixture/A'), { recursive: true });
  const arm = { venueId: 'fixture', arm: 'A', budget: 12, networkRequests: 4, wallSeconds: 1,
    nodeCpuSeconds: 0, nodePeakRssBytes: 0, pages, requests, events: [] };
  writeFileSync(join(out, 'fixture/A/result.json'), JSON.stringify(arm));
  writeFileSync(join(out, 'labels.json'), JSON.stringify({ humanApproved: false, labels }));
  try {
    execFileSync(process.execPath, [join(here, 'evaluate.mjs'), out, join(out, 'labels.json')], { stdio: 'pipe' });
    return JSON.parse(readFileSync(join(out, 'comparison.json')));
  } finally { rmSync(out, { recursive: true, force: true }); }
}

const reviewedMenu = (url) => ({ venueId: 'fixture', url, verdict: 'menu', format: 'html', relevant: true,
  reviewer: 'fixture-truth', evidence: 'A worked menu example', officialEvidence: { sourceUrl: url }, priceReviewComplete: true,
  bodySha256: 'menu-body', priceRecords: [{ id: 'soup', item: 'Soup', amountGbp: 6.5, currency: 'GBP', evidence: 'Soup £6.50' }] });

test('the evaluation CLI merges recorded aliases in labels, candidates, and emitted provenance', () => {
  const root = 'https://fixture.example/';
  const alias = root + 'menu';
  const final = root + 'menu/';
  const context = { url: root, status: 200, candidate: false, path: [root], links: [{ url: alias, keyword: true }, { url: final, keyword: true }] };
  const menu = { url: final, requestedUrl: alias, status: 200, candidate: true, path: [root, alias, final], sourceUrl: root, bodySha256: 'menu-body' };
  for (const labelUrl of [alias, final]) {
    const result = evaluationFixture([context, menu], [reviewedMenu(labelUrl)], [{ url: alias, status: 301, location: final, bytes: 0 }]).summary[0];
    assert.equal(result.candidates, 1);
    assert.equal(result.truePositives, 1);
    assert.equal(result.falseNegatives, 0);
    assert.equal(result.unjudgedCandidates, 0);
    assert.equal(result.verifiedUrls[0].url, final);
    assert.equal(result.verifiedUrls[0].fetched, true);
    assert.equal(result.verifiedUrls[0].path.at(-1), final);
  }
  const distinct = evaluationFixture([context], [reviewedMenu(final)]).summary[0];
  assert.equal(distinct.candidates, 2, 'A trailing slash alone does not establish alias identity');
});

test('the evaluation CLI keeps complete yield unknown until successful noncandidates receive review', () => {
  const url = 'https://fixture.example/menu';
  const contextUrl = 'https://fixture.example/context';
  const pages = [{ url, status: 200, candidate: true, bodySha256: 'menu-body' }, { url: contextUrl, status: 200, candidate: false }];
  const labels = [reviewedMenu(url)];
  let result = evaluationFixture(pages, labels);
  assert.equal(result.summary[0].verifiedPriceRecordsPer100Requests, null);
  assert.equal(result.summary[0].verifiedPriceRecordsPer100RequestsLowerBound, 25);
  assert.equal(result.summary[0].relevantPagesPer100Requests, null);
  labels.push({ venueId: 'fixture', url: contextUrl, verdict: 'unresolved', reviewer: 'fixture-truth', evidence: 'Review pending' });
  assert.equal(evaluationFixture(pages, labels).summary[0].verifiedPriceRecordsPer100Requests, null);
  labels[1] = { ...labels[1], verdict: 'not-menu', relevant: false };
  result = evaluationFixture(pages, labels);
  assert.equal(result.summary[0].verifiedPriceRecordsPer100Requests, 25);
  assert.equal(result.summary[0].relevantPagesPer100Requests, 25);
});

test('the live CLI rejects partial-cohort options before opening a crawl', () => {
  for (const option of [['--venues', '1'], ['--venues=1']]) {
    const result = spawnSync(process.execPath, [join(here, 'run.mjs'), 'live', ...option], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Live runs require the full frozen 60-site manifest/);
  }
});

test('the review CLI resolves alias leads and retains documents for offline inspection', () => {
  const out = mkdtempSync(join(tmpdir(), 'pubmax-menu-review-'));
  const venue = JSON.parse(readFileSync(join(here, 'manifest.json'))).venues[0];
  const root = venue.website;
  const alias = new URL('/food-menu', root).href;
  const final = new URL('/food-menu/', root).href;
  const body = Buffer.from('%PDF-1.4 retained fixture document');
  const pages = [
    { url: root, status: 200, format: 'html', text: 'Fixture pub', path: [root], links: [{ url: alias, keyword: true }, { url: final, keyword: true }] },
    { url: final, requestedUrl: alias, status: 200, format: 'pdf', text: '', path: [root, alias, final],
      links: [], bodySha256: 'fixture-pdf', bodyFile: 'bodies/document.bin' },
  ];
  const directory = join(out, venue.venueId.replace('/', '-'), 'A');
  mkdirSync(join(directory, 'bodies'), { recursive: true });
  writeFileSync(join(directory, 'bodies/document.bin'), body);
  writeFileSync(join(directory, 'result.json'), JSON.stringify({ venueId: venue.venueId, arm: 'A', pages, requests: [], events: [] }));
  try {
    execFileSync(process.execPath, [join(here, 'review.mjs'), out], { stdio: 'pipe' });
    const packet = JSON.parse(readFileSync(join(out, 'review-packet.json')));
    assert.equal(packet.humanApproved, false);
    assert.equal(packet.pages.length, 2);
    assert.deepEqual(packet.uncrawledMenuLeads, []);
    const pdf = packet.pages.find((p) => p.format === 'pdf');
    assert.equal(pdf.url, final);
    assert.deepEqual(readFileSync(join(out, 'review', pdf.retainedPdf)), body);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
