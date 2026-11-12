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
//   2. Exactly ONE coral action: the card's plan door. The card's other
//      commands are ghosts.
//   3. No action appears twice on the sheet: the card's actions left the body.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tableAuth = vi.hoisted(() => ({
  configured: false,
  loading: false,
  user: null as { id: string; email: string } | null,
  handle: null as string | null,
}));
const tableTrack = vi.hoisted(() => vi.fn());
const tableFetch = vi.hoisted(() => vi.fn());
const emailSignIn = vi.hoisted(() => vi.fn(async () => ({ status: "sent", message: "Link sent" })));
vi.mock("@/lib/analytics", () => ({ trackEvent: tableTrack }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: tableFetch }));
const dynamicDialog = vi.hoisted(() => ({ component: null as React.ComponentType<never> | null }));
vi.mock("next/dynamic", async () => {
  const { createElement: create } = await import("react");
  return {
    default: () => function DynamicDialog(props: never) {
      return dynamicDialog.component ? create(dynamicDialog.component, props) : null;
    },
  };
});
vi.mock("@/components/visits/VisitReportPanel", () => ({
  default: () => createElement("div", { "data-testid": "visit-report-peek" }),
}));

vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({
    ...tableAuth, session: null,
    supabaseAuthState: "signed-out",
    socialProviders: { google: false, apple: false, microsoft: false },
    signInWithEmail: emailSignIn,
    cancelAuthAttempt: () => {},
    identityResolved: true, getCurrentUserId: () => tableAuth.user?.id ?? null,
  }),
}));

import VenueActionCard from "@/components/map/inspector/VenueActionCard";
import TableRequestDialog from "@/components/map/inspector/TableRequestDialog";
dynamicDialog.component = TableRequestDialog as React.ComponentType<never>;
import VenueActionSummary from "@/components/map/inspector/VenueActionSummary";
import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import { venueActionDoors } from "@/components/map/inspector/venueActionDoors";
import VenuePeekPintPrice from "@/components/map/VenuePeekPintPrice";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import {
  ACTION_CARD_CORAL_CLASS,
  venueActionCardPriceDate,
  venueActionCardWalkMinutes,
} from "@/lib/venueActionCard";
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
  window.history.replaceState(null, "", "/");
  tableAuth.configured = false;
  tableAuth.loading = false;
  tableAuth.user = null;
  tableAuth.handle = null;
  vi.clearAllMocks();
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

describe("table request arrival", () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.useRealTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const show = async (pub = venue()) => {
    await act(async () => root.render(createElement(VenueActionCard, {
      venue: pub, shareVenue: async () => {}, currentShareFeedback: null,
    })));
  };
  const input = async (selector: string, value: string) => {
    const field = defined(document.querySelector<HTMLInputElement>(selector) ?? undefined);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const submit = async () => {
    await act(async () => defined(document.querySelector("form") ?? undefined).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ));
  };

  it("opens the named pub with the party prefilled, consumes the intent and does not reopen", async () => {
    window.history.replaceState(null, "", `/map?sel=${VENUE_ID}&table=8`);
    await show();
    expect(document.querySelector("select")?.value).toBe("8");
    expect(new URLSearchParams(window.location.search).has("table")).toBe(false);
    await act(async () => defined(document.querySelector<HTMLButtonElement>(".tableRequestClose") ?? undefined).click());
    await act(async () => root.render(null));
    await show();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps a signed-out ask in the address for the sign-in return, and drops it on Not now", async () => {
    tableAuth.configured = true;
    window.history.replaceState(null, "", `/map?sel=${VENUE_ID}&table=8`);
    await show();
    expect(document.querySelector(".contributionGate")).not.toBeNull();
    expect(document.querySelector("select")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("table")).toBe("8");
    await act(async () => defined(document.querySelector<HTMLButtonElement>(".contributionGateClose") ?? undefined).click());
    expect(document.querySelector(".contributionGate")).toBeNull();
    expect(new URLSearchParams(window.location.search).has("table")).toBe(false);
  });

  it("opens the prefilled form when the reader comes back signed in", async () => {
    tableAuth.configured = true;
    tableAuth.user = { id: "reader", email: "reader@example.com" };
    tableAuth.handle = "reader";
    window.history.replaceState(null, "", `/map?sel=${VENUE_ID}&table=12`);
    await show();
    expect(document.querySelector(".contributionGate")).toBeNull();
    expect(document.querySelector("select")?.value).toBe("12");
    expect(new URLSearchParams(window.location.search).has("table")).toBe(false);
  });

  it("keeps the ask through the handle claim door", async () => {
    tableAuth.configured = true;
    tableAuth.user = { id: "reader", email: "reader@example.com" };
    window.history.replaceState(null, "", `/map?sel=${VENUE_ID}&table=8`);
    await show();
    expect(document.querySelector(".contributionGate")).not.toBeNull();
    expect(document.querySelector("select")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("table")).toBe("8");
    const href = document.querySelector<HTMLAnchorElement>(".contributionGatePrimary")?.href;
    expect(href && new URL(href).searchParams.get("returnTo")).toBe(`/map?sel=${VENUE_ID}&table=8`);
  });

  it.each(["/map", "/map/manchester"])("keeps the table ask through email sign-in from %s", async (path) => {
    tableAuth.configured = true;
    const id = path === "/map" ? VENUE_ID : "venue-mcr-1lwo5lo";
    const returnTo = `${path}?sel=${id}&table=8`;
    window.history.replaceState(null, "", returnTo);
    await show(venue({ id }));
    await input('input[type="email"]', "reader@example.test");
    await submit();
    expect(emailSignIn).toHaveBeenCalledWith(
      "reader@example.test", `/u/you?returnTo=${encodeURIComponent(returnTo)}`,
    );
  });

  it("resumes the held ask when sign-in and handle resolve without navigation", async () => {
    tableAuth.configured = true;
    window.history.replaceState(null, "", `/map?sel=${VENUE_ID}&table=8`);
    await show();
    tableAuth.user = { id: "reader", email: "reader@example.test" };
    await show();
    expect(document.querySelector(".contributionGatePrimary")).not.toBeNull();
    tableAuth.handle = "reader";
    await show();
    expect(document.querySelector(".contributionGate")).toBeNull();
    expect(document.querySelector("select")?.value).toBe("8");
  });

  it("waits for auth to settle before deciding which door to open", async () => {
    tableAuth.configured = true;
    tableAuth.loading = true;
    window.history.replaceState(null, "", `/map?sel=${VENUE_ID}&table=8`);
    await show();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    tableAuth.loading = false;
    await show();
    expect(document.querySelector(".contributionGate")).not.toBeNull();
    expect(document.querySelector("select")).toBeNull();
  });

  it("consumes but never opens a table form for a non-pub", async () => {
    window.history.replaceState(null, "", `/map?sel=${VENUE_ID}&table=8`);
    await show(venue({ kind: "cafe" }));
    expect(window.location.search).not.toContain("table=");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each(["sent", "not_sent"])("counts a completed Pal request as %s", async (outcome) => {
    tableAuth.configured = true;
    tableAuth.user = { id: "reader", email: "reader@example.com" };
    tableAuth.handle = "reader";
    tableFetch.mockResolvedValue(Response.json({ outcome }));
    window.history.replaceState(null, "", `/map?sel=${VENUE_ID}&table=8`);
    await show();
    await input('input[autocomplete="name"]', "Sam");
    await submit();
    expect(document.querySelector(`[data-table-request-outcome="${outcome}"]`)).not.toBeNull();
    expect(tableTrack).toHaveBeenCalledWith("table_request_sent", { source: "pal", outcome });
  });

  it("reuses the attempt key after lost and retryable answers, then rotates it for an edited request", async () => {
    tableAuth.configured = true;
    tableAuth.user = { id: "reader", email: "reader@example.com" };
    tableAuth.handle = "reader";
    tableFetch
      .mockRejectedValueOnce(new TypeError("Connection lost"))
      .mockResolvedValueOnce(Response.json({ retryable: true }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ outcome: "sent" }));
    await act(async () => root.render(createElement(TableRequestDialog, { venue: venue(), onClose: noop })));
    await input('input[autocomplete="name"]', "Sam");
    await submit();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    await submit();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    await input('input[autocomplete="name"]', "Sam's birthday");
    await submit();
    expect(document.querySelector('[data-table-request-outcome="sent"]')).not.toBeNull();
    const requests = tableFetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(requests).toHaveLength(3);
    expect(requests[0].requestKey).toEqual(expect.any(String));
    expect(requests[0].requestKey.length).toBeGreaterThan(0);
    expect(requests[1].requestKey).toBe(requests[0].requestKey);
    expect(requests[2].requestKey).not.toBe(requests[1].requestKey);
    expect(requests[2].name).toBe("Sam's birthday");
  });

  it.each([
    ["an unreadable", () => new Response("{", { status: 201 })],
    ["an unrecognised", () => Response.json({ outcome: "queued" }, { status: 201 })],
  ])("keeps %s ok answer retryable under the same key", async (_label, answer) => {
    tableAuth.configured = true;
    tableAuth.user = { id: "reader", email: "reader@example.com" };
    tableAuth.handle = "reader";
    tableFetch
      .mockResolvedValueOnce(answer())
      .mockResolvedValueOnce(Response.json({ outcome: "sent" }, { status: 201 }));
    await act(async () => root.render(createElement(TableRequestDialog, { venue: venue(), onClose: noop })));
    await input('input[autocomplete="name"]', "Sam");
    await submit();
    expect(document.querySelector('[data-table-request-outcome="not_sent"]')).toBeNull();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(tableTrack).not.toHaveBeenCalled();
    await submit();
    expect(document.querySelector('[data-table-request-outcome="sent"]')).not.toBeNull();
    const keys = tableFetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)).requestKey);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("counts the keyless fallback as a sheet request, but not invalid input", async () => {
    await act(async () => root.render(createElement(TableRequestDialog, { venue: venue(), onClose: noop })));
    await submit();
    expect(tableTrack).not.toHaveBeenCalled();
    await input('input[autocomplete="name"]', "Sam");
    await input('input[type="email"]', "sam@example.com");
    await submit();
    expect(tableTrack).toHaveBeenCalledWith("table_request_sent", { source: "sheet", outcome: "not_sent" });
  });
});

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
  const doors = venueActionDoors({
    venueId: pub.id,
    venueName: pub.name,
    isPub: true,
    mode: options.mode ?? "suggest",
    builtIds: options.builtIds ?? [],
    drops,
    communityPrices: [],
    onLog: noop,
    onAcceptStop1: noop,
    onToggleStop: noop,
  });
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
      onLog: doors.logFirst ? undefined : noop,
      dated: venueActionCardPriceDate(lane, pub),
    }),
    planDoor: doors.coral,
  });
  const card = createElement(VenueActionCard, {
    venue: pub,
    summary,
    planDoor: doors.ghost,
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
  it("with a fresh drinker price, the card holds exactly one painted door, and it is the plan door", () => {
    for (const [mode, builtIds] of [["suggest", []], ["build", ["venue-other"]]] as const) {
      const view = renderSheet([drop()].slice(0, 1), { mode, builtIds: [...builtIds] });
      const card = cardOf(view);
      expect(card.querySelectorAll(`.${ACTION_CARD_CORAL_CLASS}`)).toHaveLength(1);
      expect(view.querySelectorAll(`.${ACTION_CARD_CORAL_CLASS}`)).toHaveLength(1);
      // Every other command on the card is a ghost.
      const ghosts = [...card.querySelectorAll('[role="toolbar"] button')];
      expect(ghosts.map(actionName)).toEqual(["Ask for a table at The Action Arms", "Summon mates to The Action Arms", "Share The Action Arms"]);
      for (const ghost of ghosts) expect(ghost.className).toBe("venueSheetStickyGhost");
    }
  });

  it.each([
    ["no drinker price", () => []],
    ["a drinker price past the window", () => defined(DROPS["aged-out"])()],
  ] as const)("with %s, the one painted door is Log what you paid and the plan door is a ghost", (_label, drops) => {
    for (const [mode, builtIds, plan] of [
      ["suggest", [], "Make it Stop 1: The Action Arms"],
      ["build", ["venue-other"], "Plan stop"],
    ] as const) {
      const view = renderSheet(drops(), { mode, builtIds: [...builtIds] });
      const card = cardOf(view);
      const coral = [...view.querySelectorAll(`.${ACTION_CARD_CORAL_CLASS}`)];
      expect(coral.map(actionName)).toEqual(["Log what you paid at The Action Arms"]);
      const ghosts = [...card.querySelectorAll('[role="toolbar"] button')];
      expect(ghosts.map(actionName)).toEqual([plan, "Ask for a table at The Action Arms", "Summon mates to The Action Arms", "Share The Action Arms"]);
      for (const ghost of ghosts) expect(ghost.className).toBe("venueSheetStickyGhost");
      // The coral already asks, so the price cell says and does not ask again.
      expect(card.querySelector(".mobileVenuePeekDrop")).toBeNull();
    }
  });

  it("the Overview renders one price door beside the plan door", () => {
    expect(renderSheet([drop()]).querySelectorAll("[data-price-door]")).toHaveLength(1);
  });
});

describe("no action appears twice on the sheet", () => {
  it.each([
    ["no crawl", "logged-once", "suggest", []],
    ["a crawl in progress", "logged-once", "build", ["venue-other"]],
    ["no fresh drinker price", "aged-out", "suggest", []],
    ["no fresh drinker price and a crawl in progress", "aged-out", "build", ["venue-other"]],
  ] as const)("with %s", (_label, state, mode, builtIds) => {
    const view = renderSheet(defined(DROPS[state])(), { mode, builtIds: [...builtIds] });
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
