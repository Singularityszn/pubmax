// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("ships 44px targets and wraps safely at 390px", () => {
    const css = readFileSync(
      join(process.cwd(), "components/map/mapExperienceLens.css"),
      "utf8",
    );
    expect(css).toMatch(/\.mapExperienceLensOption\s*{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.mapExperienceLensOptions\s*{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.mapExperienceLens\s*{[^}]*min-width:\s*0/);
  });

  it("removes pint-only controls while an experience view owns the map", () => {
    const pubMap = readFileSync(
      join(process.cwd(), "components/PubMap.tsx"),
      "utf8",
    );
    const toolbar = readFileSync(
      join(process.cwd(), "components/map/MapToolbar.tsx"),
      "utf8",
    );

    expect(pubMap).toMatch(
      /experienceLens === "all"\s*\?\s*\([\s\S]*?<DrinkShapeChips/,
    );
    expect(pubMap).toMatch(
      /activeLensPrices !== null\s*\?\s*\([\s\S]*?selectedLensPrice[\s\S]*?Unknown/,
    );
    // The peek is a single-row read of the same index the list and the sheet
    // report on, so it uses their helper rather than a fifth sentence that
    // could settle a partial or unread index as "none logged".
    expect(pubMap).toMatch(
      /selectedLensPrice\?\.categoryLabel \?\?\s*\n?\s*drinkLensUnknownRowLabel\(/,
    );
    expect(pubMap).not.toContain("No price logged");
    expect(pubMap).toContain("experienceLens={experienceLens}");
    expect(pubMap).toContain("drinkLensCategory={mapDrinkLensCategory}");
    expect(pubMap).toContain("drinkLensPriceNoun(mapDrinkLensCategory)");
    expect(pubMap).toContain(
      'drinkCategory={experienceLens === "all" ? filters.drinkCategory || null : null}',
    );
    expect(pubMap).toContain(
      "const mobileShellReady = !mapLoadingActive;",
    );
    expect(pubMap).toContain("food: true,");
    expect(pubMap).toContain("restaurant: true,");
    expect(pubMap).toMatch(
      /experienceLens === "all"\s*\?\s*\(\s*<TabsTrigger value="prices">/,
    );
    expect(pubMap).toMatch(
      /experienceLens === "all"\s*\?\s*\(\s*<TabsContent value="prices"/,
    );
    // The drink-shape control and the drink-lane picker beside it are both
    // pint-map controls, so an experience view owns the map without them. One
    // named derivation gates every one of them.
    expect(toolbar).toContain('const laneAvailable = experienceLens === "all";');
    // The drink filters used to have a "Drinks" button of their own beside the
    // lane control. They read inside the lane's own panel now (7 Sep 2026,
    // walk finding B9): one control, one subject.
    expect(toolbar).not.toContain("mapToolbarDrinksBtn");
    expect(toolbar).toMatch(/laneOpen && laneAvailable \? \([\s\S]*?<DrinkShapeChips/);
    const overview = readFileSync(
      join(
        process.cwd(),
        "components/map/inspector/VenueOverviewTab.tsx",
      ),
      "utf8",
    );
    expect(overview).toContain('experienceLens === "food"');
    expect(overview).toMatch(
      /!drinkLensCategory &&[\s\S]*?experienceLens !== "no-alcohol" \|\|[\s\S]*?venue\.kind === "food"[\s\S]*?<VenuePriceSummary/,
    );
    // The resting pint view is ONE named derivation now, so the two blocks that
    // ask it cannot drift apart, and the fence holds the name to the rule.
    expect(overview).toContain(
      'const restingPintView = experienceLens === "all" && !drinkLensCategory;',
    );
    expect(overview).toMatch(/restingPintView \?\s*\([\s\S]*?<VenuePriceThen/);
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
      await act(async () => root.render(overview("ready", "idle", "all", "bar")));
      expect(container.querySelector(".venueDrinkPrices")?.textContent)
        .toContain("No beer price logged here yet.");
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("threads the drink lens into both sheets and names coffee, not no-alcohol", () => {
    const overview = readFileSync(
      join(process.cwd(), "components/map/inspector/VenueOverviewTab.tsx"),
      "utf8",
    );
    const sheet = readFileSync(
      join(process.cwd(), "components/map/UnverifiedPubSheet.tsx"),
      "utf8",
    );
    const inspector = readFileSync(
      join(process.cwd(), "components/map/VenueInspector.tsx"),
      "utf8",
    );
    const helpers = readFileSync(
      join(process.cwd(), "lib/mapExperienceLens.ts"),
      "utf8",
    );

    expect(inspector).toContain("drinkLensCategory={drinkLensCategory}");
    // The tab names the lens through the lane table, which routes every
    // category except the joined no-alcohol view to its own drink noun.
    expect(overview).toContain("drinkLaneNoun(leadLane)");
    expect(overview).toMatch(/<VenueDrinkPrices[\s\S]*?activeLane=\{leadLane\}/);
    expect(sheet).toContain("drinkLensCategory");
    expect(sheet).toContain(
      "drinkLensEmptyVenueNote(drinkLensNoun, readStatus)",
    );
    expect(sheet).toContain(
      "row.drinkCategory === drinkLensCategory",
    );
    // The experience noun is only for the joined no-alcohol view.
    expect(helpers).toContain('case "soft-drink":');
    expect(helpers).toContain('return "soft drink";');
    expect(helpers).toMatch(
      /Never return NO_ALCOHOL_LENS_PRICE_NOUN[\s\S]*drinkLensPriceNoun/,
    );
  });

  it("renames pubs for no-alcohol nights and keeps food view food-first", () => {
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
    expect(food).toContain(">Food<");
    expect(food).toContain(">Restaurants<");
    expect(food).not.toContain(">Pints<");
    expect(food).not.toContain(">Bars<");
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
    const pints = html.match(/<button[^>]*aria-pressed="true"[^>]*>[\s\S]*?Pints[\s\S]*?<\/button>/)?.[0] ?? "";
    const bars = html.match(/<button[^>]*aria-pressed="false"[^>]*>[\s\S]*?Bars[\s\S]*?<\/button>/)?.[0] ?? "";

    expect(pints).toContain('class="tonightArcChip isOn"');
    expect(bars).toContain('class="tonightArcChip"');
    // The tick is the non-colour selection mark (design judgement 2026-08-01,
    // finding 2.1: selection reads without the accent). Decorative only —
    // aria-pressed carries the state.
    expect(pints).toContain('class="tonightArcChipTick" aria-hidden="true"');
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
