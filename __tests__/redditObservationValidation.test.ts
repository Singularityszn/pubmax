import { describe, expect, it } from "vitest";
import { isValidCommunityPriceObservationRow, observationToCommunityPrice } from "@/lib/communityPriceObservation";

const row = {
  venueId: "venue-a", drinkCategory: "beer" as const, drinkName: "Guinness",
  priceGbp: 5.5, observedAt: "2026-09-20T12:00:00.000Z", source: "reddit" as const,
  sourceUrl: "https://www.reddit.com/r/london/comments/1abc234/pints/mabc234/", confidence: 0.78,
};
const now = Date.parse("2026-09-22T12:00:00Z");

describe("Reddit observation publication", () => {
  it("accepts a dated Reddit comment", () => expect(isValidCommunityPriceObservationRow(row, now)).toBe(true));
  it.each([
    "https://example.com/price", "https://www.reddit.com/r/london/comments/abc/fix1/",
    "https://www.reddit.com/r/london/comments/1abc234/pints/",
    "http://www.reddit.com/r/london/comments/1abc234/pints/mabc234/",
  ])("refuses non-evidence URL %s", (sourceUrl) => {
    expect(isValidCommunityPriceObservationRow({ ...row, sourceUrl }, now)).toBe(false);
  });
  it("refuses epoch placeholders", () => {
    expect(isValidCommunityPriceObservationRow({ ...row, observedAt: "1970-01-01T00:00:00Z" }, now)).toBe(false);
  });
  it("keeps different drinks from one comment distinct", () => {
    expect(observationToCommunityPrice(row).id).not.toBe(observationToCommunityPrice({ ...row, drinkName: "Lager", priceGbp: 6 }).id);
  });
});
