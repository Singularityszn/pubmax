// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { LeagueRow } from "@/lib/pintIndex";
import { slimVenueToPin } from "@/lib/slimPins";

vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({
    user: null,
    session: null,
    loading: false,
    configured: false,
    handle: null,
    identityResolved: true,
    getCurrentUserId: () => null,
  }),
}));

const leagueLoader = vi.hoisted(() => ({
  load: vi.fn<() => Promise<LeagueRow[]>>(),
}));

vi.mock("@/lib/pintIndexLeagueLoader", () => ({
  loadPintIndexLeagueRows: () => leagueLoader.load(),
}));

describe("VenueOverviewTab drink comparison", () => {
  it("removes a settled pint comparison when Wine has no observations", async () => {
    // These prices and this pub are synthetic, not observations about a real pub.
    const venueId = "synthetic-wine-compare-pub";
    const noop = () => {};
    const communityPrices: CommunityPricesState = {
      byVenueId: new Map([[venueId, []]]),
      signalsByVenueId: new Map(),
      freshestByVenueId: new Map(),
      venuePriceStatus: new Map([[venueId, "ready"]]),
      noAlcoholIndexStatus: "idle",
      loadNoAlcoholIndex: noop,
      loadDrinkCategoryIndex: noop,
      drinkCategoryIndexStatus: new Map(),
      provisionalBaseVenueIds: new Set(),
      loadProvisionalBaseVenues: noop,
      loadVenue: vi.fn(),
      submit: async () => ({ ok: false, error: "Not submitted", reason: "rejected" }),
      submitVenueSignal: async () => ({ ok: true }),
      submitting: false,
      reportPrice: noop,
      reportedIds: new Set(),
    };
    const props = {
      venue: slimVenueToPin({
        id: venueId,
        name: "The Synthetic Wine Arms",
        lat: 51.52,
        lng: -0.11,
        borough: "Camden",
        zone: 2,
        cheapestPrice: 1.99,
        kind: "pub",
      }),
      tab: "overview",
      cityId: "london",
      mode: "suggest",
      inCrawl: false,
      latestContributorPrice: null,
      dropReadStatus: "ready",
      communityPrices,
      experienceLens: "all",
      drinkLensCategory: null,
      onToggleStop: noop,
      presenceState: "idle",
      markPresenceHere: noop,
      userLocation: null,
      locationRequestStatus: "idle",
      onRequestLocation: noop,
      onClearLocation: noop,
      onLogTonightPrice: noop,
      onOpenVisitReports: noop,
      priceEntryAllowed: false,
      priceSignInRequested: false,
      priceAuthLoading: false,
      priceFocusRequest: 0,
      zoneIndex: {
        rows: [{ zone: 2, medianGbp: 5.7, pricedCount: 12, enough: true }],
        ranked: [],
        dearest: null,
        cheapest: null,
        taxGbp: null,
      },
    } satisfies ComponentProps<typeof VenueOverviewTab>;

    let resolveLeague!: (rows: LeagueRow[]) => void;
    const league = new Promise<LeagueRow[]>((resolve) => {
      resolveLeague = resolve;
    });
    leagueLoader.load.mockReset().mockReturnValue(league);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // Unrelated public reads remain unavailable. No provider success is fabricated.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const pintComparison = "£1.99 here. Zone 2 median £5.70.";

    try {
      await act(async () => root.render(createElement(VenueOverviewTab, props)));
      expect(leagueLoader.load).toHaveBeenCalledOnce();
      expect(container.querySelector(".venueAreaPriceCompare")).toBeNull();

      // Establish the real positive comparison after settlement, before selecting Wine.
      await act(async () => {
        resolveLeague([]);
        await league;
      });
      expect(container.querySelector(".venueAreaPriceCompare")?.textContent)
        .toBe(pintComparison);

      await act(async () => root.render(createElement(VenueOverviewTab, {
        ...props,
        drinkLensCategory: "wine",
      })));
      expect(container.querySelector(".venueDrinkPrices")?.textContent)
        .toContain("No wine price logged here yet.");
      expect(container.querySelector(".venueAreaPriceCompare")).toBeNull();
      expect(container.textContent).not.toContain(pintComparison);

      // Returning to ordinary Pints retains its eligible comparison.
      await act(async () => root.render(createElement(VenueOverviewTab, props)));
      expect(container.querySelector(".venueAreaPriceCompare")?.textContent)
        .toBe(pintComparison);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
