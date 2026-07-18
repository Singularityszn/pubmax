import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateDataset,
  evaluateRegistry,
  hasBreach,
  resolveObservedAt,
  type FreshnessDataset,
  type FreshnessRegistry,
} from "@/lib/freshness";

const NOW = new Date("2026-07-18T12:00:00Z");

function dataset(overrides: Partial<FreshnessDataset> = {}): FreshnessDataset {
  return {
    id: "sample",
    label: "Sample",
    class: "cron",
    artifact: "public/data/sample.json",
    stamp: { kind: "field", pointer: "generatedAt" },
    cadence: "daily",
    stalenessBudgetHours: 48,
    refreshWorkflow: "Sample refresh",
    gate: "none",
    ...overrides,
  };
}

describe("resolveObservedAt", () => {
  it("reads a top-level field stamp", () => {
    expect(
      resolveObservedAt({ kind: "field", pointer: "generatedAt" }, { generatedAt: "2026-07-16T00:00:00Z" }),
    ).toBe("2026-07-16T00:00:00Z");
  });

  it("returns a literal stamp verbatim", () => {
    expect(resolveObservedAt({ kind: "literal", value: "2026-07-03T12:00:00Z" }, undefined)).toBe(
      "2026-07-03T12:00:00Z",
    );
  });

  it("returns null for a null spec (static data)", () => {
    expect(resolveObservedAt(null, { generatedAt: "2026-07-16T00:00:00Z" })).toBeNull();
  });

  it("returns null when the field is missing, non-string, or unparseable", () => {
    expect(resolveObservedAt({ kind: "field", pointer: "generatedAt" }, {})).toBeNull();
    expect(resolveObservedAt({ kind: "field", pointer: "generatedAt" }, { generatedAt: 5 })).toBeNull();
    expect(
      resolveObservedAt({ kind: "field", pointer: "generatedAt" }, { generatedAt: "not-a-date" }),
    ).toBeNull();
  });

  it("returns null when the artifact is missing (undefined) for a field spec", () => {
    expect(resolveObservedAt({ kind: "field", pointer: "generatedAt" }, undefined)).toBeNull();
  });

  it("returns null for an unparseable literal", () => {
    expect(resolveObservedAt({ kind: "literal", value: "nope" }, undefined)).toBeNull();
  });
});

describe("evaluateDataset — status + budget math", () => {
  it("marks a within-budget artifact fresh", () => {
    // 24h old, 48h budget.
    const r = evaluateDataset(dataset(), "2026-07-17T12:00:00Z", NOW);
    expect(r.status).toBe("fresh");
    expect(r.ageHours).toBe(24);
  });

  it("marks an over-budget artifact stale", () => {
    // 72h old, 48h budget.
    const r = evaluateDataset(dataset(), "2026-07-15T12:00:00Z", NOW);
    expect(r.status).toBe("stale");
    expect(r.ageHours).toBe(72);
  });

  it("treats exactly-at-budget as fresh (breach is strictly over)", () => {
    // 48h old, 48h budget — boundary is inclusive.
    const r = evaluateDataset(dataset(), "2026-07-16T12:00:00Z", NOW);
    expect(r.ageHours).toBe(48);
    expect(r.status).toBe("fresh");
  });

  it("flips to stale just past the budget", () => {
    // 48.1h old.
    const r = evaluateDataset(dataset(), "2026-07-16T11:54:00Z", NOW);
    expect(r.status).toBe("stale");
  });

  it("reports live datasets without ageing them", () => {
    const r = evaluateDataset(dataset({ class: "live", artifact: null, stamp: null }), null, NOW);
    expect(r.status).toBe("live");
    expect(r.ageHours).toBeNull();
  });

  it("reports a stamped-but-unresolved artifact as unknown", () => {
    const r = evaluateDataset(dataset(), null, NOW);
    expect(r.status).toBe("unknown");
  });

  it("reports a null-budget, null-stamp static dataset as untracked", () => {
    const r = evaluateDataset(
      dataset({ class: "static", stamp: null, stalenessBudgetHours: null }),
      null,
      NOW,
    );
    expect(r.status).toBe("untracked");
    expect(r.ageHours).toBeNull();
  });

  it("shows age but stays untracked when a stamp exists with no budget", () => {
    const r = evaluateDataset(
      dataset({ class: "episodic", stalenessBudgetHours: null }),
      "2026-01-01T12:00:00Z",
      NOW,
    );
    expect(r.status).toBe("untracked");
    expect(r.ageHours).toBeGreaterThan(0);
  });
});

describe("evaluateRegistry + hasBreach", () => {
  const registry: FreshnessRegistry = {
    version: 1,
    datasets: [
      dataset({ id: "fresh-one" }),
      dataset({ id: "stale-one" }),
      dataset({ id: "live-one", class: "live", artifact: null, stamp: null }),
    ],
  };

  const stamps: Record<string, string | null> = {
    "fresh-one": "2026-07-18T00:00:00Z",
    "stale-one": "2026-07-10T00:00:00Z",
    "live-one": null,
  };

  it("evaluates every dataset via the injected stamp resolver", () => {
    const results = evaluateRegistry(registry, (d) => stamps[d.id] ?? null, NOW);
    expect(results.map((r) => r.status)).toEqual(["fresh", "stale", "live"]);
  });

  it("detects a breach when any dataset is stale or unknown", () => {
    const results = evaluateRegistry(registry, (d) => stamps[d.id] ?? null, NOW);
    expect(hasBreach(results)).toBe(true);
  });

  it("reports no breach when all datasets are fresh/live/untracked", () => {
    const results = evaluateRegistry(
      { version: 1, datasets: [dataset({ id: "fresh-one" })] },
      () => "2026-07-18T06:00:00Z",
      NOW,
    );
    expect(hasBreach(results)).toBe(false);
  });
});

describe("data/freshness_registry.json integrity", () => {
  const root = join(__dirname, "..");
  const registry = JSON.parse(
    readFileSync(join(root, "data", "freshness_registry.json"), "utf8"),
  ) as FreshnessRegistry;

  it("declares a versioned, non-empty dataset list with unique ids", () => {
    expect(registry.version).toBe(1);
    expect(registry.datasets.length).toBeGreaterThan(0);
    const ids = registry.datasets.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every declared artifact path present on disk", () => {
    for (const d of registry.datasets) {
      if (!d.artifact) continue;
      const exists = readFileSync(join(root, d.artifact), "utf8");
      expect(typeof exists).toBe("string");
    }
  });

  it("uses only known classes and coherent budget/stamp shapes", () => {
    const classes = new Set(["cron", "episodic", "user-cadence", "live", "static"]);
    for (const d of registry.datasets) {
      expect(classes.has(d.class)).toBe(true);
      if (d.stalenessBudgetHours !== null) {
        expect(d.stalenessBudgetHours).toBeGreaterThan(0);
      }
      // A budgeted dataset must have a way to observe its stamp.
      if (d.stalenessBudgetHours !== null) {
        expect(d.stamp).not.toBeNull();
        expect(d.artifact).not.toBeNull();
      }
      // Live datasets carry no disk artifact to age.
      if (d.class === "live") {
        expect(d.artifact).toBeNull();
        expect(d.stalenessBudgetHours).toBeNull();
      }
    }
  });

  it("resolves a real observed stamp for every budgeted artifact", () => {
    for (const d of registry.datasets) {
      if (d.stalenessBudgetHours === null) continue;
      const raw = JSON.parse(readFileSync(join(root, d.artifact as string), "utf8"));
      expect(resolveObservedAt(d.stamp, raw)).not.toBeNull();
    }
  });
});
