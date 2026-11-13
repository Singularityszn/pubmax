// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/pubs",
}));

import PubsGallery, { pubsCountLabel } from "@/components/pubs/PubsGallery";
import { countScrapedPubsBySource, type ScrapedPub } from "@/lib/scrapedPubs";
import { readScrapedPubsForPage } from "@/lib/scrapedPubs.server";
import { bundledReadDay } from "@/__tests__/helpers/pintDatasetClock";

function gallery(pubs: ScrapedPub[]): HTMLDivElement {
  const view = document.createElement("div");
  view.innerHTML = renderToStaticMarkup(createElement(PubsGallery, {
    pubs, matchingPubs: pubs.length, filter: "all", zone: "all",
    counts: { all: pubs.length, ...countScrapedPubsBySource(pubs) },
    zonesPresent: [], page: 1, totalPages: 1, complete: true,
  }));
  return view;
}

describe("pubs gallery secondary surface", () => {
  it("carries the real Blackfriar price row through the loader and visible card", async () => {
    const { pubs } = await readScrapedPubsForPage();
    const pub = pubs.find((item) => item.name === "The Blackfriar");
    expect(pub).toBeDefined();
    const view = gallery([pub!]);
    const card = view.querySelector(".pubsCard");
    expect(card?.textContent).toContain("£6.50");
    expect(card?.textContent).toContain("Pravha");
    expect(card?.textContent).not.toContain("PRAVHA");
    expect(card?.textContent).toContain("Serving not recorded");
    const publisher = [...view.querySelectorAll("a")].find((link) => link.textContent === "Pint Prices");
    expect(publisher?.getAttribute("href")).toBe("https://www.pint-prices.com/pub/174%20Queen%20Victoria%20St,%20Greater,%20London%20EC4V%204EG,%20UK/The%20Blackfriar");
    const read = bundledReadDay("app_price_000264");
    expect(card?.querySelector(`time[dateTime="${read.iso}"]`)?.textContent).toBe(read.words);
    expect(view.querySelector("a a")).toBeNull();
  });

  it.each([false, true])("labels missing or mismatched price evidence without borrowing the menu ($0)", (mismatched) => {
    const pub: ScrapedPub = {
      id: "venue-fixture", name: "Fixture Arms", borough: "Camden", source: "youngs.co.uk",
      sourceLabel: "Young's", menuUrl: "https://chain.example/menu", cheapestPrice: 5.5, zone: 2,
      ...(mismatched ? { priceEvidence: {
        priceGbp: 6.5, pintName: "Another figure's lager", measure: "pint",
        publisher: { label: "Other publisher", url: "https://other.example/price" }, observedOn: "2025-10-04",
      } } : {}),
    };
    const card = gallery([pub]).querySelector(".pubsCard");
    expect(card?.textContent).toContain("£5.50");
    expect(card?.textContent).toContain("Drink not recorded");
    expect(card?.textContent).toContain("Serving not recorded");
    expect(card?.textContent).toContain("Publisher not recorded. Read date unavailable.");
    expect(card?.textContent).not.toContain("Other publisher");
    expect(card?.querySelector('.listedPriceSource a')).toBeNull();
    expect(card?.querySelector('a[href="https://chain.example/menu"]')?.textContent).toContain("Menu");
  });

  it("keeps a recorded half at its own amount and outside pint bands", () => {
    const pub: ScrapedPub = {
      id: "venue-half", name: "Half Arms", borough: "Camden", source: "youngs.co.uk",
      sourceLabel: "Young's", cheapestPrice: 2.5, zone: 2,
      priceEvidence: { priceGbp: 2.5, pintName: "Half of lager", measure: "half",
        publisher: { label: "Pub menu", url: "https://pub.example/price" }, observedOn: "2025-10-04" },
    };
    const card = gallery([pub]).querySelector(".pubsCard");
    expect(card?.textContent).toContain("£2.50");
    expect(card?.textContent).toContain("Half of lager");
    expect(card?.textContent).toContain("Half");
    expect(card?.querySelector('[class*="priceBand-"]')).toBeNull();
  });

  it("does not present an incomplete venue read as an authoritative count", () => {
    expect(
      pubsCountLabel({
        matchingPubs: 3,
        filter: "all",
        zone: "all",
        page: 1,
        totalPages: 1,
        complete: false,
      }),
    ).toBe("3 pubs available · Some chain data is unavailable");
  });
});
