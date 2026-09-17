// F12, and the honesty-lane retirement that followed it.
//
// `price_updates` described its envelope date as naming one fixed collection
// day (2026-07-03) while the shipped envelope carried 2026-09-04. Nobody was
// wrong about the RULE, which is that the empty envelope tracks the bundled
// pint dataset's collection day; the prose named a day, and days move.
//
// The lane is now RETIRED, and so is `food_price_updates`: neither has a
// producer in this tree, so `/api/freshness` reports both as `retired` rather
// than as feeds anybody owes a run. This file holds three things to each
// other so none of them can rot back: the registry declaration, the shipped
// artifact, and the absence of the machinery that used to imply progress.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { evaluateFreshness } from "@/scripts/check_freshness.mjs";
import { evaluateDataset, hasBreach } from "@/lib/freshness";

const ROOT = path.resolve(__dirname, "..");

type Dataset = {
  id: string;
  class: string;
  artifact: string | null;
  refreshWorkflow: string;
  gate: string;
  stalenessBudgetHours: number | null;
  retired?: boolean;
  stamp: { kind: string; value?: string; pointer?: string } | null;
};

const registry = JSON.parse(
  readFileSync(path.join(ROOT, "data", "freshness_registry.json"), "utf8"),
) as { version: number; datasets: Dataset[] };

const packageJson = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

function dataset(id: string): Dataset {
  const found = registry.datasets.find((entry) => entry.id === id);
  expect(found, `registry holds ${id}`).toBeDefined();
  return found as Dataset;
}

/** Every lane that declares itself closed. Both of them, today. */
const retiredIds = registry.datasets
  .filter((entry) => entry.retired === true)
  .map((entry) => entry.id);

describe("a retired lane says so in the registry and in the spine", () => {
  it("is the two price lanes nothing writes, and no others", () => {
    expect(retiredIds.sort()).toEqual(["food_price_updates", "price_updates"]);
  });

  it("carries no staleness budget, because nobody can be late for nothing", () => {
    for (const id of retiredIds) {
      expect(dataset(id).stalenessBudgetHours, id).toBeNull();
    }
  });

  it("evaluates as retired against the shipped artifact, and never as a breach", async () => {
    // Run through the real CLI checker with the artifacts on disk and a clock
    // far past any budget either lane ever carried, so the proof is the
    // classification rather than a sentence in the registry.
    const { results, breached } = await evaluateFreshness({
      now: new Date("2030-01-01T00:00:00Z"),
      rootDir: ROOT,
      registry: { ...registry, datasets: retiredIds.map(dataset) },
    });
    expect(results.map((row) => row.id).sort()).toEqual(retiredIds.sort());
    for (const row of results) {
      expect(row.status, row.id).toBe("retired");
      expect(["fresh", "stale", "untracked", "snapshot"]).not.toContain(row.status);
      // The date the artifact carries still rides along: a reader is owed it
      // even when no refresh is.
      expect(row.observedAt, row.id).not.toBeNull();
    }
    expect(breached).toBe(false);
  });

  it("keeps the artifact's own integrity: a stamp that stops resolving is still a breach", () => {
    // Retiring a lane retires its REFRESH. `food_price_updates` is a 3 MB pack
    // the venue Menu tab reads, so "the file that ships has gone missing" must
    // stay the finding it always was.
    const food = dataset("food_price_updates");
    const missing = evaluateDataset(
      food as never,
      null,
      new Date("2030-01-01T00:00:00Z"),
      "Artifact public/data/food_price_updates/latest.json is not present at runtime, so its age cannot be measured.",
    );
    expect(missing.status).toBe("unknown");
    expect(hasBreach([missing])).toBe(true);
  });

  it("names no fixed collection day, because a typed date rots", () => {
    for (const id of retiredIds) {
      expect(dataset(id).refreshWorkflow, id).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    }
  });
});

describe("price_updates: the empty envelope and the deleted producer", () => {
  const priceUpdates = dataset("price_updates");

  it("still ships an EMPTY envelope, which is what makes its date an envelope date", () => {
    const envelope = JSON.parse(
      readFileSync(path.join(ROOT, priceUpdates.artifact as string), "utf8"),
    ) as { updates: unknown[]; generatedAt: string };
    expect(envelope.updates).toEqual([]);
    expect(Number.isFinite(Date.parse(envelope.generatedAt))).toBe(true);
  });

  it("says what the envelope date actually means", () => {
    expect(priceUpdates.refreshWorkflow).toMatch(/dates NO observation/i);
    expect(priceUpdates.refreshWorkflow).toMatch(/envelope date/i);
  });

  it("keeps the envelope aligned to the bundled dataset's own collection day", () => {
    // The rule the prose states, checked against the two stamps rather than
    // asserted about one of them. The bundled dataset's collection day is the
    // registry's own literal stamp, which lib/dataFreshness.ts derives from.
    const pintStamp = registry.datasets.find((entry) => entry.id === "pint_prices")?.stamp;
    expect(pintStamp?.kind).toBe("literal");
    const envelope = JSON.parse(
      readFileSync(path.join(ROOT, priceUpdates.artifact as string), "utf8"),
    ) as { generatedAt: string };
    expect(new Date(envelope.generatedAt).toISOString().slice(0, 10)).toBe(
      new Date(pintStamp?.value as string).toISOString().slice(0, 10),
    );
  });

  it("has no producer left to imply progress with", () => {
    // Deleted rather than switched off: the publish, the stub parser module
    // behind it, and the package script that ran it. A `fetchFromSource` that
    // returns [] by construction is a promise of a parser, and there is no
    // permissible source for one to read.
    expect(packageJson.scripts["refresh:prices"]).toBeUndefined();
    for (const script of Object.values(packageJson.scripts)) {
      expect(script).not.toContain("refresh_prices.mjs");
      expect(script).not.toContain("price_source_fetchers.mjs");
    }
  });

  it("holds no placeholder in the source allowlist it used to read", () => {
    const sources = JSON.parse(
      readFileSync(path.join(ROOT, "data", "price_sources.json"), "utf8"),
    ) as { sources: { id: string; url: string }[] };
    expect(sources.sources).toEqual([]);
  });
});
