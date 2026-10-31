import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
