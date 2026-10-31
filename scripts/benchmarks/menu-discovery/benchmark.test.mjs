import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
