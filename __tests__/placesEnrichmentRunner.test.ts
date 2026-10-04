import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
function fixture(name: string) {
  const dir = path.join(ROOT, "test-results/places-enrich", name);
  rmSync(dir, { recursive: true, force: true });
  for (const sub of ["scripts/lib", "data/places_verification", "bin"]) mkdirSync(path.join(dir, sub), { recursive: true });
  for (const file of ["scripts/enrich_google_places.mjs", "scripts/lib/googlePlacesQuota.mjs", "tsconfig.json"]) copyFileSync(path.join(ROOT, file), path.join(dir, file));
  for (const name of ["lib", "node_modules"]) symlinkSync(path.join(ROOT, name), path.join(dir, name), "dir");
  writeFileSync(path.join(dir, "bin/gcloud"), "#!/bin/sh\nprintf 'fixture-access-token\\n'\n", { mode: 0o755 });
  const pubs = [1, 2, 3].map((n) => ({ venueId: `venue-osm-n${n}`, googlePlaceId: `ChIJVerified00${n}` }));
  writeFileSync(path.join(dir, "data/places_verification/london.json"), JSON.stringify({ pubs }));
  writeFileSync(path.join(dir, "data/places_verification/pub_hours_london.json"), JSON.stringify({ rows: [
    { ...pubs[1], verdict: "mismatch" }, { ...pubs[2], verdict: "unknown" },
    { venueId: "venue-osm-n9", googlePlaceId: "ChIJUnverified", verdict: "unknown" },
  ] }));
  writeFileSync(path.join(dir, "boundary.mjs"), `
+import { appendFileSync } from 'node:fs';
+let details = '10000';
+let placeCalls = 0;
+const result = (body, status = 200) => new Response(JSON.stringify(body), { status });
+globalThis.fetch = async (input, init) => {
+ const url = String(input);
+ if (url.startsWith('https://monitoring.googleapis.com/')) return result({timeSeries:[{points:[{value:{int64Value:'9000'}}]}]});
+ if (url.startsWith('https://serviceusage.googleapis.com/')) {
+   if (init?.method === 'POST') {
+     const overrides = JSON.parse(init.body).inlineSource.overrides;
+     details = overrides.find(row => row.metric.includes('GetPlaceRequest')).overrideValue;
+     appendFileSync('quota.log', details + '\\n'); return result({done:true});
+   }
+   if (url.endsWith('/consumerOverrides')) return result({overrides:[{overrideValue:'10000'}]});
+   return result({quotaBuckets:[{effectiveLimit:url.includes('GetPlaceRequest') ? details : '10000'}]});
+ }
+ if (url.startsWith('https://places.googleapis.com/v1/places/')) {
+   appendFileSync('calls.log', url.split('/').at(-1) + '\\n');
+   placeCalls += 1;
+   if (process.env.FIXTURE_FAIL === 'all' || Number(process.env.FIXTURE_FAIL) === placeCalls) return result({error:{message:'RESPONSE_MUST_NOT_BE_LOGGED'}}, Number(process.env.FIXTURE_FAIL_STATUS || 503));
+   if (process.env.FIXTURE_EMPTY === '1') return result({ websiteUri: 'javascript:alert(1)' });
+   return result({ formattedAddress: '1 Example Street', nationalPhoneNumber:'020 7946 0123', websiteUri:'https://pub.example/', regularOpeningHours:{periods:[{open:{day:0,hour:0,minute:0}}]} });
+ }
+ throw new Error('Unexpected external request');
+};
+`.replace(/^\+/gm, ""));
  return dir;
}
function run(dir: string, args: string[], fail = "none", env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", "--import", "./boundary.mjs", "scripts/enrich_google_places.mjs", ...args], {
    cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, GOOGLE_PLACES_API_KEY: "fixture-key", FIXTURE_FAIL: fail, ...env },
  });
}

it("dry run makes no calls; live copy follows priority, preserves dates on resume and restores quotas", () => {
  const dir = fixture("runner-success");
  expect(run(dir, ["--dry-run"]).status).toBe(0);
  const live = run(dir, ["--write", "--exclusive"]);
  expect(live.status, live.stderr).toBe(0);
  expect(readFileSync(path.join(dir, "calls.log"), "utf8").trim().split("\n")).toEqual(["ChIJVerified003", "ChIJVerified002", "ChIJVerified001"]);
  expect(readFileSync(path.join(dir, "quota.log"), "utf8").trim().split("\n").at(-1)).toBe("10000");
  const before = readFileSync(path.join(dir, "data/places_enrichment.json"), "utf8");
  expect(JSON.parse(before).spend.reservedUsd).toBe(0.06);
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  expect(readFileSync(path.join(dir, "data/places_enrichment.json"), "utf8")).toBe(before);
});

it("a failed paid attempt stays in spend ledger and quota restoration still runs without logging Google content", () => {
  const dir = fixture("runner-failure");
  const live = run(dir, ["--write", "--exclusive"], "all");
  expect(live.status).toBe(1);
  expect(live.stderr).not.toContain("RESPONSE_MUST_NOT_BE_LOGGED");
  const out = JSON.parse(readFileSync(path.join(dir, "data/places_enrichment.json"), "utf8"));
  expect(out.spend.reservedUsd).toBe(0.02);
  expect(out.venues).toEqual([]);
  expect(readFileSync(path.join(dir, "quota.log"), "utf8").trim().split("\n").at(-1)).toBe("10000");
});

it("recovers interrupted quota restoration even when every paid request already completed", () => {
  const dir = fixture("runner-restore-recovery");
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  const file = path.join(dir, "data/places_verification/enrichment_progress.json");
  const checkpoint = JSON.parse(readFileSync(file, "utf8"));
  checkpoint.quotaRestored = false;
  writeFileSync(file, JSON.stringify(checkpoint));
  const calls = readFileSync(path.join(dir, "calls.log"), "utf8");
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  expect(JSON.parse(readFileSync(file, "utf8")).quotaRestored).toBe(true);
  expect(readFileSync(path.join(dir, "calls.log"), "utf8")).toBe(calls);
});

const calls = (dir: string) => existsSync(path.join(dir, "calls.log")) ? readFileSync(path.join(dir, "calls.log"), "utf8").trim().split("\n") : [];
const pack = (dir: string) => JSON.parse(readFileSync(path.join(dir, "data/places_enrichment.json"), "utf8"));
const preview = (dir: string, args: string[]) => JSON.parse(run(dir, ["--dry-run", ...args]).stdout.trim().split("\n")[0]);
const checkpointFile = (dir: string) => path.join(dir, "data/places_verification/enrichment_progress.json");
const FIELDS = ["regularOpeningHours", "formattedAddress", "nationalPhoneNumber", "websiteUri"];
function age(file: string, observedAt: string) {
  const body = JSON.parse(readFileSync(file, "utf8"));
  const rows = Array.isArray(body.venues) ? body.venues : Object.values(body.completed);
  for (const row of rows) {
    row.observedAt = observedAt;
    for (const field of FIELDS) if (row[field]) row[field].observedAt = observedAt;
  }
  if ("observedAt" in body) body.observedAt = observedAt;
  writeFileSync(file, JSON.stringify(body));
}
const finalLine = (result: { stdout: string }) => JSON.parse(result.stdout.trim().split("\n").at(-1)!);
const OLD = "2020-01-01T00:00:00.000Z";
function stale(dir: string) {
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  age(checkpointFile(dir), OLD);
  age(path.join(dir, "data/places_enrichment.json"), OLD);
}

it("a clone without the checkpoint resumes from the committed spend ledger, keeping errors and never re-buying an attempted row", () => {
  const dir = fixture("runner-committed-ledger");
  expect(run(dir, ["--write", "--exclusive"], "2").status).toBe(1);
  expect(calls(dir)).toEqual(["ChIJVerified003", "ChIJVerified002"]);
  rmSync(checkpointFile(dir));
  expect(preview(dir, [])).toMatchObject({ pending: 1, plannedCalls: 1, priorReservedUsd: 0.04, earlierPushesReservedUsd: 0 });
  const resumed = run(dir, ["--write", "--exclusive"]);
  expect(resumed.status).toBe(0);
  expect(finalLine(resumed).failedRows).toMatchObject([{ venueId: "venue-osm-n2", status: 503 }]);
  expect(calls(dir)).toEqual(["ChIJVerified003", "ChIJVerified002", "ChIJVerified001"]);
  const out = pack(dir);
  expect(out.spend).toMatchObject({ attemptedCalls: 3, reservedUsd: 0.06, priorAttemptedCalls: 0, runStartedAt: null });
  expect(out.errors.map((row: { venueId: string }) => row.venueId)).toEqual(["venue-osm-n2"]);
  expect(out.summary).toMatchObject({ venues: 2, errors: 1 });
  rmSync(checkpointFile(dir));
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  const refused = run(dir, ["--write", "--exclusive", "--refresh"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("nothing to refresh");
  expect(calls(dir)).toHaveLength(3);
  expect(pack(dir)).toEqual(out);
});

it("a place-level failure is recorded and the run continues to every later row", () => {
  const dir = fixture("runner-row-failure");
  const live = run(dir, ["--write", "--exclusive"], "2", { FIXTURE_FAIL_STATUS: "404" });
  expect(live.status, live.stderr).toBe(0);
  expect(calls(dir)).toEqual(["ChIJVerified003", "ChIJVerified002", "ChIJVerified001"]);
  expect(finalLine(live).failedRows).toMatchObject([{ venueId: "venue-osm-n2", status: 404 }]);
  expect(pack(dir).summary).toMatchObject({ venues: 2, errors: 1 });
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  expect(calls(dir)).toHaveLength(3);
});

it("a stale stamp starts a capped refresh push past a completed checkpoint, keeps earlier spend and re-buys only stale or failed rows", () => {
  const dir = fixture("runner-stale-refresh");
  stale(dir);
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  expect(calls(dir)).toHaveLength(3);
  expect(preview(dir, ["--refresh"])).toMatchObject({ push: "refresh", pending: 3, plannedCalls: 3, priorReservedUsd: 0, earlierPushesReservedUsd: 0.06, capUsd: 85 });
  expect(run(dir, ["--write", "--exclusive", "--refresh"], "2").status).toBe(1);
  const partial = pack(dir);
  expect(partial.spend).toMatchObject({ attemptedCalls: 2, reservedUsd: 0.04, priorAttemptedCalls: 3, priorReservedUsd: 0.06 });
  expect(partial.observedAt).toBe(OLD);
  const dated = Object.fromEntries(partial.venues.map((row: { venueId: string; formattedAddress: { observedAt: string } }) => [row.venueId, row.formattedAddress.observedAt]));
  expect(dated["venue-osm-n3"]).not.toBe(OLD);
  expect([dated["venue-osm-n2"], dated["venue-osm-n1"]]).toEqual([OLD, OLD]);
  const again = run(dir, ["--write", "--exclusive", "--refresh"]);
  expect(again.status).toBe(1);
  expect(again.stderr).toContain("resume it without --refresh");
  const resumed = run(dir, ["--write", "--exclusive"]);
  expect(resumed.status).toBe(0);
  expect(finalLine(resumed).failedRows).toMatchObject([{ venueId: "venue-osm-n2", status: 503 }]);
  expect(calls(dir).slice(3)).toEqual(["ChIJVerified003", "ChIJVerified002", "ChIJVerified001"]);
  expect(pack(dir).spend).toMatchObject({ attemptedCalls: 3, priorAttemptedCalls: 3, runStartedAt: partial.spend.runStartedAt });
  expect(pack(dir).observedAt).toBe(OLD);
  expect(run(dir, ["--write", "--exclusive", "--refresh"]).status).toBe(0);
  expect(calls(dir).slice(6)).toEqual(["ChIJVerified002"]);
  const done = pack(dir);
  expect(done.spend).toMatchObject({ attemptedCalls: 1, priorAttemptedCalls: 6 });
  expect(done.observedAt).not.toBe(OLD);
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  expect(calls(dir)).toHaveLength(7);
});

it("a paid response with no usable field completes its row for the refresh push", () => {
  const dir = fixture("runner-fieldless-refresh");
  stale(dir);
  expect(run(dir, ["--write", "--exclusive", "--refresh"], "none", { FIXTURE_EMPTY: "1" }).status).toBe(0);
  expect(calls(dir)).toHaveLength(6);
  const out = pack(dir);
  expect(out.venues.map((row: object) => Object.keys(row).sort())).toEqual(Array(3).fill(["googlePlaceId", "observedAt", "venueId"]));
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  expect(run(dir, ["--write", "--exclusive", "--refresh"]).stderr).toContain("nothing to refresh");
  expect(calls(dir)).toHaveLength(6);
  expect(pack(dir)).toEqual(out);
});
