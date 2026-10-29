// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import MapExperienceLens from "@/components/map/MapExperienceLens";
import TonightArcChips from "@/components/map/TonightArcChips";
import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import UnverifiedPubSheet from "@/components/map/UnverifiedPubSheet";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { CommunityPrice } from "@/lib/communityPrice";
import type {
  MapExperienceLens as ExperienceLens,
  VenuePriceReadStatus,
} from "@/lib/mapExperienceLens";
import { slimVenueToPin } from "@/lib/slimPins";
import type { VenueDropReadStatus } from "@/lib/venueDropRead";
import type { DrinkCategory } from "@/lib/drinks";
import type { VenueKind } from "@/lib/venues";

describe("MapExperienceLens", () => {
  it("offers all, no-alcohol, and food views with selected state and status copy", () => {
    const html = renderToStaticMarkup(
      createElement(MapExperienceLens, {
        lens: "no-alcohol",
        summary:
          "No alcohol-free or soft drink prices logged here yet. Food venues still show menu prices we have.",
        onChange: () => undefined,
      }),
    );

    expect(html).toContain(">All<");
    expect(html).toContain(">No alcohol<");
    expect(html).toContain(">Food<");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("No alcohol-free or soft drink prices logged here yet.");
  });

  it("changes the selected view through each rendered control", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const onChange = vi.fn();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    try {
      for (const [lens, label] of [["all", "All"], ["no-alcohol", "No alcohol"], ["food", "Food"]] as const) {
        await act(async () => root.render(createElement(MapExperienceLens, { lens, summary: "Prices for this view", onChange })));
        const controls = [...container.querySelectorAll("button")];
        const selected = controls.find((button) => button.textContent === label)!;
        expect(selected.getAttribute("aria-pressed")).toBe("true");
        expect(controls.filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
        await act(async () => selected.click());
        expect(onChange).toHaveBeenLastCalledWith(lens);
        expect(container.querySelector('[role="status"]')?.textContent).toBe("Prices for this view");
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("keeps the inspector's no-alcohol empty state behind an answered read", async () => {
    const venueId = "venue-read-state";
    const loadVenue = vi.fn();
    const noop = () => {};
    const prices = (
      status: VenuePriceReadStatus | undefined,
      rows: CommunityPrice[] = [],
    ): CommunityPricesState => ({
      byVenueId: new Map([[venueId, rows]]),
      signalsByVenueId: new Map(),
      freshestByVenueId: new Map(),
      noAlcoholIndexStatus: "idle",
      loadNoAlcoholIndex: noop,
      loadDrinkCategoryIndex: noop,
      drinkCategoryIndexStatus: new Map(),
      provisionalBaseVenueIds: new Set(),
      loadProvisionalBaseVenues: noop,
      loadVenue,
      venuePriceStatus: new Map(status ? [[venueId, status]] : []),
      submit: async () => ({ ok: false, error: "Not submitted", reason: "rejected" }),
      submitVenueSignal: async () => ({ ok: true }),
      submitting: false,
      reportPrice: noop,
      reportedIds: new Set(),
    });
    const overview = (
      status: VenuePriceReadStatus | undefined,
      dropReadStatus: VenueDropReadStatus = "ready",
      experienceLens: ExperienceLens = "no-alcohol",
      kind: VenueKind = "pub",
      rows: CommunityPrice[] = [],
      drinkLensCategory: DrinkCategory | null = null,
    ) => createElement(VenueOverviewTab, {
      venue: slimVenueToPin({
        id: venueId, name: "The Read Arms", lat: 51.52, lng: -0.11,
        borough: "Camden", cheapestPrice: null, kind,
      }),
      tab: "overview",
      cityId: "london",
      mode: "suggest",
      inCrawl: false,
      latestContributorPrice: null,
      dropReadStatus,
      communityPrices: prices(status, rows),
      experienceLens,
      drinkLensCategory,
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
    });
    const emptyNote = "No alcohol-free or soft drink price logged here yet.";
    const container = document.createElement("div");
    const root = createRoot(container);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    try {
      for (const status of [undefined, "idle", "loading", "degraded", "ready"] as const) {
        await act(async () => root.render(overview(status)));
        const text = container.querySelector(".venueDrinkPrices")?.textContent;
        expect(text).toBeDefined();
        if (status === "ready") {
          expect(text).toContain(emptyNote);
        } else {
          expect(text).not.toContain(emptyNote);
          expect(text).toContain(status === "degraded"
            ? "We could not read this pub's alcohol-free or soft drink prices just now."
            : "Checking alcohol-free or soft drink prices logged here.");
        }
        const sheet = renderToStaticMarkup(createElement(UnverifiedPubSheet, {
          pub: {
            id: venueId, name: "The Read Arms", lat: 51.52, lng: -0.11,
            address: "", curatedVenueId: "", kind: "pub",
          },
          communityPrices: prices(status),
          experienceLens: "no-alcohol",
        }));
        if (status === "ready") expect(sheet).toContain(emptyNote);
        else expect(sheet).not.toContain(emptyNote);
        if (status === "degraded") {
          expect(sheet).toContain("We could not read what has been logged here just now.");
        }
      }
      // Beer needs both reads. The no-alcohol view does not depend on Pint Drops.
      for (const [priceStatus, dropStatus, expected] of [
        ["ready", "idle", "Checking beer prices logged here."],
        ["loading", "ready", "Checking beer prices logged here."],
        ["ready", "unavailable", "We could not read this pub's beer prices just now."],
        ["degraded", "ready", "We could not read this pub's beer prices just now."],
        ["ready", "ready", "No beer price logged here yet."],
      ] as const) {
        await act(async () => root.render(overview(priceStatus, dropStatus, "all")));
        expect(container.querySelector(".venueDrinkPrices")?.textContent).toContain(expected);
        if (priceStatus !== "ready" || dropStatus !== "ready") {
          expect(container.querySelector(".venueDrinkPrices")?.textContent)
            .not.toContain("No beer price logged here yet.");
        }
      }
      await act(async () => root.render(overview("ready", "unavailable")));
      expect(container.querySelector(".venueDrinkPrices")?.textContent).toContain(emptyNote);
      const loggedRows: CommunityPrice[] = (["alcohol-free", "soft-drink"] as const).map((drinkCategory) => ({
        venueId, drinkCategory,
        priceGbp: 2.5, source: "community", submittedAt: Date.now(),
      }));
      for (const status of ["loading", "degraded", "ready"] as const) {
        await act(async () => root.render(overview(status, "ready", "no-alcohol", "pub", loggedRows)));
        expect(container.querySelector(".venueDrinkPrices")?.textContent).toContain("£2.50");
        expect(container.querySelector(".venueDrinkPrices")?.textContent).not.toContain(emptyNote);
      }
      for (const kind of ["bar", "food", "restaurant"] as const) {
        loadVenue.mockClear();
        await act(async () => {
          root.render(createElement("div", { key: kind }, overview("loading", "idle", "no-alcohol", kind)));
        });
        expect(loadVenue).toHaveBeenCalledWith(venueId);
        expect(container.querySelector(".venueDrinkPrices")?.textContent)
          .toContain("Checking alcohol-free or soft drink prices logged here.");
        expect(container.querySelector(".venueDrinkPrices")?.textContent).not.toContain(emptyNote);
      }
      const mixedRows: CommunityPrice[] = (["beer", "coffee", "soft-drink"] as const).map((drinkCategory, index) => ({
        venueId, drinkCategory, priceGbp: [6.5, 3.25, 2.75][index]!,
        source: "community", submittedAt: Date.now(),
      }));
      for (const [category, noun, price] of [["coffee", "coffee", "£3.25"], ["soft-drink", "soft drink", "£2.75"]] as const) {
        await act(async () => root.render(overview("ready", "ready", "all", "pub", mixedRows, category)));
        const lead = container.querySelector(".venueDrinkPrices .communityPriceRow");
        expect(lead?.textContent).toContain(price);
        expect(lead?.textContent?.toLowerCase()).toContain(noun);
        const sheet = renderToStaticMarkup(createElement(UnverifiedPubSheet, {
          pub: { id: venueId, name: "The Read Arms", lat: 51.52, lng: -0.11, address: "", curatedVenueId: "", kind: "pub" },
          communityPrices: prices("ready", mixedRows), experienceLens: "all", drinkLensCategory: category,
        }));
        expect(sheet).toContain(price);
        expect(sheet).not.toContain("£6.50");
        expect(sheet).not.toContain(category === "coffee" ? "£2.75" : "£3.25");
        await act(async () => root.render(overview("ready", "ready", "all", "pub", [], category)));
        expect(container.querySelector(".venueDrinkPrices")?.textContent).toContain("No " + noun + " price logged here yet.");
      }
      await act(async () => root.render(overview("ready", "ready", "food", "pub", mixedRows)));
      expect(container.querySelector(".venueDrinkPrices")).toBeNull();
      await act(async () => root.render(overview("ready", "idle", "all", "bar")));
      expect(container.querySelector(".venueDrinkPrices")?.textContent)
        .toContain("No beer price logged here yet.");
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("names pubs in both food and no-alcohol views and offers food-serving bars", () => {
    const visibility = {
      pub: true,
      bar: true,
      food: true,
      restaurant: true,
    };
    const noAlcohol = renderToStaticMarkup(
      createElement(TonightArcChips, {
        visibility,
        experienceLens: "no-alcohol",
        onChange: () => undefined,
      }),
    );
    expect(noAlcohol).toContain(">Pubs<");
    expect(noAlcohol).not.toContain(">Pints<");

    const food = renderToStaticMarkup(
      createElement(TonightArcChips, {
        visibility,
        experienceLens: "food",
        onChange: () => undefined,
      }),
    );
    expect(food).toContain(">Late food<");
    expect(food).toContain(">Restaurants<");
    expect(food).not.toContain(">Pints<");
    expect(food).toContain(">Pubs<");
    expect(food).toContain(">Bars<");
  });

  it("marks selected venue filters without colour, and offers no dead chip", () => {
    const html = renderToStaticMarkup(
      createElement(TonightArcChips, {
        visibility: {
          pub: true,
          bar: false,
          food: true,
          restaurant: false,
        },
        onChange: () => undefined,
      }),
    );
    const pubs = html.match(/<button[^>]*aria-pressed="true"[^>]*>[\s\S]*?Pubs[\s\S]*?<\/button>/)?.[0] ?? "";
    const bars = html.match(/<button[^>]*aria-pressed="false"[^>]*>[\s\S]*?Bars[\s\S]*?<\/button>/)?.[0] ?? "";

    expect(pubs).toContain('class="tonightArcChip isOn"');
    expect(bars).toContain('class="tonightArcChip"');
    // The tick is the non-colour selection mark (design judgement 2026-08-01,
    // finding 2.1: selection reads without the accent). Decorative only —
    // aria-pressed carries the state.
    expect(pubs).toContain('class="tonightArcChipTick" aria-hidden="true"');
    expect(bars).not.toContain("✓");
    // The Clubs chip is gone (7 Sep 2026, walk finding B9). It was permanently
    // disabled, explained by a `title` attribute no phone shows, and it could
    // never be enabled, so it went: `curatedVenueKind` in
    // lib/venueKindFilters.ts files a club under the bars, and the Bars chip
    // shows and hides clubs with them.
    expect(html).not.toContain("Clubs");
    expect(html).not.toContain("aria-disabled");
    expect(html).not.toContain("are not mapped yet");
    expect(html).not.toContain("Wave 2");
    expect(html).not.toContain("arrives in");
  });
});
