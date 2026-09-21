import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const judgeHeritageListingStructure = vi.fn();
const judgeSamePubPair = vi.fn();

vi.mock("@/lib/heritageListingStructure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/heritageListingStructure")>();
  return {
    ...actual,
    judgeHeritageListingStructure,
    typesafeConfigured: () => true,
  };
});

vi.mock("@/lib/samePubIdentity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/samePubIdentity")>();
  return { ...actual, judgeSamePubPair };
});

const { judgedEvaluateMatch } = await import("../scripts/lib/heritageJudgedMatch");
const { samePubReviewDocument } = await import("../scripts/lib/samePubJudgedCanonicalize");

const PUB = { id: "venue-hamilton", name: "The Duke of Hamilton", lat: 51.55, lng: -0.18 };
const STABLES = {
  listEntry: 1,
  name: "STABLES IN REAR YARD OF THE DUKE OF HAMILTON PUBLIC HOUSE (PUBLIC HOUSE NOT INCLUDED)",
  grade: "II",
  lat: 51.55,
  lng: -0.18,
};
const PUB_LISTING = {
  listEntry: 2,
  name: "THE DUKE OF HAMILTON PUBLIC HOUSE",
  grade: "II",
  lat: 51.55,
  lng: -0.18,
};

beforeEach(() => {
  judgeHeritageListingStructure.mockReset();
  judgeSamePubPair.mockReset();
});

describe("judgedEvaluateMatch", () => {
  it("never matches a structure-refuse listing even when same-pub would merge", async () => {
    judgeHeritageListingStructure.mockResolvedValue({
      probability: 0.05,
      band: "refuse",
      model: "jev-test",
    });
    const result = await judgedEvaluateMatch(PUB, STABLES);
    expect(result.matched).toBe(false);
    expect(result.structureBand).toBe("refuse");
    expect(judgeSamePubPair).not.toHaveBeenCalled();
  });

  it("queues a structure-review listing and does not auto-match", async () => {
    judgeHeritageListingStructure.mockResolvedValue({
      probability: 0.5,
      band: "review",
      model: "jev-test",
    });
    const result = await judgedEvaluateMatch(PUB, STABLES);
    expect(result.matched).toBe(false);
    expect(result.review?.probability).toBe(0.5);
  });

  it("matches only when structure accepts and same-pub merges", async () => {
    judgeHeritageListingStructure.mockResolvedValue({
      probability: 0.95,
      band: "accept",
      model: "jev-test",
    });
    judgeSamePubPair.mockResolvedValue({ probability: 0.9, band: "merge", model: "jev-test" });
    const result = await judgedEvaluateMatch(PUB, PUB_LISTING);
    expect(result.matched).toBe(true);
    expect(result.listing?.listEntry).toBe(2);
  });

  it("never auto-matches a same-pub review band", async () => {
    judgeHeritageListingStructure.mockResolvedValue({
      probability: 0.95,
      band: "accept",
      model: "jev-test",
    });
    judgeSamePubPair.mockResolvedValue({ probability: 0.6, band: "review", model: "jev-test" });
    const result = await judgedEvaluateMatch(PUB, PUB_LISTING);
    expect(result.matched).toBe(false);
    expect(result.samePubBand).toBe("review");
    expect(result.review?.probability).toBe(0.6);
  });

  it("aborts when TypeSafe returns null rather than falling through to STRUCTURE_DENY", async () => {
    judgeHeritageListingStructure.mockResolvedValue(null);
    await expect(judgedEvaluateMatch(PUB, STABLES)).rejects.toThrow("could not reach TypeSafe");
  });
});

describe("heritage listing review queue", () => {
  it("matches the committed empty queue exactly", () => {
    const committed = readFileSync("data/review/heritage-listing-review.json", "utf8");
    expect(committed).toBe(
      `${JSON.stringify(
        samePubReviewDocument(
          [],
          "NHLE listing pairs in the uncertain band between the refuse and merge thresholds. Never auto-merged.",
        ),
        null,
        2,
      )}\n`,
    );
  });
});
