import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DrinkCoverage from "@/components/map/DrinkCoverage";


describe("map drink coverage copy", () => {
  it("states loaded scope and an incomplete read beside the known count", () => {
    const html = renderToStaticMarkup(<DrinkCoverage category="coffee" coverage={{ count: 1, total: 20, status: "partial" }} />);
    expect(html).toContain("1 of 20 loaded pubs");
    expect(html).toContain("Some prices are still missing");
  });
  it("does not publish zero coverage when prices could not be read", () => {
    const html = renderToStaticMarkup(<DrinkCoverage category="coffee" coverage={{ count: 0, total: 20, status: "degraded" }} />);
    expect(html).not.toContain("0 of 20");
    expect(html).toContain("could not read");
  });
  it("renders the café count from the coverage record", () => {
    const html = renderToStaticMarkup(<DrinkCoverage category="coffee" coverage={{ count: 1, total: 20, status: "ready", coffeePilot: { count: 7, status: "ready" } }} />);
    expect(html).toContain("1 of 20 loaded pubs");
    expect(html).toContain("7 cafés with listed prices");
  });
  it("keeps the separate cafe count and its failed read explicit", () => {
    const html = renderToStaticMarkup(<DrinkCoverage category="coffee" coverage={{ count: 0, total: 20, status: "ready", coffeePilot: { count: 0, status: "failed" } }} />);
    expect(html).toContain("café prices could not be read");
  });
});

import ListedDrinkCoverage from "@/components/pintindex/ListedDrinkCoverage";
import type { ListedDrinkCoverage as Coverage } from "@/lib/listedDrinkCoverage";
const listed: Coverage = { total: 2, pricedPubs: 1, counts: {
  beer: 1, coffee: 0, "alcohol-free": 0, wine: 0, cocktail: 0, "soft-drink": 0,
  whisky: 0, gin: 0, vodka: 0, rum: 0, shot: 0, other: 0,
} };

describe("pub list coverage copy", () => {
  it("states the denominator and separates listed coverage from borough eligibility", () => {
    const html = renderToStaticMarkup(<ListedDrinkCoverage coverage={listed} status="ready" />);
    expect(html).toContain("1 of the 2 pubs in our London pub list have a pint price on record");
    expect(html).toContain("(50%)");
    expect(html).toContain("not every pub in London");
    expect(html).toContain("pub price list and published menus");
    expect(html).toContain("separate from the borough league");
  });
  it.each(["ready", "partial"] as const)("distinguishes pint colours from confirmed other drinks when %s", (status) => {
    const html = renderToStaticMarkup(<ListedDrinkCoverage coverage={listed} status={status} />);
    expect(html).toContain("default pint colours can use published prices from our pub price list");
    expect(html).toContain("Other drink colours need prices confirmed by more than one drinker");
    expect(html).not.toContain("Map drink colours use confirmed prices from drinkers");
  });
  it("never turns an unread pub list into zero coverage", () => {
    const html = renderToStaticMarkup(<ListedDrinkCoverage coverage={listed} status="degraded" />);
    expect(html).toContain("Coverage is unavailable");
    expect(html).not.toContain("1 of 2");
  });
  it("labels partial menu counts and withholds the percentage", () => {
    const html = renderToStaticMarkup(<ListedDrinkCoverage coverage={listed} status="partial" />);
    expect(html).toContain("drink counts below are incomplete");
    expect(html).not.toContain("(50%)");
  });
});
