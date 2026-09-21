import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const judgeSamePubPair = vi.fn();

vi.mock("@/lib/samePubIdentity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/samePubIdentity")>();
  return { ...actual, judgeSamePubPair, typesafeConfigured: () => true };
});

const { judgedMatchVenue } = await import("../scripts/lib/areaNewsJudgedMatch");
const { samePubReviewDocument } = await import("../scripts/lib/samePubJudgedCanonicalize");
const { matchVenue } = await import("../scripts/lib/areaNewsMatch.mjs");

const VENUES = [
  { id: "venue-2", name: "The Devonshire", borough: "Westminster" },
  { id: "venue-3", name: "The Devonshire Arms", borough: "Westminster" },
];

beforeEach(() => {
  judgeSamePubPair.mockReset();
});

describe("judgedMatchVenue", () => {
  it("keeps the keyless unique Devonshire match as a merge", async () => {
    expect(matchVenue("The Devonshire", "westminster", VENUES)?.venueId).toBe("venue-2");
    judgeSamePubPair.mockResolvedValue({ probability: 0.94, band: "merge", model: "jev-test" });
    const result = await judgedMatchVenue("The Devonshire", "westminster", VENUES);
    expect(result.venueId).toBe("venue-2");
    expect(result.confidence).toBe("high");
  });

  it("never auto-matches the review band", async () => {
    judgeSamePubPair.mockResolvedValue({ probability: 0.55, band: "review", model: "jev-test" });
    const result = await judgedMatchVenue("The Devonshire", "westminster", VENUES);
    expect(result.venueId).toBeNull();
    expect(result.review).toHaveLength(1);
  });

  it("refuses when two cheap candidates both merge", async () => {
    const twins = [
      { id: "venue-x", name: "The George", borough: "Westminster" },
      { id: "venue-5", name: "The George", borough: "Westminster" },
    ];
    expect(matchVenue("The George", "westminster", twins)).toBeNull();
    judgeSamePubPair.mockResolvedValue({ probability: 0.9, band: "merge", model: "jev-test" });
    const result = await judgedMatchVenue("The George", "westminster", twins);
    expect(result.venueId).toBeNull();
  });

  it("aborts when TypeSafe returns null rather than using the keyless unique hit", async () => {
    judgeSamePubPair.mockResolvedValue(null);
    await expect(judgedMatchVenue("The Devonshire", "westminster", VENUES)).rejects.toThrow(
      "could not reach TypeSafe",
    );
  });
});

describe("area-news review queue", () => {
  it("matches the committed empty queue exactly", () => {
    const committed = readFileSync("data/review/area-news-review.json", "utf8");
    expect(committed).toBe(
      `${JSON.stringify(
        samePubReviewDocument(
          [],
          "Area-news venue pairs in the uncertain band between the refuse and merge thresholds. Never auto-merged.",
        ),
        null,
        2,
      )}\n`,
    );
  });
});
