import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { NearGuinnessLine } from "@/components/nearme/NearMeNow";
import { buildDrinkBrandLanding } from "@/lib/drinkBrandLanding";
import {
  cheapestGuinnessNearby,
  NEAR_GUINNESS_HREF,
  NEAR_GUINNESS_WALK_MINUTES,
  nearGuinnessLine,
  nearGuinnessListedMonth,
  type NearGuinnessPrice,
  type PricedPoint,
} from "@/lib/nearMeAnswer";
import { nearGuinnessPrices } from "@/lib/nearGuinness.server";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import { pricedLandingMapHref } from "@/lib/pricedLanding";
import { walkMinutesFromKm } from "@/lib/walkMinutes";
import { haversineKm } from "@/lib/haversine";

// Launch review B3: "Cheapest Guinness within 15 minutes" on /near, built from
// the venues the near answer already ranks and the drink page's own Guinness
// row, linked to /drink/guinness, and silent when nothing is in reach.

const here = { lat: 51.5074, lng: -0.1278 };

function at(id: string, dLat: number, cheapestPrice: number | null = 4): PricedPoint {
  return {
    id,
    name: `Pub ${id}`,
    lat: here.lat + dLat,
    lng: here.lng,
    cheapestPrice,
    borough: "Westminster",
  };
}

function minutesTo(point: PricedPoint): number {
  return walkMinutesFromKm(haversineKm([here.lng, here.lat], [point.lng, point.lat]));
}

describe("cheapestGuinnessNearby", () => {
  // 0.001 degrees of latitude is about 111 m.
  const near = at("near", 0.002);
  const nearer = at("nearer", 0.001);
  const edge = at("edge", 0.009);
  const far = at("far", 0.02);

  it("places the fixtures either side of the 15 minute walk", () => {
    expect(minutesTo(near)).toBeLessThanOrEqual(NEAR_GUINNESS_WALK_MINUTES);
    expect(minutesTo(edge)).toBeLessThanOrEqual(NEAR_GUINNESS_WALK_MINUTES);
    expect(minutesTo(far)).toBeGreaterThan(NEAR_GUINNESS_WALK_MINUTES);
  });

  it("picks the cheapest listed Guinness within 15 minutes", () => {
    const prices: NearGuinnessPrice[] = [
      ["near", 6.2, "2026-09-14"],
      ["edge", 5.4, "2026-10-02"],
      ["far", 3.9, "2026-10-02"],
    ];
    const answer = cheapestGuinnessNearby(here.lat, here.lng, [near, edge, far], prices);
    expect(answer).toMatchObject({ id: "edge", name: "Pub edge", priceGbp: 5.4, observedOn: "2026-10-02" });
  });

  it("breaks a tie on price by the shorter walk", () => {
    const prices: NearGuinnessPrice[] = [
      ["near", 5.5, "2026-09-14"],
      ["nearer", 5.5, "2026-09-14"],
    ];
    expect(cheapestGuinnessNearby(here.lat, here.lng, [near, nearer], prices)?.id).toBe("nearer");
  });

  it("reads only the venues the near answer ranks, never a venue it has no row for", () => {
    const prices: NearGuinnessPrice[] = [["not-in-the-index", 2.5, "2026-10-02"]];
    expect(cheapestGuinnessNearby(here.lat, here.lng, [near], prices)).toBeNull();
    // An unpriced venue does not qualify for the near answer, so not for this line either.
    expect(
      cheapestGuinnessNearby(here.lat, here.lng, [at("unpriced", 0.001, null)], [["unpriced", 4, null]]),
    ).toBeNull();
  });

  it("returns nothing when no Guinness is listed within 15 minutes", () => {
    expect(cheapestGuinnessNearby(here.lat, here.lng, [far], [["far", 3.9, "2026-10-02"]])).toBeNull();
    expect(cheapestGuinnessNearby(here.lat, here.lng, [near], [])).toBeNull();
  });
});

describe("nearGuinnessLine", () => {
  it("names the pub, the price and the month it was listed", () => {
    expect(
      nearGuinnessLine({ id: "a", name: "The Harp", priceGbp: 5.2, observedOn: "2026-09-14", walkMinutes: 6 }),
    ).toBe("Cheapest Guinness within 15 minutes: The Harp, £5.20, listed September 2026");
  });

  it("says the listing date is not recorded rather than inventing one", () => {
    expect(nearGuinnessListedMonth(null)).toBeNull();
    expect(
      nearGuinnessLine({ id: "a", name: "The Harp", priceGbp: 5.2, observedOn: null, walkMinutes: 6 }),
    ).toBe("Cheapest Guinness within 15 minutes: The Harp, £5.20, listing date not recorded");
  });

  it("renders as a link to /drink/guinness, and renders nothing without an answer", () => {
    const html = renderToStaticMarkup(
      <NearGuinnessLine
        answer={{ id: "a", name: "The Harp", priceGbp: 5.2, observedOn: "2026-09-14", walkMinutes: 6 }}
      />,
    );
    expect(NEAR_GUINNESS_HREF).toBe("/drink/guinness");
    expect(html).toContain('href="/drink/guinness"');
    expect(html).toContain("The Harp, £5.20, listed September 2026");
    expect(renderToStaticMarkup(<NearGuinnessLine answer={null} />)).toBe("");
  });
});

describe("nearGuinnessPrices (the server half)", () => {
  it("reads every Guinness price the way /drink/guinness does", async () => {
    const venues = await loadPintPriceLandingVenues();
    const landing = buildDrinkBrandLanding("guinness", venues);
    expect(landing).not.toBeNull();
    const tuples = nearGuinnessPrices(venues);
    expect(tuples.length).toBe(landing!.totalPricedVenues);
    const byVenue = new Map(tuples.map(([id, price]) => [id, price]));
    for (const row of landing!.rows) {
      expect(byVenue.get(row.venueId)).toBe(row.priceGbp);
    }
  });

  it("hands over nothing when the drink page does not publish", () => {
    expect(nearGuinnessPrices([])).toEqual([]);
  });

  it("the drink page's map link carries the Guinness lane", () => {
    expect(pricedLandingMapHref({ brandSlug: "guinness" })).toBe("/map?brand=guinness");
  });
});
