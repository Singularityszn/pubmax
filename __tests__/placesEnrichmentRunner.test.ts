import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = path.resolve(__dirname, "..");
function fixture(name: string) {
  const dir = path.join(ROOT, "test-results/places-enrich", name);
  rmSync(dir, { recursive: true, force: true });
  for (const sub of ["scripts/lib", "data/places_verification", "bin"]) mkdirSync(path.join(dir, sub), { recursive: true });
  for (const file of ["scripts/enrich_google_places.mjs", "scripts/lib/googlePlacesQuota.mjs", "scripts/lib/placesEnrichmentStamp.mjs", "tsconfig.json"]) copyFileSync(path.join(ROOT, file), path.join(dir, file));
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
+if (process.env.FIXTURE_CLOCK) {
+  const RealDate = Date;
+  let now = RealDate.parse(process.env.FIXTURE_CLOCK);
+  globalThis.Date = class extends RealDate {
+    constructor(...args) { super(...(args.length ? args : [now])); }
+    static now() { return now; }
+  };
+  globalThis.fixtureTick = () => { now += Number(process.env.FIXTURE_CLOCK_STEP); };
+}
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
+   globalThis.fixtureTick?.();
+   if (process.env.FIXTURE_FAIL === 'all' || Number(process.env.FIXTURE_FAIL) === placeCalls) {
+     const status = Number(process.env.FIXTURE_FAIL_STATUS || 503);
+     const reason = process.env.FIXTURE_FAIL_REASON;
+     return result({error:{code:status, status:{400:'INVALID_ARGUMENT',404:'NOT_FOUND'}[status] ?? 'UNAVAILABLE', message:'RESPONSE_MUST_NOT_BE_LOGGED',
+       details: reason ? [{'@type':'type.googleapis.com/google.rpc.ErrorInfo', reason}] : []}}, status);
+   }
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
  const { version, inputHash, observedAt, spend, summary, venues } = JSON.parse(before);
  expect(version).toBe(1);
  expect(JSON.parse(readFileSync(path.join(dir, "data/places_enrichment_stamp.json"), "utf8"))).toEqual({ version, observedAt, packs: { places_enrichment: { inputHash, observedAt, spend, summary } } });
  expect(observedAt).toBe(venues.map((row: { observedAt: string }) => row.observedAt).sort()[0]);
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  expect(readFileSync(path.join(dir, "data/places_enrichment.json"), "utf8")).toBe(before);
});

it("a failed paid attempt stays in spend ledger and quota restoration still runs without logging Google content", () => {
  const dir = fixture("runner-failure");
  const live = run(dir, ["--write", "--exclusive"], "all");
  expect(live.status).toBe(1);
  expect(live.stderr).not.toContain("RESPONSE_MUST_NOT_BE_LOGGED");
  const out = JSON.parse(readFileSync(path.join(dir, "data/places_enrichment.json"), "utf8"));
  expect(out.spend).toMatchObject({ reservedUsd: 0.02, monthReservedUsd: 0.02 });
  expect(out.venues).toEqual([]);
  expect(out.errors).toEqual([]);
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
const preview = (dir: string, args: string[]) => JSON.parse(defined(run(dir, ["--dry-run", ...args]).stdout.trim().split("\n")[0]));
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

const MONTH = new Date().toISOString().slice(0, 7);
const editPack = (dir: string, edit: (body: { spend: Record<string, unknown> }) => void) => {
  const file = path.join(dir, "data/places_enrichment.json");
  const body = JSON.parse(readFileSync(file, "utf8"));
  edit(body);
  writeFileSync(file, JSON.stringify(body));
};

it("a clone without the checkpoint resumes from the committed spend ledger, retrying a stopped row and keeping place failures", () => {
  const dir = fixture("runner-committed-ledger");
  const stopped = run(dir, ["--write", "--exclusive"], "2");
  expect(stopped.status).toBe(1);
  expect(finalLine(stopped).failedRows).toEqual([]);
  expect(calls(dir)).toEqual(["ChIJVerified003", "ChIJVerified002"]);
  rmSync(checkpointFile(dir));
  expect(preview(dir, [])).toMatchObject({ pending: 2, plannedCalls: 2, month: MONTH, monthReservedUsd: 0.04, totalReservedUsd: 0.04 });
  const resumed = run(dir, ["--write", "--exclusive"], "1", { FIXTURE_FAIL_STATUS: "404" });
  expect(resumed.status, resumed.stderr).toBe(0);
  expect(finalLine(resumed).failedRows).toMatchObject([{ venueId: "venue-osm-n2", status: 404 }]);
  expect(calls(dir)).toEqual(["ChIJVerified003", "ChIJVerified002", "ChIJVerified002", "ChIJVerified001"]);
  const out = pack(dir);
  expect(out.spend).toMatchObject({ attemptedCalls: 4, reservedUsd: 0.08, month: MONTH, monthAttemptedCalls: 4, runStartedAt: null });
  expect(out.errors.map((row: { venueId: string }) => row.venueId)).toEqual(["venue-osm-n2"]);
  expect(out.summary).toMatchObject({ venues: 2, errors: 1 });
  rmSync(checkpointFile(dir));
  expect(preview(dir, [])).toMatchObject({ pending: 0, failedRows: [{ venueId: "venue-osm-n2", status: 404 }] });
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  const refused = run(dir, ["--write", "--exclusive", "--refresh"]);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("nothing to refresh");
  expect(calls(dir)).toHaveLength(4);
  expect(pack(dir)).toEqual(out);
});

it.each(["404", "400"])("a place-level HTTP %s is recorded and the run continues to every later row", (status) => {
  const dir = fixture(`runner-row-failure-${status}`);
  const live = run(dir, ["--write", "--exclusive"], "2", { FIXTURE_FAIL_STATUS: status });
  expect(live.status, live.stderr).toBe(0);
  expect(live.stdout).not.toContain("RESPONSE_MUST_NOT_BE_LOGGED");
  expect(calls(dir)).toEqual(["ChIJVerified003", "ChIJVerified002", "ChIJVerified001"]);
  expect(finalLine(live).failedRows).toMatchObject([{ venueId: "venue-osm-n2", status: Number(status) }]);
  expect(pack(dir).summary).toMatchObject({ venues: 2, errors: 1 });
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  expect(calls(dir)).toHaveLength(3);
});

it("an HTTP 400 about the API key stops the run after one attempt and marks no row failed", () => {
  const dir = fixture("runner-key-400");
  const live = run(dir, ["--write", "--exclusive"], "all", { FIXTURE_FAIL_STATUS: "400", FIXTURE_FAIL_REASON: "API_KEY_INVALID" });
  expect(live.status).toBe(1);
  expect(live.stderr).toContain("HTTP 400");
  expect(`${live.stdout}${live.stderr}`).not.toContain("RESPONSE_MUST_NOT_BE_LOGGED");
  expect(calls(dir)).toEqual(["ChIJVerified003"]);
  expect(finalLine(live).failedRows).toEqual([]);
  expect(pack(dir)).toMatchObject({ spend: { attemptedCalls: 1 }, errors: [] });
  expect(preview(dir, [])).toMatchObject({ pending: 3 });
});

it("a stale stamp starts a refresh push past a completed checkpoint, keeps all spend and re-buys only stale, stopped or failed rows", () => {
  const dir = fixture("runner-stale-refresh");
  stale(dir);
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  expect(calls(dir)).toHaveLength(3);
  expect(preview(dir, ["--refresh"])).toMatchObject({ push: "refresh", pending: 3, plannedCalls: 3, monthReservedUsd: 0.06, totalReservedUsd: 0.06, capUsd: 85 });
  expect(run(dir, ["--write", "--exclusive", "--refresh"], "2").status).toBe(1);
  const partial = pack(dir);
  expect(partial.spend).toMatchObject({ attemptedCalls: 5, reservedUsd: 0.1, monthAttemptedCalls: 5 });
  expect(partial.observedAt).toBe(OLD);
  const dated = Object.fromEntries(partial.venues.map((row: { venueId: string; formattedAddress: { observedAt: string } }) => [row.venueId, row.formattedAddress.observedAt]));
  expect(dated["venue-osm-n3"]).not.toBe(OLD);
  expect([dated["venue-osm-n2"], dated["venue-osm-n1"]]).toEqual([OLD, OLD]);
  const again = run(dir, ["--write", "--exclusive", "--refresh"]);
  expect(again.status).toBe(1);
  expect(again.stderr).toContain("resume it without --refresh");
  const resumed = run(dir, ["--write", "--exclusive"], "1", { FIXTURE_FAIL_STATUS: "404" });
  expect(resumed.status).toBe(0);
  expect(finalLine(resumed).failedRows).toMatchObject([{ venueId: "venue-osm-n2", status: 404 }]);
  expect(calls(dir).slice(3)).toEqual(["ChIJVerified003", "ChIJVerified002", "ChIJVerified002", "ChIJVerified001"]);
  expect(pack(dir).spend).toMatchObject({ attemptedCalls: 7, monthAttemptedCalls: 7, runStartedAt: partial.spend.runStartedAt });
  expect(pack(dir).observedAt).toBe(OLD);
  expect(run(dir, ["--write", "--exclusive", "--refresh"]).status).toBe(0);
  expect(calls(dir).slice(7)).toEqual(["ChIJVerified002"]);
  const done = pack(dir);
  expect(done.spend).toMatchObject({ attemptedCalls: 8, monthAttemptedCalls: 8 });
  expect(done.observedAt).not.toBe(OLD);
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  expect(calls(dir)).toHaveLength(8);
});

it("the USD 85 cap is cumulative across pushes in a calendar month and resets in the next month", () => {
  const dir = fixture("runner-monthly-cap");
  stale(dir);
  rmSync(checkpointFile(dir));
  editPack(dir, (body) => Object.assign(body.spend, { attemptedCalls: 4249, reservedUsd: 84.98, monthAttemptedCalls: 4249, monthReservedUsd: 84.98 }));
  expect(preview(dir, ["--refresh"])).toMatchObject({ pending: 3, plannedCalls: 1, omittedForBudget: 2, monthReservedUsd: 84.98 });
  expect(run(dir, ["--write", "--exclusive", "--refresh"]).status).toBe(0);
  expect(calls(dir)).toHaveLength(4);
  expect(pack(dir).spend).toMatchObject({ attemptedCalls: 4250, monthAttemptedCalls: 4250, monthReservedUsd: 85 });
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  expect(calls(dir)).toHaveLength(4);
  rmSync(checkpointFile(dir));
  editPack(dir, (body) => Object.assign(body.spend, { month: "2000-01" }));
  expect(preview(dir, [])).toMatchObject({ month: MONTH, monthReservedUsd: 0, plannedCalls: 2, totalReservedUsd: 85 });
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  expect(calls(dir)).toHaveLength(6);
  expect(pack(dir).spend).toMatchObject({ attemptedCalls: 4252, month: MONTH, monthAttemptedCalls: 2 });
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

it("a run crossing a UTC month end counts each attempt against the month it was reserved in", () => {
  const dir = fixture("runner-month-rollover");
  const clock = { FIXTURE_CLOCK: "2026-10-31T23:59:58.500Z", FIXTURE_CLOCK_STEP: "1000" };
  const live = run(dir, ["--write", "--exclusive"], "none", clock);
  expect(live.status, live.stderr).toBe(0);
  expect(calls(dir)).toEqual(["ChIJVerified003", "ChIJVerified002", "ChIJVerified001"]);
  expect(pack(dir).spend).toMatchObject({ attemptedCalls: 3, reservedUsd: 0.06, month: "2026-11", monthAttemptedCalls: 1, monthReservedUsd: 0.02 });
});

it("reads only the London ledger, so another city ledger neither changes the push nor gets requested", () => {
  const dir = fixture("runner-london-only");
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  const before = readFileSync(path.join(dir, "data/places_enrichment.json"), "utf8");
  writeFileSync(path.join(dir, "data/places_verification/uk_cities.json"), JSON.stringify({ pubs: [{ venueId: "venue-uk-n1", googlePlaceId: "ChIJCity001" }] }));
  const dry = run(dir, ["--dry-run"]);
  expect(dry.status, dry.stderr).toBe(0);
  expect(JSON.parse(defined(dry.stdout.trim().split("\n")[0]))).toMatchObject({ verified: 3, pending: 0 });
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  expect(readFileSync(path.join(dir, "data/places_enrichment.json"), "utf8")).toBe(before);
  expect(calls(dir)).not.toContain("ChIJCity001");
});

it("enriches the explicit UK pack independently of a completed London resume", () => {
  const dir = fixture("runner-uk-pack");
  expect(run(dir, ["--write", "--exclusive"]).status).toBe(0);
  const london = readFileSync(path.join(dir, "data/places_enrichment.json"), "utf8");
  writeFileSync(path.join(dir, "data/places_verification/uk_cities.json"), JSON.stringify({ pubs: [{ venueId: "venue-uk-n4", googlePlaceId: "ChIJCity0004" }] }));
  const result = run(dir, ["--write", "--exclusive", "--pack=uk_cities"]);
  expect(result.status, result.stderr).toBe(0);
  expect(calls(dir).at(-1)).toBe("ChIJCity0004");
  expect(readFileSync(path.join(dir, "data/places_enrichment.json"), "utf8")).toBe(london);
  const uk = JSON.parse(readFileSync(path.join(dir, "data/places_enrichment_uk_cities.json"), "utf8"));
  expect(uk.spend.reservedUsd).toBe(0.02);
  expect(uk.venues[0].formattedAddress.source).toBe("google_places");
  const stamp = JSON.parse(readFileSync(path.join(dir, "data/places_enrichment_stamp.json"), "utf8"));
  expect(Object.keys(stamp.packs)).toEqual(["places_enrichment", "places_enrichment_uk_cities"]);
  expect(stamp.packs.places_enrichment_uk_cities).toEqual({ inputHash: uk.inputHash, observedAt: uk.observedAt, spend: uk.spend, summary: uk.summary });
  expect(stamp.observedAt).toBe([JSON.parse(london).observedAt, uk.observedAt].sort()[0]);
  expect(run(dir, ["--write", "--exclusive", "--pack=uk_cities"]).status).toBe(0);
  expect(calls(dir)).toHaveLength(4);
});

it("shares the USD 28 task cap across UK core and both extras packs, including failed attempts and fresh clones", () => {
  const dir = fixture("runner-task-cap");
  writeFileSync(path.join(dir, "data/places_verification/uk_cities.json"), JSON.stringify({ pubs: [{ venueId: "venue-uk-n4", googlePlaceId: "ChIJCity0004" }] }));
  const file = path.join(dir, "data/places_enrichment_uk_cities.json");
  writeFileSync(file, JSON.stringify({ version: 1, spend: { attemptedCalls: 1398, monthAttemptedCalls: 1398, month: MONTH }, venues: [], errors: [] }));
  const args = ["--write", "--exclusive", "--pack=london_extras"];
  const live = run(dir, args, "all");
  expect(live.status, live.stderr).toBe(1);
  const extra = JSON.parse(readFileSync(path.join(dir, "data/places_enrichment_london_extras.json"), "utf8"));
  expect(extra.spend.reservedUsd).toBe(0.025);
  rmSync(path.join(dir, "data/places_verification/enrichment_london_extras_progress.json"));
  const dry = run(dir, ["--dry-run", "--pack=london_extras"]);
  expect(JSON.parse(dry.stdout)).toMatchObject({ plannedCalls: 0, taskReservedUsd: 27.985 });
  expect(JSON.parse(dry.stdout).fieldMask.split(",")).toEqual(expect.arrayContaining(["allowsDogs", "goodForWatchingSports", "servesLunch", "reservable", "restroom", "paymentOptions"]));
  expect(run(dir, args).status).toBe(0);
  expect(calls(dir)).toHaveLength(1);
});
