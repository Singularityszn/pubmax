import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { canonical, coordinateHosts, sha256, Transport } from './transport.mjs';
import { createServer } from 'node:http';
import { urlIdentity } from './evaluate.mjs';
import { createContext, runInContext } from 'node:vm';

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
    const lead = new URL('/missing-menu', root).href;
    const destination = new URL('/missing-menu/', root).href;
    pages[0].links.push({ url: lead, keyword: true });
    writeFileSync(join(directory, 'result.json'), JSON.stringify({ venueId: venue.venueId, arm: 'A', pages,
      requests: [{ url: lead, status: 301, location: destination }], events: [] }));
    execFileSync(process.execPath, [join(here, 'review.mjs'), out], { stdio: 'pipe' });
    const revised = JSON.parse(readFileSync(join(out, 'review-packet.json')));
    assert.equal(revised.uncrawledMenuLeads.length, 1);
    assert.equal(revised.uncrawledMenuLeads[0].url, destination);
    assert.deepEqual(revised.uncrawledMenuLeads[0].path, [root, lead, destination]);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

async function transportFixture(routes, check) {
  const out = mkdtempSync(join(tmpdir(), 'pubmax-menu-transport-'));
  const hits = [];
  const server = createServer((request, response) => {
    hits.push(request.url);
    const [status, body, headers = {}] = routes[request.url] ?? [404, 'Missing'];
    response.writeHead(status, { 'content-type': 'text/html', ...headers }).end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const protocol = { ...JSON.parse(readFileSync(join(here, 'protocol.json'))), minIntervalMs: 0, timeoutMs: 3000 };
  const clocks = new Map();
  const make = () => new Transport({ venue: { website: origin + '/', postcode: 'SW1A 1AA' }, protocol,
    arm: 'FIXTURE', out, clocks, fixtureOrigin: origin });
  try { await check(make, origin, hits); }
  finally { await new Promise((r) => server.close(r)); rmSync(out, { recursive: true, force: true }); }
}

const robotsRoute = [200, 'User-agent: *\nAllow: /\n', { 'content-type': 'text/plain' }];

test('malformed page redirects retain both transport ledgers and allow later fetches', async () => {
  await transportFixture({ '/robots.txt': robotsRoute,
    '/bad': [302, '', { location: 'http://[' }],
    '/menu.pdf': [200, '%PDF-1.4', { 'content-type': 'application/pdf' }],
  }, async (make, origin, hits) => {
    for (const arm of ['A', 'B']) {
      const transport = make();
      transport.arm = arm;
      assert.equal(await transport.fetch(origin + '/bad'), null);
      assert.equal(await transport.fetch(origin + '/bad'), null);
      assert.equal(transport.requests.length, 2);
      assert.equal(transport.requests[1].status, 302);
      assert.equal(transport.requests[1].location, 'http://[');
      assert.ok(transport.requests[1].bodySha256);
      assert.ok(transport.events.some((e) => e.url === origin + '/bad' && e.reason === 'invalid-redirect'));
      assert.equal((await transport.fetch(origin + '/menu.pdf')).status, 200);
    }
    assert.deepEqual(hits, ['/robots.txt', '/bad', '/menu.pdf', '/robots.txt', '/bad', '/menu.pdf']);
  });
});

test('malformed robots redirects retain both transport ledgers and refuse page reads', async () => {
  await transportFixture({ '/robots.txt': [302, '', { location: 'http://[' }] }, async (make, origin, hits) => {
    for (const arm of ['A', 'B']) {
      const transport = make();
      transport.arm = arm;
      assert.equal(await transport.fetch(origin + '/'), null);
      assert.equal(await transport.fetch(origin + '/menu'), null);
      assert.equal(transport.requests.length, 1);
      assert.equal(transport.requests[0].location, 'http://[');
      assert.equal(transport.requests[0].kind, 'robots');
      assert.ok(transport.events.some((e) => e.url === origin + '/robots.txt' && e.reason === 'invalid-redirect'));
      assert.ok(transport.events.some((e) => e.reason === 'robots-unreadable'));
    }
    assert.deepEqual(hits, ['/robots.txt', '/robots.txt']);
  });
});

test('the evaluation CLI ignores malformed recorded aliases and retains valid aliases', () => {
  const root = 'https://fixture.example/';
  const alias = root + 'menu';
  const final = root + 'menu.pdf';
  const page = { url: final, status: 200, candidate: true, path: [root, alias, final],
    sourceUrl: root, bodySha256: 'menu-body' };
  const requests = [{ url: root, status: 302, location: 'http://[' },
    { url: alias, status: 302, location: '/menu.pdf' }];
  const result = evaluationFixture([page], [reviewedMenu(alias)], requests).summary[0];
  assert.equal(result.truePositives, 1);
  assert.equal(result.falseNegatives, 0);
  assert.equal(result.verifiedUrls[0].url, final);
  assert.equal(urlIdentity([{ venueId: 'fixture', pages: [page], requests }])('fixture', root), root);
});

test('the audit CLI ignores malformed provenance targets without hiding valid or missing edges', () => {
  const out = mkdtempSync(join(tmpdir(), 'pubmax-menu-redirect-audit-'));
  const manifestBytes = readFileSync(join(here, 'manifest.json'));
  const venue = JSON.parse(manifestBytes).venues[0];
  const root = canonical(venue.website);
  const valid = new URL('menu.pdf', root).href;
  const missing = new URL('missing.pdf', root).href;
  const protocol = JSON.parse(readFileSync(join(here, 'protocol.json')));
  const requests = [
    { url: root, status: 302, location: 'http://[' },
    { url: root, status: 302, location: valid },
    { url: valid, status: 200, bodySha256: 'valid-body' },
    { url: missing, status: 200, bodySha256: 'missing-body' },
  ].map((row, i) => ({ ...row, sequence: i + 1, at: new Date(i * 10000).toISOString(), elapsedMs: 0, bytes: 0 }));
  const pages = [valid, missing].map((url, i) => ({ url, sourceUrl: root, path: [root, url],
    bodySha256: i ? 'missing-body' : 'valid-body', links: [] }));
  try {
    mkdirSync(join(out, 'venue/A'), { recursive: true });
    writeFileSync(join(out, 'venue/A/result.json'), JSON.stringify({ venueId: venue.venueId, arm: 'A',
      budget: 12, networkRequests: requests.length, requests, pages, events: [] }));
    writeFileSync(join(out, 'run.json'), JSON.stringify({ completeCohort: false, failures: [],
      manifestSha256: sha256(manifestBytes), harnessFiles: {}, protocol, codeHead: 'synthetic-fixture' }));
    const result = spawnSync(process.execPath, [join(here, 'audit.mjs'), out], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    const audit = JSON.parse(readFileSync(join(out, 'audit.json')));
    const provenance = audit.failures.filter((f) => f.name.includes('page provenance'));
    assert.equal(provenance.length, 1);
    assert.ok(provenance[0].name.endsWith(missing));
    assert.equal(provenance[0].detail, `Unexplained path edge: ${root} -> ${missing}`);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('offline fixes retain all page redirect aliases and stop redirect loops', async () => {
  await transportFixture({ '/robots.txt': robotsRoute, '/': [200, '<html>Pub</html>'],
    '/old': [302, '', { location: '/middle' }], '/middle': [302, '', { location: '/menu' }],
    '/menu': [200, '<html><h1>Menu</h1>Soup £6.50</html>'],
    '/loop-a': [302, '', { location: '/loop-b' }], '/loop-b': [302, '', { location: '/loop-a' }],
    '/self': [302, '', { location: '/self' }],
  }, async (make, origin, hits) => {
    const transport = make();
    const page = await transport.fetch(origin + '/old');
    assert.equal(page.url, origin + '/menu');
    const before = hits.length;
    assert.equal(await transport.fetch(origin + '/middle'), page);
    assert.equal(await transport.fetch(origin + '/menu'), page);
    assert.equal(hits.length, before);
    assert.equal(await transport.fetch(origin + '/loop-a'), null);
    assert.equal(await transport.fetch(origin + '/loop-b'), null);
    assert.equal(await transport.fetch(origin + '/self'), null);
    assert.equal(await transport.fetch(origin + '/self'), null);
    for (const path of ['/old', '/middle', '/menu', '/loop-a', '/loop-b', '/self']) {
      assert.equal(hits.filter((url) => url === path).length, 1, path);
    }
  });
});

test('offline fixes stop self and multi-hop robots loops without page reads', async () => {
  for (const target of ['/robots.txt', '/robots-next']) {
    await transportFixture({ '/robots.txt': [302, '', { location: target }],
      '/robots-next': [302, '', { location: '/robots.txt' }],
    }, async (make, origin, hits) => {
      const transport = make();
      assert.equal(await transport.fetch(origin + '/'), null);
      assert.equal(await transport.fetch(origin + '/menu'), null);
      assert.deepEqual(hits, target === '/robots.txt' ? ['/robots.txt'] : ['/robots.txt', '/robots-next']);
    });
  }
});

test('offline fixes keep redirect-cycle identity independent of its starting alias', () => {
  const a = 'https://fixture.example/a';
  const b = 'https://fixture.example/b';
  const identity = urlIdentity([{ venueId: 'fixture', pages: [], requests: [
    { url: a, status: 302, location: b }, { url: b, status: 302, location: a },
  ] }]);
  assert.equal(identity('fixture', a), identity('fixture', b));
  assert.equal(identity('other', b), b);
});

test('offline fixes preserve the terms refusal and robots-delay boundaries', async () => {
  for (const terms of [[404, '<html>Missing</html>'], [200, '<html></html>'],
    [200, '%PDF-1.4', { 'content-type': 'application/pdf' }], [200, 'Terms', { 'content-type': 'text/plain' }],
    [200, '<html>You shall not scrape this site.</html>'], [200, '<html>Ordinary terms of use.</html>']]) {
    await transportFixture({ '/robots.txt': robotsRoute,
      '/': [200, '<html><a href="/terms">Terms</a><a href="/menu">Menu</a></html>'],
      '/terms': terms, '/menu': [200, '<html>Menu</html>'],
    }, async (make, origin, hits) => {
      const transport = make();
      await transport.fetch(origin + '/');
      const page = await transport.fetch(origin + '/menu');
      const readable = terms[1].includes('Ordinary terms');
      assert.equal(Boolean(page), readable);
      assert.equal(hits.includes('/menu'), readable);
    });
  }
  await transportFixture({ '/robots.txt': [200, 'User-agent: *\nDisallow: /\nCrawl-delay: 0.1\n', { 'content-type': 'text/plain' }] },
    async (make, origin) => {
      const first = make();
      const second = make();
      assert.equal(await first.fetch(origin + '/'), null);
      assert.equal(await second.fetch(origin + '/'), null);
      assert.ok(Date.parse(second.requests[0].at) - Date.parse(first.requests[0].at) - first.requests[0].elapsedMs >= 90);
    });
});

function offlineExportFixture(check) {
  const out = mkdtempSync(join(tmpdir(), 'pubmax-menu-export-'));
  const put = (name, value) => writeFileSync(join(out, name), JSON.stringify(value));
  const protocol = JSON.parse(readFileSync(join(here, 'protocol.json')));
  const venues = JSON.parse(readFileSync(join(here, 'manifest.json'))).venues;
  const venueId = venues[0].venueId;
  const url = 'https://fixture.example/menu';
  const label = { ...reviewedMenu(url), venueId };
  try {
    for (const venue of venues) for (const arm of ['A', 'B']) {
      const directory = join(venue.venueId.replace('/', '-'), arm);
      mkdirSync(join(out, directory), { recursive: true });
      put(directory + '/result.json', { venueId: venue.venueId, arm, budget: 12, networkRequests: 0,
        wallSeconds: 0, nodeCpuSeconds: 0, nodePeakRssBytes: 0, requests: [], events: [],
        pages: venue.venueId === venueId ? [{ url, status: 200, bodySha256: 'menu-body',
          text: '', headings: '', links: [], candidate: true }] : [] });
      writeFileSync(join(out, directory, 'native-audit.jsonl'), '');
    }
    put('run.json', { finishedAt: '2026-10-31T00:00:00Z', protocol, wallSeconds: 0 });
    put('audit.json', { passed: true, requests: 0, historicalAccessReview: { unreadableTermsAccepted: [], hostDelayViolations: [] } });
    put('sensitivity.json', {});
    put('extracted-pdfs.json', { wallSeconds: 0 });
    const annotations = { humanApproved: false, primaryGoldVenueIds: [], labels: [label] };
    const cli = (file, ...args) => execFileSync(process.execPath, [join(here, file), ...args], { stdio: 'pipe' });
    check({ out, put, annotations, label, cli });
  } finally { rmSync(out, { recursive: true, force: true }); }
}

test('offline fixes bind exports to external evaluated labels and reject changed snapshots', () => {
  offlineExportFixture(({ out, put, annotations, cli }) => {
    put('annotations.json', { ...annotations, labels: [] });
    put('external.json', annotations);
    cli('evaluate.mjs', out, join(out, 'external.json'));
    put('external.json', { ...annotations, labels: [] });
    for (const localLabels of ['stale', 'absent']) {
      if (localLabels === 'absent') rmSync(join(out, 'annotations.json'));
      const exported = join(out, 'export-' + localLabels);
      cli('export.mjs', out, exported);
      assert.deepEqual(JSON.parse(readFileSync(join(exported, 'annotations.json'))), annotations);
      assert.equal(readFileSync(join(exported, 'price-records.jsonl'), 'utf8').trim().split('\n').length, 1);
    }
    put('evaluated-annotations.json', { ...annotations, labels: [] });
    assert.throws(() => cli('export.mjs', out, join(out, 'tampered')), /snapshot/i);
  });
});

test('offline fixes export prices only from conclusive menu labels', () => {
  offlineExportFixture(({ out, put, annotations, label, cli }) => {
    annotations.labels.push({ ...label, url: label.url + '-rejected', verdict: 'not-menu' },
      { ...label, url: label.url + '-pending', verdict: 'unresolved' });
    put('annotations.json', annotations);
    cli('evaluate.mjs', out, join(out, 'annotations.json'));
    cli('export.mjs', out, join(out, 'export'));
    const prices = readFileSync(join(out, 'export/price-records.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(prices.map((p) => p.menuUrl), [label.url]);
  });
});

test('offline fixes refuse every existing reference stage before reading targets', () => {
  for (const existing of ['reference', 'reference-summary.json', 'reference-origin.json']) {
    const out = mkdtempSync(join(tmpdir(), 'pubmax-menu-reference-'));
    try {
      writeFileSync(join(out, 'run.json'), JSON.stringify({ finishedAt: '2026-10-31T00:00:00Z' }));
      writeFileSync(join(out, 'targets.json'), JSON.stringify({ targets: [] }));
      if (existing === 'reference') mkdirSync(join(out, existing));
      else writeFileSync(join(out, existing), 'retained evidence');
      const result = spawnSync(process.execPath, [join(here, 'reference.mjs'), out, join(out, 'targets.json')], { encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Reference evidence already exists/);
      if (existing !== 'reference') assert.equal(readFileSync(join(out, existing), 'utf8'), 'retained evidence');
    } finally { rmSync(out, { recursive: true, force: true }); }
  }
});

test('offline fixes reproduce the retained compact comparison without network access', () => {
  const out = mkdtempSync(join(tmpdir(), 'pubmax-menu-compact-'));
  const retained = join(here, 'results/2026-10-31');
  try {
    for (const name of ['venue-results.jsonl', 'pages.jsonl', 'requests.jsonl', 'access-events.jsonl', 'annotations.json']) {
      copyFileSync(join(retained, name), join(out, name));
    }
    execFileSync(process.execPath, [join(here, 'evaluate.mjs'), out, join(out, 'annotations.json')], { stdio: 'pipe' });
    assert.deepEqual(readFileSync(join(out, 'comparison.json')), readFileSync(join(retained, 'comparison.json')));
    const comparison = JSON.parse(readFileSync(join(out, 'comparison.json')));
    assert.equal(comparison.recommendation, 'REJECT_PRODUCTION_ADOPTION_PENDING_EVIDENCE');
    assert.equal(comparison.humanApproved, false);
    assert.ok(comparison.summary.every((arm) => arm.verifiedPriceRecordsPer100Requests === null));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

function captureReviewFixture(check) {
  const out = mkdtempSync(join(tmpdir(), 'pubmax-menu-capture-review-'));
  const venue = JSON.parse(readFileSync(join(here, 'manifest.json'))).venues[0];
  const url = new URL('/menu', venue.website).href;
  const page = (arm) => ({ url, status: 200, format: 'html', bodySha256: arm + '-body',
    text: arm + ' menu Soup £6.50', sourceUrl: new URL('/' + arm, venue.website).href,
    path: [venue.website, new URL('/' + arm, venue.website).href, url], links: [], candidate: true });
  const label = { venueId: venue.venueId, url, bodySha256: 'A-body', verdict: 'menu', relevant: true,
    format: 'pdf', sourceUrl: 'https://stale.example/', path: ['https://stale.example/'],
    reviewer: 'Fixture reviewer', evidence: 'A menu evidence', officialEvidence: { binding: 'A address' },
    priceReviewComplete: true, priceRecords: [{ id: 'soup', item: 'Soup', amountGbp: 6.5 }] };
  const generate = (arms, imported = label) => {
    for (const arm of ['A', 'B']) {
      const directory = join(out, venue.venueId.replace('/', '-'), arm);
      rmSync(directory, { recursive: true, force: true });
      if (!arms.includes(arm)) continue;
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'result.json'), JSON.stringify({ venueId: venue.venueId, arm,
        pages: [page(arm)], requests: [], events: [] }));
    }
    writeFileSync(join(out, 'annotations.json'), JSON.stringify({ humanApproved: false, labels: [imported] }));
    execFileSync(process.execPath, [join(here, 'review.mjs'), out], { stdio: 'pipe' });
    return { packet: JSON.parse(readFileSync(join(out, 'review-packet.json'))),
      html: readFileSync(join(out, 'review/index.html'), 'utf8') };
  };
  try { return check({ generate, label, page }); }
  finally { rmSync(out, { recursive: true, force: true }); }
}

function openGeneratedReview(html, drafts = {}) {
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  const elements = new Map(scripts.filter(([, attrs]) => attrs.includes('application/json'))
    .map(([, attrs, textContent]) => [attrs.match(/id="([^"]+)"/)[1], { textContent }]));
  const fields = { verdict: { value: 'menu' }, reviewer: { value: 'New reviewer' },
    evidence: { value: 'B address and menu' }, complete: { checked: true },
    prices: { value: '[{"id":"b-soup","item":"B soup","amountGbp":7}]', setCustomValidity() {} } };
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { value: id === 'scope' ? 'all' : '',
        addEventListener() {}, querySelector: (selector) => fields[selector.match(/name=(\w+)/)[1]] });
      return elements.get(id);
    },
    createElement: () => ({ click() {} }),
  };
  const data = JSON.parse(elements.get('data').textContent);
  const cacheKey = 'pubmax-menu-review-' + data.generatedFrom;
  const storage = new Map([[cacheKey, JSON.stringify(drafts)]]);
  let blob;
  let queued;
  const context = createContext({ document, localStorage: {
    getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value),
  }, Blob, URL: { createObjectURL(value) { blob = value; return 'blob:fixture'; }, revokeObjectURL() {} },
  window: { lavish: { queuePrompt: (...args) => { queued = args; } } } });
  for (const [, attrs, source] of scripts) if (!attrs.includes('application/json')) runInContext(source, context);
  return { data, cacheKey, storage, fields,
    save: (id) => runInContext('save(' + JSON.stringify(id) + ')', context),
    download: async () => { document.getElementById('export').onclick(); return JSON.parse(await blob.text()); },
    queue: () => { document.getElementById('queue').onclick(); return queued?.[1].data.items; } };
}

function assertCaptureBinding(label, page) {
  for (const key of ['venueId', 'url', 'bodySha256', 'sourceUrl', 'path', 'format']) {
    assert.deepEqual(label[key], page[key], key);
  }
}

test('capture review clears imported A evidence when the displayed capture is B', () => {
  captureReviewFixture(({ generate, label }) => {
    const first = generate(['A']).packet.pages[0];
    const repeated = generate(['A']).packet.pages[0];
    assert.equal(first.reviewId, repeated.reviewId);
    assert.deepEqual(first.label.priceRecords, label.priceRecords);
    assertCaptureBinding(first.label, first);
    const revised = generate(['A', 'B']).packet.pages[0];
    assert.notEqual(revised.reviewId, first.reviewId);
    assert.equal(revised.bodySha256, 'B-body');
    assertCaptureBinding(revised.label, revised);
    assert.equal(revised.label.verdict, 'unresolved');
    assert.equal(revised.label.relevant, null);
    assert.equal(revised.label.evidence, '');
    assert.equal(revised.label.reviewer, '');
    assert.equal(revised.label.officialEvidence, undefined);
    assert.equal(revised.label.priceReviewComplete, false);
    assert.deepEqual(revised.label.priceRecords, []);
  });
});

test('capture review rejects stale drafts and binds saved downloads and feedback to B', async () => {
  const pending = captureReviewFixture(({ generate, label }) => {
    const old = generate(['A']).packet.pages[0];
    const { packet, html } = generate(['A', 'B']);
    const current = packet.pages[0];
    const stale = { [old.reviewId]: label, [current.reviewId]: label, legacy: label };
    const browser = openGeneratedReview(html, stale);
    const check = async () => {
      assert.deepEqual((await browser.download()).labels, []);
      assert.equal(browser.queue(), undefined);
      assert.deepEqual(JSON.parse(browser.storage.get(browser.cacheKey)), stale);
      browser.save(current.reviewId);
      const saved = JSON.parse(browser.storage.get(browser.cacheKey));
      assertCaptureBinding(saved[current.reviewId], current);
      assert.deepEqual(saved[old.reviewId], label);
      assert.deepEqual(saved.legacy, label);
      const downloaded = await browser.download();
      assert.equal(downloaded.humanApproved, false);
      assert.equal(downloaded.labels.length, 1);
      assertCaptureBinding(downloaded.labels[0], current);
      assert.equal(downloaded.labels[0].priceRecords[0].item, 'B soup');
      const queued = JSON.parse(JSON.stringify(browser.queue()));
      assert.equal(queued.length, 1);
      assertCaptureBinding(queued[0], current);
      const restored = openGeneratedReview(html, saved);
      const recovered = (await restored.download()).labels[0];
      assertCaptureBinding(recovered, current);
      assert.equal(recovered.evidence, 'B address and menu');
      assert.equal(recovered.priceRecords[0].item, 'B soup');
    };
    return check();
  });
  await pending;
});

test('capture review restores matching drafts with the displayed provenance and format', async () => {
  const pending = captureReviewFixture(({ generate, label }) => {
    const { packet, html } = generate(['B'], { ...label, bodySha256: 'B-body' });
    const current = packet.pages[0];
    assertCaptureBinding(current.label, current);
    assert.equal(current.label.evidence, label.evidence);
    const browser = openGeneratedReview(html, { [current.reviewId]: { ...label, bodySha256: 'B-body' } });
    return browser.download().then((downloaded) => {
      assertCaptureBinding(downloaded.labels[0], current);
      assert.equal(downloaded.labels[0].evidence, label.evidence);
      assert.deepEqual(downloaded.labels[0].priceRecords, label.priceRecords);
    });
  });
  await pending;
});
