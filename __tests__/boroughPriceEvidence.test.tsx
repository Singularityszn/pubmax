import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

const dataset = vi.hoisted(() => ({ venues: [] as Venue[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/pintPriceLandingDataset.server", () => ({
  loadPintPriceLandingVenues: async () => dataset.venues,
}));
vi.mock("@/lib/historic", () => ({ loadHistoricPubs: async () => [] }));
vi.mock("@/lib/areaNews.server", () => ({ loadAreaNews: async () => ({ status: "ready", entries: [] }) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/borough/BoroughPassportSlice", () => ({ default: () => null }));

import BoroughIndexPage from "@/app/borough/page";
import BoroughPage from "@/app/borough/[slug]/page";
import { resetBoroughIndexForTests } from "@/lib/boroughIndex.server";
import { listBoroughs, pubsInBorough } from "@/lib/boroughs";

function price(overrides: Partial<VenuePrice> = {}): VenuePrice {
  return {
    app_price_id: "test-first", pub_name: "The Selected Arms", address: "1 Test Street", latitude: 51.51, longitude: -0.13,
    primary_borough: "Westminster", boroughs_visible: "Westminster", pint_name: "Selected lager",
    price_gbp: 3.5, measure: "pint", pub_url: "https://first.example/menu",
    scraped_at_values: "2026-01-12", ...overrides,
  } as VenuePrice;
}

beforeEach(() => {
  resetBoroughIndexForTests();
  dataset.venues = groupVenuePrices([
    price(),
    price({ app_price_id: "test-second", pint_name: "Equal-price cider", pub_url: "https://later.example/menu", scraped_at_values: "2026-02-12" }),
  ]);
});

describe("borough price evidence", () => {
  it("keeps the index amount beside its selected drink, serving, publisher and complete day", async () => {
    const document = new JSDOM(renderToStaticMarkup(await BoroughIndexPage())).window.document;
    const row = document.querySelector(".boroughRow")!;
    expect(row.textContent).toContain("£3.50");
    expect(row.textContent).toContain("The Selected Arms");
    expect(row.textContent).toContain("Selected lager · Pint");
    expect(row.querySelector('a[target="_blank"]')?.getAttribute("href")).toBe("https://first.example/menu");
    expect(row.querySelector("time")?.textContent).toBe("12 January 2026");
    expect(row.querySelector("time")?.getAttribute("dateTime")).toBe("2026-01-12");
    expect(row.textContent).not.toContain("Equal-price cider");
    expect(row.textContent).not.toContain("12 February");
    expect(row.querySelector(".rowListTitleLink")?.getAttribute("href")).toBe("/borough/westminster");
  });

  it("keeps each chapter price beside that amount's own evidence and its existing map and history doors", async () => {
    const document = new JSDOM(renderToStaticMarkup(await BoroughPage({ params: Promise.resolve({ slug: "westminster" }) }))).window.document;
    const row = document.querySelector(".boroughPubRows > li")!;
    expect(row.textContent).toContain("£3.50");
    expect(row.textContent).toContain("Selected lager · Pint");
    expect(row.querySelector('a[target="_blank"]')?.getAttribute("href")).toBe("https://first.example/menu");
    expect(row.querySelector("time")?.textContent).toBe("12 January 2026");
    expect(row.textContent).not.toContain("Equal-price cider");
    const id = dataset.venues[0]!.id;
    expect(row.querySelector(".rowListTitleLink")?.getAttribute("href")).toContain(`sel=${id}`);
    expect(row.querySelector(".boroughLedgerLink")?.getAttribute("href")).toBe(`/ledger/${id}`);
  });

  it("states an unstated serving instead of inventing a pint measure", async () => {
    dataset.venues = groupVenuePrices([price({ measure: undefined })]);
    const document = new JSDOM(renderToStaticMarkup(await BoroughIndexPage())).window.document;
    const row = document.querySelector(".boroughRow")!;
    expect(row.textContent).toContain("£3.50");
    expect(row.textContent).toContain("Selected lager · Serving not recorded");
    expect(row.querySelector("time")?.textContent).toBe("12 January 2026");
  });

  it("keeps unrankable prices visible with their own unknowns, without borrowing a tied row's facts", async () => {
    dataset.venues = groupVenuePrices([
      price(),
      price({ app_price_id: "unknown", pub_name: "Unknown Arms", address: "2 Test Street", price_gbp: 2, measure: undefined, pub_url: "", scraped_at_values: "" }),
      price({ app_price_id: "later", pub_name: "Unknown Arms", address: "2 Test Street", price_gbp: 2, pub_url: "https://borrowed.example/menu", scraped_at_values: "2026-02-12" }),
      price({ app_price_id: "half", pub_name: "Half Arms", address: "3 Test Street", price_gbp: 2.5, measure: "half" }),
    ]);
    const document = new JSDOM(renderToStaticMarkup(await BoroughPage({ params: Promise.resolve({ slug: "westminster" }) }))).window.document;
    const rows = Array.from(document.querySelectorAll(".boroughPubRows > li"));
    expect(rows.map((row) => row.querySelector(".rowListTitleLink")?.textContent)).toEqual(["The Selected Arms", "Half Arms", "Unknown Arms"]);
    const unknown = rows[2]!;
    expect(unknown.textContent).toContain("£2.00");
    expect(unknown.textContent).toContain("Serving not recorded");
    expect(unknown.textContent).toContain("Publisher not recorded");
    expect(unknown.textContent).toContain("Read date unavailable");
    expect(unknown.querySelector("time")).toBeNull();
    expect(unknown.querySelector('a[target="_blank"]')).toBeNull();
    expect(rows[1]!.textContent).toContain("Selected lager · Half");
    expect(listBoroughs(dataset.venues)[0]?.cheapestGbp).toBe(3.5);
  });

  it("preserves the first index tie, alphabetical chapter ties and non-public exclusion", () => {
    dataset.venues = groupVenuePrices([
      price(),
      price({ pub_name: "Alpha Arms", address: "2 Test Street" }),
      price({ pub_name: "UCL Students' Union", address: "3 Test Street", price_gbp: 2.5 }),
    ]);
    const summary = listBoroughs(dataset.venues)[0]!;
    expect(summary.cheapestGbp).toBe(3.5);
    expect(summary.cheapestPint?.venueName).toBe("The Selected Arms");
    expect(pubsInBorough(dataset.venues, "westminster").map((pub) => pub.name)).toEqual(["Alpha Arms", "The Selected Arms", "UCL Students' Union"]);
  });

  it("shows the real Bbar bottle amount and receipt without a pint band", async () => {
    const rows = JSON.parse(readFileSync("public/data/pint_prices_app_dataset.json", "utf8")) as VenuePrice[];
    const bbar = groupVenuePrices(rows).find((pub) => pub.id === "venue-1bw18uv")!;
    expect(bbar.name).toBe("Bbar");
    expect(bbar.cheapestPint).toBe("BOTTLED BEER");
    dataset.venues = [bbar, ...dataset.venues];
    const document = new JSDOM(renderToStaticMarkup(await BoroughPage({ params: Promise.resolve({ slug: "westminster" }) }))).window.document;
    const pubRows = Array.from(document.querySelectorAll(".boroughPubRows > li"));
    const bottle = pubRows.find((row) => row.querySelector(".rowListTitleLink")?.textContent === "Bbar")!;
    expect(bottle.textContent).toContain("£9.00");
    expect(bottle.textContent).toContain("Bottled Beer");
    expect(bottle.textContent).toContain("Pint Prices");
    expect(bottle.querySelector("time")?.textContent).toBe("2 October 2026");
    expect(bottle.querySelector(".priceBadge")?.className).not.toMatch(/(?:^|\s)priceBand-/);
    expect(pubRows[0]!.querySelector(".priceBadge")?.className).toMatch(/(?:^|\s)priceBand-/);
  });
});
