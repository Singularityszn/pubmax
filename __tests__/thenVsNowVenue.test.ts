import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

import VenuePriceStory from "@/components/map/VenuePriceStory";
import {
  computeVenuePriceStory,
  cpiIndexForYear,
  inflateToToday,
  parseEraYear,
  INFLATION_TODAY_YEAR,
  type VenuePriceStoryDrop,
} from "@/lib/thenVsNow";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";
import type { Provenance } from "@/lib/curation";
import { bundledReadDay } from "@/__tests__/helpers/pintDatasetClock";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-15T12:00:00.000Z");

// Each fixture provides the selected price and the evidence relevant to that
// scenario, without unrelated map and amenity fields.
function v(
  over: Partial<Venue> & { id: string; name: string; cheapestPrice: number | null },
): Venue {
  return {
    primaryBorough: "",
    visibleBoroughs: [],
    cheapestPint: "",
    curation: {},
    ...over,
  } as Venue;
}

function drop(
  over: Partial<VenuePriceStoryDrop> & { venueId: string; provenance: Provenance },
): VenuePriceStoryDrop {
  return {
    priceGbp: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    era: "",
    handle: "someone",
    ...over,
  };
}

function listedVenue(row: Partial<VenuePrice> = {}): Venue {
  return v({
    id: "v1", name: "The Anchor", cheapestPrice: 4,
    prices: [{
      pint_name: "Guinness", measure: "pint", price_gbp: 4,
      pub_url: "https://pint-prices.com/pub/anchor", scraped_at_values: "2026-10-02T12:00:00Z",
      ...row,
    } as VenuePrice],
  });
}

function pricedReport(over: Partial<VenuePriceStoryDrop> = {}): VenuePriceStoryDrop {
  return drop({
    venueId: "v1", priceGbp: 5, drink: "Guinness", measure: "pint", provenance: "contributor",
    handle: "@reporter", createdAt: "2026-10-14T12:00:00Z", ...over,
  });
}

describe("parseEraYear", () => {
  it("pulls a bare 4-digit year out of a free-text era", () => {
    expect(parseEraYear("The wedding, 1971")).toBe(1971);
    expect(parseEraYear("Dad started drinking here in 2003")).toBe(2003);
  });

  it("resolves a decade tag to its midpoint", () => {
    expect(parseEraYear("Dad's rule, 1980s")).toBe(1985);
    expect(parseEraYear("Nan's shift, 1950s")).toBe(1955);
    expect(parseEraYear("Told since the 2010s")).toBe(2015);
  });

  it("prefers a decade over the bare year inside it", () => {
    // "1980s" contains "1980"; the decade midpoint must win, not 1980.
    expect(parseEraYear("1980s")).toBe(1985);
  });

  it("returns null for undated / out-of-range / non-string eras", () => {
    expect(parseEraYear("High-tide advice")).toBeNull();
    expect(parseEraYear("")).toBeNull();
    expect(parseEraYear(null)).toBeNull();
    expect(parseEraYear(undefined)).toBeNull();
    expect(parseEraYear("Back in 1850")).toBeNull(); // before the 1900 floor
    expect(parseEraYear("£5 a pint")).toBeNull(); // a price is not a year
  });
});

describe("cpiIndexForYear", () => {
  it("returns the exact index at an anchor year", () => {
    expect(cpiIndexForYear(2015)).toBe(100);
    expect(cpiIndexForYear(INFLATION_TODAY_YEAR)).toBeGreaterThan(100);
  });

  it("interpolates linearly between anchors", () => {
    // 1990 = 58.2, 2000 = 74.8 → 1995 is the midpoint.
    expect(cpiIndexForYear(1995)).toBeCloseTo((58.2 + 74.8) / 2, 5);
  });

  it("clamps outside the covered range", () => {
    expect(cpiIndexForYear(1800)).toBe(cpiIndexForYear(1950));
    expect(cpiIndexForYear(3000)).toBe(cpiIndexForYear(INFLATION_TODAY_YEAR));
  });

  it("returns null for a non-finite year", () => {
    expect(cpiIndexForYear(Number.NaN)).toBeNull();
  });
});

describe("inflateToToday", () => {
  it("revalues an older price UP into today's money", () => {
    const today = inflateToToday(2, 1990);
    expect(today).not.toBeNull();
    // 1990 money is worth more today, so £2 then > £2 now.
    expect(today as number).toBeGreaterThan(2);
  });

  it("is the identity at the today year", () => {
    expect(inflateToToday(4.5, INFLATION_TODAY_YEAR)).toBe(4.5);
  });

  it("rounds to the penny", () => {
    const value = inflateToToday(1.23, 1985);
    expect(value).not.toBeNull();
    expect(Math.round((value as number) * 100)).toBe((value as number) * 100);
  });

  it("returns null for an unusable amount", () => {
    expect(inflateToToday(Number.NaN, 1990)).toBeNull();
  });
});

describe("computeVenuePriceStory", () => {
  it.each([
    { measure: "pint", reportMeasure: "pint" as const },
    { measure: "175ml", reportMeasure: "175ml" as const },
  ])("compares dated records of the same named drink and $measure serving", ({ measure, reportMeasure }) => {
    const venue = listedVenue({ measure });
    const report = pricedReport({ measure: reportMeasure });
    const story = computeVenuePriceStory(venue, [report], NOW);
    expect(story.deltaGbp).toBe(1);
    expect(story.pct).toBe(25);
    const clock = vi.spyOn(Date, "now").mockReturnValue(NOW);
    try {
      const markup = renderToStaticMarkup(createElement(VenuePriceStory, { venue, drops: [report] }));
      expect(markup).toContain("vs earlier price");
      expect(markup).not.toContain("Price comparison unavailable");
    } finally {
      clock.mockRestore();
    }
  });

  it.each([3, 4, 5])("withholds every change claim for a stale £%s Guinness pint report", (priceGbp) => {
    const now = Date.parse("2026-11-07T12:00:00Z");
    const venue = listedVenue({ scraped_at_values: "2026-09-01T12:00:00Z" });
    const report = pricedReport({ priceGbp, createdAt: "2026-09-15T12:00:00Z" });
    const story = computeVenuePriceStory(venue, [report], now);
    expect(story.baseline?.gbp).toBe(4);
    expect(story.now?.gbp).toBe(priceGbp);
    expect(story.now?.isFresh).toBe(false);
    expect(story.deltaGbp).toBeNull();
    expect(story.pct).toBeNull();

    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const markup = renderToStaticMarkup(createElement(VenuePriceStory, { venue, drops: [report] }));
      expect(markup).toContain("£4.00");
      expect(markup).toContain(`£${priceGbp.toFixed(2)}`);
      expect(markup).toContain("Logged");
      expect(markup).toContain("15 September 2026");
      expect(markup).toContain("Price comparison unavailable. These records do not establish a change for the same drink and serving.");
      expect(markup).not.toContain("vpsArrow");
      expect(markup).not.toContain("vpsBars");
      expect(markup).not.toContain("vpsDelta");
      expect(markup).not.toContain("%");
      expect(markup).not.toContain("vs earlier price");
      expect(markup).not.toContain("No change from the earlier price");
      expect(markup).not.toContain("The community price matches");
      expect(markup).not.toContain("community-reported.");
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    { name: "different drink at the same price", report: { drink: "Guinness 0.0", priceGbp: 4 } },
    { name: "half instead of pint", report: { measure: "half" as const } },
    { name: "wine glass instead of pint", report: { measure: "175ml" as const } },
    { name: "different other serving", row: { measure: "330 ml can" }, report: { measure: "other" as const, measureLabel: "500 ml can" } },
    { name: "unnamed other serving", report: { measure: "other" as const, measureLabel: "" } },
    { name: "unknown drink", report: { drink: null } },
    { name: "unknown serving", report: { measure: null } },
    { name: "missing publisher", row: { pub_url: "" }, report: {} },
    { name: "missing read date", row: { scraped_at_values: "" }, report: {} },
    { name: "older report", report: { createdAt: "2026-10-01T12:00:00Z" } },
    { name: "future report", report: { createdAt: "2026-10-16T12:00:00Z" } },
  ])("does not claim a historical change for $name", ({ row, report }) => {
    const story = computeVenuePriceStory(listedVenue(row), [pricedReport(report)], NOW);
    expect(story.deltaGbp).toBeNull();
    expect(story.pct).toBeNull();
  });

  it("does not fill missing evidence from a newer tied or more expensive row", () => {
    const venue = listedVenue({ pint_name: "", pub_url: "", scraped_at_values: "" });
    venue.prices.push({
      ...venue.prices[0]!, pint_name: "Newer tied beer", pub_url: "https://newer.example/menu",
      scraped_at_values: "2026-10-14T12:00:00Z",
    });
    venue.prices.push({ ...venue.prices[1]!, pint_name: "Dearer beer", price_gbp: 7 });
    const markup = renderToStaticMarkup(createElement(VenuePriceStory, { venue, drops: [] }));
    expect(markup).toContain("£4.00");
    expect(markup).toContain("Drink not recorded");
    expect(markup).toContain("Publisher not recorded");
    expect(markup).toContain("Source read date unknown");
    expect(markup).not.toContain("Newer tied beer");
    expect(markup).not.toContain("newer.example");
    expect(markup).not.toContain("14 October 2026");
  });

  it("ignores another venue's reports and keeps public-safe attribution", () => {
    const venue = listedVenue();
    expect(computeVenuePriceStory(venue, [pricedReport({ venueId: "another-pub" })], NOW).now).toBeNull();
    const report = pricedReport({ handle: "a PUBMAXXER" });
    expect(computeVenuePriceStory(venue, [report], NOW).now?.evidence.publisher).toBe("Reported by a PUBMAXXER");
  });

  it("does not describe an unknown report date as fresh or over 30 days old", () => {
    const story = computeVenuePriceStory(listedVenue(), [pricedReport({ createdAt: "" })], NOW);
    expect(story.now?.evidence.recordedAt).toBeNull();
    expect(story.now?.label).toContain("date unknown");
    expect(story.now?.label).not.toContain("tonight");
    expect(story.now?.label).not.toContain("Over 30 days old");
  });

  it.each(["1985", "Old memory", "Family story", "Told since the 1960s"])(
    "keeps the log date but withholds price freshness and movement for %s",
    (era) => {
      const venue = listedVenue();
      const report = pricedReport({ era });
      const story = computeVenuePriceStory(venue, [report], NOW);
      expect(story.now?.isFresh).toBe(false);
      expect(story.now?.evidence.recordedAt).toBe("2026-10-14T12:00:00.000Z");
      expect(story.deltaGbp).toBeNull();
      expect(story.inflation).toBeNull();
      const markup = renderToStaticMarkup(createElement(VenuePriceStory, { venue, drops: [report] }));
      expect(markup).toContain("14 October 2026");
      expect(markup).toContain("When this price was seen is not recorded.");
      expect(markup).not.toContain("vs earlier price");
      expect(markup).not.toContain("A pint here was");
    },
  );

  it("retains the explicit Tonight price-log preset", () => {
    const story = computeVenuePriceStory(listedVenue(), [pricedReport({ era: "Tonight" })], NOW);
    expect(story.now?.isFresh).toBe(true);
    expect(story.deltaGbp).toBe(1);
  });

  it("does not choose an attribution between indistinguishable merged reports", () => {
    const venue = listedVenue();
    venue.latestContributorPrice = 4;
    venue.latestContributorAt = "2026-10-14T12:00:00Z";
    venue.cheapestPint = "Guinness";
    const reports = [pricedReport({ priceGbp: 4 }), pricedReport({ priceGbp: 4, handle: "@another" })];
    expect(computeVenuePriceStory(venue, reports, NOW).baseline?.evidence.publisher).toBeNull();
  });

  it("retains an update publisher as text when its link is unsafe and its date is unknown", () => {
    const venue = listedVenue();
    Object.assign(venue, { sourcedPrice: {
      provenance: "sourced", sourceLabel: "The Anchor menu", sourceUrl: "javascript:alert(1)", observedAt: "",
    } });
    const markup = renderToStaticMarkup(createElement(VenuePriceStory, { venue, drops: [] }));
    expect(markup).toContain("The Anchor menu");
    expect(markup).toContain("Link unavailable");
    expect(markup).toContain("Source read date unknown");
    expect(markup).not.toContain("javascript:");
  });

  it("shows the Blackfriar baseline with the drink, serving and that price's publisher and read day", () => {
    const rows = JSON.parse(readFileSync(
      new URL("../public/data/pint_prices_app_dataset.json", import.meta.url),
      "utf8",
    )) as VenuePrice[];
    const venue = groupVenuePrices(rows.filter((row) => row.pub_name === "The Blackfriar"))[0]!;
    expect(venue.id).toBe("venue-eltcmh");
    expect(venue.cheapestPrice).toBe(6.5);

    const markup = renderToStaticMarkup(createElement(VenuePriceStory, { venue, drops: [] }));
    expect(markup).toContain("£6.50");
    expect(markup).toContain("Pravha · pint");
    expect(markup).toContain("pint");
    expect(markup).toContain("Pint Prices");
    expect(markup).toContain(bundledReadDay("app_price_000264").words);
    expect(markup).toContain('href="https://www.pint-prices.com/');
  });

  it("does not invent a pint serving for the committed TânVân bottled-beer record", () => {
    const rows = JSON.parse(readFileSync(
      new URL("../public/data/pint_prices_app_dataset.json", import.meta.url), "utf8",
    )) as VenuePrice[];
    const venue = groupVenuePrices(rows.filter((row) => row.app_price_id === "app_price_001013"))[0]!;
    expect(venue.id).toBe("venue-16crofi");
    expect(venue.cheapestPrice).toBe(5);
    const story = computeVenuePriceStory(venue, [], NOW);
    expect(story.baseline?.evidence.drink).toBe("BOTTLED BEER");
    expect(story.baseline?.evidence.serving).toBeNull();
    const markup = renderToStaticMarkup(createElement(VenuePriceStory, { venue, drops: [] }));
    expect(markup).toContain("Bottled Beer");
    expect(markup).toContain("Serving size not recorded");
  });

  it("shows a different drink and serving as a separate report, not a historical price change", () => {
    const venue = v({
      id: "v1", name: "The Anchor", cheapestPrice: 4,
      prices: [{
        pint_name: "PRAVHA", measure: "pint", price_gbp: 4,
        pub_url: "https://pint-prices.com/pub/anchor", scraped_at_values: "2026-10-02T12:00:00Z",
      } as VenuePrice],
    });
    const report = drop({
      venueId: "v1", priceGbp: 3, drink: "Guinness", measure: "half",
      provenance: "contributor", handle: "@reporter", createdAt: "2026-10-14T12:00:00Z",
    });
    const story = computeVenuePriceStory(venue, [report], NOW);
    expect(story.now?.evidence).toMatchObject({ drink: "Guinness", serving: "half" });
    expect(story.deltaGbp).toBeNull();
    expect(story.pct).toBeNull();
    const markup = renderToStaticMarkup(createElement(VenuePriceStory, { venue, drops: [report] }));
    expect(markup).toContain("Guinness");
    expect(markup).toContain("half");
    expect(markup).toContain("@reporter");
    expect(markup).toContain("14 October 2026");
    expect(markup).toContain("Price comparison unavailable");
    expect(markup).not.toContain("vs earlier price");
    expect(markup).not.toContain("No change from the earlier price");
  });

  it("does not borrow an older row's drink or publisher for a selected sourced update at the same amount", () => {
    const venue = Object.assign(v({
      id: "v1", name: "The Anchor", cheapestPrice: 4, cheapestPint: "PRAVHA",
      prices: [{
        pint_name: "PRAVHA", measure: "pint", price_gbp: 4,
        pub_url: "https://pint-prices.com/pub/anchor", scraped_at_values: "2026-10-02T12:00:00Z",
      } as VenuePrice],
    }), {
      sourcedPrice: {
        provenance: "sourced", sourceLabel: "The Anchor menu", sourceUrl: "https://anchor.example/menu",
        observedAt: "2026-10-14T12:00:00Z",
      },
    });
    const story = computeVenuePriceStory(venue, [], NOW);
    expect(story.baseline?.gbp).toBe(4);
    expect(story.baseline?.evidence).toMatchObject({
      drink: null, serving: null, publisher: "The Anchor menu", sourceUrl: "https://anchor.example/menu",
    });
    const markup = renderToStaticMarkup(createElement(VenuePriceStory, { venue, drops: [] }));
    expect(markup).toContain("The Anchor menu");
    expect(markup).toContain("14 October 2026");
    expect(markup).toContain("Drink not recorded");
    expect(markup).toContain("Serving size not recorded");
    expect(markup).not.toMatch(/pravha/i);
    expect(markup).not.toContain("Pint Prices");
  });

  it("keeps a merged community amount with its own report instead of the old dataset row", () => {
    const report = drop({
      venueId: "v1", priceGbp: 3, drink: "Guinness", measure: "pint", provenance: "contributor",
      handle: "@reporter", createdAt: "2026-10-14T12:00:00Z",
    });
    const venue = v({
      id: "v1", name: "The Anchor", cheapestPrice: 3, cheapestPint: "Guinness",
      latestContributorPrice: 3, latestContributorAt: report.createdAt,
      prices: [{
        pint_name: "PRAVHA", measure: "pint", price_gbp: 4,
        pub_url: "https://pint-prices.com/pub/anchor", scraped_at_values: "2026-10-02T12:00:00Z",
      } as VenuePrice],
    });
    const story = computeVenuePriceStory(venue, [report], NOW);
    expect(story.baseline).toBeNull();
    expect(story.now).toMatchObject({
      gbp: 3, provenance: "contributor",
      evidence: { drink: "Guinness", serving: "pint", publisher: "Reported by @reporter" },
    });
    expect(story.deltaGbp).toBeNull();
    const markup = renderToStaticMarkup(createElement(VenuePriceStory, { venue, drops: [report] }));
    expect(markup).not.toContain("Baseline on record");
    expect(markup).not.toMatch(/pravha/i);
    expect(markup).not.toContain("Pint Prices");
    expect(markup.match(/£3\.00/g)).toHaveLength(1);
    expect(markup.match(/Reported by @reporter/g)).toHaveLength(1);
    expect(markup).not.toContain("Price comparison unavailable");
  });

  it("resolves separate price records without dating a price from a memory's era", () => {
    const venue = v({ id: "v1", name: "The Anchor", cheapestPrice: 4 });
    const drops = [
      drop({
        venueId: "v1",
        priceGbp: 6,
        provenance: "contributor",
        createdAt: "2026-06-01T00:00:00.000Z",
      }),
      drop({
        venueId: "v1",
        priceGbp: 1.2,
        era: "Dad's round, 1985",
        provenance: "anecdote",
        handle: "@ken",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    const story = computeVenuePriceStory(venue, drops);

    expect(story.isEmpty).toBe(false);
    expect(story.baseline).toEqual({
      gbp: 4,
      provenance: "sourced",
      label: "Baseline on record",
      evidence: {
        drink: null,
        serving: null,
        publisher: null,
        sourceUrl: null,
        recordedAt: null,
        dateKind: "read",
      },
    });
    // "now" is the newest priced drop (the £6 contributor).
    expect(story.now?.gbp).toBe(6);
    expect(story.now?.provenance).toBe("contributor");
    // The two amounts have no matching drink/serving evidence.
    expect(story.deltaGbp).toBeNull();
    expect(story.pct).toBeNull();

    expect(story.inflation).toBeNull();
    const markup = renderToStaticMarkup(createElement(VenuePriceStory, { venue, drops }));
    expect(markup).not.toContain("A pint here was");
  });

  it("does not treat the oldest memory era as a price observation", () => {
    const venue = v({ id: "v2", name: "Old Bell", cheapestPrice: 5 });
    const drops = [
      drop({ venueId: "v2", priceGbp: 2, era: "1990s", provenance: "anecdote" }),
      drop({ venueId: "v2", priceGbp: 0.5, era: "1960s", provenance: "anecdote" }),
    ];
    const story = computeVenuePriceStory(venue, drops);
    expect(story.inflation).toBeNull();
  });

  it("carries a demo drop's provenance through without flattening it", () => {
    const venue = v({ id: "v3", name: "Demo Arms", cheapestPrice: 3 });
    const drops = [
      drop({ venueId: "v3", priceGbp: 1, era: "1980s", provenance: "demo" }),
    ];
    const story = computeVenuePriceStory(venue, drops);
    expect(story.inflation).toBeNull();
    expect(story.now?.provenance).toBe("demo");
  });

  it("honours a venue's own curation provenance on the baseline", () => {
    const venue = v({
      id: "v4",
      name: "Seeded Tap",
      cheapestPrice: 4,
      curation: { provenance: "demo" },
    });
    const story = computeVenuePriceStory(venue, []);
    expect(story.baseline?.provenance).toBe("demo");
  });

  it("skips the inflation line when no drop carries both a price and a dated era", () => {
    const venue = v({ id: "v5", name: "Undated", cheapestPrice: 4 });
    const drops = [
      // priced but undated
      drop({ venueId: "v5", priceGbp: 5, era: "High-tide advice", provenance: "contributor" }),
      // dated but unpriced
      drop({ venueId: "v5", priceGbp: null, era: "1975", provenance: "anecdote" }),
    ];
    const story = computeVenuePriceStory(venue, drops);
    expect(story.inflation).toBeNull();
    // …but the baseline + now still resolve.
    expect(story.baseline?.gbp).toBe(4);
    expect(story.now?.gbp).toBe(5);
    expect(story.isEmpty).toBe(false);
  });

  it("is empty when the venue has no baseline, no priced drop and no dated memory", () => {
    const venue = v({ id: "v6", name: "Blank", cheapestPrice: null });
    const drops = [
      drop({ venueId: "v6", priceGbp: null, era: "", provenance: "anecdote" }),
    ];
    const story = computeVenuePriceStory(venue, drops);
    expect(story.isEmpty).toBe(true);
    expect(story.baseline).toBeNull();
    expect(story.now).toBeNull();
    expect(story.inflation).toBeNull();
    expect(story.deltaGbp).toBeNull();
    expect(story.pct).toBeNull();
  });

  it("shows a baseline-only story with no delta when there is no community price", () => {
    const venue = v({ id: "v7", name: "Baseline Only", cheapestPrice: 4.5 });
    const story = computeVenuePriceStory(venue, []);
    expect(story.isEmpty).toBe(false);
    expect(story.baseline?.gbp).toBe(4.5);
    expect(story.now).toBeNull();
    expect(story.deltaGbp).toBeNull();
    expect(story.pct).toBeNull();
  });

  it("does not render TONIGHT for stale community prices, but keeps it for fresh prices", () => {
    const venue = v({ id: "v8", name: "The Sir Christopher Hatton", cheapestPrice: 4.5 });
    const staleDrop = drop({
      venueId: "v8",
      priceGbp: 4.7,
      provenance: "contributor",
      createdAt: new Date(NOW - 39 * DAY_MS).toISOString(),
    });
    const freshDrop = drop({
      venueId: "v8",
      priceGbp: 4.7,
      provenance: "contributor",
      createdAt: new Date(NOW - 1 * DAY_MS).toISOString(),
    });

    expect(computeVenuePriceStory(venue, [staleDrop], NOW).now?.label).not.toMatch(/tonight/i);
    expect(computeVenuePriceStory(venue, [staleDrop], NOW).now?.label).toContain(
      "logged 39 days ago",
    );

    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const staleMarkup = renderToStaticMarkup(
      createElement(VenuePriceStory, { venue, drops: [staleDrop] }),
    );
    const freshMarkup = renderToStaticMarkup(
      createElement(VenuePriceStory, { venue, drops: [freshDrop] }),
    );
    vi.useRealTimers();

    expect(staleMarkup).not.toContain("Community tonight");
    expect(staleMarkup).not.toContain('class="vpsBarLabel">Now</span>');
    expect(staleMarkup).toContain("logged 39 days ago");
    expect(staleMarkup).toContain("Over 30 days old, needs a fresh drinker");
    expect(freshMarkup).toContain("Community tonight");
  });
});
