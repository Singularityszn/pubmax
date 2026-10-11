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
  },
  {
    name: "listed", lane: {
      lane: "listed", listed: { priceGbp: 4.7, sourceUrl: "https://example.com/menu", observedAt: NOW },
    },
    figure: "£4.70", caption: "listed by the pub",
  },
  {
    name: "baseline", lane: {
      lane: "baseline", cheapestPrice: 4.7, standing: "none", publisher: null, observedOn: null,
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
});

async function render(overrides: Partial<Props>) {
  await act(async () => root.render(createElement(VenuePeekPintPrice, { ...DEFAULTS, ...overrides })));
}

describe("held pint evidence while venue details load", () => {
  it.each(HELD)("preserves the $name figure and caption before and after detail settlement", async (fixture) => {
    for (const detailLoading of [true, false]) {
      for (const refreshing of [false, true]) {
        await render({
          lane: fixture.lane, pintTrust: fixture.trust ?? null, detailLoading,
          priceReadStatus: refreshing ? "loading" : "ready",
          dropReadStatus: refreshing ? "idle" : "ready",
        });
        expect(host.textContent).toBe(fixture.figure + fixture.caption);
        expect(host.querySelector('[role="status"]')).toBeNull();
        if (fixture.trust) {
          expect(host.querySelector("[data-pint-trust]")?.getAttribute("data-pint-trust")).toBe(fixture.trust);
        }
      }
    }
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
    }
    const onLog = vi.fn();
    await render({ ...evidence, detailLoading: false, onLog });
    expect(host.textContent).toBe(name === "estimate" ? "est. £6.50Estimated" : "No price yet.Be the first →");
    if (name === "estimate") {
      expect(host.querySelector(".priceBadge")).toBeNull();
    } else {
      await act(async () => host.querySelector("button")?.click());
      expect(onLog).toHaveBeenCalledOnce();
    }
  });

  it("keeps a non-pub's anchor visible while details load", async () => {
    await render({ isPub: false, lane: { lane: "anchor", anchorLabel: "Lunch", cheapestPrice: 12 } });
    expect(host.textContent).toBe("£12.00listed anchor price");
  });
});
