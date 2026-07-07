import { beforeEach, describe, expect, it } from "vitest";

import { hasMenuBeyondPints } from "@/lib/drinkMenu";
import type { VenuePrice } from "@/lib/venues";
import { venueMenuForInspector } from "@/lib/venueMenu";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

// A seeded heritage venue id (Prospect of Whitby) — see __tests__/drinkSeeds.test.ts.
const SEEDED_VENUE_ID = "venue-16pnwmm";

function fabricatedPrice(id: string, name: string, priceGbp: number | null): VenuePrice {
  return {
    app_price_id: id,
    pub_name: "Test Pub",
    pint_name: name,
    price_gbp: priceGbp,
    price_text: priceGbp !== null ? `£${priceGbp.toFixed(2)}` : "",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    boroughs_visible: "",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "",
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: "",
    constructed_pub_url: "",
    borough_urls: "",
    phone_number: "",
    email: "",
    website: "",
    booking_link: "",
    image_url: "",
  } as VenuePrice;
}

describe("venueMenuForInspector", () => {
  it("returns beer first then seeded non-beer drinks for a seeded venue", () => {
    const prices = [
      fabricatedPrice("p1", "London Pride", 6.4),
      fabricatedPrice("p2", "Guinness", 6.1),
    ];
    const menu = venueMenuForInspector({ id: SEEDED_VENUE_ID, prices });

    expect(menu.length).toBeGreaterThan(prices.length);
    expect(menu[0].category).toBe("beer");
    expect(menu[1].category).toBe("beer");
    const nonBeer = menu.filter((d) => d.category !== "beer");
    expect(nonBeer.length).toBeGreaterThan(0);
    for (const drink of nonBeer) {
      expect(drink.provenance.source).toBe("seed");
    }
    expect(hasMenuBeyondPints(menu)).toBe(true);
  });

  it("returns only beer for a non-seeded venue with pint rows", () => {
    const prices = [
      fabricatedPrice("p1", "London Pride", 6.4),
      fabricatedPrice("p2", "Guinness", 6.1),
    ];
    const menu = venueMenuForInspector({ id: "venue-not-seeded", prices });

    expect(menu.every((d) => d.category === "beer")).toBe(true);
    expect(hasMenuBeyondPints(menu)).toBe(false);
    for (const drink of menu) {
      expect(drink.provenance.source).toBe("app-dataset");
    }
  });

  it("returns an empty menu for null-priced rows with no seeds", () => {
    const prices = [fabricatedPrice("p1", "Unknown", null), fabricatedPrice("p2", "Unknown 2", null)];
    const menu = venueMenuForInspector({ id: "venue-not-seeded", prices });

    expect(menu).toEqual([]);
  });
});
