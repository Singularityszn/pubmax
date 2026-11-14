// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import CrawlReceipt from "@/components/wild/CrawlReceipt";
import PintLine from "@/components/wild/PintLine";
import { formatPence } from "@/lib/formatGbp";
import { buildNamedRoute } from "@/lib/namedRoutes";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import {
  clampPeople,
  crawlPriceListing,
  crawlRound,
  formatKm,
  listedDaysText,
  missingStopsText,
  sourcesText,
  unsourcedText,
  type WildCrawl,
  type WildCrawlStop,
} from "@/lib/wildPintLineCrawl";
import { readDayLabel, straightLineMinutes, wildCrawlFromNamedRoute } from "@/lib/wildPintLineRoute";

function stop(position: number, priceGbp: number | null, extra: Partial<WildCrawlStop["pint"]> = {}): WildCrawlStop {
  return {
    position,
    name: `Pub ${position}`,
    point: [-0.13 + position * 0.001, 51.51],
    pint:
      priceGbp === null
        ? null
        : {
            priceGbp,
            drink: "Amstel",
            band: "average",
            source: "Pint Prices",
            readDay: "2026-10-02",
            readDayLabel: "2 October 2026",
            ...extra,
          },
    legMinutes: position === 1 ? null : 2,
  };
}

const FIVE: WildCrawlStop[] = [stop(1, 6.1), stop(2, 6.75), stop(3, 6.05), stop(4, 5.7), stop(5, 6.4)];

describe("the receipt's sums", () => {
  it("adds the five Victorian Soho pints to £31.00 without drifting a penny", () => {
    const round = crawlRound(FIVE, 1);
    expect(round.pintEachStopPence).toBe(3100);
    expect(formatPence(round.pintEachStopPence)).toBe("£31.00");
  });

  it("buys a pint for every person at every stop, and splits it back to one each", () => {
    const round = crawlRound(FIVE, 3);
    expect(round.roundPence).toBe(9300);
    expect(round.eachPence).toBe(3100);
    expect(round.pints).toBe(15);
    expect(formatPence(round.eachPence)).toBe("£31.00");
  });

  it("holds the stepper to one to eight people", () => {
    expect(clampPeople(0)).toBe(1);
    expect(clampPeople(9)).toBe(8);
    expect(clampPeople(Number.NaN)).toBe(1);
    expect(crawlRound(FIVE, 12).people).toBe(8);
  });

  it("leaves a stop with no price out of every total, and counts it", () => {
    const stops = [stop(1, 6.1), stop(2, null), stop(3, 5.9)];
    const round = crawlRound(stops, 2);
    expect(round.pricedStops).toBe(2);
    expect(round.unpricedStops).toBe(1);
    expect(round.pintEachStopPence).toBe(1200);
    expect(round.roundPence).toBe(2400);
    expect(round.pints).toBe(4);
  });

  it("counts a planned stop the dataset no longer holds as missing, and so as unpriced", () => {
    const four = FIVE.slice(0, 4);
    const round = crawlRound(four, 2, 5);
    expect(round.pricedStops).toBe(4);
    expect(round.missingStops).toBe(1);
    expect(round.unpricedStops).toBe(1);
    expect(round.pintEachStopPence).toBe(2460);
    expect(round.pints).toBe(8);
    // Without a planned count, or with nothing lost, nothing is missing.
    expect(crawlRound(four, 2).missingStops).toBe(0);
    expect(crawlRound(FIVE, 1, 5)).toMatchObject({ missingStops: 0, unpricedStops: 0 });
    expect(crawlRound([stop(1, 6.1), stop(2, null)], 1, 4)).toMatchObject({ missingStops: 2, unpricedStops: 3 });
    expect(missingStopsText(0)).toBeNull();
    expect(missingStopsText(1)).toBe("1 planned stop is missing from our pub list, so it is not shown or counted.");
    expect(missingStopsText(2)).toBe("2 planned stops are missing from our pub list, so they are not shown or counted.");
    expect(unsourcedText(0)).toBeNull();
    expect(unsourcedText(1)).toBe("1 price names no publisher.");
    expect(unsourcedText(3)).toBe("3 prices name no publisher.");
  });

  it("says who listed the prices and when, and what it does not know", () => {
    const listing = crawlPriceListing([
      stop(1, 6.1, { readDay: "2026-10-09", readDayLabel: "9 October 2026" }),
      stop(2, 5.5),
      stop(3, 6, { source: null, readDay: null, readDayLabel: null }),
      stop(4, null),
    ]);
    expect(listedDaysText(listing)).toBe("2 October 2026 to 9 October 2026");
    expect(sourcesText(listing.sources)).toBe("Pint Prices");
    expect(listing.undated).toBe(1);
    expect(listing.unsourced).toBe(1);
    expect(sourcesText(["A", "B", "C"])).toBe("A, B and C");
    expect(listedDaysText(crawlPriceListing([stop(1, 6.1)]))).toBe("2 October 2026");
  });

  it("prints a short walk in metres and a longer one in kilometres", () => {
    expect(formatKm(0.4498)).toBe("0.4 km");
    expect(formatKm(0.034)).toBe("30 m");
  });
});

describe("a named route as a wild crawl", () => {
  const venues = groupVenuePrices(
    JSON.parse(readFileSync(join(process.cwd(), "public/data/pint_prices_app_dataset.json"), "utf8")) as VenuePrice[],
  );

  it("carries the page's own stops, prices, bands, read days and straight-line walks", () => {
    const route = buildNamedRoute("victorian-soho", venues)!;
    const crawl = wildCrawlFromNamedRoute(route, venues, (name) => name.toLowerCase(), Date.parse("2026-11-02T12:00:00Z"));
    expect(crawl.name).toBe(route.crawl.name);
    expect(crawl.stops.map((s) => s.name)).toEqual(route.stops.map((s) => s.name));
    expect(crawl.stops.map((s) => s.pint?.priceGbp ?? null)).toEqual(route.stops.map((s) => s.pint?.priceGbp ?? null));
    expect(crawl.stops[0]!.legMinutes).toBeNull();
    for (const [i, s] of crawl.stops.entries()) {
      expect(s.point).not.toBeNull();
      if (i > 0) expect(s.legMinutes).toBe(straightLineMinutes(route.stops[i]!.legKm!));
      if (s.pint) {
        expect(["cheap", "average", "expensive"]).toContain(s.pint.band);
        expect(s.pint.drink).toBe(s.pint.drink.toLowerCase());
      }
    }
    expect(crawl.totalMinutes).toBe(straightLineMinutes(route.totalKm!));
  });

  it("plans every stop of the route, so a venue the dataset has lost is counted as missing", () => {
    const route = buildNamedRoute("victorian-soho", venues)!;
    const lost = route.stops[1]!.venueId;
    const thinner = venues.filter((venue) => venue.id !== lost);
    const crawl = wildCrawlFromNamedRoute(buildNamedRoute("victorian-soho", thinner)!, thinner);
    expect(crawl.plannedStops).toBe(route.crawl.venueIds.length);
    expect(crawl.stops).toHaveLength(route.stops.length - 1);
    expect(crawlRound(crawl.stops, 1, crawl.plannedStops).missingStops).toBe(1);
    expect(crawl.totalMinutes).toBeNull();
  });

  it("names no read day that is still ahead or unreadable", () => {
    const now = Date.parse("2026-11-02T12:00:00Z");
    expect(readDayLabel("2026-10-02", now)).toBe("2 October 2026");
    expect(readDayLabel("2026-12-25", now)).toBeNull();
    expect(readDayLabel("2026-02-30", now)).toBeNull();
    expect(readDayLabel("2026-11-02", Date.parse("2026-11-02T09:00:00Z"))).toBe("2 November 2026");
    expect(readDayLabel("October", now)).toBeNull();
    expect(readDayLabel(null, now)).toBeNull();
  });
});

const CRAWL: WildCrawl = {
  name: "Victorian Soho",
  plannedStops: 4,
  stops: [stop(1, 6.1), stop(2, null), stop(3, 6.75, { band: "expensive" }), stop(4, 5.7, { band: "cheap" })],
  totalKm: 0.45,
  totalMinutes: 6,
};

describe("the receipt as it renders", () => {
  const html = renderToStaticMarkup(createElement(CrawlReceipt, { crawl: CRAWL }));

  it("prints every stop, and says a missing price rather than guessing one", () => {
    for (const name of ["Pub 1", "Pub 2", "Pub 3", "Pub 4"]) expect(html).toContain(name);
    expect(html).toContain("No price yet");
    expect(html).toContain("Not listed, so not in the total");
    expect(html).toContain("1 stop has no listed price, so the total leaves it out.");
  });

  it("keeps each publisher and read day beside its own stop", () => {
    const mixed = renderToStaticMarkup(createElement(CrawlReceipt, { crawl: {
      ...CRAWL,
      stops: [stop(1, 6.1, { source: "First source", readDay: "2026-07-04", readDayLabel: "4 July 2026" }),
        stop(2, 6.2, { source: "Second source", readDay: "2026-10-02", readDayLabel: "2 October 2026" })],
    } }));
    const rows = mixed.match(/<li class="crawlReceipt__item">[\s\S]*?<\/li>/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("First source");
    expect(rows[0]).toContain('dateTime="2026-07-04"');
    expect(rows[0]).not.toContain("Second source");
    expect(rows[1]).toContain("Second source");
    expect(rows[1]).toContain('dateTime="2026-10-02"');
  });

  it("paints each price through its band class", () => {
    expect(html).toMatch(/crawlReceipt__itemPrice priceBand-average[^>]*>£6\.10/);
    expect(html).toMatch(/crawlReceipt__itemPrice priceBand-expensive[^>]*>£6\.75/);
    expect(html).toMatch(/crawlReceipt__itemPrice priceBand-cheap[^>]*>£5\.70/);
  });

  it("adds the priced stops only, rounds for three and splits it", () => {
    expect(html).toContain("£18.55");
    expect(html).toContain("£55.65");
    expect(html).toMatch(/Split <span class="crawlReceipt__peopleCount">3<\/span> ways/);
    expect(html).toContain("£18.55 each");
    expect(html).toContain("Selected pints subtotal");
    expect(html).not.toContain("What the night costs");
  });

  it("gives the walk as an estimate and keeps the honest footer", () => {
    expect(html).toContain("about 6 min, 0.5 km");
    expect(html).toContain("A straight-line estimate.");
    expect(html).toMatch(/Prices listed <span class="crawlReceipt__listedDate">2 October 2026<\/span> by Pint Prices\./);
    expect(html).toContain("Pay what the bar charges.");
  });

  it("gives the people stepper two labelled 44px controls", () => {
    expect(html).toContain('aria-label="One fewer person"');
    expect(html).toContain('aria-label="One more person"');
    expect(html.match(/uiButton--icon/g)).toHaveLength(2);
  });

  it("writes no em dash and no exclamation mark", () => {
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/[—!]/);
  });
});

// The same crawl after the dataset lost its fifth planned stop: four pubs, all
// priced, and one publisher left unrecorded.
const LOST_ONE: WildCrawl = {
  name: "Victorian Soho",
  plannedStops: 5,
  stops: [stop(1, 6.1), stop(2, 6.75), stop(3, 6.05, { source: null }), stop(4, 5.7)],
  totalKm: null,
  totalMinutes: null,
};

describe("the receipt over a crawl that has lost a stop", () => {
  const html = renderToStaticMarkup(createElement(CrawlReceipt, { crawl: LOST_ONE }));
  const text = html.replace(/<[^>]+>/g, "");

  it("never says every stop, and says the missing one plainly", () => {
    expect(text).not.toMatch(/at every stop/);
    expect(text).toContain("A pint at each priced stop");
    expect(text).toContain("A round at each priced stop for 3");
    expect(text).toContain("one each at every priced stop.");
    expect(text).toContain("1 planned stop is missing from our pub list, so it is not shown or counted.");
    // Every listed stop has a price, so no listed stop is said to lack one.
    expect(text).not.toContain("no listed price, so the total");
  });

  it("names the publisher it has, and counts the price that names none", () => {
    expect(html).toMatch(/Prices listed <span class="crawlReceipt__listedDate">2 October 2026<\/span> by Pint Prices\. 1 price names no publisher\./);
  });

  it("still says the missing stop when no stop it holds is priced", () => {
    const unpriced = renderToStaticMarkup(
      createElement(CrawlReceipt, { crawl: { ...LOST_ONE, stops: [stop(1, null), stop(2, null)], plannedStops: 4 } }),
    ).replace(/<[^>]+>/g, "");
    expect(unpriced).toContain("No stop on this crawl has a listed price yet");
    expect(unpriced).toContain("2 stops have no listed price.");
    expect(unpriced).toContain("2 planned stops are missing from our pub list, so they are not shown or counted.");
  });
});

describe("the Pint Line over a crawl that has lost a stop", () => {
  const text = renderToStaticMarkup(createElement(PintLine, { crawl: LOST_ONE })).replace(/<[^>]+>/g, "");

  it("prices the priced stops only, and says the missing one plainly", () => {
    expect(text).not.toContain("a pint at every stop");
    expect(text).toContain("a pint at the 4 priced stops");
    expect(text).toContain("1 planned stop is missing from our pub list, so it is not shown or counted.");
    expect(text).not.toContain("no listed price.");
    expect(text).toContain("1 price names no publisher.");
  });
});

describe("the Pint Line poster before it has measured", () => {
  const html = renderToStaticMarkup(createElement(PintLine, { crawl: CRAWL }));

  it("names the route and its totals, and who listed the pints and when", () => {
    expect(html).toContain("The Pint Line");
    expect(html).toContain("Victorian Soho");
    expect(html).toContain("£18.55");
    expect(html).toContain("a pint at the 3 priced stops");
    expect(html).toContain("Pints listed by Pint Prices, read 2 October 2026.");
    expect(html).toContain("1 stop has no listed price.");
    expect(html).toContain("Walk times are straight-line estimates");
  });

  it("writes no em dash and no exclamation mark", () => {
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/[—!]/);
  });
});
