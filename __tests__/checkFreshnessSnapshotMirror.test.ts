// scripts/check_freshness.mjs is the dependency-free CLI mirror of
// lib/freshness.ts. The owner check and the /api/freshness route must reach the
// same verdict about a CLOSED lane, or the release gate and the site disagree
// about whether anything is owed a refresh.
//
// Captain ruling 2026-09-05 (drink_price_updates): a lane declared
// `class: "snapshot"` with NO staleness budget is one nothing may lawfully
// advance, so both readers date it and neither warns about it. A snapshot-class
// lane that KEEPS a budget can still be re-collected and keeps its stale
// finding: the budget's absence is the declaration, not the class alone.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { evaluateFreshness } from "@/scripts/check_freshness.mjs";
import { evaluateDataset, type FreshnessDataset } from "@/lib/freshness";
import { defined } from "@/__tests__/helpers/defined";

const NOW = new Date("2026-09-05T12:00:00Z");
const OBSERVED_AT = "2026-08-21T15:44:29.901Z";
const ARTIFACT = "public/data/closed_lane/latest.json";

let rootDir = "";

function closedLane(
  overrides: Partial<FreshnessDataset> = {},
): FreshnessDataset {
  return {
    id: "closed_lane",
    label: "Closed lane",
    class: "snapshot",
    artifact: ARTIFACT,
    stamp: { kind: "field", pointer: "generatedAt" },
    cadence: "static snapshot",
    stalenessBudgetHours: null,
    refreshWorkflow: "None. Nothing may lawfully advance it.",
    gate: "none",
    ...overrides,
  };
}

beforeAll(() => {
  rootDir = mkdtempSync(join(tmpdir(), "freshness-snapshot-mirror-"));
  mkdirSync(join(rootDir, "public", "data", "closed_lane"), { recursive: true });
  writeFileSync(
    join(rootDir, ARTIFACT),
    JSON.stringify({ generatedAt: OBSERVED_AT }),
    "utf8",
  );
});

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("the CLI mirror and the spine agree about a closed snapshot lane", () => {
  it("both date it, name it a snapshot, and raise no breach", async () => {
    const dataset = closedLane();
    const { results, breached } = await evaluateFreshness({
      now: NOW,
      rootDir,
      // The CLI mirror is plain ESM, so its registry parameter is untyped
      // rows. Widen the shared type here rather than restating the entry.
      registry: { version: 1, datasets: [{ ...dataset }] },
    });
    const spine = evaluateDataset(dataset, OBSERVED_AT, NOW);

    expect(defined(results[0]).status).toBe("snapshot");
    expect(spine.status).toBe("snapshot");
    expect(defined(results[0]).observedAt).toBe(OBSERVED_AT);
    expect(defined(results[0]).ageHours).toBe(spine.ageHours);
    expect(defined(results[0]).detail).toBe(spine.detail);
    expect(breached).toBe(false);
  });

  it("both keep the stale finding when the lane still carries a budget", async () => {
    const dataset = closedLane({ stalenessBudgetHours: 24 });
    const { results, breached } = await evaluateFreshness({
      now: NOW,
      rootDir,
      // The CLI mirror is plain ESM, so its registry parameter is untyped
      // rows. Widen the shared type here rather than restating the entry.
      registry: { version: 1, datasets: [{ ...dataset }] },
    });

    expect(defined(results[0]).status).toBe("stale");
    expect(evaluateDataset(dataset, OBSERVED_AT, NOW).status).toBe("stale");
    expect(breached).toBe(true);
  });
});
