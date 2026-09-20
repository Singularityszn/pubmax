// The judged same-pub lane decides whether two venue identities are folded into
// one. A wrong merge rewrites venue_id_aliases.json and repoints pint drops and
// saved plans, so every path that is NOT an explicit merge verdict has to end
// with no alias: refuse, the review band, a malformed answer and a transport
// failure alike.

import { beforeEach, describe, expect, it, vi } from "vitest";

const judgeSamePubPair = vi.fn();

vi.mock("@/lib/samePubIdentity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/samePubIdentity")>();
  return { ...actual, judgeSamePubPair, typesafeConfigured: () => true };
});

const { buildJudgedSamePubMatch, samePubReviewDocument } = await import(
  "../scripts/lib/samePubJudgedCanonicalize"
);
const { canonicalizeDataset } = await import("../scripts/lib/venueCanonicalization.mjs");

// Two identities 20 m apart sharing one distinctive token: a candidate pair
// under the cheap gates, and NOT a merge under the keyless rule.
const BELL = {
  id: "v_bell",
  name: "The Bell",
  address: "High Street, London",
  lat: 51.5,
  lng: -0.1,
  normName: "bell",
};
const BELL_CROWN = {
  id: "v_bell_crown",
  name: "The Bell and Crown",
  address: "High Street, London",
  lat: 51.50018,
  lng: -0.1,
  normName: "bell and crown",
};

function judgment(probability: number, band: "merge" | "refuse" | "review") {
  return { probability, band, model: "jev-test" };
}

beforeEach(() => {
  judgeSamePubPair.mockReset();
});

describe("buildJudgedSamePubMatch bands", () => {
  it("merges only on an explicit merge verdict", async () => {
    judgeSamePubPair.mockResolvedValue(judgment(0.94, "merge"));
    const { samePubMatch, review } = await buildJudgedSamePubMatch([BELL, BELL_CROWN]);
    expect(samePubMatch(BELL, BELL_CROWN)).toBe(true);
    expect(samePubMatch(BELL_CROWN, BELL)).toBe(true);
    expect(review).toEqual([]);
  });

  it("refuses on a refuse verdict and writes no review row", async () => {
    judgeSamePubPair.mockResolvedValue(judgment(0.12, "refuse"));
    const { samePubMatch, review } = await buildJudgedSamePubMatch([BELL, BELL_CROWN]);
    expect(samePubMatch(BELL, BELL_CROWN)).toBe(false);
    expect(review).toEqual([]);
  });

  it("never merges the review band, and queues it for the captain instead", async () => {
    judgeSamePubPair.mockResolvedValue(judgment(0.6, "review"));
    const { samePubMatch, review } = await buildJudgedSamePubMatch([BELL, BELL_CROWN]);
    expect(samePubMatch(BELL, BELL_CROWN)).toBe(false);
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({
      a: { id: "v_bell" },
      b: { id: "v_bell_crown" },
      probability: 0.6,
    });
  });

  it("refuses a pair that was never judged", async () => {
    judgeSamePubPair.mockResolvedValue(judgment(0.99, "merge"));
    const { samePubMatch } = await buildJudgedSamePubMatch([BELL, BELL_CROWN]);
    const stranger = { ...BELL, id: "v_unjudged" };
    expect(samePubMatch(BELL, stranger)).toBe(false);
  });

  it("aborts the run when TypeSafe fails mid-pass rather than merging", async () => {
    judgeSamePubPair.mockRejectedValue(new Error("fetch failed: ETIMEDOUT"));
    await expect(buildJudgedSamePubMatch([BELL, BELL_CROWN])).rejects.toThrow("ETIMEDOUT");
  });

  it("aborts when a call fails and comes back null rather than merging", async () => {
    judgeSamePubPair.mockResolvedValue(null);
    await expect(buildJudgedSamePubMatch([BELL, BELL_CROWN])).rejects.toThrow(
      "No aliases were written",
    );
  });
});

describe("judged verdicts reaching canonicalizeDataset", () => {
  function rowsForPair() {
    const base = {
      address: "High Street, London",
      price_gbp: 5,
      source_datasets: "test",
    };
    return [
      { ...base, app_price_id: "p1", pub_name: "The Bell", latitude: 51.5, longitude: -0.1 },
      {
        ...base,
        app_price_id: "p2",
        pub_name: "The Bell and Crown",
        latitude: 51.50018,
        longitude: -0.1,
      },
    ];
  }

  it("folds the pair only when the judge said merge", () => {
    const merged = canonicalizeDataset(rowsForPair(), {
      fuzzyMergeMeters: 120,
      samePubMatch: () => true,
    });
    expect(merged.stats.duplicateClusters).toBe(1);
    expect(Object.keys(merged.aliases)).toHaveLength(1);
  });

  it("writes no alias when the judge refused or sent the pair to review", () => {
    for (const verdict of [false, false]) {
      const out = canonicalizeDataset(rowsForPair(), {
        fuzzyMergeMeters: 120,
        samePubMatch: () => verdict,
      });
      expect(out.stats.duplicateClusters).toBe(0);
      expect(out.aliases).toEqual({});
    }
  });
});

describe("the review queue is a committed artifact", () => {
  const entry = (id: string, probability: number) => ({
    a: { id: `a_${id}`, name: "A", address: "London" },
    b: { id: `b_${id}`, name: "B", address: "London" },
    distanceMetres: 20,
    probability,
  });

  it("carries no clock, so the same verdicts produce the same bytes", () => {
    const first = samePubReviewDocument([entry("two", 0.6), entry("one", 0.5)]);
    const second = samePubReviewDocument([entry("one", 0.5), entry("two", 0.6)]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("matches the committed empty queue exactly", async () => {
    const { readFileSync } = await import("node:fs");
    const committed = readFileSync("data/review/same-pub-review.json", "utf8");
    expect(committed).toBe(`${JSON.stringify(samePubReviewDocument([]), null, 2)}\n`);
  });
});
