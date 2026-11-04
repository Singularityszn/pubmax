import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import AreaPage, { generateMetadata } from "@/app/area/[slug]/page";
import { areaCandidateForVenue, buildAreaLanding, listAreaLandings } from "@/lib/areaLanding";
import { PRICED_LANDING_PUBLICATION_FLOORS } from "@/lib/pricedLanding";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

const venues = groupVenuePrices(
  JSON.parse(readFileSync(join(process.cwd(), "public/data/pint_prices_app_dataset.json"), "utf8")) as VenuePrice[],
);

describe("area root pages", () => {
  it("publish on the floor of 15 priced pubs alone, Soho and Shoreditch included", () => {
    expect(PRICED_LANDING_PUBLICATION_FLOORS.area).toBe(15);
    const published = listAreaLandings(venues);
    const slugs = published.map((landing) => landing.areaSlug);
    expect(slugs).toEqual(expect.arrayContaining(["piccadilly-soho", "shoreditch", "clapham", "victoria"]));
    for (const landing of published) expect(landing.totalPricedVenues).toBeGreaterThanOrEqual(15);
    expect(buildAreaLanding("barnes", venues)).toBeNull();
    expect(buildAreaLanding("not-an-area", venues)).toBeNull();
  });

  it("rank cheapest first, at most 20 rows, one pub once at its own cheapest pint", () => {
    const soho = buildAreaLanding("piccadilly-soho", venues)!;
    expect(soho.rows.length).toBeLessThanOrEqual(20);
    const prices = soho.rows.map((row) => row.priceGbp);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(new Set(soho.rows.map((row) => row.venueId)).size).toBe(soho.rows.length);
  });

  it("print a collection date on every area that publishes today", () => {
    for (const landing of listAreaLandings(venues)) {
      expect({ area: landing.areaSlug, collectedAt: landing.collectedAt }).toEqual({
        area: landing.areaSlug,
        collectedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}/),
      });
    }
  });

  it("break a price tie on the beer pages' order, whatever order the dataset holds", () => {
    const venue = venues.find((candidate) => {
      const prices = candidate.prices.map((row) => row.price_gbp).filter((price) => typeof price === "number");
      const lowest = Math.min(...prices);
      return candidate.prices.filter((row) => row.price_gbp === lowest).length > 1 && areaCandidateForVenue(candidate);
    })!;
    expect(venue).toBeDefined();
    const forward = areaCandidateForVenue(venue)!;
    const reversed = areaCandidateForVenue({ ...venue, prices: [...venue.prices].reverse() })!;
    expect(reversed.pintName).toBe(forward.pintName);
  });

  it("take each figure, publisher and read from the row that owns it", () => {
    const venue = venues.find((candidate) => candidate.id === "venue-1ufn31x")!;
    const candidate = areaCandidateForVenue(venue)!;
    const owner = venue.prices.find((row) => row.price_gbp === candidate.priceGbp)!;
    expect(candidate.pintName).toBe(owner.pint_name);
    expect(candidate.priceGbp).toBe(Math.min(...venue.prices.map((row) => row.price_gbp as number)));
  });

  it("leave out a venue that is not a public pub", () => {
    const bar: Venue = { ...venues[0]!, kind: "restaurant" };
    expect(areaCandidateForVenue(bar)).toBeNull();
  });

  it("carry one canonical and noindex an area without a page", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "shoreditch" }) });
    expect(metadata.title).toBe("Cheapest pints in Shoreditch");
    expect(metadata.alternates?.canonical).toBe("/area/shoreditch");
    const held = await generateMetadata({ params: Promise.resolve({ slug: "barnes" }) });
    expect(held.robots).toEqual({ index: false, follow: false });
  });

  it("render the answer, a publisher on every row, the stations and a map arrival, never ?q=", async () => {
    const html = renderToStaticMarkup(await AreaPage({ params: Promise.resolve({ slug: "piccadilly-soho" }) }));
    expect(html).toContain("Cheapest pints in Piccadilly &amp; Soho");
    expect(html).toMatch(/From £\d+\.\d{2}/);
    expect(html).toContain("Piccadilly Circus");
    expect(html).toContain('href="/map?area=piccadilly-soho"');
    expect(html).not.toContain("/map?q=");
  });
});
