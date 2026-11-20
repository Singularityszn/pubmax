// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SocialLondonEmpty from "@/app/social/SocialLondonEmpty";
import { buildSocialAlternatives } from "@/lib/socialAlternatives";
import { parseUkPriceBundleRows } from "@/lib/ukPriceBundle";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

const rows = parseUkPriceBundleRows(JSON.parse(readFileSync(
  join(process.cwd(), "public/data/uk_prices/rows.json"), "utf8",
)));
const NOW = Date.parse("2026-11-07T12:00:00Z");
const LORE = {
  id: "venue-uk-w745483505", name: "Lore of the Land", address: "4 Conway Street, W1T 6BB",
  latitude: 51.5220874, longitude: -0.1395832, kind: "pub", prices: [],
} satisfies Parameters<typeof buildSocialAlternatives>[0][number];
const THIRSTY_BEAR = {
  id: "venue-uk-n1707216586", name: "The Thirsty Bear", address: "62, Stamford street, London, SE1 9LX",
  latitude: 51.50707, longitude: -0.10812, kind: "pub", prices: [],
} satisfies Parameters<typeof buildSocialAlternatives>[0][number];

function pricesSection(venue: Parameters<typeof buildSocialAlternatives>[0][number]) {
  const alternatives = buildSocialAlternatives([venue], [], NOW, rows);
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(SocialLondonEmpty, { alternatives }));
  return { alternatives, section: host.querySelector("section[aria-labelledby='social-empty-prices']") };
}

describe("Social first view dated pints", () => {
  it("keeps the crawl link until a pending read confirms emptiness", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    try {
      await act(async () => { root.render(createElement(SocialLondonEmpty)); });
      expect(host.querySelector('a[href="/crawls"]')).not.toBeNull();
      await act(async () => finish(Response.json({ status: "ready", crawls: [] })));
      expect(host.querySelector('a[href="/crawls"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["degraded", () => Response.json({ status: "degraded", crawls: [] })],
    ["HTTP error", () => new Response(null, { status: 503 })],
    ["invalid JSON", () => new Response("{")],
    ["invalid listing", () => Response.json({ status: "ready", crawls: [{}] })],
    ["invalid payload", () => Response.json({ status: "ready" })],
    ["network failure", () => { throw new Error("offline"); }],
  ])("preserves crawl navigation after a %s read", async (_label, response) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    try {
      await act(async () => { root.render(createElement(SocialLondonEmpty, { openTable: { status: "unavailable" } })); });
      expect(host.querySelector('a[href="/crawls"]')).not.toBeNull();
      expect(host.querySelector(".socialOpenTable")?.textContent).toContain("couldn't check open crawls");
      expect(host.querySelector(".socialOpenTable")?.textContent).toContain("couldn't check this week's featured night");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("offers open crawls only when the public read has a crawl", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    let crawls: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "ready", crawls })));
    let root = createRoot(host);
    await act(async () => { root.render(createElement(SocialLondonEmpty)); });
    expect(host.querySelector('a[href="/crawls"]')).toBeNull();
    await act(async () => root.unmount());
    crawls = [{ crewId: "e9d33260-1bf0-4899-9fe4-f58c3c1eb937", title: "Pub walk", startTime: new Date(Date.now() + 60_000).toISOString(), hostHandle: "alice", memberCount: 1, capacity: 4, meetingVenueId: "venue-1", meetingVenueName: "The Fox", description: "A walk" }];
    root = createRoot(host);
    await act(async () => { root.render(createElement(SocialLondonEmpty)); });
    expect(host.querySelector('a[href="/crawls"]')).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
  it("includes newer attributed pint observations from the published venue data", () => {
    const venueRows = JSON.parse(readFileSync(join(process.cwd(), "public/data/pint_prices_app_dataset.json"), "utf8")) as VenuePrice[];
    const venues = groupVenuePrices(venueRows);
    const answer = buildSocialAlternatives(venues, [], Date.parse("2026-11-15T12:00:00Z"), rows);
    expect(answer.prices[0]?.observedOn).toBe("2026-11-09");
    expect(answer.prices[0]?.publisher.label).toBe("Pint Prices");
  });
});

describe("Social empty-state pint prices from the published price bundle", () => {
  it("keeps a pub's published wine list out and says no dated price is held", () => {
    expect(rows.some((row) => row.venueId === LORE.id && row.category === "wine")).toBe(true);
    const { alternatives, section } = pricesSection(LORE);
    expect(alternatives).toMatchObject({ priceRead: "ready", prices: [] });
    expect(section?.querySelector(".socialAlternativeMeta")?.textContent).toBe("No dated menu prices to show here yet.");
  });

  it("prints a published pint with its complete name, serving, publisher and read day", () => {
    const { alternatives, section } = pricesSection(THIRSTY_BEAR);
    expect(alternatives.prices).toHaveLength(1);
    expect(section?.querySelector(".socialAlternativeMeta")?.textContent).toBe("Inches Cider, pint · £5.95");
    expect(section?.querySelector(".socialAlternativeSource a")?.getAttribute("href"))
      .toBe("https://www.thethirstybear.com/drinks");
    expect(section?.querySelector("time")?.dateTime).toBe("2026-10-09");
  });
});
