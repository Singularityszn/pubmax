// Integration test for the drink-price-update validation wired into
// scripts/validate-data.mjs (E2 of docs/PRD_ALL_DRINKS.md). Runs the actual
// script as a subprocess against a temp copy of public/data/ so we exercise
// real file I/O + real exit-code behaviour, not just a re-implementation of
// its logic.
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCRIPT = join(ROOT, "scripts", "validate-data.mjs");

const tempDirs: string[] = [];

// Build a scratch copy of the repo's public/data/ (the real bundled datasets
// are needed too, since the script validates all of them in one run) plus a
// drink_price_updates/ directory containing exactly the given file bodies.
function setupScratch(files: Record<string, unknown>): string {
  const scratchRoot = mkdtempSync(join(tmpdir(), "validate-data-test-"));
  tempDirs.push(scratchRoot);
  const scratchScripts = join(scratchRoot, "scripts");
  const scratchData = join(scratchRoot, "public", "data");
  mkdirSync(scratchScripts, { recursive: true });
  mkdirSync(scratchData, { recursive: true });
  // Copy the real script (unmodified) and the real bundled datasets it also
  // validates, so the run reflects production data validation end-to-end.
  cpSync(SCRIPT, join(scratchScripts, "validate-data.mjs"));
  for (const f of ["london_pois.json", "tfl_lines.json", "pint_prices_app_dataset.json"]) {
    cpSync(join(ROOT, "public", "data", f), join(scratchData, f));
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
  it("passes with no drink_price_updates files present", () => {
    const scriptsDir = setupScratch({});
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(0);
    expect(stdout).toContain("SKIP public/data/drink_price_updates/: no .json files present");
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
