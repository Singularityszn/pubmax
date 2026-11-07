import { describe, expect, it } from "vitest";

import { huntSourceVerb } from "@/lib/cheapestHunt";
import { loadCheapestHunt } from "@/lib/cheapestHunt.server";
import { loadLandingHeroData } from "@/lib/landingPubCard.server";
import type { LegacyPintPrice } from "@/lib/drinks";
import { pintPriceAverages } from "@/lib/pintSavings";
import { listedPriceCohort } from "@/lib/pricedPubCount";
import { median, MIN_PRICED_VENUES } from "@/lib/zones";
import {
  boroughMedians,
  buildWildPriceGlass,
  pickPriceGlassBoroughs,
  priceGlassReadRange,
  PRICE_GLASS_MAX_BOROUGHS,
  type PriceGlassPint,
  type PriceGlassText,
  type PriceGlassVenue,
} from "@/lib/wildPriceGlass";
import { loadWildPriceGlass } from "@/lib/wildPriceGlass.server";

// The Price Glass (round-two wild idea 01) pours only figures the app already
// stands behind, each with its source beside it. These pins hold the four
// kinds of pour to the readers they come from, and the real build to the very
// average the landing's saving line prints.

type Pub = Omit<PriceGlassVenue, "prices"> & { prices: LegacyPintPrice[] };

function pub(name: string, borough: string, price: number, readAt: string | null): Pub {
  return {
    name,
    kind: "pub",
    cheapestPrice: price,
    primaryBorough: borough,
    prices: [
      {
        app_price_id: `${name}-1`,
        pint_name: "Lager",
        price_gbp: price,
        ...(readAt ? { scraped_at_values: readAt } : {}),
      },
    ],
  };
}

function borough(name: string, prices: number[], readAt = "2026-10-02T10:00:00Z"): Pub[] {
  return prices.map((price, index) => pub(`${name} Arms ${index + 1}`, name, price, readAt));
}

function text(parts: PriceGlassText[]): string {
  return parts.map((part) => part.text).join("");
}

const pint = (over: Partial<PriceGlassPint> = {}): PriceGlassPint => ({
  pubName: "The Cheap Seat",
  priceGbp: 2.43,
  mapHref: "/map?sel=venue-cheap",
  publisher: { label: "Pint Prices", url: "https://www.pint-prices.com/pub/x" },
  observedOn: "2026-10-02",
  sourceVerb: "Listed by",
  ...over,
});

// Thirty-plus pubs, so the London mean clears pintSavings' sample floor.
const cheapBorough = borough("Enfield", [4, 4.2, 4.3, 4.35, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5]);
const busyBorough = borough("Islington", [5.5, 5.6, 5.7, 5.8, 5.9, 5.95, 6, 6.1, 6.2, 6.3, 6.4, 6.5]);
const dearBorough = borough("Westminster", [6, 6.2, 6.3, 6.35, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 7]);
const thinBorough = borough("Bexley", [3, 3.1, 3.2]);
const VENUES: Pub[] = [...cheapBorough, ...busyBorough, ...dearBorough, ...thinBorough];

describe("the pours", () => {
  const glass = buildWildPriceGlass({ venues: VENUES, cheapest: pint(), dearest: pint({ pubName: "The Dear Duke", priceGbp: 9.5 }) });

  it("pours London, the cheapest, the boroughs cheapest first, then the dearest", () => {
    expect(glass?.pours.map((pour) => pour.id)).toEqual([
      "london",
      "cheapest",
      "borough-enfield",
      "borough-islington",
      "borough-westminster",
      "dearest",
    ]);
    expect(glass?.scaleMaxGbp).toBe(10);
  });

  it("pours London's average from the listed cohort, the landing's own mean", () => {
    const london = glass?.pours.find((pour) => pour.id === "london");
    const prices = VENUES.map((venue) => venue.cheapestPrice as number);
    expect(london?.priceGbp).toBe(pintPriceAverages(prices)?.averageGbp);
    expect(text(london!.what)).toBe(
      `The average of each pub's cheapest listed pint, across ${VENUES.length} pubs in our London pub list with a listed price.`,
    );
    expect(text(london!.source)).toBe("From prices read on 2 October 2026.");
  });

  it("pours a borough's median by the house median, over its own pubs", () => {
    const enfield = glass?.pours.find((pour) => pour.id === "borough-enfield");
    expect(enfield?.priceGbp).toBe(median(cheapBorough.map((venue) => venue.cheapestPrice as number)));
    expect(enfield?.chip).toBe("Enfield");
    expect(text(enfield!.what)).toContain(`across the ${cheapBorough.length} Enfield pubs in our London pub list`);
  });

  it("names the hunt's pints with who listed them and the day that source was read", () => {
    const cheapest = glass?.pours.find((pour) => pour.id === "cheapest");
    expect(cheapest?.priceGbp).toBe(2.43);
    expect(text(cheapest!.what)).toBe("The cheapest listed pint in London, at The Cheap Seat.");
    expect(cheapest!.what.find((part) => part.href)?.href).toBe("/map?sel=venue-cheap");
    expect(text(cheapest!.source)).toBe("Listed by Pint Prices, source read 2 October 2026.");
    expect(cheapest!.source.find((part) => part.url)?.url).toBe("https://www.pint-prices.com/pub/x");
    const dearest = glass?.pours.find((pour) => pour.id === "dearest");
    expect(text(dearest!.what)).toBe("London's dearest pint: the cheapest pint at The Dear Duke.");
  });

  it("pours nothing it cannot source", () => {
    expect(buildWildPriceGlass({ venues: [], cheapest: null, dearest: null })).toBeNull();
    const undated = VENUES.map((venue) => ({
      ...venue,
      prices: venue.prices.map((row) => ({ ...row, scraped_at_values: undefined })),
    }));
    const glassUndated = buildWildPriceGlass({ venues: undated, cheapest: null, dearest: null });
    expect(glassUndated).toBeNull();
  });
});

describe("the boroughs", () => {
  it("needs the zone floor of priced pubs before a median is poured", () => {
    const slugs = boroughMedians(VENUES).map((row) => row.slug);
    expect(MIN_PRICED_VENUES).toBe(10);
    expect(slugs).not.toContain("bexley");
    expect(slugs).toEqual(["enfield", "islington", "westminster"]);
  });

  it("takes the cheapest and dearest medians, then the busiest, at most three", () => {
    const extra = borough("Camden", [5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6]);
    const picked = pickPriceGlassBoroughs(boroughMedians([...VENUES, ...extra])).map((row) => row.slug);
    expect(picked).toHaveLength(PRICE_GLASS_MAX_BOROUGHS);
    expect(picked[0]).toBe("enfield");
    expect(picked.at(-1)).toBe("westminster");
    expect(picked).toContain("camden");
    expect(picked).not.toContain("islington");
  });

  it("leaves a pub with no recognised borough out rather than guessing", () => {
    const stray = { ...pub("The Nowhere", "Soho", 1.5, "2026-10-02T10:00:00Z") };
    expect(boroughMedians([...VENUES, stray]).some((row) => row.name === "Soho")).toBe(false);
  });
});

describe("the read range", () => {
  it("keeps the mean, borough median and read denominator on the same non-bottle cohort", () => {
    const bottle = pub("Bottle", "Enfield", 50, "2026-01-01T10:00:00Z");
    bottle.prices[0]!.pint_name = "BOTTLED BEER";
    const unknown = pub("Unknown", "Enfield", 6, null);
    const venues = [...VENUES, bottle, unknown];
    const glass = buildWildPriceGlass({ venues, cheapest: pint(), dearest: pint({ priceGbp: 9.5 }) });
    const london = glass!.pours.find((pour) => pour.id === "london")!;
    const retained = [...VENUES, unknown];
    expect(london.priceGbp).toBe(pintPriceAverages(retained.map((row) => row.cheapestPrice!))!.averageGbp);
    expect(text(london.what)).toContain(`across ${retained.length} pubs`);
    expect(text(london.source)).toBe(`From prices read on 2 October 2026. 1 of the ${retained.length} pubs records no read day.`);
    const enfield = boroughMedians(listedPriceCohort(venues)).find((row) => row.slug === "enfield")!;
    expect(enfield.medianGbp).toBe(median([...cheapBorough, unknown].map((row) => row.cheapestPrice!)));
    expect(enfield.pubs).not.toContain(bottle);
  });

  it("names the oldest and newest read and counts the undated pubs out loud", () => {
    const pubs = [
      pub("A", "Hackney", 5, "2026-07-04T10:00:00Z"),
      pub("B", "Hackney", 5.5, "2026-10-02T10:00:00Z"),
      pub("C", "Hackney", 6, null),
    ];
    expect(priceGlassReadRange(pubs)).toBe(
      "From prices read between 4 July 2026 and 2 October 2026. 1 of the 3 pubs records no read day.",
    );
  });
});

describe("the real build", () => {
  it("pours the same London average the landing's saving line prints", async () => {
    const [hero, hunt] = await Promise.all([loadLandingHeroData(), loadCheapestHunt()]);
    const london = hunt.cities.find((row) => row.cityId === "london")?.pint ?? null;
    const asPint = (value: typeof london): PriceGlassPint | null =>
      value
        ? {
            pubName: value.pubName,
            priceGbp: value.priceGbp,
            mapHref: value.mapHref,
            publisher: value.publisher,
            observedOn: value.observedOn,
            sourceVerb: huntSourceVerb(value.standing),
          }
        : null;
    const glass = await loadWildPriceGlass({ cheapest: asPint(london), dearest: asPint(hunt.londonDearest) });
    expect(glass).not.toBeNull();
    const pours = glass!.pours;
    expect(pours.find((pour) => pour.id === "london")?.priceGbp).toBe(hero.averages?.averageGbp);
    if (london) expect(pours.find((pour) => pour.id === "cheapest")?.priceGbp).toBe(london.priceGbp);
    if (hunt.londonDearest) {
      expect(pours.find((pour) => pour.id === "dearest")?.priceGbp).toBe(hunt.londonDearest.priceGbp);
    }
    for (const pour of pours) {
      expect(text(pour.source).length, `${pour.id} carries its source`).toBeGreaterThan(10);
      expect(pour.priceGbp).toBeGreaterThan(0);
    }
  });
});
