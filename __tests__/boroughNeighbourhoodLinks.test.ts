import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  boroughNamedRouteLinks,
  boroughNightAreaLinks,
  nightAreaBoroughSlugs,
} from "@/lib/boroughNeighbourhoodLinks";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

const venues = groupVenuePrices(
  JSON.parse(readFileSync(join(process.cwd(), "public/data/pint_prices_app_dataset.json"), "utf8")) as VenuePrice[],
);

describe("borough links to Soho, Shoreditch and the named routes", () => {
  it("links an area from each borough that holds at least five of its priced pubs", () => {
    expect(nightAreaBoroughSlugs("piccadilly-soho", venues)).toEqual(["camden", "westminster"]);
    expect(nightAreaBoroughSlugs("shoreditch", venues)).toEqual([
      "city-of-london",
      "hackney",
      "islington",
      "tower-hamlets",
    ]);
  });

  it("links a borough to the area pages that cover it, never through ?q=", () => {
    expect(boroughNightAreaLinks("westminster", venues)).toContainEqual({
      href: "/area/piccadilly-soho",
      label: "Cheapest pints in Piccadilly & Soho",
    });
    expect(boroughNightAreaLinks("hackney", venues)).toContainEqual({
      href: "/area/shoreditch",
      label: "Cheapest pints in Shoreditch",
    });
    const every = ["westminster", "hackney", "camden", "southwark", "lambeth"].flatMap((slug) =>
      boroughNightAreaLinks(slug, venues),
    );
    expect(every.every((link) => /^\/area\/[a-z-]+$/.test(link.href))).toBe(true);
  });

  it("links a borough to each named route with a stop in it", () => {
    const westminster = boroughNamedRouteLinks("westminster", venues);
    expect(westminster).toContainEqual({ href: "/routes/victorian-soho", label: "Victorian Soho route" });
    expect(boroughNamedRouteLinks("camden", venues)).toContainEqual({
      href: "/routes/camden-market",
      label: "Camden Market crawl route",
    });
    const every = ["westminster", "hackney", "camden", "southwark", "city-of-london"].flatMap((slug) => [
      ...boroughNightAreaLinks(slug, venues),
      ...boroughNamedRouteLinks(slug, venues),
    ]);
    expect(every.some((link) => link.href.includes("?q="))).toBe(false);
  });
});
