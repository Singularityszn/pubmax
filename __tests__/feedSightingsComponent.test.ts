import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import FeedSightings from "@/components/feed/FeedSightings";
import type { SightingDTO } from "@/lib/feedSightings";

const sighting: SightingDTO = {
  id: "sighting-venue-test",
  venueId: "venue-test",
  venueName: "The Crown and Horseshoes",
  venueMapUrl: "/map?sel=venue-test",
  drink: "Hawk Ridge White IPA with a deliberately long name",
  priceGbp: 5.25,
  priceLabel: "£5.25",
  sourceLabel: "Greene King official site",
  sourceUrl: "https://www.greeneking.co.uk/pubs/example",
  sourceDomain: "greeneking.co.uk",
  observedAt: "2026-07-20T12:00:00.000Z",
};

describe("FeedSightings", () => {
  it("groups rows under one sourced-price heading without a repeated badge", () => {
    const html = renderToStaticMarkup(
      createElement(FeedSightings, { variant: "primary", sightings: [sighting] }),
    );

    expect(html).toContain("Recent sourced prices");
    expect(html).not.toMatch(/spotted/i);
    expect(html).toContain("Hawk Ridge White IPA with a deliberately long name");
    expect(html).toContain("greeneking.co.uk");

    const drink = html.indexOf('class="feedSightingDrink"');
    const price = html.indexOf('class="feedSightingPrice"');
    const venue = html.indexOf('class="feedSightingVenue"');
    const source = html.indexOf('class="feedSightingSource"');
    expect(drink).toBeGreaterThan(-1);
    expect(drink).toBeLessThan(price);
    expect(price).toBeLessThan(venue);
    expect(venue).toBeLessThan(source);
  });

  it("preserves sourced-price context in each row's accessible name", () => {
    const html = renderToStaticMarkup(
      createElement(FeedSightings, { variant: "strip", sightings: [sighting] }),
    );

    expect(html).toMatch(
      /aria-label="Sourced price: Hawk Ridge White IPA with a deliberately long name at £5.25, The Crown and Horseshoes\. Source greeneking\.co\.uk · [^"]+\. Open on the map\."/,
    );
  });

  it("keeps one contribution action after primary sourced rows", () => {
    const primary = renderToStaticMarkup(
      createElement(FeedSightings, { variant: "primary", sightings: [sighting] }),
    );
    const strip = renderToStaticMarkup(
      createElement(FeedSightings, { variant: "strip", sightings: [sighting] }),
    );

    expect(primary).toContain('href="/map?log=1"');
    expect(primary).toContain("Find a pub and drop a pint");
    expect(strip).not.toContain('href="/map?log=1"');
  });
});
