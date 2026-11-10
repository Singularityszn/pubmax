// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { Venue, VenuePrice } from "@/lib/venues";

const fixture = vi.hoisted(() => ({ venues: [] as Venue[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/lib/venueDataset", () => ({ loadGroupedVenues: async () => fixture.venues }));
vi.mock("next/dynamic", async () => ({ default: (await import("next/dist/shared/lib/app-dynamic")).default }));

import NamedRoutePage from "@/app/routes/[slug]/page";
import { curatedCrawlById } from "@/lib/curatedCrawls";
import { groupVenuePrices } from "@/lib/venues";

it("keeps bottle stops on the mounted route and omits both from every selected-pint total", async () => {
  const rows = JSON.parse(readFileSync("public/data/pint_prices_app_dataset.json", "utf8")) as VenuePrice[];
  const template = rows[0]!;
  const base = groupVenuePrices([template])[0]!;
  const ids = curatedCrawlById("victorian-soho")!.venueIds;
  fixture.venues = ids.map((id, index) => ({
    ...base,
    id,
    name: `Stop ${index + 1}`,
    longitude: -0.13 + index * 0.001,
    latitude: 51.51,
    anchorLabel: undefined,
    cheapestPrice: [5, 5, 6, 7, 8][index]!,
    prices: [{
      ...template,
      pint_name: index === 1 ? "Lager 330ml bottle" : "Lager",
      measure: index === 0 ? "bottle" : index === 1 ? undefined : "pint",
      price_gbp: [5, 5, 6, 7, 8][index]!,
      pub_url: `https://source${index + 1}.example/menu`,
      scraped_at_values: `2026-10-0${index + 1}`,
    }],
  }));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: media === "(prefers-reduced-motion: reduce)", media, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
  }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 390, 400));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(await NamedRoutePage({ params: Promise.resolve({ slug: "victorian-soho" }) })));
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(host.querySelectorAll(".crawlReceipt__item")).toHaveLength(5);
    expect(host.querySelectorAll(".pintLine__label")).toHaveLength(5);
    const stops = host.querySelectorAll('ul[aria-label="Victorian Soho stops"] > li');
    const receipt = host.querySelector(".crawlReceipt")!;
    const items = receipt.querySelectorAll(".crawlReceipt__item");
    expect(stops).toHaveLength(5);
    for (const index of [0, 1]) {
      expect(stops[index]?.textContent).toContain(`Stop ${index + 1}`);
      expect(stops[index]?.textContent).toContain("No listed price.");
      expect(stops[index]?.textContent).not.toContain("£5.00");
      expect(items[index]?.textContent).toContain(`Stop ${index + 1}`);
      expect(items[index]?.textContent).toContain("No price yet");
      expect(items[index]?.textContent).toContain("Not listed, so not in the total");
      expect(items[index]?.querySelector("time")).toBeNull();
      expect(host.querySelector(`.pintLine__label[data-at="${index}"]`)?.textContent).toContain("No price listed");
    }
    for (const index of [2, 3, 4]) {
      expect(items[index]?.textContent).toContain(`£${index + 4}.00`);
      expect(items[index]?.textContent).toContain(`source${index + 1}.example`);
      expect(items[index]?.querySelector("time")?.dateTime).toBe(`2026-10-0${index + 1}`);
      expect(stops[index]?.textContent).toContain(`source${index + 1}.example`);
      expect(stops[index]?.textContent).toContain(`${index + 1} October 2026`);
    }
    expect(receipt.textContent).toContain("2 stops have no listed price, so the total leaves them out.");
    expect(receipt.textContent).toContain("£21.00");
    expect(receipt.querySelector(".crawlReceipt__row--total")?.textContent).toContain("£63.00");
    expect(receipt.textContent).toContain("£21.00 each");
    const line = host.querySelector(".pintLine")!;
    expect(line.textContent).toContain("£21.00");
    expect(line.textContent).toContain("2 stops have no listed price.");
    expect(line.textContent).not.toContain("£5.00");
    const map = host.querySelector<HTMLAnchorElement>('a[aria-label="Plan the Victorian Soho crawl on the map"]')!;
    expect(new URL(map.href).searchParams.get("pubs")?.split(",")).toEqual(ids);
    expect(Array.from(stops, (stop) => stop.querySelector("a")?.getAttribute("href"))).toEqual(ids.map((id) => `/ledger/${id}`));
    const more = receipt.querySelector<HTMLButtonElement>('button[aria-label="One more person"]')!;
    await act(async () => more.click());
    expect(receipt.querySelector(".crawlReceipt__row--total")?.textContent).toContain("£84.00");
    expect(receipt.textContent).toContain("£21.00 each");
    const fewer = receipt.querySelector<HTMLButtonElement>('button[aria-label="One fewer person"]')!;
    for (let count = 0; count < 3; count += 1) await act(async () => fewer.click());
    expect(receipt.querySelector(".crawlReceipt__row--total")?.textContent).toBe("Just you£21.00");
    expect(receipt.textContent).not.toContain("Split ");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
