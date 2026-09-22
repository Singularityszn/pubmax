import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import VenueDrinkPrices from "@/components/map/VenueDrinkPrices";
import { readVenueCommunityEvidenceLoad, readVenuePriceLoad, type CommunityPricesState } from "@/components/map/useCommunityPrices";

const communityPrices: CommunityPricesState = {
  byVenueId: new Map(), evidenceByVenueId: new Map(), signalsByVenueId: new Map(), freshestByVenueId: new Map(),
  noAlcoholIndexStatus: "ready", loadNoAlcoholIndex: vi.fn(), loadDrinkCategoryIndex: vi.fn(),
  drinkCategoryIndexStatus: new Map(), provisionalBaseVenueIds: new Set(),
  loadProvisionalBaseVenues: vi.fn(), loadVenue: vi.fn(), venuePriceStatus: new Map(),
  submit: vi.fn<CommunityPricesState["submit"]>(), submitVenueSignal: vi.fn<CommunityPricesState["submitVenueSignal"]>(),
  submitting: false, reportPrice: vi.fn(), reportedIds: new Set(),
};

describe("Reddit price attribution", () => {
  it("links the actual source without calling the poster a PUBMAXXER", () => {
    const sourceUrl = "https://www.reddit.com/r/london/comments/1abc234/pints/mabc234/";
    const evidence = readVenueCommunityEvidenceLoad({ communityEvidence: [{
      venueId: "venue-a", drinkCategory: "beer", drinkName: "Guinness", measure: "half", priceGbp: 5.5,
      observedAt: "2026-09-20T12:00:00Z", source: "reddit", sourceUrl, confidence: 0.78,
    }] });
    const html = renderToStaticMarkup(<VenueDrinkPrices
      venueId="venue-a" venueName="Test pub" rows={[]} activeLane="beer" laneNoun="beer"
      readStatus="ready" communityPrices={{ ...communityPrices, evidenceByVenueId: new Map([["venue-a", evidence]]) }}
      onLogPrice={() => {}} canLog
    />);
    expect(html).toContain(`href="${sourceUrl}"`);
    expect(html).toContain("Reported on Reddit");
    expect(html).not.toContain("Logged by a PUBMAXXER");
    expect(html).not.toContain("Report this community price");
    expect(html).toContain("Guinness");
    expect(html).toContain("Half");
    expect(html).toContain("No beer price logged here yet.");
    expect(html).toContain("Log a beer price");
  });
  it("never strips legacy evidence provenance into a direct PUBMAXX report", () => {
    const result = readVenuePriceLoad({ prices: [{ venueId: "venue-a", drinkCategory: "beer", priceGbp: 5.5,
      submittedAt: Date.now(), source: "community", evidence: { source: "reddit", url: "https://reddit.com" } }] });
    expect(result.prices).toEqual([]);
  });
  it.each([{ sourceUrl: "https://example.com" }, { priceGbp: -5 }, { observedAt: "2099-01-01" }, { measure: "invalid" }])("refuses invalid source evidence %s", (invalid) => {
    expect(readVenueCommunityEvidenceLoad({ communityEvidence: [{ venueId: "venue-a", drinkCategory: "beer", drinkName: "Guinness",
      source: "reddit", sourceUrl: "https://www.reddit.com/r/london/comments/1abc234/pints/mabc234/", priceGbp: 5.5,
      observedAt: "2026-09-20T12:00:00Z", confidence: 0.8, ...invalid }] })).toEqual([]);
  });
});
