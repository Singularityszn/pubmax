import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import VenueDrinkPrices from "@/components/map/VenueDrinkPrices";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { observationToCommunityPrice } from "@/lib/communityPriceObservation";

const communityPrices: CommunityPricesState = {
  byVenueId: new Map(), signalsByVenueId: new Map(), freshestByVenueId: new Map(),
  noAlcoholIndexStatus: "ready", loadNoAlcoholIndex: vi.fn(), loadDrinkCategoryIndex: vi.fn(),
  drinkCategoryIndexStatus: new Map(), provisionalBaseVenueIds: new Set(),
  loadProvisionalBaseVenues: vi.fn(), loadVenue: vi.fn(), venuePriceStatus: new Map(),
  submit: vi.fn<CommunityPricesState["submit"]>(), submitVenueSignal: vi.fn<CommunityPricesState["submitVenueSignal"]>(),
  submitting: false, reportPrice: vi.fn(), reportedIds: new Set(),
};

describe("Reddit price attribution", () => {
  it("links the actual source without calling the poster a PUBMAXXER", () => {
    const sourceUrl = "https://www.reddit.com/r/london/comments/1abc234/pints/mabc234/";
    const price = observationToCommunityPrice({
      venueId: "venue-a", drinkCategory: "beer", drinkName: "Guinness", priceGbp: 5.5,
      observedAt: "2026-09-20T12:00:00Z", source: "reddit", sourceUrl, confidence: 0.78,
    });
    const html = renderToStaticMarkup(<VenueDrinkPrices
      venueId="venue-a" venueName="Test pub" rows={[price]} activeLane="beer" laneNoun="beer"
      readStatus="ready" communityPrices={communityPrices}
      onLogPrice={() => {}} canLog={false}
    />);
    expect(html).toContain(`href="${sourceUrl}"`);
    expect(html).toContain("Reported on Reddit");
    expect(html).not.toContain("Logged by a PUBMAXXER");
    expect(html).not.toContain("Report this community price");
  });
});
