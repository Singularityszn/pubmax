import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "test-results", "places-observation-dates");
const PUB_ID = "venue-osm-n1";
const CAFE_ID = "venue-osm-n5000";

function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value)}\n`);
}

function setupFixture(name: string) {
  const dir = path.join(ARTIFACTS, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  mkdirSync(path.join(dir, "bin"), { recursive: true });
  mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
  copyFileSync(path.join(ROOT, "scripts", "verify_london_places.mjs"), path.join(dir, "scripts", "verify_london_places.mjs"));
  copyFileSync(path.join(ROOT, "scripts", "lib", "googlePlacesQuota.mjs"), path.join(dir, "scripts", "lib", "googlePlacesQuota.mjs"));
  copyFileSync(path.join(ROOT, "tsconfig.json"), path.join(dir, "tsconfig.json"));
  symlinkSync(path.join(ROOT, "lib"), path.join(dir, "lib"), "dir");
  symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "dir");
  writeFileSync(path.join(dir, "bin", "gcloud"), "#!/bin/sh\nprintf 'synthetic-token\\n'\n", { mode: 0o755 });
  const pubs = Array.from({ length: 3650 }, (_, index) => [
    `n${index + 1}`, index === 0 ? "The Fixture Pub" : `Unused Pub ${index}`,
    "London EC2A 3AY", 51.525, -0.078, "pub",
  ]);
  const cafes = Array.from({ length: 61 }, (_, index) => [
    `n${index + 5000}`, index === 0 ? "Fixture Cafe" : `Unused Cafe ${index}`,
    "London EC2A 3AY", 51.525, -0.078, "cafe",
  ]);
  writeJson(path.join(dir, "public/data/london_venues/packs/fixture.json"), { venues: [...pubs, ...cafes] });
  writeJson(path.join(dir, "public/data/london_desks/desks.json"), { venues: [] });
  writeJson(path.join(dir, "data/places_verification/closed_pubs.json"), { osmRefs: [] });
  mkdirSync(path.join(dir, "public/data/price_bands"), { recursive: true });
  copyFileSync(path.join(ROOT, "public/data/price_bands/thresholds.json"), path.join(dir, "public/data/price_bands/thresholds.json"));
  const searches = Object.fromEntries([...pubs, ...cafes]
    .filter((row) => row[0] !== "n1" && row[0] !== "n5000")
    .map((row) => [`venue-osm-${row[0]}`, { outcome: "skipped", reason: "no_result" }]));
  writeJson(path.join(dir, "data/places_verification/progress.json"), { searches, details: {} });
  writeFileSync(path.join(dir, "fixture-boundary.mjs"), `
const RealDate = Date;
let day = process.env.FIXTURE_DAY;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [day + "T12:00:00.000Z"])); }
  static now() { return new RealDate(day + "T12:00:00.000Z").getTime(); }
};
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, delay, ...args) => realSetTimeout(callback, Math.min(delay, 1), ...args);
const response = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (process.env.FIXTURE_NO_PLACES === "1" && url.startsWith("https://places.googleapis.com/")) throw new Error("Places reread forbidden: " + url);
  if (url.startsWith("https://monitoring.googleapis.com/v3/projects/pubmaxx/timeSeries?")) return response({ timeSeries: [] });
  if (url.startsWith("https://serviceusage.googleapis.com/v1beta1/projects/590118888791/services/places.googleapis.com/consumerQuotaMetrics/")) {
    if (url.endsWith("/consumerOverrides")) return response({ overrides: [{ overrideValue: "10000" }] });
    if (url.includes("/limits/%2Fd%2Fproject")) return response({ quotaBuckets: [{ effectiveLimit: "10000" }] });
  }
  if (url === "https://serviceusage.googleapis.com/v1beta1/projects/590118888791/services/places.googleapis.com/consumerQuotaMetrics:importConsumerOverrides") return response({ done: true });
  if (url === "https://places.googleapis.com/v1/places:searchText") {
    const query = JSON.parse(init.body).textQuery;
    if (query.startsWith("The Fixture Pub ")) return response({ places: [{ id: "ChIJFixturePub0001" }] });
    if (query.startsWith("Fixture Cafe ")) return response({ places: [{ id: "ChIJFixtureCafe0001" }] });
  }
  if (url === "https://places.googleapis.com/v1/places/ChIJFixturePub0001") return response({ businessStatus: "OPERATIONAL", displayName: { text: "The Fixture Pub" } });
  if (url === "https://places.googleapis.com/v1/places/ChIJFixtureCafe0001") {
    if (process.env.FIXTURE_MIDNIGHT === "1") day = "2026-10-04";
    return response({ businessStatus: "OPERATIONAL", regularOpeningHours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] } });
  }
  throw new Error("unexpected external request: " + url);
};
`);
  return dir;
}

function runCli(dir: string, day: string, options: { noPlaces?: boolean; midnight?: boolean } = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", "--import", "./fixture-boundary.mjs", "scripts/verify_london_places.mjs"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      PATH: path.join(dir, "bin"),
      HOME: dir,
      NODE_ENV: "test",
      GOOGLE_PLACES_API_KEY: "synthetic-key",
      FIXTURE_DAY: day,
      FIXTURE_NO_PLACES: options.noPlaces ? "1" : "0",
      FIXTURE_MIDNIGHT: options.midnight ? "1" : "0",
      TZ: "UTC",
    },
  });
}

it("retains successful pub and cafe observation days across interrupted publication and resume", () => {
  const dir = setupFixture("cross-day");
  const output = path.join(dir, "data/places_verification");
  mkdirSync(path.join(output, "london.json"));
  const first = runCli(dir, "2026-10-03");
  expect(first.status, first.stderr).toBe(1);
  expect(first.stderr).toMatch(/EISDIR|Is a directory/);
  const progress = JSON.parse(readFileSync(path.join(output, "progress.json"), "utf8"));
  expect(progress.details[PUB_ID]?.observedAt, first.stderr).toBe("2026-10-03");
  expect(progress.details[CAFE_ID]?.observedAt, first.stderr).toBe("2026-10-03");
  expect(JSON.stringify(progress.details)).not.toMatch(/displayName|regularOpeningHours|periods/);
  rmSync(path.join(output, "london.json"), { recursive: true });
  const resumed = runCli(dir, "2026-10-04", { noPlaces: true });
  expect(resumed.status, resumed.stderr).toBe(0);
  const london = JSON.parse(readFileSync(path.join(output, "london.json"), "utf8"));
  const cafes = JSON.parse(readFileSync(path.join(output, "shoreditch_cafes.json"), "utf8"));
  expect(london.pubs.find((row: { venueId: string }) => row.venueId === PUB_ID)?.verifiedAt).toBe("2026-10-03");
  expect(cafes.rows.find((row: { venueId: string }) => row.venueId === CAFE_ID)?.verifiedAt).toBe("2026-10-03");
});

function publishedRows(dir: string) {
  const output = path.join(dir, "data/places_verification");
  const london = JSON.parse(readFileSync(path.join(output, "london.json"), "utf8"));
  const cafes = JSON.parse(readFileSync(path.join(output, "shoreditch_cafes.json"), "utf8"));
  return { pub: london.pubs.find((row: { venueId: string }) => row.venueId === PUB_ID), cafe: cafes.rows.find((row: { venueId: string }) => row.venueId === CAFE_ID), london, cafes };
}

it("uses each row's actual observation day when details cross midnight", () => {
  const dir = setupFixture("midnight");
  const result = runCli(dir, "2026-10-03", { midnight: true });
  expect(result.status, result.stderr).toBe(0);
  const { pub, cafe, london, cafes } = publishedRows(dir);
  expect(pub.verifiedAt).toBe("2026-10-03");
  expect(cafe.verifiedAt).toBe("2026-10-04");
  expect(london.verifiedAt).toBe("2026-10-04");
  expect(cafes.verifiedAt).toBe("2026-10-04");
});

it("keeps same-day details on the day they were read", () => {
  const dir = setupFixture("same-day");
  const result = runCli(dir, "2026-10-03");
  expect(result.status, result.stderr).toBe(0);
  const { pub, cafe } = publishedRows(dir);
  expect(pub.verifiedAt).toBe("2026-10-03");
  expect(cafe.verifiedAt).toBe("2026-10-03");
});

for (const [name, observedAt] of [["legacy-undated", undefined], ["malformed-date", "2026-02-30"], ["future-date", "2026-10-05"]] as const) {
  it(`rechecks ${name} details rather than publishing a guessed day`, () => {
    const dir = setupFixture(name);
    const progressPath = path.join(dir, "data/places_verification/progress.json");
    const progress = JSON.parse(readFileSync(progressPath, "utf8"));
    progress.searches[PUB_ID] = { outcome: "matched", placeId: "ChIJFixturePub0001" };
    progress.searches[CAFE_ID] = { outcome: "matched", placeId: "ChIJFixtureCafe0001" };
    progress.details[PUB_ID] = { closure: "closed", nameMatched: true, operational: false, ...(observedAt ? { observedAt } : {}) };
    progress.details[CAFE_ID] = { osmHoursVerdict: "disagree", ...(observedAt ? { observedAt } : {}) };
    writeJson(progressPath, progress);
    const result = runCli(dir, "2026-10-04");
    expect(result.status, result.stderr).toBe(0);
    const { pub, cafe, london } = publishedRows(dir);
    expect(pub.verifiedAt).toBe("2026-10-04");
    expect(cafe.verifiedAt).toBe("2026-10-04");
    expect(cafe.osmHoursVerdict).toBe("no_osm_hours");
    expect(london.summary.closedPermanently).toBe(0);
  });
}
