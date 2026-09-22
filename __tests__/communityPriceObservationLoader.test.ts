import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));
import { communityPriceEvidenceForVenue, resetCommunityPriceObservationCacheForTests } from "@/lib/communityPriceObservationLoader.server";

const seed = { venueId: "venue-a", drinkCategory: "beer", drinkName: "Guinness", priceGbp: 5.5,
  observedAt: "2026-09-20T12:00:00Z", source: "reddit",
  sourceUrl: "https://www.reddit.com/r/london/comments/1abc234/pints/mabc234/", confidence: 0.78 };
const pack = (observations: unknown[]) => JSON.stringify({ version: 1, lane: "reddit-london", observations });
describe("community source evidence loader", () => {
  beforeEach(() => { vi.mocked(readFileSync).mockReset(); resetCommunityPriceObservationCacheForTests(); });
  it("keeps named drinks and explicit servings separate without creating direct reports", () => {
    vi.mocked(readFileSync).mockReturnValue(pack([seed, { ...seed, drinkName: "Lager", measure: "pint" },
      { ...seed, measure: "half", priceGbp: 3 }, seed, { ...seed, venueId: "venue-other" }]));
    const rows = communityPriceEvidenceForVenue("venue-a");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.drinkName)).toEqual(["Guinness", "Lager", "Guinness"]);
    expect(rows.map((row) => row.measure)).toEqual([undefined, "pint", "half"]);
    expect(rows.every((row) => row.source === "reddit" && !("corroborations" in row) && !("mapCandidate" in row))).toBe(true);
  });
  it("treats an empty production pack as no evidence", () => {
    vi.mocked(readFileSync).mockReturnValue(pack([]));
    expect(communityPriceEvidenceForVenue("venue-a")).toEqual([]);
  });
  it("refuses malformed pack envelopes", () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ observations: [seed] }));
    expect(communityPriceEvidenceForVenue("venue-a")).toEqual([]);
  });
});
