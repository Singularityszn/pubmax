// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
async function mount(venue: Venue) {
  if (!root) { host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => { root!.render(<VenueMenuTab venue={venue} tab="menu" />); });
}
function button(label: RegExp) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => label.test(node.textContent ?? ""));
}

import { GET } from "@/app/api/venue/[id]/route";
import VenueMenuTab from "@/components/map/inspector/VenueMenuTab";
import { resetVenueDetailCachesForTests } from "@/lib/venueDetailIndex";
import { resetUkPriceBundleForTests } from "@/lib/ukPriceBundle.server";
import { venueFromDetailPayload, type Venue } from "@/lib/venues";
import type { ListedCategoryPrice } from "@/lib/listedCategoryPrices";
import type { VenueWithPriceUpdates } from "@/lib/venuePriceUpdates";

const ploughId = "venue-13xdb1p";
const ownCider: ListedCategoryPrice = {
  source: "listed", category: "beer", drinkLabel: "Aspall 4.5%", priceGbp: 3.65,
  servingSize: null, sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/",
  observedAt: "2026-09-21T18:27:31.674Z",
};

beforeEach(() => {
  resetVenueDetailCachesForTests();
  resetUkPriceBundleForTests();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-30T12:00:00Z"));
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined; host?.remove(); vi.restoreAllMocks();
});

async function ploughDetail() {
  const response = await GET(new Request("http://localhost/api/venue/" + ploughId), {
    params: Promise.resolve({ id: ploughId }),
  });
  expect(response.status).toBe(200);
  return (await response.json()).venue;
}

async function openDrinks() {
  const tile = button(/^Drinks/);
  expect(tile, "The Drinks tile must be reachable").toBeTruthy();
  await act(async () => { tile!.click(); });
}

function expectOwnCider() {
  const row = [...host.querySelectorAll("li")].find(node =>
    node.querySelector(".venueDrinkPriceTag")?.textContent === "Beer · Aspall 4.5%");
  expect(row, "Own Cider must appear on the opened menu").toBeTruthy();
  expect(row!.textContent).toContain("£3.65");
  expect(row!.textContent).toContain("Serving not recorded");
  expect(row!.textContent).toContain("21 September 2026");
  expect(row!.querySelector("a")?.getAttribute("href")).toBe(ownCider.sourceUrl);
  expect(row!.textContent).not.toMatch(/pint|live|in stock|cheap/i);
  expect(row!.querySelector('[data-band], [class*="band-"]')).toBeNull();
}

describe("published drinks on the venue menu", () => {
  it("carries the actual Plough own Cider quote without changing the non-beer detail contract", async () => {
    const detail = await ploughDetail();
    expect(detail.listedBeerPrices).toContainEqual(ownCider);
    expect(detail.listedBeerPrices.every((q: ListedCategoryPrice) => q.category === "beer"))
      .toBe(true);
    expect(detail.listedBeerPrices.length).toBeLessThanOrEqual(4);
    expect(detail.listedCategoryPrices.every((q: ListedCategoryPrice) => q.category !== "beer"))
      .toBe(true);
  });

  it("opens Drinks from the real detail response and shows own source, date and unknown serving", async () => {
    const venue = venueFromDetailPayload(await ploughDetail());
    await mount(venue);
    await openDrinks();
    expectOwnCider();
    expect(host.textContent).toMatch(/PRAVHA/i);
    await act(async () => { button(/Menus$/)!.click(); });
    expect(button(/^Drinks/)).toBeTruthy();
    expect(host.textContent).not.toContain("Beer · Aspall 4.5%");
  });

  it("allows a quote-only pub to open Drinks without claiming an empty menu", async () => {
    const venue: VenueWithPriceUpdates = {
      ...venueFromDetailPayload(await ploughDetail()), prices: [],
      priceUpdates: { drink: [], food: [] }, listedCategoryPrices: [], listedBeerPrices: [ownCider],
    };
    await mount(venue);
    await openDrinks();
    expectOwnCider();
    expect(host.textContent).not.toContain("No menu on record yet");
    expect(host.textContent).not.toMatch(/We don.t have this pub.s drinks yet/);
  });

  it("resets the drill-in and removes the first pub's quote when the venue changes", async () => {
    const venue: VenueWithPriceUpdates = {
      ...venueFromDetailPayload(await ploughDetail()), listedBeerPrices: [ownCider],
    };
    await mount(venue);
    await openDrinks();
    expectOwnCider();
    await mount({ ...venue, id: "venue-unpriced", prices: [],
      priceUpdates: { drink: [], food: [] }, listedBeerPrices: [], listedCategoryPrices: [] } as VenueWithPriceUpdates);
    expect(host.textContent).not.toContain("Beer · Aspall 4.5%");
    expect(button(/Menus$/)).toBeUndefined();
    expect(button(/^Drinks/)).toBeUndefined();
  });
  it("opens the unavailable-price status without calling an unread menu empty", async () => {
    const venue: VenueWithPriceUpdates = {
      ...venueFromDetailPayload(await ploughDetail()), prices: [],
      priceUpdates: { drink: [], food: [] }, listedCategoryPrices: null, listedBeerPrices: null,
    };
    await mount(venue);
    await openDrinks();
    expect(host.textContent).toContain("Published menu prices unavailable just now.");
    expect(host.textContent).not.toContain("No menu on record yet");
    expect(host.textContent).not.toMatch(/We don.t have this pub.s drinks yet/);
    await act(async () => { button(/Menus$/)!.click(); });
    expect(button(/^Drinks/)).toBeTruthy();
  });

});
