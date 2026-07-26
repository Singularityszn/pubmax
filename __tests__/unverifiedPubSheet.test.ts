import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import UnverifiedPubSheet from "@/components/map/UnverifiedPubSheet";
import VenuePriceSubmit from "@/components/map/VenuePriceSubmit";
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

function state(rows: CommunityPrice[], known = true): CommunityPricesState {
  return {
    byVenueId: known ? new Map([[pub.id, rows]]) : new Map(),
    freshestByVenueId: new Map(),
    loadVenue: () => {},
    submit: async () => ({ ok: true }),
    submitting: false,
  };
}

function findPriceSubmit(node: ReactNode): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findPriceSubmit(child);
      if (match) return match;
    }
  }
  if (isValidElement(node)) {
    if (node.type === VenuePriceSubmit) return node;
    const match = findPriceSubmit(
      (node.props as { children?: ReactNode }).children,
    );
    if (match) return match;
  }
  return null;
}

describe("UnverifiedPubSheet", () => {
  it("remounts price submission state when selection moves directly between base pubs", () => {
    const nextPub: UkBasePub = {
      ...pub,
      id: "venue-uk-n456",
      osmRef: "n456",
      name: "The Next Arms",
    };
    const firstSubmitter = findPriceSubmit(
      UnverifiedPubSheet({ pub, communityPrices: state([], false) }),
    );
    const nextSubmitter = findPriceSubmit(
      UnverifiedPubSheet({ pub: nextPub, communityPrices: state([], false) }),
    );

    expect(firstSubmitter?.key).toBe(pub.id);
    expect(nextSubmitter?.key).toBe(nextPub.id);
    expect(nextSubmitter?.key).not.toBe(firstSubmitter?.key);
  });

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
