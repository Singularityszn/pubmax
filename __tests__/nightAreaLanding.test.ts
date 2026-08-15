import { describe, expect, it } from "vitest";

import { loadGroupedVenues } from "@/lib/venueDataset";
import {
  NIGHT_AREA_LANDING_PUBLICATION_FLOOR,
  assignVenueToNightArea,
  buildNightAreaLandingModel,
  buildNightAreaLandingModels,
} from "@/lib/nightAreaLanding";
import { getNightArea, type NightArea } from "@/lib/nightAreas";
import type { Venue } from "@/lib/venues";

const NOW = new Date("2026-08-14T12:00:00.000Z");

function area(
  slug: "clapham" | "victoria" | "barnes",
  centre: { lat: number; lng: number },
  radiusKm = 2,
): NightArea {
  return { ...getNightArea(slug), centre, radiusKm };
}

function venue({
  id,
  lat = 51.462,
  lng = -0.138,
  price = 4,
  exactPrice = price,
  sourceUrl = "https://www.pint-prices.com/pub/test",
  kind = "pub",
  name = id,
}: {
  id: string;
  lat?: number;
  lng?: number;
  price?: number | null;
  exactPrice?: number | null;
  sourceUrl?: string;
  kind?: Venue["kind"];
  name?: string;
}): Venue {
  return {
    id,
    name,
    latitude: lat,
    longitude: lng,
    kind,
    primaryBorough: "Lambeth",
    cheapestPrice: price,
    prices:
      exactPrice === null
        ? []
        : [
            {
              app_price_id: `${id}-price`,
              pint_name: "House lager",
              price_gbp: exactPrice,
              pub_url: sourceUrl,
            },
          ],
  } as unknown as Venue;
}

describe("governed Night Area landing model", () => {
  it("assigns a Venue to one nearest containing Night Area", () => {
    const areas = [
      area("clapham", { lat: 51.5, lng: -0.01 }, 5),
      area("victoria", { lat: 51.5, lng: 0.01 }, 5),
    ];

    expect(
      assignVenueToNightArea(
        venue({ id: "venue-near", lat: 51.5, lng: -0.008 }),
        areas,
      )?.slug,
    ).toBe("clapham");
    expect(
      assignVenueToNightArea(
        venue({ id: "venue-outside", lat: 52, lng: 0.5 }),
        areas,
      ),
    ).toBeNull();
  });

  it("refuses thin and non-route-ready Night Areas", () => {
    const clapham = area("clapham", { lat: 51.462, lng: -0.138 });
    const thin = Array.from(
      { length: NIGHT_AREA_LANDING_PUBLICATION_FLOOR - 1 },
      (_, index) => venue({ id: `thin-${index}` }),
    );
    expect(
      buildNightAreaLandingModel("clapham", thin, { areas: [clapham], now: NOW }),
    ).toBeNull();

    const barnes = area("barnes", { lat: 51.474, lng: -0.239 });
    const dense = Array.from(
      { length: NIGHT_AREA_LANDING_PUBLICATION_FLOOR },
      (_, index) =>
        venue({ id: `barnes-${index}`, lat: barnes.centre.lat, lng: barnes.centre.lng }),
    );
    expect(
      buildNightAreaLandingModel("barnes", dense, { areas: [barnes], now: NOW }),
    ).toBeNull();
  });

  it("counts only publisher-backed exact cheapest-pint rows", () => {
    const clapham = area("clapham", { lat: 51.462, lng: -0.138 });
    const valid = Array.from({ length: 10 }, (_, index) =>
      venue({ id: `valid-${index}`, price: 3 + index / 10 }),
    );
    const model = buildNightAreaLandingModel(
      "clapham",
      [
        ...valid,
        venue({ id: "no-source", sourceUrl: "" }),
        venue({ id: "mismatch", price: 2, exactPrice: 4 }),
        venue({ id: "bar", kind: "bar" }),
      ],
      { areas: [clapham], now: NOW },
    );

    expect(model?.totalPricedVenues).toBe(10);
    expect(model?.rows).toHaveLength(10);
    expect(model?.rows.every((row) => row.publisher.label.length > 0)).toBe(true);
  });

  it("sorts by Pint Price, Venue name, and stable Venue ID, then caps rows", () => {
    const clapham = area("clapham", { lat: 51.462, lng: -0.138 });
    const model = buildNightAreaLandingModel(
      "clapham",
      [
        venue({ id: "venue-z", name: "Beta", price: 3 }),
        venue({ id: "venue-b", name: "Alpha", price: 3 }),
        venue({ id: "venue-a", name: "Alpha", price: 3 }),
        venue({ id: "venue-cheap", name: "Gamma", price: 2 }),
      ],
      { areas: [clapham], now: NOW, publicationFloor: 1, rowLimit: 3 },
    );

    expect(model?.rows.map((row) => row.venueId)).toEqual([
      "venue-cheap",
      "venue-a",
      "venue-b",
    ]);
    expect(model?.totalPricedVenues).toBe(4);
    expect(model?.collectedLabel).toBe("Prices last collected 3 July 2026.");
  });

  it("takes publisher from the exact cheapest-pint row", () => {
    const clapham = area("clapham", { lat: 51.462, lng: -0.138 });
    const input = venue({ id: "venue-source", price: 4, sourceUrl: "" });
    input.prices = [
      {
        ...input.prices[0],
        app_price_id: "wrong-price",
        price_gbp: 5,
        pub_url: "https://www.pint-prices.com/pub/wrong",
      },
      {
        ...input.prices[0],
        app_price_id: "exact-price",
        price_gbp: 4,
        pub_url: "https://example.org/prices",
      },
    ];

    const model = buildNightAreaLandingModel("clapham", [input], {
      areas: [clapham],
      now: NOW,
      publicationFloor: 1,
    });

    expect(model?.rows[0].publisher).toEqual({
      label: "example.org",
      url: "https://example.org/prices",
    });
  });

  it("publishes only the four current strong London Night Areas", async () => {
    const models = buildNightAreaLandingModels(await loadGroupedVenues(), { now: NOW });

    expect(models.map((model) => [model.slug, model.totalPricedVenues])).toEqual([
      ["clapham", 35],
      ["victoria", 41],
      ["piccadilly-soho", 72],
      ["canary-wharf", 13],
    ]);
  });
});
