// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VenuePeekPintPrice from "@/components/map/VenuePeekPintPrice";

type Props = ComponentProps<typeof VenuePeekPintPrice>;

const NOW = "2026-10-10T12:00:00.000Z";
const estimate = {
  priceGbp: 6.5, computedAt: NOW, basis: "regional_baseline:camden", sampleSize: 8,
};
const DEFAULTS: Props = {
  venueId: "venue-4xlgb0",
  isPub: true,
  lane: null,
  bundle: {},
  pintTrust: null,
  detailLoading: true,
  priceReadStatus: "ready",
  dropReadStatus: "ready",
  onLog: () => {},
};

const HELD: Array<{
  name: string;
  lane: NonNullable<Props["lane"]>;
  trust?: Props["pintTrust"];
  figure: string;
  caption: string;
  source?: { label: string; href: string };
}> = [
  {
    name: "confirmed", lane: { lane: "contributor", contributorPrice: 4.7 },
    trust: "confirmed", figure: "£4.70", caption: "current recorded price",
  },
  {
    name: "corroborated", lane: { lane: "contributor", contributorPrice: 4.7 },
    trust: "corroborated", figure: "£4.70", caption: "current recorded price",
  },
  {
    name: "sourced", lane: {
      lane: "sourced", cheapestPrice: 4.7,
      sourcedPrice: { provenance: "sourced", sourceLabel: "Pub menu", sourceUrl: "https://example.com/menu", observedAt: NOW },
    },
    figure: "£4.70", caption: "sourced price on record",
    source: { label: "Pub menu", href: "https://example.com/menu" },
  },
  {
    name: "listed", lane: {
      lane: "listed", listed: { priceGbp: 4.7, sourceUrl: "https://example.com/menu", observedAt: NOW },
    },
    figure: "£4.70", caption: "published price",
  },
  {
    name: "baseline", lane: {
      // Read on the test day: a price with no read day is aging (lib/priceTier.ts
      // priceAgeFor) and its chip says so, which __tests__/pinPriceAging.test.ts pins.
      lane: "baseline", cheapestPrice: 4.7, standing: "none", publisher: null,
      observedOn: NOW.slice(0, 10),
    },
    figure: "£4.70", caption: "Price on record, publisher not recorded",
  },
  {
    name: "provisional", lane: { lane: "provisional", provisionalPrice: 4.7, observedAt: NOW },
    trust: "logged-once", figure: "£4.70", caption: "Logged once, needs a second drinker",
  },
  {
    name: "aged", lane: { lane: "aged", agedPrice: 4.7, observedAt: "2026-07-01T12:00:00.000Z" },
    trust: "aged-out", figure: "£4.70", caption: "Over 30 days old, needs a fresh drinker",
  },
  {
    name: "disputed", lane: {
      lane: "disputed", split: { prices: [4.5, 4.7], reporters: 2 }, observedAt: NOW,
    },
    trust: "disputed", figure: "£4.50-£4.70", caption: "Two drinkers, two prices: £4.50 and £4.70",
  },
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ deals: [] }))));
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(overrides: Partial<Props>) {
  await act(async () => root.render(createElement(VenuePeekPintPrice, { ...DEFAULTS, ...overrides })));
}

function expectHeldEvidence(fixture: typeof HELD[number]) {
  expect(host.querySelector('[data-estimate-legend]')).toBeNull();
  expect(host.querySelectorAll(".priceBadge, strong")).toHaveLength(1);
  expect(host.querySelector(".priceBadge, strong")?.textContent).toBe(fixture.figure);
  expect(host.querySelector("small:not([data-price-dated]):not([data-price-source])")?.textContent).toBe(fixture.caption);
  if (fixture.trust) {
    expect(host.querySelector("[data-pint-trust]")?.getAttribute("data-pint-trust")).toBe(fixture.trust);
  }
  const source = host.querySelector<HTMLAnchorElement>("[data-price-source] a");
  if (fixture.source) {
    expect(source?.textContent).toBe(fixture.source.label);
    expect(source?.getAttribute("href")).toBe(fixture.source.href);
  } else {
    expect(source).toBeNull();
  }
}

describe("held pint evidence while venue details load", () => {
  it("recognises a non-pint deal as price evidence", async () => {
    const deal = { id: "wine", venueId: DEFAULTS.venueId, drinkCategory: "wine", drink: "House wine", measure: "175ml", measureLabel: "", priceGbp: 4.5, schedule: { days: [5], start: "16:00", end: "19:00" }, endDate: null, conditions: "", reportedAt: NOW };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ deals: [deal] }))));
    await render({ detailLoading: false });
    expect(host.textContent).not.toContain("No price yet");
    expect(host.textContent).not.toContain("Be the first");
    expect(host.textContent).toContain("regular");
  });
  it.each(["loading", "unavailable"])("does not claim absence while deals are %s", async (status) => {
    vi.stubGlobal("fetch", status === "loading"
      ? vi.fn(() => new Promise<Response>(() => {}))
      : vi.fn(async () => new Response("{}", { status: 503 })));
    await render({ detailLoading: false });
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(host.textContent).not.toContain("No price yet");
    expect(host.textContent).not.toContain("Be the first");
  });
  it.each(HELD)("preserves the $name figure and caption before and after detail settlement", async (fixture) => {
    for (const detailLoading of [true, false]) {
      for (const refreshing of [false, true]) {
        await render({
          lane: fixture.lane, pintTrust: fixture.trust ?? null, detailLoading,
          priceReadStatus: refreshing ? "loading" : "ready",
          dropReadStatus: refreshing ? "idle" : "ready",
        });
        expectHeldEvidence(fixture);
        expect(host.querySelector('[role="status"]')).toBeNull();
      }
    }
  });

  it.each(HELD)("preserves the $name evidence when the latest logged-price read fails", async (fixture) => {
    await render({
      lane: fixture.lane, pintTrust: fixture.trust ?? null, detailLoading: false,
      priceReadStatus: "degraded", dropReadStatus: "unavailable",
    });
    expectHeldEvidence(fixture);
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it.each(["absence", "estimate"])("keeps %s pending until details and both price reads settle", async (name) => {
    const evidence: Partial<Props> = name === "estimate"
      ? { lane: { lane: "estimate", estimate }, bundle: { estimate } }
      : {};
    for (const pending of [
      { detailLoading: true, priceReadStatus: "ready", dropReadStatus: "ready" },
      { detailLoading: false, priceReadStatus: "idle", dropReadStatus: "ready" },
      { detailLoading: false, priceReadStatus: "loading", dropReadStatus: "ready" },
      { detailLoading: false, priceReadStatus: "ready", dropReadStatus: "idle" },
    ] as const) {
      await render({ ...evidence, ...pending });
      expect(host.textContent).toBe("Checking prices…");
      expect(host.querySelector('[role="status"]')).not.toBeNull();
      expect(host.querySelector("button")).toBeNull();
      expect(host.querySelector('[data-estimate-legend]')).toBeNull();
    }
    const onLog = vi.fn();
    await render({ ...evidence, detailLoading: false, onLog });
    if (name === "estimate") {
      expect(host.querySelector('strong')?.textContent).toBe("est. £6.50");
      expect(host.querySelector<HTMLAnchorElement>('[data-estimate-legend] a')?.getAttribute('href')).toBe('/how-we-estimate');
      expect(host.querySelector(".priceBadge")).toBeNull();
    } else {
      expect(host.textContent).toBe("No price yet.Be the first →");
      expect(host.querySelector('[data-estimate-legend]')).toBeNull();
      await act(async () => host.querySelector("button")?.click());
      expect(onLog).toHaveBeenCalledOnce();
    }
  });

  it.each(["absence", "estimate"])("names an unavailable read instead of the %s fallback", async (name) => {
    const evidence: Partial<Props> = name === "estimate"
      ? { lane: { lane: "estimate", estimate }, bundle: { estimate } }
      : {};
    await render({ ...evidence, detailLoading: false, dropReadStatus: "unavailable" });
    expect(host.textContent).toContain("could not read");
    expect(host.textContent).not.toContain("Checking prices");
    expect(host.textContent).not.toContain("No price yet");
    expect(host.textContent).not.toContain("Be the first");
    expect(host.querySelector("button")).toBeNull();
  });

  it("keeps a non-pub's anchor visible while details load", async () => {
    await render({ isPub: false, lane: { lane: "anchor", anchorLabel: "Lunch", cheapestPrice: 12 } });
    expect(host.textContent).toBe("£12.00listed anchor price");
  });
});

describe("the pill names its publisher at every width", () => {
  const PINT_PRICES = { label: "Pint Prices", url: "https://www.pint-prices.com/pub/example" };
  const listedBaseline = (publisher: { label: string; url: string } | null, extra: object = {}) => ({
    lane: "baseline" as const, cheapestPrice: 5.2, standing: "listed" as const, publisher,
    observedOn: "2026-10-09", ...extra,
  });
  const sourceLine = () => host.querySelector("[data-price-source]");

  it("links a publisher whose URL is safe and dates it as a source read", async () => {
    await render({ lane: listedBaseline(PINT_PRICES), detailLoading: false });
    expect(host.textContent).toContain("Listed · source read 9 Oct");
    expect(host.textContent).not.toContain("collected");
    const link = sourceLine()?.querySelector("a");
    expect(link?.textContent).toBe("Pint Prices");
    expect(link?.getAttribute("href")).toBe(PINT_PRICES.url);
  });

  it.each(["javascript:alert(1)", "", "pint-prices.com/pub"])("keeps the label and says the link is unavailable for %j", async (url) => {
    await render({ lane: listedBaseline({ label: "Pint Prices", url }), detailLoading: false });
    expect(sourceLine()?.querySelector("a")).toBeNull();
    expect(sourceLine()?.textContent).toBe("Pint Prices. Link unavailable.");
  });

  it("names the index's publisher before its link has loaded", async () => {
    await render({
      lane: listedBaseline(null, { standing: "none", listedIndex: { label: "Pint Prices", observedOn: "2026-10-09" } }),
      detailLoading: true,
    });
    expect(host.textContent).toContain("Listed · source read 9 Oct");
    expect(sourceLine()?.querySelector("a")).toBeNull();
    expect(sourceLine()?.textContent).toBe("Pint Prices");
  });

  it("says no publisher was recorded on a published price that names none", async () => {
    await render({
      lane: { lane: "listed", listed: { priceGbp: 4.7, sourceUrl: "https://example.com/menu", observedAt: NOW } },
      detailLoading: false,
    });
    expect(sourceLine()?.querySelector("a")).toBeNull();
    expect(sourceLine()?.textContent).toBe("Publisher not recorded");
  });

  it("refuses an unsafe sourced link but keeps its label", async () => {
    await render({
      lane: {
        lane: "sourced", cheapestPrice: 4.7,
        sourcedPrice: { provenance: "sourced", sourceLabel: "Pub menu", sourceUrl: "javascript:alert(1)", observedAt: NOW },
      },
      detailLoading: false,
    });
    expect(sourceLine()?.querySelector("a")).toBeNull();
    expect(sourceLine()?.textContent).toBe("Pub menu. Link unavailable.");
  });
});
