// @vitest-environment jsdom

// THE VENUE SHEET'S ACTION CARD (launch plan 1 Nov 2026, section 5): one card
// that stays in view while the Overview scrolls, holding the pub's best honest
// price with its trust words and date, the walk, the ONE plan door, "Ask for a
// table" and Share.
//
// Three things are pinned here, on the sheet as the map composes it (the card
// with its first row built the way components/PubMap.tsx builds it, beside
// the real Overview):
//   1. The card prints the SHEET'S OWN price and date: the figure and the date
//      the Overview's price block prints for the same lane, for every lane a
//      drinker's log can take, because both read one lane and one formatter.
//   2. Exactly ONE coral action: the card's plan door. The Overview's price
//      door is drawn in ink and the card's other commands are ghosts.
//   3. No action appears twice on the sheet: the card's actions left the body.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/visits/VisitReportPanel", () => ({
  default: () => createElement("div", { "data-testid": "visit-report-peek" }),
}));

vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({
    user: null, session: null, loading: false, configured: false,
    handle: null, identityResolved: true, getCurrentUserId: () => null,
  }),
}));

import VenueActionCard from "@/components/map/inspector/VenueActionCard";
import VenueActionSummary from "@/components/map/inspector/VenueActionSummary";
import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import VenuePeekPlanDoor from "@/components/map/inspector/VenuePeekPlanDoor";
import VenuePeekPintPrice from "@/components/map/VenuePeekPintPrice";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import {
  ACTION_CARD_CORAL_CLASS,
  venueActionCardPriceDate,
  venueActionCardWalkMinutes,
} from "@/lib/venueActionCard";
import { phoneVenuePlanDoor } from "@/lib/venuePlanDoor";
import {
  dropLaneInputsFor,
  pintTrustFor,
  pintTrustSignalFields,
  type PintTrustState,
} from "@/lib/pintTrust";
import {
  venueBundlePrices,
  venuePriceLane,
  venueSourcedPrice,
} from "@/lib/venuePriceLane";
import { mergeVenueDrops, type SummaryDrop, type Venue } from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-02T20:00:00.000Z");
const VENUE_ID = "venue-action-card";
const noop = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});

function venue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: VENUE_ID,
    name: "The Action Arms",
    address: "1 Card Street",
    latitude: 51.52,
    longitude: -0.11,
    primaryBorough: "Camden",
    visibleBoroughs: [],
    prices: [],
    cheapestPrice: null,
    cheapestPint: "",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {},
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    kind: "pub",
    ...overrides,
  } as Venue;
}

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function drop(overrides: Partial<SummaryDrop> = {}): SummaryDrop {
  return {
    drink: "Lager",
    priceGbp: 4.6,
    passedDownNote: "",
    provenance: "contributor",
    createdAt: daysAgo(2),
    handle: "tester",
    ...overrides,
  };
}

const DROPS: Partial<Record<PintTrustState, () => SummaryDrop[]>> = {
  "logged-once": () => [drop()],
  corroborated: () => [
    drop({ authorityKey: "key-a" }),
    drop({ handle: "second", authorityKey: "key-b", createdAt: daysAgo(3) }),
  ],
  unchecked: () => [drop({ priceEvidence: "unchecked", authorityKey: "key-a" })],
  "aged-out": () => [drop({ createdAt: daysAgo(90) })],
};

function communityPrices(): CommunityPricesState {
  return {
    byVenueId: new Map([[VENUE_ID, []]]),
    signalsByVenueId: new Map(),
    freshestByVenueId: new Map(),
    noAlcoholIndexStatus: "idle",
    loadNoAlcoholIndex: noop,
    loadDrinkCategoryIndex: noop,
    drinkCategoryIndexStatus: new Map(),
    provisionalBaseVenueIds: new Set(),
    loadProvisionalBaseVenues: noop,
    loadVenue: noop,
    venuePriceStatus: new Map([[VENUE_ID, "ready"]]),
    submit: async () => ({ ok: true, attribution: { status: "anonymous" }, price: null }),
    submitVenueSignal: async () => ({ ok: true }),
    submitting: false,
    reportPrice: noop,
    reportedIds: new Set(),
  } as unknown as CommunityPricesState;
}

/** The sheet as the map composes it: the action card first, then the Overview. */
function renderSheet(
  drops: SummaryDrop[],
  options: { mode?: "suggest" | "build"; builtIds?: string[]; userLocation?: { lat: number; lng: number } | null } = {},
): HTMLElement {
  const [merged] = mergeVenueDrops([venue()], new Map([[VENUE_ID, drops]]), NOW);
  const pub = defined(merged);
  const signal = pintTrustSignalFields(pintTrustFor(drops, NOW));
  const lanes = dropLaneInputsFor(signal);
  const lane = venuePriceLane(
    pub,
    signal.latestContributorPrice,
    venueSourcedPrice(pub),
    venueBundlePrices(pub),
    lanes.provisional,
    lanes.aged,
    lanes.disputed,
  );
  const summary = createElement(VenueActionSummary, {
    label: `${pub.name} summary`,
    walkMinutes: venueActionCardWalkMinutes(options.userLocation ?? null, pub),
    price: createElement(VenuePeekPintPrice, {
      venueId: pub.id,
      isPub: true,
      lane,
      bundle: venueBundlePrices(pub),
      pintTrust: signal.pintTrust,
      detailLoading: false,
      priceReadStatus: "ready",
      dropReadStatus: "ready",
      onLog: noop,
      dated: venueActionCardPriceDate(lane, pub),
    }),
    planDoor: createElement(VenuePeekPlanDoor, {
      door: phoneVenuePlanDoor({
        isPub: true,
        mode: options.mode ?? "suggest",
        builtIds: options.builtIds ?? [],
        venueId: pub.id,
        canAcceptStop1: true,
      }),
      venueId: pub.id,
      venueName: pub.name,
      onAcceptStop1: noop,
      onToggleStop: noop,
    }),
  });
  const card = createElement(VenueActionCard, {
    venue: pub,
    summary,
    shareVenue: async () => {},
    currentShareFeedback: null,
  });
  const overview = createElement(VenueOverviewTab, {
    venue: pub,
    tab: "overview",
    cityId: "london",
    latestContributorPrice: signal.latestContributorPrice,
    latestPintDropAt: signal.latestContributorAt,
    confirmedPrice: signal.confirmedPrice,
    provisionalPrice: lanes.provisional,
    agedPrice: lanes.aged,
    disputedPrice: lanes.disputed,
    communityPrices: communityPrices(),
    dropReadStatus: "ready",
    experienceLens: "all",
    drinkLensCategory: null,
    presenceState: "idle",
    markPresenceHere: noop,
    userLocation: null,
    locationRequestStatus: "idle",
    onRequestLocation: noop,
    onClearLocation: noop,
    onLogTonightPrice: noop,
    onConfirmPrice: noop,
    onOpenVisitReports: noop,
    priceEntryAllowed: true,
    priceSignInRequested: false,
    priceAuthLoading: false,
    priceFocusRequest: 0,
  });
  const view = document.createElement("div");
  view.innerHTML = renderToStaticMarkup(createElement("div", { className: "mapDrawer right" }, card, overview));
  return view;
}

/** The element, or a thrown error naming what was missing. */
function present<T extends Element>(element: T | null, what: string): T {
  if (!element) throw new Error(`expected ${what} on the sheet`);
  return element;
}

function cardOf(view: HTMLElement): HTMLElement {
  return present(view.querySelector<HTMLElement>(".venueActionCard"), "the action card");
}

/** What a reader hears for an action: its accessible name, else its words. */
function actionName(element: Element): string {
  return (element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("the card prints the sheet's own price and date", () => {
  it.each(Object.keys(DROPS) as PintTrustState[])("for a %s pint", (state) => {
    const view = renderSheet(defined(DROPS[state])());
    const card = cardOf(view);
    const block = present(view.querySelector<HTMLElement>("#venuePanel-overview .contributorPrice"), "the price block");

    const cardFigure = card.querySelector(".priceBadge")?.textContent?.trim();
    const blockFigure = block.querySelector(".priceBadge, .trustPill")?.textContent?.trim() ?? "";
    expect(cardFigure).toBeTruthy();
    expect(blockFigure).toContain(cardFigure ?? "missing");

    const cardDate = card.querySelector("[data-price-dated]")?.textContent?.trim();
    expect(cardDate).toMatch(/^logged \d+ days? ago$/);
    const blockSmalls = [...block.querySelectorAll("small")].map((small) => small.textContent?.trim());
    expect(blockSmalls).toContain(cardDate);
  });

  it("prints the trust words the price carries, and the walk only when it is known", () => {
    const unchecked = cardOf(renderSheet(defined(DROPS.unchecked)()));
    expect(unchecked.textContent).toMatch(/not checked/i);
    // An unchecked figure wears no band, on the card as in the block.
    expect(unchecked.querySelector(".priceBadge")?.className).not.toMatch(/priceBand--/);

    expect(cardOf(renderSheet([])).textContent).toContain("Turn on location for walk times");
    const near = cardOf(renderSheet([], { userLocation: { lat: 51.5205, lng: -0.1105 } }));
    expect(near.querySelector(".mobileVenuePeekNearMe")?.textContent).toBe("1 min");
  });

  it("says nothing is priced rather than inventing a figure or a date", () => {
    const card = cardOf(renderSheet([]));
    expect(card.querySelector(".priceBadge")).toBeNull();
    expect(card.querySelector("[data-price-dated]")).toBeNull();
    expect(card.textContent).toContain("No price yet.");
  });
});

describe("one coral action", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const CORAL = /var\(--(?:brass|color-accent|accent-action)[\w-]*[,)]/;

  it("the card holds exactly one painted door, and it is the plan door", () => {
    for (const [mode, builtIds] of [["suggest", []], ["build", ["venue-other"]]] as const) {
      const view = renderSheet([drop()].slice(0, 1), { mode, builtIds: [...builtIds] });
      const card = cardOf(view);
      expect(card.querySelectorAll(`.${ACTION_CARD_CORAL_CLASS}`)).toHaveLength(1);
      expect(view.querySelectorAll(`.${ACTION_CARD_CORAL_CLASS}`)).toHaveLength(1);
      // Every other command on the card is a ghost.
      const ghosts = [...card.querySelectorAll('[role="toolbar"] button')];
      expect(ghosts.map(actionName)).toEqual([`Ask The Action Arms for a table`, "Share The Action Arms"]);
      for (const ghost of ghosts) expect(ghost.className).toBe("venueSheetStickyGhost");
    }
  });

  it("the Overview's price door is drawn in ink, the ghosts carry no coral, and the plan door is coral at every width", () => {
    const globals = read("app/globals.css");
    const priceDoor = globals.match(/\n\.priceDoor\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(priceDoor).toMatch(/background:\s*var\(--control-secondary-surface\)/);
    expect(priceDoor).not.toMatch(CORAL);
    const priceDoorHover = globals.match(/\.priceDoor:hover\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(priceDoorHover).not.toMatch(CORAL);

    const sheet = read("components/map/venueSheet.css");
    for (const [, body = ""] of sheet.matchAll(/\.venueSheetStickyGhost[^{,]*\{([^}]*)\}/g)) {
      expect(body.replace(/outline[^;]*;/g, "")).not.toMatch(CORAL);
    }

    const card = read("components/map/inspector/venueActionCard.css");
    const desktopDoor = card.match(/\.venueActionCard \.mobileVenuePeekSummary button\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(desktopDoor).toMatch(/background:\s*var\(--color-accent\)/);
    const phone = read("components/mobile/mobileMapShell.css");
    expect(phone).toMatch(/\.mobileVenuePeekSummary button\s*\{[^}]*background:\s*var\(--color-accent\)/);
    // A price door still renders, once, beside the one coral.
    expect(renderSheet([drop()]).querySelectorAll("[data-price-door]")).toHaveLength(1);
  });
});

describe("no action appears twice on the sheet", () => {
  it.each([
    ["no crawl", "suggest", []],
    ["a crawl in progress", "build", ["venue-other"]],
  ] as const)("with %s", (_label, mode, builtIds) => {
    const view = renderSheet(defined(DROPS["logged-once"])(), { mode, builtIds: [...builtIds] });
    // "That's wrong" sits beside the price AND under the listed facts by its
    // own rule (components/map/inspector/VenueCorrectionDoor.tsx, `where`):
    // two lines, two subjects, neither of them a card action.
    const names = [...view.querySelectorAll("button, a[href]")]
      .map(actionName)
      .filter((name) => name && !/^That's wrong/.test(name));
    const seen = new Map<string, number>();
    for (const name of names) seen.set(name, (seen.get(name) ?? 0) + 1);
    const twice = [...seen].filter(([, count]) => count > 1).map(([name]) => name);
    expect(twice).toEqual([]);

    const plan = names.filter((name) => /stop 1|plan stop|in plan|crawl/i.test(name));
    expect(plan).toHaveLength(1);
    const table = names.filter((name) => /for a table/i.test(name));
    expect(table).toHaveLength(1);
    const share = names.filter((name) => name === "Share The Action Arms");
    expect(share).toHaveLength(1);
    // The card's actions are not also in the body.
    const body = present(view.querySelector("#venuePanel-overview"), "the Overview");
    expect([...body.querySelectorAll("button")].map(actionName).filter((name) => /stop 1|plan stop|crawl|for a table|^Share The Action Arms$/i.test(name))).toEqual([]);
  });
});
