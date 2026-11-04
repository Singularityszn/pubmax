import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listBoroughs, pubsInBorough } from "@/lib/boroughs";
import { rankCompassTargets } from "@/lib/pintCompass";
import { factBlockSentences, faqItems, pintFactStats } from "@/lib/pintFacts";
import { cheapestByArea, cheapestPints } from "@/lib/leaderboard";
import { arrivalAreas } from "@/lib/pintIndexArrival";
import { selectMapFallbackPubs } from "@/lib/mapFallbackVenues";
import { pintRoulettePool } from "@/lib/pintRoulette";
import { slimRowPintPrice, stopsInView } from "@/components/wild/palHopPlan";
import { scoreVenueForPlan } from "@/lib/planGenerationRanking";
import { tallyLensMatches } from "@/lib/tonightConditions";
import { scoreVenue, type Venue, type VenuePrice } from "@/lib/venues";
import { slimVenueToPin } from "@/lib/slimPins";
import type { SlimVenue } from "@/lib/venuesSlim";
import type { NightContext } from "@/lib/nightPlanning";
import FactBlock from "@/components/seo/FactBlock";

const routeData = vi.hoisted(() => ({ venues: [] as Venue[] }));
vi.mock("@/lib/pintPriceLandingDataset.server", () => ({ loadPintPriceLandingVenues: async () => routeData.venues }));
vi.mock("next/og", () => ({ ImageResponse: class extends Response {
  constructor(element: ReactElement) { super(renderToStaticMarkup(element)); }
} }));

const origin = { lat: 51.5765, lng: 0.1822 };
const context: NightContext = {
  nightArea: "piccadilly-soho", daypart: "after_work", partyType: "friends", groupSize: 2,
  budget: "value", budgetLimitPence: null, zeroProof: false, wetherspoonsPreferred: false,
  atmosphere: [], foodNeeds: [], accessibility: [], transportConstraints: [],
};

function slim(id: string, change: Partial<SlimVenue> = {}): SlimVenue {
  return { id, name: id, ...origin, borough: "Havering", cheapestPrice: 5,
    cheapestPint: "Lager", priceSource: "Pub menu", priceObservedAt: "2026-10-01", ...change };
}

function full(row: SlimVenue): Venue {
  return { ...slimVenueToPin(row), prices: [{
    price_gbp: row.cheapestPrice, pint_name: row.cheapestPint ?? "Lager", measure: row.measure,
    pub_url: row.priceSource ? "https://pub.example/menu" : "", scraped_at_values: row.priceObservedAt,
  } as VenuePrice] };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); routeData.venues = []; });

describe("discovery claims use complete same-row pint evidence", () => {
  it.each([
    { anchorLabel: "Half pint" },
    { cheapestPint: "BOTTLED BEER" },
    { cheapestPint: "Half-pint lager" },
    { cheapestPint: "half_pint lager" },
    { cheapestPint: "2 halves of stout" },
    { measure: "bottle" },
    { priceSource: undefined },
    { priceObservedAt: undefined },
    { priceObservedAt: "2026-01" },
    { priceObservedAt: "2026-02-30" },
    { priceObservedAt: "2026-11-04" },
    { cheapestPrice: 0 },
    { cheapestPrice: Number.NaN },
  ] satisfies Partial<SlimVenue>[])("refuses %j across sibling rankings and filters", (change) => {
    const rejected = slim("rejected", { cheapestPrice: 2.49, ...change });
    const pint = slim("pint");
    const rows = [rejected, pint];
    const pubs = rows.map(full);
    expect(rankCompassTargets(origin, rows).targets.map((row) => row.id)).toEqual(["pint"]);
    expect(pubsInBorough(pubs, "havering").map((pub) => pub.id)).toEqual(["pint", "rejected"]);
    expect(listBoroughs(pubs)).toMatchObject([{ pubCount: 2, cheapestGbp: 5 }]);
    expect(cheapestPints(pubs).map((row) => row.venue.id)).toEqual(["pint"]);
    expect(cheapestByArea(pubs).map((row) => row.venue.id)).toEqual(["pint"]);
    expect(arrivalAreas([...pubs, ...Array.from({ length: 7 }, (_, i) => full(slim(`other-${i}`, { cheapestPrice: 6 })))])[0])
      .toMatchObject({ cheapestGbp: 5, cheapestVenueId: "pint", pricedCount: 8 });
    expect(selectMapFallbackPubs(pubs, 2).map((pub) => pub.id)).toEqual(["pint", "rejected"]);
    expect(pintRoulettePool(origin.lat, origin.lng, rows, { priceCapGbp: 5 }).map((row) => row.point.id)).toEqual(["pint"]);
    expect(slimRowPintPrice(rejected)).toBeNull();
    expect(stopsInView(rows, () => ({ x: 10, y: 10 }), { left: 0, right: 20, top: 0, bottom: 20 }).map((row) => row.id)).toEqual(["pint"]);
    expect(pintFactStats(pubs, "Havering", "havering")).toMatchObject({ minGbp: 5, minPubName: "pint", maxGbp: 5 });
    const concierge = rows.map((row) => ({ ...row, area: row.borough, amenities: {
      food: false, cocktails: false, beerGarden: true, liveSports: false, liveMusic: false,
    }, nearWater: false, hasStory: false, canonical: true }));
    expect(tallyLensMatches(concierge, "beer-garden", [origin.lng, origin.lat])).toEqual({ count: 2, underCeiling: 1 });
    expect(scoreVenueForPlan(concierge[0]!, context, 0, [], [], null).reasons).toEqual([]);
    expect(scoreVenueForPlan(concierge[1]!, context, 0, [], [], null).reasons).toEqual(["pints from £5.00"]);
    expect(scoreVenue(pubs[1]!, "cheapest")).toBeGreaterThan(scoreVenue(pubs[0]!, "cheapest"));
  });

  it("refuses the published unsourced Moon & Stars in Compass and Havering claims", () => {
    const published = JSON.parse(readFileSync("public/data/venues_slim.json", "utf8")) as { rows: SlimVenue[] };
    const moon = published.rows.find((row) => row.name.includes("Moon") && row.cheapestPrice === 2.49 && row.borough === "Havering");
    expect(moon).toBeDefined();
    const pubs = [full(moon!), full(slim("pint"))];
    expect(rankCompassTargets(origin, [moon!, slim("pint")]).targets.map((row) => row.id)).toEqual(["pint"]);
    const stats = pintFactStats(pubs, "Havering", "havering");
    expect(stats).toMatchObject({ averageGbp: 3.75, pubCount: 2, totalPubCount: 2, minGbp: 5, maxGbp: 5 });
    expect(faqItems(stats, { monthYear: "November 2026", year: "2026" })[0]?.answer).toContain("£5.00 at pint");
    expect(factBlockSentences(stats, { monthYear: "November 2026", observedDate: "3 November 2026" }).join(" ")).not.toContain("at The Moon");
    expect(pubsInBorough(pubs, "havering")).toHaveLength(2);
  });

  it("keeps area averages when no pint qualifies and publishes no cheapest claim", async () => {
    routeData.venues = [full(slim("half", { anchorLabel: "Half pint", cheapestPrice: 3.4 })),
      full(slim("undated", { cheapestPrice: 8, priceObservedAt: undefined }))];
    const stats = pintFactStats(routeData.venues, "Havering", "havering");
    expect(stats).toMatchObject({ minGbp: null, maxGbp: null, averageGbp: 5.7, totalPubCount: 2 });
    expect(faqItems(stats, { monthYear: "November 2026", year: "2026" }).map((item) => item.question))
      .not.toContain("What is the cheapest pint in Havering?");
    const html = renderToStaticMarkup(createElement(FactBlock, { stats, headingId: "facts", title: "Facts", monthYear: "November 2026", observedDate: "3 November 2026" }));
    expect(html).toContain("£5.70");
    expect(html).not.toContain("at null");
    const { generateMetadata } = await import("@/app/borough/[slug]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "havering" }) });
    expect(metadata.description).not.toContain("Pints from");
    const { default: image } = await import("@/app/borough/[slug]/opengraph-image");
    const response = await image({ params: Promise.resolve({ slug: "havering" }) });
    const imageHtml = await response.text();
    expect(imageHtml).not.toContain("the cheapest tracked pint");
    expect(imageHtml).toContain("£5.70");
  });

  it("uses the qualified minimum in borough metadata and the share image", async () => {
    routeData.venues = [full(slim("half", { anchorLabel: "Half pint", cheapestPrice: 3.4 })), full(slim("pint"))];
    const { generateMetadata } = await import("@/app/borough/[slug]/page");
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "havering" }) });
    expect(metadata.description).toContain("Pints from £5.00");
    const { default: image } = await import("@/app/borough/[slug]/opengraph-image");
    const response = await image({ params: Promise.resolve({ slug: "havering" }) });
    const html = await response.text();
    expect(html).toContain("£5.00");
    expect(html).not.toContain("£3.40");
  });

  it("refuses an expensive non-pint in the maximum and range claims", () => {
    const pubs = [full(slim("bottle", { cheapestPint: "BOTTLED BEER", cheapestPrice: 9 })), full(slim("pint"))];
    const stats = pintFactStats(pubs, "Havering", "havering");
    expect(stats).toMatchObject({ minGbp: 5, maxGbp: 5, averageGbp: 5, pubCount: 1 });
    expect(faqItems(stats, { monthYear: "November 2026", year: "2026" }).map((item) => item.question))
      .not.toContain("What's the price range for a pint in Havering?");
    expect(pubsInBorough(pubs.reverse(), "havering").map((pub) => pub.id)).toEqual(["pint", "bottle"]);
  });

  it("keeps a later tied row from lending the chosen price its day", () => {
    const pub = full(slim("pint", { priceSource: undefined, priceObservedAt: undefined }));
    pub.prices = [{ price_gbp: 3, pint_name: "Lager", pub_url: "https://pub.example/menu" },
      { price_gbp: 3, pint_name: "Lager", pub_url: "https://pub.example/menu", scraped_at_values: "2026-10-01" }] as VenuePrice[];
    pub.cheapestPrice = 3;
    expect(pintFactStats([pub], "Havering", "havering").minGbp).toBeNull();
    expect(listBoroughs([pub])[0]?.cheapestGbp).toBeNull();
  });

  it("uses the same average and named population in the share card and fact block", async () => {
    routeData.venues = [
      { ...full(slim("pint")), averagePrice: 40 },
      full(slim("bottle", { cheapestPint: "BOTTLED BEER", cheapestPrice: 9 })),
      full(slim("unknown", { cheapestPrice: 7, priceObservedAt: undefined, priceSource: undefined })),
    ];
    const { default: image } = await import("@/app/borough/[slug]/opengraph-image");
    const html = await (await image({ params: Promise.resolve({ slug: "havering" }) })).text();
    expect(html).toContain("£6.00");
    expect(html).toContain("average across 2 listed pubs");
    expect(html).toContain("3");
    expect(html).not.toContain("£40.00");
    expect(pintFactStats(routeData.venues, "Havering", "havering")).toMatchObject({ averageGbp: 6, pubCount: 2 });
  });
});
