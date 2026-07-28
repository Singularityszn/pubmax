import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  evaluateDataset,
  evaluateRegistry,
  hasBreach,
  resolveObservedAt,
  resolveStamp,
  staleFeeds,
  unresolvedFeeds,
  type FreshnessDataset,
  type FreshnessRegistry,
} from "@/lib/freshness";
import { readFreshnessArtifact, resolveDatasetStamp } from "@/lib/freshnessArtifact";

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

describe("resolveStamp — why a stamp could not be resolved", () => {
  const spec = { kind: "field", pointer: "generatedAt" } as const;

  it("resolves the field and attaches no reason", () => {
    expect(
      resolveStamp(spec, {
        kind: "ok",
        path: "public/data/sample.json",
        json: { generatedAt: "2026-07-16T00:00:00Z" },
      }),
    ).toEqual({ observedAt: "2026-07-16T00:00:00Z", reason: null });
  });

  it("names the artifact that is not there, rather than blaming the data", () => {
    const r = resolveStamp(spec, { kind: "missing", path: "public/data/sample.json" });
    expect(r.observedAt).toBeNull();
    expect(r.reason).toContain("public/data/sample.json");
    expect(r.reason).toContain("not present at runtime");
  });

  it("distinguishes an unparseable file from a missing one", () => {
    const r = resolveStamp(spec, {
      kind: "unreadable",
      path: "public/data/sample.json",
      error: "Unexpected token }",
    });
    expect(r.reason).toContain("could not be parsed");
    expect(r.reason).toContain("Unexpected token }");
  });

  it("distinguishes a present file missing the stamp field", () => {
    const r = resolveStamp(spec, { kind: "ok", path: "public/data/sample.json", json: {} });
    expect(r.reason).toContain("no parseable \"generatedAt\" field");
  });

  it("gives every failure mode a DIFFERENT sentence, so an alert is actionable", () => {
    const reasons = [
      resolveStamp(spec, { kind: "missing", path: "a.json" }).reason,
      resolveStamp(spec, { kind: "unreadable", path: "a.json", error: "boom" }).reason,
      resolveStamp(spec, { kind: "ok", path: "a.json", json: {} }).reason,
      resolveStamp(spec, { kind: "absent" }).reason,
      resolveStamp({ kind: "literal", value: "nope" }, { kind: "absent" }).reason,
    ];
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it("reports no reason for a dataset that never promised a stamp", () => {
    expect(resolveStamp(null, { kind: "absent" })).toEqual({ observedAt: null, reason: null });
  });

  it("returns a literal stamp without touching the artifact", () => {
    expect(
      resolveStamp({ kind: "literal", value: "2026-07-03T12:00:00Z" }, { kind: "missing", path: "gone.json" }),
    ).toEqual({ observedAt: "2026-07-03T12:00:00Z", reason: null });
  });
});

describe("readFreshnessArtifact + resolveStamp — real files on disk", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "freshness-artifact-"));
    writeFileSync(join(dir, "resolves.json"), JSON.stringify({ generatedAt: "2026-07-17T09:00:00Z" }));
    writeFileSync(join(dir, "no-stamp.json"), JSON.stringify({ rows: [] }));
    writeFileSync(join(dir, "broken.json"), "{ not json");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const spec = { kind: "field", pointer: "generatedAt" } as const;

  it("computes a genuine age for an artifact whose timestamp resolves", () => {
    const { observedAt, reason } = resolveStamp(spec, readFreshnessArtifact(dir, "resolves.json"));
    expect(reason).toBeNull();
    const r = evaluateDataset(dataset(), observedAt, NOW, reason);
    expect(r.status).toBe("fresh");
    expect(r.ageHours).toBe(27);
  });

  it("reports unknown, never fresh, for an artifact that is not on disk", () => {
    const { observedAt, reason } = resolveStamp(spec, readFreshnessArtifact(dir, "absent.json"));
    const r = evaluateDataset(dataset(), observedAt, NOW, reason);
    expect(r.status).toBe("unknown");
    expect(r.ageHours).toBeNull();
    expect(r.detail).toContain("absent.json");
  });

  it("reports unknown for a file that is present but carries no stamp", () => {
    const { observedAt, reason } = resolveStamp(spec, readFreshnessArtifact(dir, "no-stamp.json"));
    const r = evaluateDataset(dataset(), observedAt, NOW, reason);
    expect(r.status).toBe("unknown");
    expect(r.detail).toContain("no-stamp.json");
  });

  it("reports unknown, with the parse error, for a corrupt file", () => {
    const read = readFreshnessArtifact(dir, "broken.json");
    expect(read.kind).toBe("unreadable");
    const r = evaluateDataset(dataset(), null, NOW, resolveStamp(spec, read).reason);
    expect(r.status).toBe("unknown");
    expect(r.detail).toContain("could not be parsed");
  });
});

describe("resolveDatasetStamp — a route opens only what it will read", () => {
  function countingRead() {
    const opened: (string | null)[] = [];
    const read = (_root: string, relPath: string | null) => {
      opened.push(relPath);
      return relPath === null
        ? ({ kind: "absent" } as const)
        : ({ kind: "missing", path: relPath } as const);
    };
    return { opened, read };
  }

  it("opens the artifact for a field stamp", () => {
    const { opened, read } = countingRead();
    const { observedAt, reason } = resolveDatasetStamp("/root", dataset(), read);
    expect(opened).toEqual(["public/data/sample.json"]);
    expect(observedAt).toBeNull();
    expect(reason).toContain("public/data/sample.json");
  });

  it("never opens the artifact of a literal-stamped dataset", () => {
    const { opened, read } = countingRead();
    const resolution = resolveDatasetStamp(
      "/root",
      dataset({ stamp: { kind: "literal", value: "2026-07-03T12:00:00Z" }, artifact: "public/data/huge.json" }),
      read,
    );
    expect(opened).toEqual([]);
    expect(resolution).toEqual({ observedAt: "2026-07-03T12:00:00Z", reason: null });
  });

  it("never opens the artifact of an unstamped dataset", () => {
    const { opened, read } = countingRead();
    const resolution = resolveDatasetStamp(
      "/root",
      dataset({ stamp: null, artifact: "public/data/reference.json" }),
      read,
    );
    expect(opened).toEqual([]);
    expect(resolution).toEqual({ observedAt: null, reason: null });
  });

  it("still reports a field stamp with no artifact as unresolvable", () => {
    const { opened, read } = countingRead();
    const { observedAt, reason } = resolveDatasetStamp("/root", dataset({ artifact: null }), read);
    expect(opened).toEqual([null]);
    expect(observedAt).toBeNull();
    expect(reason).toContain("no artifact to read it from");
  });
});

describe("staleFeeds / unresolvedFeeds — two findings, never merged", () => {
  const results = [
    evaluateDataset(dataset({ id: "old" }), "2026-07-01T12:00:00Z", NOW),
    evaluateDataset(dataset({ id: "blind" }), null, NOW, "Artifact gone.json is not present at runtime."),
    evaluateDataset(dataset({ id: "good" }), "2026-07-18T00:00:00Z", NOW),
  ];

  it("keeps a stale feed out of the unresolved list and vice versa", () => {
    expect(staleFeeds(results).map((r) => r.id)).toEqual(["old"]);
    expect(unresolvedFeeds(results).map((r) => r.id)).toEqual(["blind"]);
  });

  it("never counts an unresolved feed as fresh", () => {
    const blind = results.find((r) => r.id === "blind");
    expect(blind?.status).toBe("unknown");
    expect(blind?.status).not.toBe("fresh");
    expect(hasBreach(results)).toBe(true);
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
    const results = evaluateRegistry(
      registry,
      (d) => ({ observedAt: stamps[d.id] ?? null, reason: null }),
      NOW,
    );
    expect(results.map((r) => r.status)).toEqual(["fresh", "stale", "live"]);
  });

  it("detects a breach when any dataset is stale or unknown", () => {
    const results = evaluateRegistry(
      registry,
      (d) => ({ observedAt: stamps[d.id] ?? null, reason: null }),
      NOW,
    );
    expect(hasBreach(results)).toBe(true);
  });

  it("reports no breach when all datasets are fresh/live/untracked", () => {
    const results = evaluateRegistry(
      { version: 1, datasets: [dataset({ id: "fresh-one" })] },
      () => ({ observedAt: "2026-07-18T06:00:00Z", reason: null }),
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

  it("does not classify manually published feeds as cron schedules", () => {
    const byId = new Map(registry.datasets.map((dataset) => [dataset.id, dataset]));

    expect(byId.get("pint_prices")?.class).toBe("episodic");
    expect(byId.get("night_signals")).toMatchObject({
      class: "episodic",
      stalenessBudgetHours: null,
    });
    expect(byId.get("price_updates")?.class).toBe("cron");
    expect(byId.get("night_signal_candidates")?.class).toBe("cron");
  });

  it("keeps cron ingestion feeds separate from the artifacts they cannot publish", () => {
    const byId = new Map(registry.datasets.map((dataset) => [dataset.id, dataset]));

    // An ingestion feed a serverless cron stamps carries no committed artifact,
    // so a run can never be mistaken for a publish of the file readers get.
    for (const id of ["price_update_retrieval", "night_signal_candidates"]) {
      expect(byId.get(id)).toMatchObject({
        class: "cron",
        artifact: null,
        stamp: null,
        stalenessBudgetHours: null,
      });
    }

    expect(byId.get("price_updates")?.artifact).toBe(
      "public/data/price_updates/latest.json",
    );
    expect(byId.get("price_updates")?.stalenessBudgetHours).toBe(336);
  });

  it("gives every live TfL read its own alarm", () => {
    const byId = new Map(registry.datasets.map((dataset) => [dataset.id, dataset]));

    // Three separate TfL surfaces, three separate entries. They share one HTTP
    // client and one keyless upstream, which is exactly why merging them would
    // be tempting and wrong: each has its own endpoint, fan-out, timeout budget
    // and failure mode, so a healthy last-train or disruption read must never
    // stand in for a bus card that has gone dark. Each entry names ITS route.
    const routeByDataset = {
      tfl_last_train: "app/api/last-train",
      tfl_nearby_buses: "app/api/nearby-bus-departures",
      tfl_disruption: "app/api/tfl-disruption",
    } as const;

    for (const [id, route] of Object.entries(routeByDataset)) {
      const dataset = byId.get(id);
      expect(dataset).toMatchObject({ class: "live", artifact: null, stamp: null });
      expect(dataset?.refreshWorkflow).toContain(route);
      // No entry may claim another's route, which is what a quiet recombination
      // would look like in this file.
      for (const [otherId, otherRoute] of Object.entries(routeByDataset)) {
        if (otherId === id) continue;
        expect(dataset?.refreshWorkflow).not.toContain(otherRoute);
      }
    }
  });

  it("keeps every declared artifact path present on disk", () => {
    for (const d of registry.datasets) {
      if (!d.artifact) continue;
      const exists = readFileSync(join(root, d.artifact), "utf8");
      expect(typeof exists).toBe("string");
    }
  });

  it("uses only known classes and coherent budget/stamp shapes", () => {
    // "snapshot" = a point-in-time captured dataset re-extracted on demand
    // (area_news fresh-facts layer, Cycle 15 Lane A).
    const classes = new Set(["cron", "episodic", "user-cadence", "live", "static", "snapshot"]);
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
