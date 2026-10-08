import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "test-results", "pub-hours-runner");
afterEach(() => rmSync(FIXTURE, { recursive: true, force: true }));
function json(file: string, value: unknown) {
  const target = path.join(FIXTURE, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(value));
}
function fixture() {
  rmSync(FIXTURE, { recursive: true, force: true });
  mkdirSync(path.join(FIXTURE, "scripts/lib"), { recursive: true });
  mkdirSync(path.join(FIXTURE, "bin"));
  for (const file of ["scripts/verify_pub_hours.mjs", "scripts/lib/placesHoursCheck.ts", "scripts/lib/googlePlacesQuota.mjs", "scripts/lib/geo.mjs", "tsconfig.json"]) {
    copyFileSync(path.join(ROOT, file), path.join(FIXTURE, file));
  }
  symlinkSync(path.join(ROOT, "lib"), path.join(FIXTURE, "lib"), "dir");
  symlinkSync(path.join(ROOT, "node_modules"), path.join(FIXTURE, "node_modules"), "dir");
  writeFileSync(path.join(FIXTURE, "bin/gcloud"), "#!/bin/sh\nprintf 'synthetic-token\\n'\n", { mode: 0o755 });
  json("data/osm/uk/uk_osm_pubs.json", { pubs: [
    { osmId: "node/1", openingHours: "Mo 10:00-20:00" },
    { osmId: "node/2", openingHours: "Mo 10:00-21:00" },
    { osmId: "node/3" },
  ] });
  json("public/data/london_desks/desks.json", { venues: [] });
  json("public/data/london_venues/manifest.json", { urlPrefix: "/data/london_venues/packs/0123456789abcdef/", shards: [{ id: "51.500_-0.125" }] });
  json("public/data/london_venues/packs/0123456789abcdef/51.500_-0.125.json", { venues: [
    ["n2", "Our second pub", "Our address", 51.52, -0.12, "pub"],
    ["n1", "Our central pub", "Our address", 51.5074, -0.1278, "pub"],
    ["n3", "Our far pub", "Our address", 51.53, -0.12, "pub"],
  ] });
  json("data/places_verification/london.json", { pubs: [
    { venueId: "venue-osm-n2", googlePlaceId: "place-two" },
    { venueId: "venue-osm-n1", googlePlaceId: "place-one" },
    { venueId: "venue-osm-n3", googlePlaceId: "place-three" },
  ] });
  writeFileSync(path.join(FIXTURE, "fake-google.mjs"), `
import { writeFileSync } from "node:fs";
const quotas = { search: "10", details: "10" };
const calls = [];
const raises = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
  if (url.includes("monitoring.googleapis.com")) return reply({ timeSeries: [{ points: [{ value: { int64Value: process.env.FAKE_MONTH_USAGE } }] }] });
  if (url.includes("consumerQuotaMetrics:importConsumerOverrides")) {
    const rows = JSON.parse(init.body).inlineSource.overrides;
    for (const row of rows) quotas[row.metric.includes("SearchText") ? "search" : "details"] = row.overrideValue;
    raises.push(quotas.details);
    writeFileSync("quota-state.json", JSON.stringify(quotas));
    writeFileSync("quota-history.json", JSON.stringify(raises));
    return reply({ done: true });
  }
  if (url.includes("serviceusage.googleapis.com")) {
    const value = quotas[url.includes("SearchText") ? "search" : "details"];
    return reply(url.endsWith("consumerOverrides") ? { overrides: [{ overrideValue: value }] } : { quotaBuckets: [{ effectiveLimit: value }] });
  }
  if (url.startsWith("https://places.googleapis.com/v1/places/")) {
    if (init.headers["X-Goog-FieldMask"] !== "regularOpeningHours.periods") throw new Error("Unexpected field mask");
    calls.push(url.split("/").at(-1));
    writeFileSync("calls.json", JSON.stringify(calls));
    if (process.env.FAKE_HOURS_FAILURE) return reply({}, 503);
    if (process.env.FAKE_TERMINAL_STATUS && calls.length === 1) return reply({ error: { status: "INVALID_ARGUMENT", details: process.env.FAKE_INVALID_KEY ? [{ reason: "API_KEY_INVALID" }] : [] } }, Number(process.env.FAKE_TERMINAL_STATUS));
    return reply({ displayName: { text: "GOOGLE NAME NEVER STORE" }, regularOpeningHours: { periods: [
      { open: { day: 1, hour: 10 }, close: { day: 1, hour: 20 } }
    ] } });
  }
  throw new Error("Unexpected network endpoint");
};
`);
}
function run(failure = false, monthUsage = 1100, terminalStatus = 0, invalidKey = false) {
  return spawnSync(process.execPath, ["--import", "tsx", "--import", "./fake-google.mjs", "scripts/verify_pub_hours.mjs", "--write"], {
    cwd: FIXTURE, encoding: "utf8", env: { ...process.env, GOOGLE_PLACES_API_KEY: "fake-key",
      PATH: `${path.join(FIXTURE, "bin")}:${process.env.PATH}`, FAKE_HOURS_FAILURE: failure ? "1" : "", FAKE_MONTH_USAGE: String(monthUsage), FAKE_TERMINAL_STATUS: String(terminalStatus || ""), FAKE_INVALID_KEY: invalidKey ? "1" : "" },
  });
}
function read(file: string) { return JSON.parse(readFileSync(path.join(FIXTURE, file), "utf8")); }

it("runs Details only in central order, saves no Google hours, restores quotas, and resumes without calls", () => {
  fixture();
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(read("calls.json")).toEqual(["place-one", "place-two"]);
  expect(read("quota-history.json")).toEqual(["1102", "10"]);
  expect(read("quota-state.json")).toEqual({ search: "10", details: "10" });
  const output = read("data/places_verification/pub_hours_london.json");
  expect(output.spend).toMatchObject({ calls: 2, estimatedUsd: 0.04 });
  expect(output.rows.map((row: { verdict: string }) => row.verdict)).toEqual(["match", "mismatch", "unknown"]);
  const review = read("data/places_verification/pub_hours_review_london.json");
  expect(review.rows.map((row: { venueId: string }) => row.venueId)).toEqual(["venue-osm-n2"]);
  // A run at 00:10:00 or 10:00 puts "10:00" in verifiedAt, so the leak check skips the run clock.
  const stored = JSON.stringify({ output, review }, (key, value) => (key === "verifiedAt" ? undefined : value));
  expect(stored).not.toMatch(/GOOGLE NAME|periods|10:00|fake-key|Our address/);
  expect(run().status).toBe(0);
  expect(read("calls.json")).toHaveLength(2);
});
it("restores quotas after a failed Details request and keeps its spend reserved", () => {
  fixture();
  expect(run(true).status).toBe(1);
  expect(read("quota-state.json")).toEqual({ search: "10", details: "10" });
  const output = read("data/places_verification/pub_hours_london.json");
  expect(output.rows).toEqual([]);
  expect(output.spend.calls).toBe(1);
  expect(output.spend.estimatedUsd).toBe(0.02);
});
it("reserves free calls only within the checkpoint's own month", () => {
  fixture();
  expect(run(true).status).toBe(1);
  const file = "data/places_verification/pub_hours_london.json";
  const exhausted = (checkedOn: string) => {
    const output = read(file);
    json(file, { ...output, checkedOn, spend: { ...output.spend, estimatedUsd: 20, remainingFreeCalls: 0 } });
  };
  exhausted(`${new Date().toISOString().slice(0, 7)}-01`);
  expect(run(false, 0).status).toBe(0);
  expect(read("calls.json")).toEqual(["place-one"]);
  expect(read(file).rows.map((row: { verdict: string }) => row.verdict)).toEqual(["unknown"]);
  exhausted("2000-01-01");
  expect(run(false, 0).status).toBe(0);
  expect(read("calls.json")).toEqual(["place-one", "place-two"]);
  const output = read(file);
  expect(output.spend).toMatchObject({ calls: 3, estimatedUsd: 20, remainingFreeCalls: 0 });
  expect(output.rows.map((row: { verdict: string }) => row.verdict)).toEqual(["unknown", "match", "mismatch"]);
});

it("persists unknown verdicts at exhausted budget without Details calls or quota changes", () => {
  fixture();
  expect(run(true).status).toBe(1);
  const file = "data/places_verification/pub_hours_london.json";
  const prior = read(file);
  json(file, { ...prior, spend: { ...prior.spend, estimatedUsd: 20, remainingFreeCalls: 0 } });
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  const output = read(file);
  expect(output.rows).toEqual([expect.objectContaining({ venueId: "venue-osm-n3", verdict: "unknown" })]);
  expect(output.spend).toEqual({ ...prior.spend, estimatedUsd: 20, remainingFreeCalls: 0 });
  expect(read("calls.json")).toEqual(["place-one"]);
  expect(read("quota-history.json")).toEqual(["1102", "10"]);
  expect(read("data/places_verification/pub_hours_review_london.json").rows).toEqual([]);
  expect(run().status).toBe(0);
  expect(read(file).rows).toEqual(output.rows);
});
it("completes an all-missing-hours checkpoint with zero paid calls", () => {
  fixture();
  json("data/osm/uk/uk_osm_pubs.json", { pubs: [{ osmId: "node/1" }, { osmId: "node/2" }, { osmId: "node/3" }] });
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  const output = read("data/places_verification/pub_hours_london.json");
  expect(output.rows.map((row: { verdict: string }) => row.verdict)).toEqual(["unknown", "unknown", "unknown"]);
  expect(output.spend).toMatchObject({ calls: 0, estimatedUsd: 0 });
  expect(existsSync(path.join(FIXTURE, "calls.json"))).toBe(false);
  expect(existsSync(path.join(FIXTURE, "quota-history.json"))).toBe(false);
});

it.each([400, 404])("records terminal Details HTTP %s as unknown and continues without retrying it", (status) => {
  fixture();
  const result = run(false, 1100, status);
  expect(result.status, result.stderr).toBe(0);
  expect(read("calls.json")).toEqual(["place-one", "place-two"]);
  const file = "data/places_verification/pub_hours_london.json";
  const output = read(file);
  expect(output.rows.map((row: { venueId: string; verdict: string }) => [row.venueId, row.verdict])).toEqual([
    ["venue-osm-n1", "unknown"], ["venue-osm-n2", "mismatch"], ["venue-osm-n3", "unknown"],
  ]);
  expect(output.spend).toMatchObject({ calls: 2, estimatedUsd: 0.04 });
  expect(read("quota-state.json")).toEqual({ search: "10", details: "10" });
  expect(run(false, 1100, status).status).toBe(0);
  expect(read("calls.json")).toEqual(["place-one", "place-two"]);
  expect(read(file).rows).toEqual(output.rows);
});

it("stops on an invalid API key without marking pending venues unknown", () => {
  fixture();
  const result = run(false, 1100, 400, true);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("HTTP 400");
  expect(read("calls.json")).toEqual(["place-one"]);
  const output = read("data/places_verification/pub_hours_london.json");
  expect(output.rows).toEqual([]);
  expect(output.spend).toMatchObject({ calls: 1, estimatedUsd: 0.02 });
  expect(read("quota-state.json")).toEqual({ search: "10", details: "10" });
  expect(run().status).toBe(0);
  expect(read("calls.json")).toEqual(["place-one", "place-two"]);
  expect(read("data/places_verification/pub_hours_london.json").spend).toMatchObject({ calls: 3, estimatedUsd: 0.06 });
});
