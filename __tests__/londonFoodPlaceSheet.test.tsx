// @vitest-environment jsdom

// The counter's sheet and the Lucia McDonald's list, from the reader's side:
// the sheet posts a Coke Zero or Diet Coke price through the shared write hook
// with the subtype the route asks for, and the list prints a counter's figure
// in a neutral badge (never a pint band), a one-voice report in words, and a
// failed read as a failed read.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/identity/ContributionGateDialog", () => ({
  useContributionGate: () => ({
    requestContribution: async (action: (auth: { accessToken: string }) => unknown) => {
      await action({ accessToken: "test-access-token" });
    },
    contributionGateDialog: null,
  }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));

import { attachBill } from "./helpers/oneTapBill";

import LuciaMcDonaldsSection from "@/components/drinks/LuciaMcDonaldsSection";
import LondonFoodPlaceSheet from "@/components/map/LondonFoodPlaceSheet";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { LondonFoodPlace, LuciaMcDonaldsRow } from "@/lib/londonFoodPlaces";

const place: LondonFoodPlace = {
  id: "venue-osm-n971874127",
  name: "McDonald's",
  address: "70 - 71, Victoria Road, Surbiton, KT6 4NR",
  lat: 51.39239,
  lng: -0.3059,
  kind: "food",
  borough: "Kingston upon Thames",
};

const submit = vi.fn();
const loadVenue = vi.fn();

function communityPrices(): CommunityPricesState {
  return {
    byVenueId: new Map(),
    signalsByVenueId: new Map(),
    freshestByVenueId: new Map(),
    venuePriceStatus: new Map([[place.id, "ready"]]),
    loadVenue,
    submit,
    submitVenueSignal: vi.fn(),
    submitting: false,
    reportPrice: vi.fn(),
    reportedIds: new Set<string>(),
  } as unknown as CommunityPricesState;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  submit.mockReset();
  loadVenue.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("the London counter's sheet", () => {
  it("reads the counter's prices and logs a Coke Zero or Diet Coke with the bill", async () => {
    submit.mockResolvedValue({
      ok: true,
      attribution: { status: "credited", handle: "lucia_goat" },
      price: null,
    });
    await act(async () => {
      root.render(createElement(LondonFoodPlaceSheet, { place, communityPrices: communityPrices() }));
    });
    expect(loadVenue).toHaveBeenCalledWith(place.id);
    expect(container.textContent).toContain("Nobody has logged a Coke Zero or Diet Coke price here yet.");

    const input = container.querySelector<HTMLInputElement>("input.vpsubInput");
    if (!input) throw new Error("price field did not render");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "1.79");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await attachBill(container);
    const logButton = container.querySelector<HTMLButtonElement>(".vpsubLog");
    if (!logButton) throw new Error("Log it did not render");
    await act(async () => {
      logButton.click();
      await Promise.resolve();
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        venueId: place.id,
        drinkCategory: "soft-drink",
        drinkSubtype: "soft-drink-lucia-special",
        priceGbp: "1.79",
        receiptPhoto: expect.any(File),
      }),
      { accessToken: "test-access-token" },
    );
    expect(container.textContent).toContain("Logged. A second drinker can confirm it.");
  });

  it("names a failed read as one, never as an empty counter", async () => {
    const state = communityPrices();
    (state.venuePriceStatus as Map<string, string>).set(place.id, "degraded");
    await act(async () => {
      root.render(createElement(LondonFoodPlaceSheet, { place, communityPrices: state }));
    });
    expect(container.textContent).toContain("We could not check the prices logged here just now.");
    expect(container.textContent).not.toContain("Nobody has logged");
  });
});

describe("the Lucia McDonald's list", () => {
  const NOW = Date.now();
  const rows: LuciaMcDonaldsRow[] = [
    {
      venueId: "venue-osm-a",
      name: "McDonald's",
      address: "1 High Street",
      borough: "Camden",
      standing: { kind: "agreed", priceGbp: 1.79, submittedAt: NOW, corroborations: 2 },
    },
    {
      venueId: "venue-osm-b",
      name: "McDonald's",
      address: "2 High Street",
      borough: "Brent",
      standing: { kind: "logged-once", priceGbp: 1.99, submittedAt: NOW },
    },
    {
      venueId: "venue-osm-c",
      name: "McDonald's",
      address: "3 High Street",
      borough: "Ealing",
      standing: { kind: "none" },
    },
  ];

  it("prints an agreed figure in a neutral badge, and a lone report in words", async () => {
    await act(async () => {
      root.render(createElement(LuciaMcDonaldsSection, { section: { status: "ready", rows } }));
    });
    const items = [...container.querySelectorAll("li")];
    expect(items).toHaveLength(3);
    const badge = items[0]?.querySelector(".priceBadge");
    expect(badge?.textContent).toBe("£1.79");
    expect(badge?.className).not.toMatch(/priceBand-/);
    expect(items[1]?.querySelector(".priceBadge")).toBeNull();
    expect(items[1]?.textContent).toContain("One report: £1.99");
    expect(items[2]?.textContent).toContain("No price yet, add one");
    const door = items[2]?.querySelector("a[href*='log=1']");
    expect(door?.getAttribute("href")).toBe(
      "/map?drink=soft-drink&sub=soft-drink-lucia-special&sel=venue-osm-c&log=1",
    );
    expect(container.textContent).not.toMatch(/[!—]/);
  });

  it("says a failed read failed", async () => {
    await act(async () => {
      root.render(
        createElement(LuciaMcDonaldsSection, {
          section: { status: "degraded", rows: rows.map((row) => ({ ...row, standing: { kind: "none" as const } })) },
        }),
      );
    });
    expect(container.textContent).toContain("We could not check the prices logged here just now.");
  });
});
