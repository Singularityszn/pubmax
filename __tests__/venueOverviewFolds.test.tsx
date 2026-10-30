// @vitest-environment jsdom

import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { slimVenueToPin } from "@/lib/slimPins";
import type { VenueKind } from "@/lib/venues";
import { OVERVIEW_FOLDS, overviewFold } from "@/lib/venueOverviewFolds";

// THE OVERVIEW IS FIVE FOLDS (launch UX V1, 30 Oct 2026). The table in
// lib/venueOverviewFolds.ts is the order and every summary word; this file
// pins the table, then the rendered sheet against it.

const noop = () => {};

function communityPrices(venueId: string): CommunityPricesState {
  return {
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
    loadVenue: noop,
    submit: async () => ({ ok: false, error: "Not submitted", reason: "rejected" }),
    submitVenueSignal: async () => ({ ok: true }),
    submitting: false,
    reportPrice: noop,
    reportedIds: new Set(),
  };
}

function props(
  kind: VenueKind = "pub",
  over: Partial<ComponentProps<typeof VenueOverviewTab>> = {},
): ComponentProps<typeof VenueOverviewTab> {
  // A synthetic pub, not an observation about a real one.
  const venueId = `synthetic-fold-${kind}`;
  return {
    venue: slimVenueToPin({
      id: venueId,
      name: "The Synthetic Fold",
      lat: 51.52,
      lng: -0.11,
      borough: "Camden",
      zone: 2,
      cheapestPrice: 4.8,
      kind,
    }),
    tab: "overview",
    cityId: "london",
    mode: "suggest",
    inCrawl: false,
    latestContributorPrice: null,
    dropReadStatus: "ready",
    communityPrices: communityPrices(venueId),
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
    ...over,
  };
}

function render(input: ComponentProps<typeof VenueOverviewTab>): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(VenueOverviewTab, input));
  return host;
}

/** Stands in for VenueGettingHomeSection: the inspector keys it per ask. */
function GettingHomeStub({ openRequest }: { openRequest: boolean }) {
  return createElement(
    "details",
    { id: "venueSection-getting-home", open: openRequest },
    createElement("summary", null, "Last train"),
  );
}

function folds(host: HTMLElement): HTMLDetailsElement[] {
  return [...host.querySelectorAll<HTMLDetailsElement>("details.venueOverviewFold")];
}

describe("the Overview fold table", () => {
  it("names five folds in order, and only Price opens on arrival", () => {
    expect(OVERVIEW_FOLDS.map((fold) => fold.label)).toEqual([
      "Price",
      "Tonight",
      "Getting there and home",
      "The pub",
      "Your record",
    ]);
    expect(OVERVIEW_FOLDS.filter((fold) => fold.defaultOpen).map((fold) => fold.key)).toEqual([
      "price",
    ]);
    expect(overviewFold("journey").label).toBe("Getting there and home");
  });

  it("says what is inside in pub words, in the house voice", () => {
    const banned =
      /experience|discover|elevate|seamless|curated|unlock|journey|effortless|snapshot|provenance|capture|evidence|venue|lane|data/i;
    for (const fold of OVERVIEW_FOLDS) {
      for (const words of [fold.label, fold.hint]) {
        expect(words, fold.key).not.toMatch(banned);
        expect(words, fold.key).not.toMatch(/[—!]/);
        expect(words.trim().length, fold.key).toBeGreaterThan(0);
      }
    }
  });
});

describe("the rendered Overview", () => {
  it("renders the five folds in table order, with only Price open", () => {
    const host = render(props());
    const rendered = folds(host);
    expect(rendered.map((fold) => fold.dataset.overviewFold)).toEqual(
      OVERVIEW_FOLDS.map((fold) => fold.key),
    );
    expect(rendered.map((fold) => fold.querySelector(".venueOverviewFoldLabel")?.textContent)).toEqual(
      OVERVIEW_FOLDS.map((fold) => fold.label),
    );
    expect(rendered.filter((fold) => fold.hasAttribute("open")).map((fold) => fold.id)).toEqual([
      "venueFold-price",
    ]);
  });

  it("puts each block in its fold", () => {
    const host = render(props());
    const inFold = (key: string, selector: string) =>
      host.querySelector(`#venueFold-${key} ${selector}`);
    expect(inFold("price", "[data-price-door]")).not.toBeNull();
    expect(inFold("tonight", 'button[aria-label^="Mark that you"]')).not.toBeNull();
    expect(inFold("journey", '[aria-label="Getting there"], .venueGettingThere')).not.toBeNull();
    expect(inFold("pub", ".venueAddress")).not.toBeNull();
    expect(inFold("pub", ".venuePubPageLink")).not.toBeNull();
    expect(inFold("record", ".saveToListToggle")).not.toBeNull();
    expect(inFold("record", ".wantedSaveBtn")).not.toBeNull();
    // The retired catch-all is gone: no block sits behind "Details and
    // practical info" any more.
    expect(host.querySelector(".venueOverviewMore")).toBeNull();
    expect(host.textContent).not.toContain("Details and practical info");
  });

  it("leaves out a fold with nothing to show, summary and all", () => {
    // A bar under the food view with a drink lens over it: no drink rows (the
    // food view), no price on record (the lens), no composer (not a pub) and
    // no pint history (not the resting pint view). The Price fold is empty.
    const host = render(props("bar", { experienceLens: "food", drinkLensCategory: "coffee" }));
    expect(host.querySelector("#venueFold-price")).toBeNull();
    expect(host.textContent).not.toContain(overviewFold("price").hint);
    expect(folds(host).map((fold) => fold.dataset.overviewFold)).toEqual([
      "tonight",
      "journey",
      "pub",
      "record",
    ]);
    // With Price absent, nothing else opens in its place.
    expect(folds(host).some((fold) => fold.hasAttribute("open"))).toBe(false);
  });

  it("opens the journey fold around a getting-home ask", () => {
    const ask = createElement(GettingHomeStub, { key: "pub:getting-home:1", openRequest: true });
    const host = render(props("pub", { gettingHome: ask }));
    const journey = host.querySelector<HTMLDetailsElement>("#venueFold-journey");
    expect(journey?.hasAttribute("open")).toBe(true);
    expect(journey?.querySelector("#venueSection-getting-home > summary")?.textContent).toBe(
      "Last train",
    );

    const quiet = createElement(GettingHomeStub, { key: "pub:overview:0", openRequest: false });
    const resting = render(props("pub", { gettingHome: quiet }));
    expect(resting.querySelector("#venueFold-journey")?.hasAttribute("open")).toBe(false);
  });

  it("keeps the desktop Add to crawl between the Price fold and the rest", () => {
    const host = render(props("pub", { mode: "build" }));
    const add = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Add to crawl",
    );
    expect(add).toBeTruthy();
    expect(add?.closest(".venueOverviewFold")).toBeNull();
    expect(add?.previousElementSibling?.id).toBe("venueFold-price");
  });
});
