import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import UnverifiedPubSheet from "@/components/map/UnverifiedPubSheet";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { CommunityPrice } from "@/lib/communityPrice";
import type { UkBasePub } from "@/lib/ukBasePubs";

const pub: UkBasePub = {
  id: "venue-uk-n123",
  osmRef: "n123",
  name: "The Test Arms",
  address: "1 Test Street",
  lat: 53.8008,
  lng: -1.5491,
};

function state(rows: CommunityPrice[]): CommunityPricesState {
  return {
    byVenueId: new Map([[pub.id, rows]]),
    freshestByVenueId: new Map(),
    loadVenue: () => {},
    submit: async () => ({ ok: true }),
    submitting: false,
  };
}

describe("UnverifiedPubSheet", () => {
  it("renders a stored dated community price without no-price framing", () => {
    const html = renderToStaticMarkup(
      createElement(UnverifiedPubSheet, {
        pub,
        communityPrices: state([
          {
            venueId: pub.id,
            drinkCategory: "beer",
            priceGbp: 4.6,
            submittedAt: Date.now(),
            source: "community",
            corroborations: 1,
          },
        ]),
      }),
    );

    expect(html).toContain("£4.60");
    expect(html).toContain("today · community");
    expect(html).toContain("Logged by a Pubmaxxer");
    expect(html).not.toContain("No price yet");
    expect(html).not.toContain("Nobody has logged");
  });
});
