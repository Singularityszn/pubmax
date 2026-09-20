import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bandFromSamePubProbability,
  cheapSamePubCandidate,
  keylessSamePubMatch,
  SAME_PUB_MERGE_THRESHOLD,
  SAME_PUB_REFUSE_THRESHOLD,
} from "@/lib/samePubIdentity";
import { canonicalizeDataset } from "../scripts/lib/venueCanonicalization.mjs";
import { SAME_PUB_FIXTURE_CASES } from "./fixtures/typesafe/samePubFixtureCases";

const FIXTURE_PROBS = path.join(
  process.cwd(),
  "__tests__/fixtures/typesafe/same-pub-probabilities.json",
);

function makeRow(overrides: Record<string, unknown>) {
  return {
    app_price_id: "app_price_test",
    pub_name: "Test Pub",
    address: "1 High St, London",
    latitude: 51.5,
    longitude: -0.1,
    price_gbp: 5,
    source_datasets: "test",
    ...overrides,
  };
}

describe("samePubIdentity keyless fallback", () => {
  it("matches Kings Head / Kings Head Tavern and refuses Bell / Bell and Crown", () => {
    expect(keylessSamePubMatch("kings head", "kings head tavern")).toBe(true);
    expect(keylessSamePubMatch("bell", "bell and crown")).toBe(false);
  });

  it("canonicalizeDataset uses keyless fuzzy rules without a judge", () => {
    const bell = makeRow({ pub_name: "The Bell", latitude: 51.5, longitude: -0.1 });
    const bellCrown = makeRow({
      pub_name: "The Bell and Crown",
      latitude: 51.50018,
      longitude: -0.1,
    });
    const { stats } = canonicalizeDataset([bell, bellCrown]);
    expect(stats.duplicateClusters).toBe(0);

    const a = makeRow({ pub_name: "The Kings Head", latitude: 51.4105, longitude: -0.3005 });
    const b = makeRow({
      pub_name: "Kings Head Tavern",
      latitude: 51.41053,
      longitude: -0.30045,
      price_gbp: null,
    });
    const merged = canonicalizeDataset([a, b]);
    expect(merged.stats.duplicateClusters).toBe(1);
  });
});

describe("cheapSamePubCandidate", () => {
  it("requires a shared distinctive token within distance", () => {
    const near = {
      lat: 51.5,
      lng: -0.1,
      address: "London",
      normName: "red lion",
    };
    const far = { ...near, lat: 51.52 };
    const other = { ...near, normName: "slug and lettuce" };
    expect(cheapSamePubCandidate(near, { ...near, normName: "red lion pub" })).toBe(true);
    expect(cheapSamePubCandidate(near, far)).toBe(false);
    expect(cheapSamePubCandidate(near, other)).toBe(false);
  });
});

describe("recorded fixture thresholds", () => {
  it("classifies every hand-labelled case with committed thresholds", () => {
    const handIds = new Set(SAME_PUB_FIXTURE_CASES.map((c) => c.id));
    const doc = JSON.parse(readFileSync(FIXTURE_PROBS, "utf8")) as {
      cases: Array<{ id: string; labelSame: boolean; probability: number }>;
      caseCount: number;
    };
    expect(doc.caseCount).toBeGreaterThanOrEqual(30);
    const handCases = doc.cases.filter((row) => handIds.has(row.id));
    expect(handCases.length).toBe(SAME_PUB_FIXTURE_CASES.length);
    for (const row of handCases) {
      const band = bandFromSamePubProbability(row.probability);
      if (row.labelSame) {
        expect(row.probability).toBeGreaterThanOrEqual(SAME_PUB_REFUSE_THRESHOLD);
        if (row.probability >= SAME_PUB_MERGE_THRESHOLD) {
          expect(band).toBe("merge");
        }
      } else {
        expect(row.probability).toBeLessThanOrEqual(SAME_PUB_MERGE_THRESHOLD);
        if (row.probability <= SAME_PUB_REFUSE_THRESHOLD) {
          expect(band).toBe("refuse");
        }
      }
    }
  });

  it("pins named regression cases from the plan", () => {
    const byId = new Map(
      (
        JSON.parse(readFileSync(FIXTURE_PROBS, "utf8")) as {
          cases: Array<{ id: string; labelSame: boolean; probability: number }>;
        }
      ).cases.map((c) => [c.id, c]),
    );
    expect(byId.get("bell-vs-bell-and-crown")?.labelSame).toBe(false);
    expect(byId.get("kings-head-tavern")?.labelSame).toBe(true);
    const bellProb = byId.get("bell-vs-bell-and-crown")?.probability ?? 1;
    const kingsProb = byId.get("kings-head-tavern")?.probability ?? 0;
    expect(bellProb).toBeLessThanOrEqual(SAME_PUB_MERGE_THRESHOLD);
    expect(kingsProb).toBeGreaterThanOrEqual(SAME_PUB_MERGE_THRESHOLD);
  });
});

describe("samePub fixture case catalog", () => {
  it("ships at least ten hand-labelled cases", () => {
    expect(SAME_PUB_FIXTURE_CASES.length).toBeGreaterThanOrEqual(10);
  });
});

describe("canonicalize script keyless", () => {
  it("refuses --judged without TYPESAFE_API_KEY", async () => {
    delete process.env.TYPESAFE_API_KEY;
    const { requiresTypesafeKeyMessage, typesafeConfigured } = await import("@/lib/samePubIdentity");
    expect(typesafeConfigured()).toBe(false);
    expect(requiresTypesafeKeyMessage()).toContain("TYPESAFE_API_KEY");
  });
});
