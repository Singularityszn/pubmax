// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import CrawlsPageClient from "@/app/crawls/CrawlsPageClient";
import type { SlimVenue } from "@/lib/venuesSlim";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

function listed(id: string, name: string, price: number, source: string, day: string): SlimVenue {
  return { id, name, lat: 51.51, lng: -0.1, borough: "London", cheapestPrice: price,
    cheapestPint: `${name} lager`, measure: "pint", priceSource: source, priceObservedAt: day };
}

const fixtures: SlimVenue[] = [
  listed("venue-1dosq7b", "Kings Arms", 2.99, "Low directory", "2025-10-02"),
  listed("venue-25y8c7", "The Counting House", 6.65, "High menu", "2025-09-11"),
  listed("venue-zottpx", "The Crosse Keys", 2.99, "Equal-price source", "2025-10-15"),
  { ...listed("venue-6r6xa3", "The Lord Aberconway", 1, "Half menu", "2025-10-03"), measure: "half" },
  listed("venue-10mil9j", "Railway", 99, "Future menu", "2999-10-04"),
  listed("venue-1ufn31x", "The Nellie Dean", 4.2, "Soho low menu", "2025-08-03"),
  listed("venue-1t8siin", "The Crown & Two Chairmen", 5.9, "Soho high menu", "2025-07-04"),
  listed("venue-11u4gpi", "Imperial", 3.5, "Leicester menu", "2025-06-05"),
];

let host: HTMLDivElement;
let root: Root;
let reads: ReturnType<typeof vi.fn<typeof fetch>>;
let rows: SlimVenue[];
let priceReadFails: boolean;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  clearSurfaceCache();
  rows = fixtures;
  priceReadFails = false;
  reads = vi.fn<typeof fetch>(async (input) => {
    if (String(input) === "/api/open-crawls") return Response.json({ status: "preview" });
    if (String(input) !== "/data/venues_slim.json") throw new Error(`Unexpected read: ${String(input)}`);
    if (priceReadFails) throw new Error("Price index unavailable");
    return Response.json({ rows });
  });
  vi.stubGlobal("fetch", reads);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("crawl catalogue price evidence", () => {
  it("keeps each featured and compact endpoint with its own serving, source and full day", async () => {
    await act(async () => root.render(createElement(CrawlsPageClient, { pack: "quiet-table" })));
    const featured = host.querySelector("#pint-park-view");
    expect(featured?.textContent).toContain("£2.99-£6.65");
    expect(featured?.textContent).toContain("3 of 5 stops");
    const endpoints = featured?.querySelector('ul[aria-label="Price range endpoints"]');
    expect(endpoints?.children).toHaveLength(2);
    expect(endpoints?.children[0]?.textContent).toContain("Kings Arms");
    expect(endpoints?.children[0]?.textContent).toContain("£2.99");
    expect(endpoints?.children[0]?.textContent).toContain("Kings Arms lager");
    expect(endpoints?.children[0]?.textContent).toContain("Pint");
    expect(endpoints?.children[0]?.textContent).toContain("Low directory. Source read 2 October 2025.");
    expect(endpoints?.children[0]?.textContent).not.toContain("Equal-price source");
    expect(endpoints?.children[1]?.textContent).toContain("The Counting House lager");
    expect(endpoints?.children[1]?.textContent).toContain("£6.65");
    expect(endpoints?.children[1]?.textContent).toContain("High menu. Source read 11 September 2025.");
    expect(featured?.textContent).not.toContain("£1.00");
    expect(featured?.textContent).not.toContain("£99.00");
  });

  it("keeps the compact ranges with their own endpoints outside the plan links", async () => {
    await act(async () => root.render(createElement(CrawlsPageClient, { pack: "quiet-table" })));
    const sohoLink = host.querySelector('a[aria-label="Plan the Soho small plates crawl on the map"]');
    const soho = sohoLink?.closest("li");
    expect(soho?.textContent).toContain("£4.20-£5.90");
    expect(soho?.textContent).toContain("2 of 5 stops");
    expect(soho?.textContent).toContain("The Nellie Dean lager");
    expect(soho?.textContent).toContain("Soho low menu. Source read 3 August 2025.");
    expect(soho?.textContent).toContain("Soho high menu. Source read 4 July 2025.");
    expect(soho?.querySelector('ul[aria-label="Price range endpoints"]')?.closest("a")).toBeNull();
    expect(new URL(sohoLink!.getAttribute("href")!, "https://pubmaxxing.com").searchParams.get("pubs"))
      .toBe("venue-1ufn31x,venue-1t8siin,venue-xiesdn,venue-phqazo,venue-15i2wst");

    const leicester = host.querySelector('a[aria-label="Plan the Leicester Square soft round crawl on the map"]')?.closest("li");
    expect(leicester?.textContent).toContain("£3.50");
    expect(leicester?.textContent).toContain("Imperial lager");
    expect(leicester?.textContent).toContain("Pint");
    expect(leicester?.textContent).toContain("Leicester menu. Source read 5 June 2025.");
    expect(leicester?.textContent).toContain("1 of 5 stops");
    expect(host.querySelector("a a")).toBeNull();
    expect(reads.mock.calls.filter(([url]) => String(url) === "/data/venues_slim.json")).toHaveLength(1);
    expect(reads.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });

  it("labels the legacy drink and serving as unknown without borrowing them", async () => {
    rows = [{ ...fixtures[0]!, cheapestPint: undefined, measure: undefined }];
    await act(async () => root.render(createElement(CrawlsPageClient, { pack: "quiet-table" })));
    const featured = host.querySelector("#pint-park-view");
    expect(featured?.textContent).toContain("£2.99");
    expect(featured?.textContent).toContain("Drink not recorded");
    expect(featured?.textContent).toContain("Serving not recorded");
    expect(featured?.textContent).toContain("Low directory. Source read 2 October 2025.");
    expect(featured?.querySelectorAll('ul[aria-label="Price range endpoints"] > li')).toHaveLength(1);
  });

  it("states when none of the stops has comparable price evidence", async () => {
    rows = [{ ...fixtures[0]!, priceSource: undefined }, fixtures[3]!, fixtures[4]!];
    await act(async () => root.render(createElement(CrawlsPageClient, { pack: "quiet-table" })));
    const featured = host.querySelector("#pint-park-view");
    expect(featured?.textContent).toContain("No comparable listed pint prices recorded for these stops.");
    expect(featured?.textContent).not.toMatch(/£\d/);
    expect(featured?.querySelector('ul[aria-label="Price range endpoints"]')).toBeNull();
  });

  it("keeps a failed price read distinct from recorded missing coverage", async () => {
    priceReadFails = true;
    await act(async () => root.render(createElement(CrawlsPageClient, { pack: "quiet-table" })));
    const featured = host.querySelector("#pint-park-view");
    expect(featured?.textContent).toContain("Price evidence unavailable.");
    expect(featured?.textContent).not.toContain("No comparable listed pint prices recorded");
    expect(featured?.textContent).not.toMatch(/£\d/);
  });
});
