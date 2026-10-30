// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NearMeNow, { nearSavingSource } from "@/components/nearme/NearMeNow";
import type { NearMeCard, PricedPoint } from "@/lib/nearMeAnswer";
import type { NearPriceTrustResponse } from "@/lib/nearPriceTrust";

// The saving line prints the doorstep pub's price (nearSavingLine,
// lib/nearMeAnswer.ts). That pub is often NOT one of the five cards, and the
// cards' evidence read only covers the cards, so the line must carry the
// doorstep pub's own publisher and read day, or say why it cannot, the way
// every printed price does (review on PR 2414, P2 provenance finding).

const boundary = vi.hoisted(() => ({ slim: vi.fn(), trustCalls: [] as string[][] }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/near",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/venuesSlim", () => ({ loadSlimVenuesForCity: boundary.slim }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
// Each read answers for exactly the ids it was asked for, so a price can only
// wear evidence a read actually returned for it.
vi.mock("@/components/nearme/useNearPriceTrust", () => ({
  useNearPriceTrust: (cards: readonly NearMeCard[], enabled: boolean) => {
    if (!enabled || cards.length === 0) return undefined;
    boundary.trustCalls.push(cards.map((card) => card.id));
    const view: NearPriceTrustResponse = {
      status: "ready",
      collectedAt: "2026-10-02",
      results: cards.map((card) => ({
        venueId: card.id,
        price: card.cheapestPrice,
        publisher: card.id === "doorstep" ? "Doorstep Pub Co" : "Card Co",
        observedAt: "2026-10-02T12:00:00.000Z",
      })),
    };
    return view;
  },
}));

const here = { lat: 51.5136, lng: -0.1365 };
const at = (id: string, dLat: number, price: number): PricedPoint => ({
  id, name: `Pub ${id}`, lat: here.lat + dLat, lng: here.lng, cheapestPrice: price, borough: "Westminster",
});
// Five cheaper pubs a few hundred metres off, and a nearer, dearer sixth: the
// sixth is the doorstep and falls outside the five cards.
const pubs: PricedPoint[] = [
  at("a", 0.004, 4.1), at("b", 0.0045, 4.2), at("c", 0.005, 4.3), at("d", 0.0055, 4.4), at("e", 0.006, 4.5),
  at("doorstep", 0.0003, 6.75),
];

let host: HTMLDivElement;
let root: Root | null;
const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // The answer belongs to the route it was asked on (ownsAnswer).
  window.history.replaceState(null, "", "/near");
  localStorage.clear();
  boundary.trustCalls = [];
  boundary.slim.mockResolvedValue(pubs);
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: here.lat, longitude: here.lng } } as GeolocationPosition),
    },
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

/** Let the location answer, the slim read and the evidence reads land. */
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
  }
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host.remove();
  if (originalGeolocation) Object.defineProperty(navigator, "geolocation", originalGeolocation);
  else Reflect.deleteProperty(navigator, "geolocation");
});

describe("the saving line's comparator evidence on /near", () => {
  it("reads and prints the doorstep pub's evidence when it falls outside the cards", async () => {
    await act(async () => {
      root?.render(createElement(NearMeNow, { initialPatchId: "", showPriceTrust: true, autoLocate: true }));
    });
    await settle();

    const cardNames = [...host.querySelectorAll(".nmnCardName")].map((node) => node.textContent);
    expect(cardNames).toHaveLength(5);
    expect(cardNames).not.toContain("Pub doorstep");

    expect(host.querySelector('[data-testid="near-saving-line"]')?.textContent).toBe(
      "Pub a is £2.65 a pint less than Pub doorstep, the nearest pub with a listed price (£6.75, right here).",
    );
    const source = host.querySelector('[data-testid="near-saving-source"]')?.textContent ?? "";
    expect(source).toMatch(/^Pub doorstep: On record · Doorstep Pub Co · read /);
    // The comparator was read on its own, one id, beside the cards' read.
    expect(boundary.trustCalls).toContainEqual(["doorstep"]);
  });

  it("prints no saving line where the surface shows no price evidence", async () => {
    await act(async () => {
      root?.render(createElement(NearMeNow, { initialPatchId: "", showPriceTrust: false, autoLocate: true }));
    });
    await settle();
    expect(host.querySelectorAll(".nmnCardName").length).toBeGreaterThan(0);
    expect(host.querySelector('[data-testid="near-saving-line"]')).toBeNull();
  });
});

describe("nearSavingSource", () => {
  const doorstep: NearMeCard = { id: "doorstep", name: "The Crown", borough: "Camden", cheapestPrice: 6.2 };
  const card: NearMeCard = { id: "a", name: "The Lamb", borough: "Camden", cheapestPrice: 4.9 };
  const read = (ids: string[], publisher: string | null): NearPriceTrustResponse => ({
    status: "ready",
    collectedAt: "2026-10-02",
    results: ids.map((venueId) => ({ venueId, price: 6.2, publisher, observedAt: null })),
  });

  it("takes a doorstep outside the cards from its own read, never the cards'", () => {
    expect(nearSavingSource(doorstep, [card], read(["a"], "Card Co"), read(["doorstep"], "Crown Co"))).toBe(
      "The Crown: On record · Crown Co",
    );
  });

  it("takes a doorstep that is a card from the cards' read", () => {
    expect(nearSavingSource(doorstep, [card, doorstep], read(["doorstep"], "Crown Co"), undefined)).toBe(
      "The Crown: On record · Crown Co",
    );
  });

  it("says so while its read is pending, and when the read could not name it", () => {
    expect(nearSavingSource(doorstep, [card], undefined, undefined)).toBe("The Crown: On record · Checking publisher");
    expect(nearSavingSource(doorstep, [card], undefined, "loading")).toBe("The Crown: On record · Checking publisher");
    expect(nearSavingSource(doorstep, [card], undefined, read(["a"], "Card Co"))).toBe(
      "The Crown: On record · Publisher could not be checked",
    );
    expect(nearSavingSource(doorstep, [card], undefined, read(["doorstep"], null))).toBe(
      "The Crown: On record · Publisher not recorded",
    );
  });
});
