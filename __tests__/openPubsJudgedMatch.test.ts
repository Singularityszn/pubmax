import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const judgeSamePubPair = vi.fn();

vi.mock("@/lib/samePubIdentity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/samePubIdentity")>();
  return { ...actual, judgeSamePubPair, typesafeConfigured: () => true };
});

const { judgedClassifyOpenPubMatch } = await import("../scripts/lib/openPubsJudgedMatch");
const { samePubReviewDocument } = await import("../scripts/lib/samePubJudgedCanonicalize");
// @ts-expect-error -- untyped .mjs module
const { buildIdentityIndex, classifyOpenPubMatch } = await import("../scripts/lib/openPubs.mjs");

const ROW = {
  fsaId: 1,
  name: "Kings Head Tavern",
  address: "1 Market Place",
  postcode: "KT1 1JT",
  easting: null,
  northing: null,
  lat: 51.4105,
  lng: -0.3005,
  localAuthority: "Kingston upon Thames",
};

const INDEX = buildIdentityIndex([
  {
    id: "venue-kings",
    name: "The Kings Head",
    lat: 51.41053,
    lng: -0.30045,
    layer: "curated" as const,
  },
]);

beforeEach(() => {
  judgeSamePubPair.mockReset();
});

describe("judgedClassifyOpenPubMatch", () => {
  it("leaves the keyless exact/identity path unmatched for a tavern suffix", () => {
    expect(classifyOpenPubMatch(ROW, INDEX).status).toBe("unmatched");
  });

  it("matches a shared-token cheap candidate only on an explicit merge verdict", async () => {
    judgeSamePubPair.mockResolvedValue({ probability: 0.91, band: "merge", model: "jev-test" });
    const result = await judgedClassifyOpenPubMatch(ROW, INDEX);
    expect(result.status).toBe("matched");
    expect(result.match?.id).toBe("venue-kings");
  });

  it("never auto-matches the review band", async () => {
    judgeSamePubPair.mockResolvedValue({ probability: 0.5, band: "review", model: "jev-test" });
    const result = await judgedClassifyOpenPubMatch(ROW, INDEX);
    expect(result.status).toBe("unmatched");
    expect(result.reason).toBe("review-band");
    expect(result.review).toHaveLength(1);
  });

  it("aborts when TypeSafe returns null rather than writing a match", async () => {
    judgeSamePubPair.mockResolvedValue(null);
    await expect(judgedClassifyOpenPubMatch(ROW, INDEX)).rejects.toThrow("could not reach TypeSafe");
  });
});

describe("open-pubs review queue", () => {
  it("matches the committed empty queue exactly", () => {
    const committed = readFileSync("data/review/open-pubs-review.json", "utf8");
    expect(committed).toBe(
      `${JSON.stringify(
        samePubReviewDocument(
          [],
          "Open Pubs identity pairs in the uncertain band between the refuse and merge thresholds. Never auto-merged.",
        ),
        null,
        2,
      )}\n`,
    );
  });
});
