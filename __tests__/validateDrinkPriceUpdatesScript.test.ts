// Integration test for the drink-price-update validation wired into
// scripts/validate-data.mjs (E2 of docs/PRD_ALL_DRINKS.md). Runs the actual
// script as a subprocess against a temp copy of public/data/ so we exercise
// real file I/O + real exit-code behaviour, not just a re-implementation of
// its logic.
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCRIPT = join(ROOT, "scripts", "validate-data.mjs");
const BUILD_SLIM_SCRIPT = join(ROOT, "scripts", "build_slim_index.mjs");
const DETAIL_INDEX = join(ROOT, "data", "generated", "venue_detail_index.json");

const tempDirs: string[] = [];

// Build a scratch copy of the repo's public/data/ (the real bundled datasets
// are needed too, since the script validates all of them in one run) plus a
// drink_price_updates/ directory containing exactly the given file bodies.
function setupScratch(files: Record<string, unknown>): string {
  if (!existsSync(DETAIL_INDEX)) {
    execFileSync("node", [BUILD_SLIM_SCRIPT], { cwd: ROOT });
  }
  const scratchRoot = mkdtempSync(join(tmpdir(), "validate-data-test-"));
  tempDirs.push(scratchRoot);
  const scratchScripts = join(scratchRoot, "scripts");
  const scratchData = join(scratchRoot, "public", "data");
  const scratchGeneratedData = join(scratchRoot, "data", "generated");
  const scratchFamousVenues = join(scratchRoot, "data", "famous_venues");
  const scratchLib = join(scratchRoot, "lib");
  mkdirSync(scratchScripts, { recursive: true });
  mkdirSync(join(scratchScripts, "lib"), { recursive: true });
  mkdirSync(scratchLib, { recursive: true });
  mkdirSync(scratchData, { recursive: true });
  mkdirSync(scratchGeneratedData, { recursive: true });
  mkdirSync(scratchFamousVenues, { recursive: true });
  // Copy the real script (unmodified) and the real bundled datasets it also
  // validates, so the run reflects production data validation end-to-end.
  cpSync(SCRIPT, join(scratchScripts, "validate-data.mjs"));
  cpSync(
    join(ROOT, "scripts", "lib", "validateLateFoodEvidence.mjs"),
    join(scratchScripts, "lib", "validateLateFoodEvidence.mjs"),
  );
  cpSync(
    join(ROOT, "scripts", "lib", "slimShards.mjs"),
    join(scratchScripts, "lib", "slimShards.mjs"),
  );
  cpSync(
    join(ROOT, "lib", "nightOutPlaceSourceUrl.mjs"),
    join(scratchLib, "nightOutPlaceSourceUrl.mjs"),
  );
  cpSync(
    join(ROOT, "lib", "nightOutPlaceContract.mjs"),
    join(scratchLib, "nightOutPlaceContract.mjs"),
  );
  // The dated Pint Index editions are hashed over one shared canonical form,
  // which the script imports rather than restates; without it the scratch run
  // dies at module resolution before it validates anything.
  cpSync(
    join(ROOT, "lib", "pintIndexCanonical.mjs"),
    join(scratchLib, "pintIndexCanonical.mjs"),
  );
  for (const f of [
    "london_pois.json",
    "london_localities.json",
    "tfl_lines.json",
    "pint_prices_app_dataset.json",
    "pubmaxxing_seed_snapshot.json",
    "pint_index_snapshot.json",
    "late_food_evidence.json",
  ]) {
    cpSync(join(ROOT, "public", "data", f), join(scratchData, f));
  }
  // The slim monolith + every shard the build emits (manifest, core, and one
  // per hollow outer borough) — validateSlimShards recomputes and checks them.
  for (const f of readdirSync(join(ROOT, "public", "data"))) {
    if (f.startsWith("venues_slim") && f.endsWith(".json")) {
      cpSync(join(ROOT, "public", "data", f), join(scratchData, f));
    }
  }
  // UK base rows can name curated owners from any supported city. Mirror the
  // city slim indexes so owner validation sees the same inputs as production.
  cpSync(join(ROOT, "public", "data", "cities"), join(scratchData, "cities"), {
    recursive: true,
  });
  // The UK base layer ships as a directory of per-cell shards + a manifest;
  // validateUkBaseShards reads every one of them, so the scratch needs the
  // whole directory rather than a named file list.
  cpSync(join(ROOT, "public", "data", "uk_base"), join(scratchData, "uk_base"), {
    recursive: true,
  });
  mkdirSync(join(scratchData, "night_signals"), { recursive: true });
  cpSync(
    join(ROOT, "public", "data", "night_signals", "latest.json"),
    join(scratchData, "night_signals", "latest.json"),
  );
  mkdirSync(join(scratchData, "night_out_places"), { recursive: true });
  cpSync(
    join(ROOT, "public", "data", "night_out_places", "latest.json"),
    join(scratchData, "night_out_places", "latest.json"),
  );
  cpSync(
    join(ROOT, "data", "night_out_place_provenance_registry.json"),
    join(scratchRoot, "data", "night_out_place_provenance_registry.json"),
  );
  for (const file of ["bars.json", "late_food.json", "restaurants.json"]) {
    cpSync(
      join(ROOT, "data", "famous_venues", file),
      join(scratchFamousVenues, file),
    );
  }
  mkdirSync(join(scratchData, "weather"), { recursive: true });
  cpSync(
    join(ROOT, "public", "data", "weather", "latest.json"),
    join(scratchData, "weather", "latest.json"),
  );
  for (const f of ["venue_detail_index.json", "venue_details.jsonl"]) {
    cpSync(join(ROOT, "data", "generated", f), join(scratchGeneratedData, f));
  }
  const drinkDir = join(scratchData, "drink_price_updates");
  mkdirSync(drinkDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(drinkDir, name), JSON.stringify(body), "utf8");
  }
  return scratchScripts;
}

function runValidate(scriptsDir: string): { code: number; stdout: string } {
  try {
    const stdout = execFileSync("node", ["validate-data.mjs"], {
      cwd: scriptsDir,
      encoding: "utf8",
    });
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { code: e.status, stdout: e.stdout };
  }
}

function writePubmaxxingSnapshotWithAlcoholBuckets(
  scriptsDir: string,
  counts: { alcoholic: number; nonAlcoholic: number; unknown: number },
) {
  const snapshotPath = join(scriptsDir, "..", "public", "data", "pubmaxxing_seed_snapshot.json");
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const template = snapshot.beverages[0];
  if (!template) throw new Error("pubmaxxing fixture must contain at least one beverage row");
  snapshot.beverages = [
    ...Array.from({ length: counts.alcoholic }, (_, i) => ({
      ...template,
      priceId: `test-alcoholic-${i}`,
      isAlcoholic: true,
    })),
    ...Array.from({ length: counts.nonAlcoholic }, (_, i) => ({
      ...template,
      priceId: `test-non-alcoholic-${i}`,
      isAlcoholic: false,
    })),
    ...Array.from({ length: counts.unknown }, (_, i) => ({
      ...template,
      priceId: `test-unknown-${i}`,
      isAlcoholic: null,
    })),
  ];
  snapshot.summary = {
    ...snapshot.summary,
    pubs: snapshot.pubs.length,
    beverageRows: snapshot.beverages.length,
    alcoholicRows: counts.alcoholic,
    nonAlcoholicRows: counts.nonAlcoholic,
    unknownAlcoholicRows: counts.unknown,
    historySeeds: snapshot.historySeeds.length,
    discountMentions: snapshot.discountMentions.length,
    uniquePubIds: new Set(
      [
        ...snapshot.pubs.map((row: { pubId?: string }) => row.pubId),
        ...snapshot.beverages.map((row: { pubId?: string }) => row.pubId),
      ].filter(Boolean),
    ).size,
  };
  writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const GOOD_ROW = {
  venueKey: "the test arms|1 test street|51.50000|-0.10000",
  drinkName: "Doom Bar",
  category: "beer",
  priceGbp: 5.29,
  source: {
    label: "J D Wetherspoon — official site",
    url: "https://www.jdwetherspoon.com/pubs/all-pubs/the-test-arms",
    licence: "All rights reserved — first-party publisher, attributed use only.",
  },
  observedAt: "2020-01-01T00:00:00.000Z",
};

describe("validate-data.mjs drink-price-update extension", () => {
  it("fails when the required night-out places artifact is absent", () => {
    const scriptsDir = setupScratch({});
    rmSync(join(scriptsDir, "..", "public", "data", "night_out_places", "latest.json"));
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).not.toBe(0);
    expect(stdout).toContain("FAIL public/data/night_out_places/latest.json: required artifact is missing");
  });

  it("fails malformed night-out rows through the shared contract", () => {
    const scriptsDir = setupScratch({});
    const snapshotPath = join(
      scriptsDir,
      "..",
      "public",
      "data",
      "night_out_places",
      "latest.json",
    );
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    snapshot.status = "published";
    snapshot.places = [{ id: "broken" }];
    writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

    const { code, stdout } = runValidate(scriptsDir);
    expect(code).not.toBe(0);
    expect(stdout).toContain("row 0: category and night-out job do not match");
  });

  it("fails when the night-out provenance registry is missing or mismatched", () => {
    const missingScriptsDir = setupScratch({});
    const missingRegistry = join(
      missingScriptsDir,
      "..",
      "data",
      "night_out_place_provenance_registry.json",
    );
    rmSync(missingRegistry);
    const missing = runValidate(missingScriptsDir);
    expect(missing.code).not.toBe(0);
    expect(missing.stdout).toContain("required provenance registry is missing");

    const mismatchedScriptsDir = setupScratch({});
    const mismatchedRegistry = join(
      mismatchedScriptsDir,
      "..",
      "data",
      "night_out_place_provenance_registry.json",
    );
    writeFileSync(
      mismatchedRegistry,
      JSON.stringify({ version: 2, producers: [{ id: "exa" }, { id: "firecrawl" }] }),
      "utf8",
    );
    const mismatched = runValidate(mismatchedScriptsDir);
    expect(mismatched.code).not.toBe(0);
    expect(mismatched.stdout).toContain(
      "provenance registry version/providers do not match the snapshot",
    );
  });

  it("passes with no drink_price_updates files present", () => {
    const scriptsDir = setupScratch({});
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(0);
    expect(stdout).toContain("SKIP public/data/drink_price_updates/: no .json files present");
  });

  it("validates an official-publisher Pint Index source without relying on empty coverage", () => {
    const scriptsDir = setupScratch({});
    const snapshotPath = join(scriptsDir, "..", "public", "data", "pint_index_snapshot.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    snapshot.status = "partial";
    snapshot.observationWindow = {
      start: "2026-07-01T00:00:00.000Z",
      end: "2026-07-15T23:59:59.000Z",
    };
    snapshot.sources = [{
      id: "official-pub-1",
      kind: "official_publisher",
      publisher: "Example Pub",
      publisherType: "pub",
      officialDomain: "example.com",
      sourceUrl: "https://www.example.com/drinks",
      licence: null,
    }];
    snapshot.observations = [{
      venueId: "venue-example",
      pubName: "Example Pub",
      boroughCode: "hackney",
      boroughName: "Hackney",
      pricePence: 600,
      observedAt: "2026-07-10T12:00:00.000Z",
      sourceId: "official-pub-1",
    }];
    writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(0);
    expect(stdout).toContain("PASS public/data/pint_index_snapshot.json: 1 public observations");
  });

  it("passes a well-formed drink-price-update file", () => {
    const scriptsDir = setupScratch({
      "prices_20200101.json": { version: 1, generatedAt: "2020-01-01T00:00:00.000Z", updates: [GOOD_ROW] },
    });
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(0);
    expect(stdout).toContain("PASS public/data/drink_price_updates/prices_20200101.json: 1 rows, 0 error(s)");
  });

  it("accepts a bare top-level array too", () => {
    const scriptsDir = setupScratch({ "prices_20200101.json": [GOOD_ROW] });
    const { code } = runValidate(scriptsDir);
    expect(code).toBe(0);
  });

  it("FAILS (nonzero exit) when a row is missing a permissible source", () => {
    const badRow = { ...GOOD_ROW, source: undefined };
    const scriptsDir = setupScratch({
      "prices_bad.json": { version: 1, generatedAt: "2020-01-01T00:00:00.000Z", updates: [badRow] },
    });
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("FAIL public/data/drink_price_updates/prices_bad.json");
    expect(stdout).toContain("missing source");
  });

  it("FAILS when the source is missing a licence", () => {
    const badRow = { ...GOOD_ROW, source: { label: "X", url: "https://example.com" } };
    const scriptsDir = setupScratch({
      "prices_bad.json": { version: 1, generatedAt: "2020-01-01T00:00:00.000Z", updates: [badRow] },
    });
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("missing/empty source.licence");
  });

  it("FAILS when observedAt is in the future (never present stale-or-fake as live)", () => {
    const futureRow = { ...GOOD_ROW, observedAt: "2099-01-01T00:00:00.000Z" };
    const scriptsDir = setupScratch({
      "prices_future.json": { version: 1, generatedAt: "2020-01-01T00:00:00.000Z", updates: [futureRow] },
    });
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("is in the future");
  });

  it("FAILS on a non-http(s) source URL", () => {
    const badRow = { ...GOOD_ROW, source: { ...GOOD_ROW.source, url: "ftp://example.com" } };
    const scriptsDir = setupScratch({
      "prices_bad.json": { version: 1, generatedAt: "2020-01-01T00:00:00.000Z", updates: [badRow] },
    });
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("is not an absolute http(s) URL");
  });

  it("FAILS on a negative price", () => {
    const badRow = { ...GOOD_ROW, priceGbp: -1 };
    const scriptsDir = setupScratch({
      "prices_bad.json": { version: 1, generatedAt: "2020-01-01T00:00:00.000Z", updates: [badRow] },
    });
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("priceGbp must be a finite number");
  });

  it("FAILS on a category outside the closed drinks taxonomy", () => {
    const badRow = { ...GOOD_ROW, category: "coffee" };
    const scriptsDir = setupScratch({
      "prices_bad.json": { version: 1, generatedAt: "2020-01-01T00:00:00.000Z", updates: [badRow] },
    });
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain('invalid category "coffee"');
  });

  it("FAILS when the file is not valid JSON", () => {
    const scriptsDir = setupScratch({});
    // Overwrite with malformed JSON directly (setupScratch only writes valid JSON).
    writeFileSync(join(scriptsDir, "..", "public", "data", "drink_price_updates", "prices_broken.json"), "{not json", "utf8");
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("could not read/parse");
  });
});

describe("validate-data.mjs slim venue index validation", () => {
  it("validates the shipped slim venue artifact against the full pint dataset", () => {
    const scriptsDir = setupScratch({});
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(0);
    expect(stdout).toContain("PASS public/data/venues_slim.json");
  });

  it("FAILS when the slim index does not match the full dataset ids", () => {
    const scriptsDir = setupScratch({});
    writeFileSync(
      join(scriptsDir, "..", "public", "data", "venues_slim.json"),
      JSON.stringify([
        {
          id: "venue-not-real",
          name: "Imaginary Arms",
          lat: 51.5,
          lng: -0.1,
          cheapestPrice: 5,
          borough: "Camden",
        },
      ]),
      "utf8",
    );
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("FAIL public/data/venues_slim.json");
    expect(stdout).toContain("id is not present in rebuilt full-dataset index");
  });
});

describe("validate-data.mjs pubmaxxing seed validation", () => {
  it("FAILS when a beverage row uses an invalid isAlcoholic value", () => {
    const scriptsDir = setupScratch({});
    const snapshotPath = join(scriptsDir, "..", "public", "data", "pubmaxxing_seed_snapshot.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    snapshot.beverages[0] = { ...snapshot.beverages[0], isAlcoholic: "maybe" };
    writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("isAlcoholic must be boolean, null, or omitted");
  });

  it("allows a small unclassified isAlcoholic bucket without rejecting a healthy beverage import", () => {
    const scriptsDir = setupScratch({});
    writePubmaxxingSnapshotWithAlcoholBuckets(scriptsDir, {
      alcoholic: 1250,
      nonAlcoholic: 100,
      unknown: 50,
    });

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(0);
    expect(stdout).toContain("PASS public/data/pubmaxxing_seed_snapshot.json");
  });

  it("FAILS when the unclassified isAlcoholic bucket is too large", () => {
    const scriptsDir = setupScratch({});
    writePubmaxxingSnapshotWithAlcoholBuckets(scriptsDir, {
      alcoholic: 1250,
      nonAlcoholic: 100,
      unknown: 151,
    });

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("unknown isAlcoholic rows 151 above ceiling");
  });

  it("FAILS when generated summary counts drift from the snapshot arrays", () => {
    const scriptsDir = setupScratch({});
    const snapshotPath = join(scriptsDir, "..", "public", "data", "pubmaxxing_seed_snapshot.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    snapshot.summary = { ...snapshot.summary, beverageRows: snapshot.beverages.length + 1 };
    writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("summary.beverageRows must equal computed count");
  });
});

describe("validate-data.mjs venue detail row validation", () => {
  it("validates the shipped lazy venue detail artifact against the full pint dataset", () => {
    const scriptsDir = setupScratch({});
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(0);
    expect(stdout).toContain("PASS data/generated/venue_details.jsonl");
  });

  it("FAILS when a detail row id does not match its grouped price rows", () => {
    const scriptsDir = setupScratch({});
    writeFileSync(
      join(scriptsDir, "..", "data", "generated", "venue_detail_index.json"),
      JSON.stringify({
        version: 1,
        detailsFile: "venue_details.jsonl",
        count: 1,
        venues: {
          "venue-not-real": {
            offset: 0,
            length: Buffer.byteLength(`${JSON.stringify({ id: "venue-not-real", rows: [] })}\n`),
            rowCount: 1,
          },
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(scriptsDir, "..", "data", "generated", "venue_details.jsonl"),
      `${JSON.stringify({ id: "venue-not-real", rows: [] })}\n`,
      "utf8",
    );
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("FAIL data/generated/venue_details.jsonl");
    expect(stdout).toContain("id is not present in rebuilt full-dataset index");
  });
});
