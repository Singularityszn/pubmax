import { describe, expect, it } from "vitest";

import { stableVenueIdFromKey, venueGroupingKey, type VenuePrice } from "@/lib/venues";
import {
  FLASH_LITE_SKU,
  JOB_SPEND_CAP_USD,
  amenityColumnIsBlank,
  evidenceQuoteIsOnPage,
  keepEvidencedAmenities,
  matchPubToVenue,
  parsePubAmenityModelJson,
  projectPubAmenitySpend,
  stableVenueId,
  stampAmenityColumns,
  venueGroupKey,
} from "@/lib/harvest/pubWebsiteAmenities";

const PAGE = [
  "The Crown serves food every day from noon.",
  "Our beer garden opens when the weather does.",
  "Sunday pub quiz starts at eight.",
  "Cocktails are listed on the board behind the bar.",
].join(" ");

describe("parsePubAmenityModelJson", () => {
  it("reads a fenced object and drops keys that are not amenities", () => {
    const raw = [
      "```json",
      JSON.stringify({
        amenities: {
          food: { value: true, evidence: "serves food every day" },
          wifi: { value: true, evidence: "free wifi" },
          cocktails: { value: "yes", evidence: "Cocktails" },
        },
      }),
      "```",
    ].join("\n");
    const parsed = parsePubAmenityModelJson(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.amenities.food).toEqual({
      value: true,
      evidence: "serves food every day",
    });
    expect(parsed.amenities).not.toHaveProperty("wifi");
    expect(parsed.amenities.cocktails).toBeUndefined();
  });

  it("refuses a body that is not JSON", () => {
    expect(parsePubAmenityModelJson("the pub has a garden")).toEqual({
      ok: false,
      reason: "not-json",
    });
  });
});

describe("keepEvidencedAmenities", () => {
  it("keeps a true value only when the quote is on the page", () => {
    const kept = keepEvidencedAmenities(
      {
        food: { value: true, evidence: "serves food every day" },
        beerGarden: { value: true, evidence: "Our Beer Garden opens" },
        liveSports: { value: true, evidence: "we show every match live" },
        cocktails: { value: false, evidence: "Cocktails are listed on the board" },
        pubQuiz: { value: true, evidence: "quiz" },
      },
      PAGE,
    );
    expect(kept.food).toBe("serves food every day");
    expect(kept.beerGarden).toBe("Our Beer Garden opens");
    expect(kept.liveSports).toBeUndefined();
    expect(kept.cocktails).toBeUndefined();
    expect(kept.pubQuiz).toBeUndefined();
    expect(evidenceQuoteIsOnPage(PAGE, "quiz")).toBe(false);
  });
});

describe("stampAmenityColumns", () => {
  it("writes yes into a blank column and leaves a stated answer alone", () => {
    const { row, stamped } = stampAmenityColumns(
      { food: "", cocktails: "no", beer_garden: "yes (summer)" },
      {
        food: "serves food every day",
        cocktails: "Cocktails are listed on the board",
        beerGarden: "Our beer garden opens",
      },
    );
    expect(row.food).toBe("yes");
    expect(row.cocktails).toBe("no");
    expect(row.beer_garden).toBe("yes (summer)");
    expect(stamped).toEqual(["food"]);
    expect(amenityColumnIsBlank("")).toBe(true);
    expect(amenityColumnIsBlank("n/a")).toBe(true);
    expect(amenityColumnIsBlank("no")).toBe(false);
  });
});

describe("projectPubAmenitySpend", () => {
  it("prices the Flash-Lite text SKU under the job cap for the London pub set", () => {
    const spend = projectPubAmenitySpend({
      calls: 1882,
      inputTokensPerCall: 3000,
      outputTokensPerCall: 800,
      inputUsdPerMillion: FLASH_LITE_SKU.inputUsdPerMillion,
      outputUsdPerMillion: FLASH_LITE_SKU.outputUsdPerMillion,
    });
    expect(spend).toBeCloseTo(1.16684, 4);
    expect(spend).toBeLessThan(JOB_SPEND_CAP_USD);
  });
});

describe("matchPubToVenue", () => {
  const venues = [
    { venueId: "venue-near", name: "The Shy Horse", lat: 51.5, lng: -0.1 },
    { venueId: "venue-far", name: "The Shy Horse", lat: 51.7, lng: -0.4 },
    { venueId: "venue-other", name: "The Crown and Treaty", lat: 51.5, lng: -0.1 },
  ];

  it("picks the closest pub whose name agrees", () => {
    const match = matchPubToVenue(
      {
        osmId: "node/1",
        name: "The Shy Horse",
        lat: 51.5002,
        lng: -0.1002,
        website: "https://example.com/shy-horse",
      },
      venues,
    );
    expect(match?.venueId).toBe("venue-near");
  });

  it("matches a chain suffix on the same pub", () => {
    const match = matchPubToVenue(
      {
        osmId: "node/3",
        name: "The Shy Horse",
        lat: 51.5001,
        lng: -0.1001,
        website: "https://example.com/shy-horse",
      },
      [{ venueId: "venue-spoon", name: "The Shy Horse - JD Wetherspoon", lat: 51.5002, lng: -0.1002 }],
    );
    expect(match?.venueId).toBe("venue-spoon");
  });

  it("does not match a different pub that only shares a word", () => {
    const match = matchPubToVenue(
      {
        osmId: "node/2",
        name: "The Crown",
        lat: 51.5,
        lng: -0.1,
        website: "https://example.com/crown",
      },
      venues,
    );
    expect(match).toBeNull();
  });
});

describe("stableVenueId", () => {
  it("matches the id the rest of the app publishes for the same row", () => {
    const row = {
      pub_name: "The Shy Horse",
      address: "1 High Street, London",
      latitude: 51.5,
      longitude: -0.1,
    } as VenuePrice;
    expect(stableVenueId(venueGroupKey(row))).toBe(
      stableVenueIdFromKey(venueGroupingKey(row)),
    );
  });
});
