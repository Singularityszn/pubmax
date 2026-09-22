import { describe, expect, it } from "vitest";
import { extractRedditPriceCandidates } from "@/lib/harvest/redditPriceExtract";
// @ts-expect-error Plain-node harvest matcher has no declaration file.
import { matchPubNameToVenue } from "../scripts/lib/redditVenueMatch.mjs";

const roebuck = { id: "venue-a", name: "The Roebuck", borough: "Southwark", lat: 51.5, lng: -0.08 };

describe("Reddit venue identity", () => {
  it("accepts a unique exact London pub name", () => {
    expect(matchPubNameToVenue("The Roebuck", "Southwark", [roebuck])?.venueId).toBe("venue-a");
  });
  it("does not discard a contradictory location", () => {
    expect(matchPubNameToVenue("The Roebuck", "Camden", [roebuck])).toBeNull();
  });
  it("does not equate a name prefix with a venue", () => {
    expect(matchPubNameToVenue("The Roebuck", "Southwark", [{ ...roebuck, name: "The Roebuck Hotel" }])).toBeNull();
  });
  it.each([
    "I paid £5.50 for a pint at The Roebuck in Oxford.",
    "I paid £4 for a pint at The Roebuck in Oxford, unlike the pubs in Southwark.",
  ])("does not infer London from a same-name pub elsewhere: %s", (body) => {
    const [candidate] = extractRedditPriceCandidates({
      body,
      permalink: "https://www.reddit.com/r/london/comments/1abc234/pints/mabc234/",
      observedAt: "2026-09-20T12:00:00Z", author: "fixture",
    });
    expect(candidate).toBeDefined();
    expect(matchPubNameToVenue(candidate.pubNameHint, candidate.areaHint, [roebuck])).toBeNull();
  });
  it("does not place a non-London pub in London", () => {
    expect(matchPubNameToVenue("The Roebuck", "Oxford", [{ ...roebuck, borough: "Oxford", lat: 51.75, lng: -1.26 }])).toBeNull();
  });
  it("keeps an unlocated pub for review even when its name is unique", () => {
    expect(matchPubNameToVenue("The Roebuck", null, [roebuck])).toBeNull();
  });
});
