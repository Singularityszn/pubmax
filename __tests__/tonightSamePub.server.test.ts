import { beforeEach, describe, expect, it, vi } from "vitest";

const judgeSamePubPair = vi.fn();

vi.mock("@/lib/samePubIdentity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/samePubIdentity")>();
  return { ...actual, judgeSamePubPair };
});

const { opportunityMatchesVenueJudged } = await import("@/lib/tonightSamePub.server");
const { opportunityMatchesVenue } = await import("@/lib/tonight");

const venue = {
  id: "v1",
  name: "The Blue Posts",
  latitude: 51.5133,
  longitude: -0.1349,
};

function op(name: string) {
  return {
    id: "op1",
    kind: "quiz",
    title: "Quiz",
    place: { name, location: { lat: 51.5133, lng: -0.1349 } },
  };
}

beforeEach(() => {
  judgeSamePubPair.mockReset();
});

describe("opportunityMatchesVenueJudged", () => {
  it("matches only on an explicit merge verdict", async () => {
    judgeSamePubPair.mockResolvedValue({ probability: 0.9, band: "merge", model: "jev-test" });
    await expect(opportunityMatchesVenueJudged(op("The Blue Posts Soho"), venue)).resolves.toBe(
      true,
    );
  });

  it("never auto-merges the review band", async () => {
    judgeSamePubPair.mockResolvedValue({ probability: 0.5, band: "review", model: "jev-test" });
    await expect(opportunityMatchesVenueJudged(op("The Blue Posts Soho"), venue)).resolves.toBe(
      false,
    );
  });

  it("falls back to today's keyless rule on timeout or a missing key", async () => {
    judgeSamePubPair.mockResolvedValue(null);
    const opportunity = op("The Blue Posts Soho");
    await expect(opportunityMatchesVenueJudged(opportunity, venue)).resolves.toBe(
      opportunityMatchesVenue(opportunity, venue),
    );
  });

  it("never throws when the judge rejects", async () => {
    judgeSamePubPair.mockRejectedValue(new Error("ETIMEDOUT"));
    await expect(opportunityMatchesVenueJudged(op("The Blue Posts Soho"), venue)).resolves.toBe(
      true,
    );
  });
});
