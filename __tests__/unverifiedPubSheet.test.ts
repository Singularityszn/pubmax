import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import UnverifiedPubSheet from "@/components/map/UnverifiedPubSheet";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { CommunityPrice } from "@/lib/communityPrice";
import type { UkBasePub } from "@/lib/ukBasePubs";

const pub: UkBasePub = {
  id: "venue-uk-n123",
  name: "The Test Arms",
  address: "1 Test Street",
  lat: 53.8008,
  lng: -1.5491,
  curatedVenueId: "",
};

function state(rows: CommunityPrice[], known = true): CommunityPricesState {
  return {
    byVenueId: known ? new Map([[pub.id, rows]]) : new Map(),
    freshestByVenueId: new Map(),
    loadVenue: () => {},
    submit: async () => ({ ok: true }),
    submitting: false,
  };
}

// NOTE ON WHAT IS *NOT* TESTED HERE. The `key={pub.id}` that resets the price
// form when the selection moves straight from one base pub to another is
// deliberately NOT asserted in this file. Vitest runs in a node environment
// (vitest.config.ts) with no DOM, so the only thing reachable from here is the
// React element's key - a shape assertion that passes whether or not the form
// actually clears. That test cannot fail for the reason it claims to guard.
// The real A-to-B transition is driven through one mounted sheet in a real
// browser, in e2e/map-uk-base-layer.spec.ts.

describe("UnverifiedPubSheet", () => {
  it("never flashes no-price framing while a stored price reloads", () => {
    const stored: CommunityPrice = {
      venueId: pub.id,
      drinkCategory: "beer",
      priceGbp: 4.6,
      submittedAt: Date.now(),
      source: "community",
      corroborations: 1,
    };
    const frames = [
      renderToStaticMarkup(
        createElement(UnverifiedPubSheet, {
          pub,
          communityPrices: state([], false),
        }),
      ),
      renderToStaticMarkup(
        createElement(UnverifiedPubSheet, {
          pub,
          communityPrices: state([stored]),
        }),
      ),
    ];

    for (const html of frames) {
      expect(html).not.toContain("No price yet");
      expect(html).not.toContain("Nobody has logged");
    }
    expect(frames[0]).toContain("Checking community prices");
    expect(frames[1]).toContain("£4.60");
  });

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

  it("shows be-the-first framing only after a confirmed empty response", () => {
    const html = renderToStaticMarkup(
      createElement(UnverifiedPubSheet, {
        pub,
        communityPrices: state([]),
      }),
    );

    expect(html).toContain("No price yet");
    expect(html).toContain("Nobody has logged");
  });
});
