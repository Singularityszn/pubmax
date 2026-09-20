import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bandFromSamePubProbability,
  cheapSamePubCandidate,
  isSamePubProbability,
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

describe("bandFromSamePubProbability", () => {
  // A table, not a restatement of the implementation: each row pins a verdict
  // an inverted or loosened comparison would get wrong.
  it.each([
    [1, "merge"],
    [SAME_PUB_MERGE_THRESHOLD, "merge"],
    [SAME_PUB_MERGE_THRESHOLD - 0.0001, "review"],
    [0.5, "review"],
    [SAME_PUB_REFUSE_THRESHOLD + 0.0001, "review"],
    [SAME_PUB_REFUSE_THRESHOLD, "refuse"],
    [0, "refuse"],
  ] as const)("puts %s in the %s band", (probability, band) => {
    expect(bandFromSamePubProbability(probability)).toBe(band);
  });

  // JavaScript coercion makes `"0.95" >= 0.82`, `95 >= 0.82` and `true >= 0.82`
  // all true, so a malformed answer must be rejected BEFORE any comparison: a
  // merge rewrites venue_id_aliases.json.
  it.each([
    ["0.95"],
    ["1"],
    [95],
    [1.5],
    [-0.5],
    [true],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [null],
    [undefined],
    [{ noul: 0.95 }],
  ])("refuses the non-probability %p", (value) => {
    expect(isSamePubProbability(value)).toBe(false);
    expect(bandFromSamePubProbability(value)).toBe("refuse");
  });
});

describe("recorded fixture thresholds", () => {
  const doc = JSON.parse(readFileSync(FIXTURE_PROBS, "utf8")) as {
    caseCount: number;
    model: string;
    cases: Array<{
      id: string;
      labelSame: boolean;
      labelSource: string;
      probability: number;
      band: string;
    }>;
  };
  // Only the hand-labelled rows are ground truth. The rest are labelled by
  // `namesLikelySamePub`, the incumbent rule this lane exists to second-guess,
  // so they are observations of where judge and rule disagree and can never be
  // asserted as correct answers.
  const hand = doc.cases.filter((row) => row.labelSource === "hand");

  it("records at least thirty real pairs and names the model that answered", () => {
    expect(doc.caseCount).toBeGreaterThanOrEqual(30);
    expect(doc.cases).toHaveLength(doc.caseCount);
    expect(doc.model).not.toBe("unknown");
    for (const row of doc.cases) {
      expect(row.labelSource, row.id).toMatch(/^(hand|keyless-heuristic)$/);
      expect(isSamePubProbability(row.probability), row.id).toBe(true);
    }
  });

  it("covers every hand-labelled case from the catalog", () => {
    const handIds = new Set(SAME_PUB_FIXTURE_CASES.map((c) => c.id));
    expect(hand.map((row) => row.id).sort()).toEqual([...handIds].sort());
    expect(hand.length).toBeGreaterThanOrEqual(10);
  });

  // The whole safety claim: no pair known to be two different pubs may reach
  // the merge threshold. Strictly below, not at: the band merges on equality.
  it("keeps every known false pair clear of the merge threshold", () => {
    const falsePairs = hand.filter((row) => !row.labelSame);
    expect(falsePairs.length).toBeGreaterThanOrEqual(4);
    for (const row of falsePairs) {
      expect(row.probability, row.id).toBeLessThan(SAME_PUB_MERGE_THRESHOLD);
      expect(bandFromSamePubProbability(row.probability), row.id).not.toBe("merge");
      expect(row.band, row.id).not.toBe("merge");
    }
  });

  it("keeps every known true pair clear of the refuse threshold", () => {
    const truePairs = hand.filter((row) => row.labelSame);
    expect(truePairs.length).toBeGreaterThanOrEqual(4);
    for (const row of truePairs) {
      expect(row.probability, row.id).toBeGreaterThan(SAME_PUB_REFUSE_THRESHOLD);
      expect(bandFromSamePubProbability(row.probability), row.id).not.toBe("refuse");
    }
  });

  it("pins named regression cases from the plan", () => {
    const byId = new Map(doc.cases.map((c) => [c.id, c]));
    const bell = byId.get("bell-vs-bell-and-crown");
    const kings = byId.get("kings-head-tavern");
    expect(bell?.labelSame).toBe(false);
    expect(kings?.labelSame).toBe(true);
    // "Bell" vs "Bell and Crown" must NOT merge; "Kings Head" vs "Kings Head
    // Tavern" MUST. Asserted through the band, so a threshold moved without
    // re-recording fails here.
    expect(bandFromSamePubProbability(bell?.probability)).not.toBe("merge");
    expect(bandFromSamePubProbability(kings?.probability)).toBe("merge");
    // The keyless rule must keep answering the same two cases on its own.
    expect(keylessSamePubMatch("bell", "bell and crown")).toBe(false);
    expect(keylessSamePubMatch("kings head", "kings head tavern")).toBe(true);
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
