// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only account/router boundaries are doubled. Pricing coordinator, panel,
// header, metrics, list, picker and route math all render their real code.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: null, session: null, loading: false, handle: null,
    getCurrentUserId: async () => null,
  }),
}));

import RoutePanel from "@/components/map/RoutePanel";
import {
  currentMapRoutePricing,
  useMapPlanCoordinator,
  useMapPlanPresentation,
} from "@/components/map/pubmap/useMapPlanCoordinator";
import type { GeneratedMobilePlan } from "@/components/plan/MobilePlanActivation";
import { routeDrinkIntentFromSearch } from "@/lib/crawlUrl";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import type { AltCrawlStyle } from "@/lib/crawlUrl";
import type { SelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";
import type { Venue } from "@/lib/venues";

// Explicit unit fixtures, never production catalogue rows. The £5.50 manual
// price reuses saveCrawlStory.test.tsx; the £7 unknown-serving Gin quote reuses
// planAnchoredGenerateRoute.test.ts. No inferred serving or publisher claim.
const MANUAL_PRICE = 5.5;
const LISTED_QUOTE: SelectedDrinkPriceEvidence = {
  category: "gin", pence: 700, serving: null, source: "listed",
  sourceUrl: "https://pub.example/category-offer/menu",
  observedAt: "2026-09-29T12:00:00.000Z",
};
const COMMUNITY_QUOTE: SelectedDrinkPriceEvidence = {
  category: "gin", pence: 700, serving: null, source: "community",
  reportedAt: "2026-09-29T12:00:00.000Z",
};

function fixtureVenue(id: string, index: number): Venue {
  return {
    id, name: `Fixture pub ${id}`, address: `${index + 1} Fixture Street, London`,
    latitude: 51.5 + index * 0.001, longitude: -0.12,
    primaryBorough: "Westminster", visibleBoroughs: ["Westminster"],
    prices: [], cheapestPrice: MANUAL_PRICE, cheapestPint: "Fixture pint",
    averagePrice: MANUAL_PRICE, hasStory: false, latestContributorPrice: null,
    latestContributorAt: null, amenities: {
      food: false, cocktails: false, beerGarden: false, liveSports: false,
      liveMusic: false, pubQuiz: false, darts: false, pool: false,
      happyHour: false, karaoke: false, nonAlcoholic: false,
    },
    website: "", bookingLink: "", imageUrl: "", description: "",
    dataQualityNotes: [], sourceDatasets: [], curation: {}, kind: "pub",
  };
}

const VENUES = ["a", "b", "c", "d"].map(fixtureVenue);
const VENUE_BY_ID = new Map(VENUES.map((venue) => [venue.id, venue]));
const ORIGINAL_IDS = ["a", "b", "c"];
const SELECTED_SIGNALS = new Map<string, { hasPintDrops: boolean; latestContributorPrice: number | null }>();

function generatedPlan({
  category = "gin", zeroProof = false, quote = LISTED_QUOTE, total = null,
}: {
  category?: GeneratedMobilePlan["context"]["drinkCategory"];
  zeroProof?: boolean;
  quote?: SelectedDrinkPriceEvidence | null;
  total?: number | null;
} = {}): GeneratedMobilePlan {
  return {
    stops: ORIGINAL_IDS.map((venueId) => ({
      venueId, venueName: VENUE_BY_ID.get(venueId)!.name,
      ...(venueId === "a" && quote ? { selectedDrinkPriceEvidence: quote } : {}),
    })),
    context: {
      nightArea: "piccadilly-soho", daypart: "evening", partyType: "friends", groupSize: 2,
      budget: "standard", budgetLimitPence: null, zeroProof,
      drinkCategory: category, wetherspoonsPreferred: false, atmosphere: [],
      foodNeeds: [], accessibility: [], transportConstraints: [],
    },
    budget: {
      currency: "GBP", limitPence: null, estimatedPerPersonPence: total,
      estimatedCrewPence: total === null ? null : total * 2, withinLimit: null,
      basis: category === "beer" && !zeroProof
        ? "one-recorded-pint-per-stop" : "selected-drink-price-unavailable",
    },
    confidence: {
      level: "medium", score: 0.5, routeReady: true,
      missingEvidence: [], warnings: [], provenance: [],
    },
    routeTotals: {
      stopCount: 3, straightLineWalkingKm: 0.3, estimatedWalkingMinutes: 5,
      distanceBasis: "straight-line",
    },
    endings: [],
  };
}

function Harness({
  generated = generatedPlan(), activationIds = ORIGINAL_IDS,
  suggestedIds = ["a", "b", "d"], currentPrices = new Map(),
  builtIds = ORIGINAL_IDS, venueById = VENUE_BY_ID,
}: {
  generated?: GeneratedMobilePlan;
  activationIds?: string[];
  suggestedIds?: string[];
  currentPrices?: ReadonlyMap<string, MapLensPrice>;
  builtIds?: string[];
  venueById?: ReadonlyMap<string, Venue>;
}) {
  const coordinator = useMapPlanCoordinator({
    mode: "build", builtIds, routeMapped: true,
    routeDrinkIntent: routeDrinkIntentFromSearch(window.location.search),
    planningOpen: false, nightArea: "piccadilly-soho",
  });
  const [altStyle, setAltStyle] = useState<AltCrawlStyle>("pint");
  const presentation = useMapPlanPresentation({
    mode: coordinator.mode, builtIds: coordinator.builtIds,
    routeMapped: coordinator.routeMapped,
    suggestedRoute: suggestedIds.map((id) => VENUE_BY_ID.get(id)!),
    activePlanRoute: [], venueById,
  });
  return <>
    <nav aria-label="Pricing fixture actions">
      <button onClick={() => coordinator.activateGeneratedPlan("piccadilly-soho", activationIds, generated)}>Activate generated plan</button>
      <button onClick={() => coordinator.setMode("suggest")}>Show suggested route</button>
      <button onClick={() => coordinator.setMode("build")}>Show built route</button>
      <button onClick={() => coordinator.replaceBuiltIds([...ORIGINAL_IDS])}>Replace with manual route</button>
      <button onClick={() => coordinator.replaceBuiltIds([])}>Clear route</button>
    </nav>
    <RoutePanel
      mode={coordinator.mode} crawlStyle="cheapest" altStyle={altStyle}
      onAltStyleChange={setAltStyle} route={presentation.route}
      generatedPricing={currentMapRoutePricing(coordinator.generatedPricing, currentPrices, venueById)} filteredVenues={VENUES}
      builtIds={coordinator.builtIds} activeVenueId={undefined}
      venueSignals={SELECTED_SIGNALS} routeMapped={coordinator.routeMapped}
      poisPath={null} onMapRoute={() => coordinator.setRouteMapped(true)}
      onHideRoute={() => coordinator.setRouteMapped(false)} onSelectVenue={() => {}}
      onReverseRoute={coordinator.reverseBuiltIds}
      onToggleStop={(id) => coordinator.setBuiltIds((ids) =>
        ids.includes(id) ? ids.filter((current) => current !== id) : [...ids, id])}
    />
  </>;
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.history.replaceState({}, "", "/map");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

async function mount(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(<Harness {...props} />));
}

async function click(label: string, scope: ParentNode = host) {
  const button = Array.from(scope.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === label);
  if (!button) throw new Error(`Missing visible button: ${label}`);
  await act(async () => button.click());
}

function metricText() {
  const metrics = host.querySelector(".routeMetrics");
  expect(metrics).not.toBeNull();
  return metrics!.textContent ?? "";
}

function stopRows() {
  return Array.from(host.querySelectorAll<HTMLLIElement>(".routeList > li"));
}

function rowFor(id: string) {
  const row = stopRows().find((entry) => entry.querySelector("strong")?.textContent === `Fixture pub ${id}`);
  if (!row) throw new Error(`Missing rendered stop: ${id}`);
  return row;
}

function expectUnknownRound(noun: string) {
  expect(metricText()).toContain("Not recordedround total");
  expect(metricText()).toContain(noun);
  expect(metricText()).not.toMatch(/estimated round|pint stops|£/i);
}

function expectNoQuotes() {
  expect(host.querySelector(".routeList")?.textContent).not.toMatch(/published menu|community report|£7\.00/);
  expect(host.querySelectorAll('.routeList a[href="https://pub.example/category-offer/menu"]')).toHaveLength(0);
}

describe("generated map route pricing rendered lifecycle", () => {
  it("renders the generated drink and current published quote with source day instead of pint money", async () => {
    await mount();
    await click("Activate generated plan");
    expect(host.querySelector("h2")?.textContent).toBe("Gin plan");
    expectUnknownRound("gin stops");
    expect(rowFor("a").querySelector("p")?.textContent)
      .toBe("Gin £7.00, published menu 29 Sept 2026. Serving size not recorded.");
    const source = rowFor("a").querySelector<HTMLAnchorElement>('a[href="https://pub.example/category-offer/menu"]');
    expect(source?.textContent).toBe("Menu source");
    expect(source?.rel).toBe("noopener noreferrer");
    expect(rowFor("b").querySelector("p")?.textContent).toBe("Gin price not recorded");
    expect(host.querySelector('[role="radiogroup"][aria-label="Crawl style"]')).toBeNull();
  });

  it("names a community report and its date without inventing a published source or serving", async () => {
    await mount({ generated: generatedPlan({ quote: COMMUNITY_QUOTE }) });
    await click("Activate generated plan");
    expectUnknownRound("gin stops");
    expect(rowFor("a").querySelector("p")?.textContent)
      .toBe("Gin £7.00, community report 29 Sept 2026. Serving size not recorded.");
    expect(Array.from(rowFor("a").querySelectorAll("a")).some((link) => link.textContent === "Menu source")).toBe(false);
  });

  it("keeps a zero-proof round unknown and rejects an alcoholic quote", async () => {
    await mount({ generated: generatedPlan({ zeroProof: true }) });
    await click("Activate generated plan");
    expect(host.querySelector("h2")?.textContent).toBe("Alcohol-free plan");
    expectUnknownRound("alcohol-free stops");
    expectNoQuotes();
    expect(rowFor("a").querySelector("p")?.textContent).toBe("Alcohol-free price not recorded");
  });

  it("does not relabel a mismatched-category quote as the requested drink", async () => {
    await mount({ generated: generatedPlan({ category: "wine" }) });
    await click("Activate generated plan");
    expectUnknownRound("wine stops");
    expectNoQuotes();
    expect(rowFor("a").querySelector("p")?.textContent).toBe("Wine price not recorded");
  });

  it("keeps generated beer's missing server budget unknown rather than borrowing manual pint totals", async () => {
    await mount({ generated: generatedPlan({ category: "beer", quote: null }) });
    await click("Activate generated plan");
    expect(metricText()).toContain("Not recordedround total");
    expect(metricText()).not.toContain("£16.50");
  });

  it.each([
    { label: "duplicate snapshot", activationIds: ["a", "a", "b"], suggestedIds: ORIGINAL_IDS },
    { label: "different displayed set", activationIds: ORIGINAL_IDS, suggestedIds: ["a", "b", "d"] },
  ])("refuses old generated beer money for $label", async ({ activationIds, suggestedIds }) => {
    await mount({ generated: generatedPlan({ category: "beer", quote: null, total: 700 }), activationIds, suggestedIds });
    const actions = Array.from(host.querySelectorAll<HTMLButtonElement>("nav button"));
    await act(async () => {
      actions.find((button) => button.textContent === "Activate generated plan")!.click();
      actions.find((button) => button.textContent === "Show suggested route")!.click();
    });
    expect(stopRows()).toHaveLength(3);
    expect(metricText()).not.toContain("£7.00");
    expect(metricText()).toContain("£16.50estimated round");
    expect(metricText()).toContain("pint stops");
  });

  it("preserves manual pint money, original stop noun and style picker", async () => {
    await mount();
    expect(metricText()).toContain("£16.50estimated round");
    expect(metricText()).toContain("pint stops");
    expect(rowFor("a").querySelector("p")?.textContent).toBe("£5.50 · Fixture pint");
    expect(host.querySelector('[role="radiogroup"][aria-label="Crawl style"]')).not.toBeNull();
  });

  it("retains each quoted pub through the real Reverse route control", async () => {
    await mount();
    await click("Activate generated plan");
    await click("Reverse route");
    expect(stopRows().map((row) => row.querySelector("strong")?.textContent))
      .toEqual(["Fixture pub c", "Fixture pub b", "Fixture pub a"]);
    expectUnknownRound("gin stops");
    expect(rowFor("a").querySelector("p")?.textContent).toContain("Gin £7.00, published menu 29 Sept 2026");
    expect(rowFor("a").querySelector('a[href="https://pub.example/category-offer/menu"]')).not.toBeNull();
  });

  it("invalidates old quotes for a different suggested set, then restores the unchanged built set", async () => {
    await mount();
    await click("Activate generated plan");
    await click("Show suggested route");
    expect(stopRows().map((row) => row.querySelector("strong")?.textContent))
      .toEqual(["Fixture pub a", "Fixture pub b", "Fixture pub d"]);
    expect(host.querySelector("h2")?.textContent).not.toBe("Gin plan");
    expect(host.textContent).not.toMatch(/gin stops|Gin price not recorded/);
    expectNoQuotes();
    await click("Show built route");
    expect(host.querySelector("h2")?.textContent).toBe("Gin plan");
    expect(rowFor("a").querySelector("p")?.textContent).toContain("published menu 29 Sept 2026");
  });

  it("refuses a duplicate generated snapshot even when displayed route length matches", async () => {
    await mount({ activationIds: ["a", "a", "b"], suggestedIds: ORIGINAL_IDS });
    // Batch activation and suggestion avoids rendering duplicate React keys;
    // the valid visible set still cannot inherit this invalid snapshot.
    const actions = Array.from(host.querySelectorAll<HTMLButtonElement>("nav button"));
    await act(async () => {
      actions.find((button) => button.textContent === "Activate generated plan")!.click();
      actions.find((button) => button.textContent === "Show suggested route")!.click();
    });
    expect(stopRows()).toHaveLength(3);
    expect(metricText()).toContain("pint stops");
    expect(host.textContent).not.toMatch(/gin stops|Gin price not recorded/);
    expectNoQuotes();
  });

  it("invalidates quotes when real picker adds and removes a stop without silently changing drink", async () => {
    await mount();
    await click("Activate generated plan");
    const picker = host.querySelector(".venuePicker")!;
    await click("Fixture pub d£5.50 · WestminsterAdd", picker);
    expect(stopRows()).toHaveLength(4);
    expectUnknownRound("gin stops");
    expectNoQuotes();
    await click("Fixture pub d£5.50 · WestminsterRemove", host.querySelector(".venuePicker")!);
    expect(stopRows()).toHaveLength(3);
    expectUnknownRound("gin stops");
    expectNoQuotes();
    expect(host.querySelector("h2")?.textContent).toBe("Gin plan");
  });

  it.each([false, true])("completion shares the retained public drink intent after a real picker edit (zeroProof=%s)", async (zeroProof) => {
    await mount({ generated: generatedPlan({ category: "gin", zeroProof, quote: zeroProof ? null : LISTED_QUOTE }) });
    await click("Activate generated plan");
    await click("Fixture pub d£5.50 · WestminsterAdd", host.querySelector(".venuePicker")!);
    expect(stopRows()).toHaveLength(4);
    expectUnknownRound(zeroProof ? "alcohol-free stops" : "gin stops");
    expectNoQuotes();
    await click("Start this crawl");
    await click("Mark complete");
    const link = host.querySelector<HTMLAnchorElement>('[data-testid="crawl-share-open"]');
    expect(link?.textContent).toBe("Open shared crawl");
    const url = new URL(link!.href);
    expect(url.searchParams.get("pubs")?.split(",")).toEqual(["a", "b", "c", "d"]);
    expect(routeDrinkIntentFromSearch(url.search)).toEqual(zeroProof
      ? { zeroProof: true } : { drinkCategory: "gin", zeroProof: false });
    expect(Array.from(url.searchParams.keys())).toEqual(["mode", "pubs", zeroProof ? "routeLow" : "routeDrink"]);
  });

  it("invalidates generated beer totals on add/remove and retains them for a pure reverse", async () => {
    await mount({ generated: generatedPlan({ category: "beer", quote: null, total: 700 }) });
    await click("Activate generated plan");
    expect(metricText()).toContain("£7.00estimated round");
    await click("Reverse route");
    expect(metricText()).toContain("£7.00estimated round");
    await click("Fixture pub d£5.50 · WestminsterAdd", host.querySelector(".venuePicker")!);
    expect(metricText()).toContain("Not recordedround total");
    expect(metricText()).not.toMatch(/£7\.00|£22\.00/);
    await click("Fixture pub d£5.50 · WestminsterRemove", host.querySelector(".venuePicker")!);
    expect(metricText()).toContain("Not recordedround total");
    expect(metricText()).not.toMatch(/£7\.00|£16\.50/);
  });

  it.each(["Replace with manual route", "Clear route"])("%s resets category, quote and style ownership", async (action) => {
    await mount();
    await click("Activate generated plan");
    await click(action);
    expect(host.querySelector("h2")?.textContent).toBe("Hand-built plan");
    expect(host.querySelector('[role="radiogroup"][aria-label="Crawl style"]')).not.toBeNull();
    expectNoQuotes();
    if (action === "Clear route") {
      expect(stopRows()).toHaveLength(0);
      expect(host.textContent).toContain("No stops yet.");
    } else {
      expect(metricText()).toContain("£16.50estimated round");
      expect(metricText()).toContain("pint stops");
    }
  });
});


describe("restored public route drink intent", () => {
  const currentPrices = new Map<string, MapLensPrice>([["a", {
    venueId: "a", category: "gin", categoryLabel: "Gin", priceGbp: 7,
    source: "listed", servingSize: null, sourceUrl: "https://pub.example/category-offer/menu",
    observedAt: "2026-09-29T12:00:00.000Z",
  }], ["not-in-route", {
    venueId: "not-in-route", category: "gin", categoryLabel: "Gin", priceGbp: 3,
    source: "listed", servingSize: "25ml", sourceUrl: "https://pub.example/other/menu",
    observedAt: "2026-09-29T12:00:00.000Z",
  }]]);

  it("restores requested category with unknown money, then renders a currently supplied exact-ID quote", async () => {
    window.history.replaceState({}, "", "/map?mode=build&pubs=a,b,c&routeDrink=gin&drink=wine");
    await mount();
    expect(host.querySelector("h2")?.textContent).toBe("Gin plan");
    expectUnknownRound("gin stops");
    expectNoQuotes();
    await mount({ currentPrices });
    expect(rowFor("a").querySelector("p")?.textContent).toBe("Gin £7.00, published menu 29 Sept 2026. Serving size not recorded.");
    expect(host.querySelector('.routeList a[href="https://pub.example/other/menu"]')).toBeNull();
    expectUnknownRound("gin stops");
    await mount({ currentPrices: new Map() });
    expectNoQuotes();
    expect(rowFor("a").querySelector("p")?.textContent).toBe("Gin price not recorded");
  });

  it("prices a stop named by an old link ID under its canonical pub", async () => {
    window.history.replaceState({}, "", "/map?mode=build&pubs=old-a,b,c&routeDrink=gin");
    const aliased = new Map(VENUE_BY_ID);
    aliased.set("old-a", VENUE_BY_ID.get("a")!);
    await mount({ currentPrices, builtIds: ["old-a", "b", "c"], venueById: aliased });
    expect(rowFor("a").querySelector("p")?.textContent).toBe("Gin £7.00, published menu 29 Sept 2026. Serving size not recorded.");
    expect(rowFor("b").querySelector("p")?.textContent).toBe("Gin price not recorded");
  });

  it("never reapplies reread quotes after a live add/remove edit", async () => {
    window.history.replaceState({}, "", "/map?mode=build&pubs=a,b,c&routeDrink=gin");
    await mount({ currentPrices });
    expect(rowFor("a").querySelector("p")?.textContent).toContain("published menu");
    await click("Fixture pub d£5.50 · WestminsterAdd", host.querySelector(".venuePicker")!);
    expectUnknownRound("gin stops");
    expectNoQuotes();
    await click("Fixture pub d£5.50 · WestminsterRemove", host.querySelector(".venuePicker")!);
    expectNoQuotes();
    await click("Replace with manual route");
    expect(host.querySelector("h2")?.textContent).toBe("Hand-built plan");
    expect(metricText()).toContain("£16.50estimated round");
  });

  it("restores zero-proof without borrowing supplied alcohol quotes or manual pint money", async () => {
    window.history.replaceState({}, "", "/map?mode=build&pubs=a,b,c&routeLow=1&routeDrink=gin");
    await mount({ currentPrices });
    expect(host.querySelector("h2")?.textContent).toBe("Alcohol-free plan");
    expectUnknownRound("alcohol-free stops");
    expectNoQuotes();
  });

  it("keeps legacy lens-only manual Pint routes under their existing owner", async () => {
    window.history.replaceState({}, "", "/map?mode=build&pubs=a,b,c&drink=gin");
    await mount({ currentPrices });
    expect(host.querySelector("h2")?.textContent).toBe("Hand-built plan");
    expect(metricText()).toContain("£16.50estimated round");
    expectNoQuotes();
  });
});


describe("Cider generated and restored public Map handoff", () => {
  // Synthetic exact-ID public quote fixture. This exercises transport and
  // rendering, not publisher or production-store corroboration.
  const ciderQuote: SelectedDrinkPriceEvidence = {
    category: "beer", pence: 490, serving: null, source: "listed",
    sourceUrl: "https://pub.example/cider/menu",
    observedAt: "2026-09-29T12:00:00.000Z",
    drinkLabel: "Appleshed Premium Cider", drinkSubtype: "beer-cider",
  };

  function ciderPlan(drinkServing: string | null = null): GeneratedMobilePlan {
    const plan = generatedPlan({ category: "beer", quote: ciderQuote });
    return { ...plan,
      context: { ...plan.context, drinkSubtype: "beer-cider", drinkServing },
      budget: { ...plan.budget, basis: "selected-drink-price-unavailable" },
    };
  }

  function currentCider(servingSize: string | null = null): MapLensPrice {
    return { venueId: "a", category: "beer", categoryLabel: "Cider",
      priceGbp: 4.9, source: "listed", servingSize,
      sourceUrl: "https://pub.example/cider/menu",
      observedAt: "2026-09-29T12:00:00.000Z", drinkLabel: "Appleshed Premium Cider" };
  }

  it("retains generated Cider through a real reverse/edit/completion share without carrying quote authority", async () => {
    await mount({ generated: ciderPlan() });
    await click("Activate generated plan");
    expect(host.querySelector("h2")?.textContent).toBe("Cider plan");
    expectUnknownRound("cider stops");
    expect(rowFor("a").querySelector("p")?.textContent)
      .toBe("Appleshed Premium Cider £4.90, published menu 29 Sept 2026. Serving size not recorded.");
    await click("Reverse route");
    expect(rowFor("a").querySelector("p")?.textContent).toContain("Appleshed Premium Cider £4.90");
    await click("Fixture pub d£5.50 · WestminsterAdd", host.querySelector(".venuePicker")!);
    expectUnknownRound("cider stops");
    expect(host.querySelector(".routeList")?.textContent).not.toContain("Appleshed Premium Cider £4.90");
    await click("Start this crawl");
    await click("Mark complete");
    const url = new URL(host.querySelector<HTMLAnchorElement>('[data-testid="crawl-share-open"]')!.href);
    expect(url.searchParams.get("pubs")?.split(",")).toEqual(["c", "b", "a", "d"]);
    expect(routeDrinkIntentFromSearch(url.search)).toMatchObject({ drinkCategory: "beer", drinkSubtype: "beer-cider", zeroProof: false });
    expect(Array.from(url.searchParams.keys())).toEqual(["mode", "pubs", "routeDrink", "routeSub"]);
    expect(url.href).not.toMatch(/4\.9|490|pub\.example|Appleshed|observedAt|memberToken|lat=|lng=/);
  });

  it.each(["pint", "500ml"])("clears an incompatible same-category generated quote while retaining requested %s", async (drinkServing) => {
    await mount({ generated: ciderPlan(drinkServing) });
    await click("Activate generated plan");
    expect(rowFor("a").querySelector("p")?.textContent).not.toContain("Appleshed Premium Cider £4.90");
    expect(host.querySelector('a[href="https://pub.example/cider/menu"]')).toBeNull();
    expectUnknownRound("cider stops");
    await click("Start this crawl");
    await click("Mark complete");
    const url = new URL(host.querySelector<HTMLAnchorElement>('[data-testid="crawl-share-open"]')!.href);
    expect(routeDrinkIntentFromSearch(url.search)).toMatchObject({ drinkCategory: "beer", drinkSubtype: "beer-cider", drinkServing, zeroProof: false });
    expect(url.searchParams.get("routeServing")).toBe(drinkServing);
  });

  it("restores Cider and reads only a current exact-ID quote without assigning its unknown serving a budget", async () => {
    window.history.replaceState({}, "", "/map?mode=build&pubs=a,b,c&routeDrink=beer&routeSub=beer-cider&drink=wine");
    await mount({ currentPrices: new Map([["a", currentCider()], ["b", { ...currentCider(), venueId: "outside-route" }]]) });
    expect(host.querySelector("h2")?.textContent).toBe("Cider plan");
    expectUnknownRound("cider stops");
    expect(rowFor("a").querySelector("p")?.textContent).toContain("Appleshed Premium Cider £4.90");
    expect(rowFor("b").querySelector("p")?.textContent).toBe("Cider price not recorded");
  });

  it("restored explicit serving rejects unknown quote and accepts only supplied matching public measure", async () => {
    window.history.replaceState({}, "", "/map?mode=build&pubs=a,b,c&routeDrink=beer&routeSub=beer-cider&routeServing=500ml");
    await mount({ currentPrices: new Map([["a", currentCider()]]) });
    expect(rowFor("a").querySelector("p")?.textContent).not.toContain("Appleshed Premium Cider £4.90");
    await mount({ currentPrices: new Map([["a", currentCider("500ml")]]) });
    expect(rowFor("a").querySelector("p")?.textContent)
      .toBe("Appleshed Premium Cider £4.90, published menu 29 Sept 2026. Serving 500ml.");
    expectUnknownRound("cider stops");
    await click("Start this crawl");
    await click("Mark complete");
    const url = new URL(host.querySelector<HTMLAnchorElement>('[data-testid="crawl-share-open"]')!.href);
    expect(routeDrinkIntentFromSearch(url.search)).toMatchObject({ drinkSubtype: "beer-cider", drinkServing: "500ml" });
  });
});
