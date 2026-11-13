// @vitest-environment jsdom

// THE PHONE PUB SHEET HAS ONE PLAN DOOR, AND IT FOLLOWS THE CRAWL (owner
// decision, option C, 16 Oct 2026). No crawl in progress: the one coral door
// is `Make it Stop 1` and hands the pub to Plan. A crawl in progress: it is
// `Plan stop` / `In plan` and adds the pub to or takes it off the crawl on the
// map. In build mode the phone sheet shows that one door and nothing else
// that plans.
//
// Since the action card (launch plan 1 Nov 2026, section 5) the door is the
// card's, at every width: on a phone the card is the sheet's footer, and from
// 641px it is the drawer's sticky top. Desktop's Stop 1 and Crawl ghosts left
// with the old command bar, so the card's door is the one plan door there too.
//
// Since D4 (c) (11 Nov 2026) a pub with no drinker price from the last 30
// days spends the coral on "Log what you paid", and the same plan door moves
// to the card's action row as a ghost.

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, handle: null, loading: false, configured: false }),
}));

import VenueActionCard from "@/components/map/inspector/VenueActionCard";
import VenueActionSummary from "@/components/map/inspector/VenueActionSummary";
import { venueActionDoors } from "@/components/map/inspector/venueActionDoors";
import { SheetFooterContext } from "@/components/mobile/sheetFooterContext";
import type { CrawlMode, SummaryDrop, Venue } from "@/lib/venues";
import type { CommunityPrice } from "@/lib/communityPrice";
import { DAY_MS } from "@/lib/dayMs";
import { pintTrustFor } from "@/lib/pintTrust";
import {
  crawlInProgress,
  hasFreshDrinkerPrice,
  phoneVenuePlanDoor,
  venueSheetDoors,
} from "@/lib/venuePlanDoor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VENUE_ID = "venue-plan-door";
const OTHER_ID = "venue-other-stop";
const NOW = Date.parse("2026-11-11T20:00:00.000Z");

function drop(days = 1, overrides: Partial<SummaryDrop> = {}): SummaryDrop {
  return {
    drink: "Lager",
    priceGbp: 4.5,
    passedDownNote: "",
    provenance: "contributor",
    createdAt: new Date(NOW - days * DAY_MS).toISOString(),
    ...overrides,
  };
}

function communityPrice(days: number, drinkCategory: CommunityPrice["drinkCategory"] = "beer"): CommunityPrice {
  return { venueId: VENUE_ID, drinkCategory, priceGbp: 6, submittedAt: NOW - days * DAY_MS, source: "community" };
}

function venue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: VENUE_ID,
    name: "The Plan Door",
    address: "1 Test Street, London",
    latitude: 51.5,
    longitude: -0.1,
    pintPrice: null,
    ...overrides,
  } as Venue;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("phoneVenuePlanDoor: the mapping, exactly", () => {
  const base = { isPub: true, venueId: VENUE_ID, canAcceptStop1: true };

  it.each([
    { mode: "suggest" as CrawlMode, builtIds: [] as string[], expected: { kind: "stop-1", label: "Make it Stop 1" } },
    // A suggest-mode leftover is no crawl: the built list is read only in build mode.
    { mode: "suggest" as CrawlMode, builtIds: [OTHER_ID], expected: { kind: "stop-1", label: "Make it Stop 1" } },
    // Build mode with nothing picked is no crawl either.
    { mode: "build" as CrawlMode, builtIds: [], expected: { kind: "stop-1", label: "Make it Stop 1" } },
    { mode: "build" as CrawlMode, builtIds: [OTHER_ID], expected: { kind: "crawl", label: "Plan stop", inCrawl: false } },
    { mode: "build" as CrawlMode, builtIds: [VENUE_ID], expected: { kind: "crawl", label: "In plan", inCrawl: true } },
    { mode: "build" as CrawlMode, builtIds: [OTHER_ID, VENUE_ID], expected: { kind: "crawl", label: "In plan", inCrawl: true } },
  ])("$mode with $builtIds.length built stop(s) -> $expected.label", ({ mode, builtIds, expected }) => {
    expect(phoneVenuePlanDoor({ ...base, mode, builtIds })).toEqual(expected);
  });

  it("a non-pub venue gets no plan door in any state", () => {
    expect(phoneVenuePlanDoor({ ...base, isPub: false, mode: "suggest", builtIds: [] })).toBeNull();
    expect(phoneVenuePlanDoor({ ...base, isPub: false, mode: "build", builtIds: [OTHER_ID] })).toBeNull();
  });

  it("with no Stop 1 acceptance on offer and no crawl, there is no door; a crawl still offers its toggle", () => {
    expect(phoneVenuePlanDoor({ ...base, canAcceptStop1: false, mode: "suggest", builtIds: [] })).toBeNull();
    expect(phoneVenuePlanDoor({ ...base, canAcceptStop1: false, mode: "build", builtIds: [OTHER_ID] }))
      .toMatchObject({ kind: "crawl", label: "Plan stop" });
  });

  it("a crawl is in progress only in build mode with at least one stop", () => {
    expect(crawlInProgress({ mode: "build", builtCount: 1 })).toBe(true);
    expect(crawlInProgress({ mode: "build", builtCount: 0 })).toBe(false);
    expect(crawlInProgress({ mode: "suggest", builtCount: 3 })).toBe(false);
  });
});

describe("the coral asks for a price where no drinker has given one this month", () => {
  it.each([
    [1, true],
    [30, true],
    [31, false],
    [66, false],
  ])("a report logged %s days ago counts as fresh: %s", (days, fresh) => {
    expect(hasFreshDrinkerPrice({ drops: [drop(days)], communityPrices: undefined }, NOW)).toBe(fresh);
  });

  it("a confirmation today does not refresh an old report or hide a newer report", () => {
    const confirmed = drop(66, {
      confirmation: { confirmationId: "moderator-confirmation", confirmedAt: new Date(NOW).toISOString(), basis: "moderator" },
    });
    expect(pintTrustFor([confirmed], NOW).state).toBe("confirmed");
    expect(hasFreshDrinkerPrice({ drops: [confirmed], communityPrices: undefined }, NOW)).toBe(false);
    const drops = [confirmed, drop(1)];
    expect(pintTrustFor(drops, NOW).drop).toBe(confirmed);
    expect(hasFreshDrinkerPrice({ drops, communityPrices: undefined }, NOW)).toBe(true);
  });

  it.each([
    { priceGbp: null },
    { priceGbp: 0 },
    { priceGbp: Number.NaN },
    { provenance: "demo" as const },
    { createdAt: "invalid" },
    { createdAt: new Date(NOW + DAY_MS).toISOString() },
  ])("does not count a report without a real dated price: %s", (overrides) => {
    expect(hasFreshDrinkerPrice({ drops: [drop(1, overrides)], communityPrices: undefined }, NOW)).toBe(false);
  });

  it("a recent report of another measure is still a drinker price", () => {
    expect(hasFreshDrinkerPrice({ drops: [drop(1, { measure: "half" })], communityPrices: undefined }, NOW)).toBe(true);
  });

  it("a price from any category counts inside 30 days and not after", () => {
    expect(hasFreshDrinkerPrice({ drops: [], communityPrices: [communityPrice(30)] }, NOW)).toBe(true);
    expect(hasFreshDrinkerPrice({ drops: [], communityPrices: [communityPrice(31)] }, NOW)).toBe(false);
    expect(hasFreshDrinkerPrice({ drops: [], communityPrices: [communityPrice(66), communityPrice(1, "wine")] }, NOW)).toBe(true);
    expect(hasFreshDrinkerPrice({ drops: undefined, communityPrices: undefined }, NOW)).toBe(false);
  });

  it("a pub with no fresh drinker price leads with the log door and keeps its plan door", () => {
    const base = { isPub: true, venueId: VENUE_ID, canAcceptStop1: true, mode: "suggest" as CrawlMode, builtIds: [] };
    expect(venueSheetDoors({ ...base, freshDrinkerPrice: false })).toEqual({
      logFirst: true,
      planDoor: { kind: "stop-1", label: "Make it Stop 1" },
    });
    expect(venueSheetDoors({ ...base, freshDrinkerPrice: true }).logFirst).toBe(false);
    expect(venueSheetDoors({ ...base, isPub: false, freshDrinkerPrice: false })).toEqual({
      logFirst: false,
      planDoor: null,
    });
  });
});

/**
 * The sheet as PubMap composes it: the action card, its first row built from
 * the one plan door, portalled into the phone sheet's footer (or rendered in
 * place with no footer, as on desktop), over the same mode and built list. The
 * toggle is PubMap's own shape (components/PubMap.tsx, `toggleBuiltStop`): a
 * picked stop puts the map in build mode.
 */
function PhoneSheet({
  initialMode,
  initialBuiltIds,
  onAcceptStop1,
  onToggle,
  onLog = () => {},
  phone = true,
  drops = [drop()],
  communityPrices,
}: {
  initialMode: CrawlMode;
  initialBuiltIds: string[];
  onAcceptStop1: () => void;
  onToggle?: (id: string) => void;
  onLog?: () => void;
  phone?: boolean;
  drops?: SummaryDrop[];
  communityPrices?: CommunityPrice[];
}) {
  const [mode, setMode] = useState<CrawlMode>(initialMode);
  const [builtIds, setBuiltIds] = useState<string[]>(initialBuiltIds);
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const toggle = (id: string) => {
    onToggle?.(id);
    setBuiltIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
    setMode("build");
  };
  const pub = venue();
  const doors = venueActionDoors({
    venueId: pub.id,
    venueName: pub.name,
    isPub: true,
    mode,
    builtIds,
    drops,
    communityPrices,
    onLog,
    onAcceptStop1,
    onToggleStop: toggle,
  });
  const card = createElement(VenueActionCard, {
    venue: pub,
    planDoor: doors.ghost,
    summary: createElement(VenueActionSummary, {
      label: "The Plan Door summary",
      price: createElement("span", null, "£4.80"),
      walkMinutes: null,
      planDoor: doors.coral,
    }),
    shareVenue: async () => {},
    currentShareFeedback: null,
  });
  if (!phone) return createElement("div", { className: "mapDrawer right" }, card);
  return createElement(
    "div",
    null,
    createElement("div", { className: "mobileSharedSheetBody" }),
    createElement("div", { className: "mobileSharedSheetFooter", ref: setFooter }),
    footer ? createElement(SheetFooterContext.Provider, { value: footer }, card) : null,
  );
}

function buttons(): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll("button"));
}

function planControls(): HTMLButtonElement[] {
  return buttons().filter((button) =>
    /stop 1|plan stop|in plan|crawl|remove/i.test(
      `${button.getAttribute("aria-label") ?? ""} ${button.textContent ?? ""}`,
    ),
  );
}

function peekDoor(): HTMLButtonElement {
  const door = host.querySelector<HTMLButtonElement>(".mobileVenuePeekSummary button");
  if (!door) throw new Error("the peek carries no plan door");
  return door;
}

describe("the phone sheet shows one plan door that follows state", () => {
  it("no crawl in progress: the one door is Make it Stop 1 and it hands the pub to Plan", () => {
    const accept = vi.fn();
    const toggle = vi.fn();
    act(() => root.render(createElement(PhoneSheet, {
      initialMode: "suggest", initialBuiltIds: [], onAcceptStop1: accept, onToggle: toggle,
    })));

    expect(planControls()).toHaveLength(1);
    expect(peekDoor().textContent).toBe("Make it Stop 1");
    expect(peekDoor().getAttribute("aria-label")).toContain(peekDoor().textContent);
    expect(peekDoor().getAttribute("aria-label")).toContain("The Plan Door");
    act(() => peekDoor().click());
    expect(accept).toHaveBeenCalledTimes(1);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("a crawl in progress: Plan stop adds the pub, In plan takes it off, and the last stop ends the crawl", () => {
    const accept = vi.fn();
    const toggle = vi.fn();
    act(() => root.render(createElement(PhoneSheet, {
      initialMode: "build", initialBuiltIds: [OTHER_ID], onAcceptStop1: accept, onToggle: toggle,
    })));

    // Build mode: ONE plan door on the whole phone sheet, not two or three
    // controls calling the same toggle.
    expect(planControls()).toHaveLength(1);
    expect(peekDoor().textContent).toBe("Plan stop");
    expect(peekDoor().getAttribute("aria-pressed")).toBe("false");

    act(() => peekDoor().click());
    expect(toggle).toHaveBeenLastCalledWith(VENUE_ID);
    expect(peekDoor().textContent).toBe("In plan");
    expect(peekDoor().getAttribute("aria-pressed")).toBe("true");
    expect(planControls()).toHaveLength(1);

    act(() => peekDoor().click());
    expect(peekDoor().textContent).toBe("Plan stop");
    expect(accept).not.toHaveBeenCalled();
  });

  it("removing the only stop needs no latch: the door reads Make it Stop 1 again", () => {
    const accept = vi.fn();
    act(() => root.render(createElement(PhoneSheet, {
      initialMode: "build", initialBuiltIds: [VENUE_ID], onAcceptStop1: accept,
    })));
    expect(peekDoor().textContent).toBe("In plan");

    act(() => peekDoor().click());
    expect(peekDoor().textContent).toBe("Make it Stop 1");
    act(() => peekDoor().click());
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it("the card in the phone footer holds the one door, Ask for a table, Summon mates and Share, in either mode", () => {
    for (const mode of ["suggest", "build"] as const) {
      act(() => root.render(createElement(PhoneSheet, {
        key: mode, initialMode: mode, initialBuiltIds: [VENUE_ID], onAcceptStop1: vi.fn(),
      })));
      const footer = host.querySelector(".mobileSharedSheetFooter");
      expect(footer?.querySelector(".venueActionCard")).toBeTruthy();
      const toolbar = footer?.querySelector('[role="toolbar"][aria-label="Venue actions"]');
      const names = Array.from(toolbar?.querySelectorAll("button") ?? [], (button) =>
        button.getAttribute("aria-label") ?? button.textContent?.trim());
      expect(names).toEqual(["Ask for a table at The Plan Door", "Summon mates to The Plan Door", "Share The Plan Door"]);
      expect(planControls()).toHaveLength(1);
      // Nothing that plans is left in the body above the footer.
      expect(host.querySelector(".mobileSharedSheetBody button")).toBeNull();
    }
  });
});

describe("desktop reads the same one door", () => {
  it("with no footer slot the card renders in place with the one door and no Stop 1 or Crawl ghosts", () => {
    const accept = vi.fn();
    const toggle = vi.fn();
    act(() => root.render(createElement(PhoneSheet, {
      initialMode: "build", initialBuiltIds: [OTHER_ID], onAcceptStop1: accept, onToggle: toggle, phone: false,
    })));
    expect(host.querySelector(".mapDrawer .venueActionCard")).toBeTruthy();
    expect(buttons().map((button) => button.textContent?.trim())).toEqual(["Plan stop", "Ask for a table", "Summon mates", "Share"]);
    expect(planControls()).toHaveLength(1);
    act(() => peekDoor().click());
    expect(toggle).toHaveBeenCalledWith(VENUE_ID);
    expect(accept).not.toHaveBeenCalled();
  });
});

describe("a pub with no fresh drinker price leads with Log what you paid", () => {
  it.each([true, false])("phone %s: the coral logs, and the plan door still plans as a ghost", (phone) => {
    const accept = vi.fn();
    const log = vi.fn();
    act(() => root.render(createElement(PhoneSheet, {
      initialMode: "suggest", initialBuiltIds: [], onAcceptStop1: accept, onLog: log, phone, drops: [drop(66, {
        confirmation: { confirmationId: "old-confirmed", confirmedAt: new Date(NOW).toISOString(), basis: "moderator" },
      })],
    })));

    const coral = host.querySelectorAll<HTMLButtonElement>(".mobileVenuePeekPlanDoor");
    expect(coral).toHaveLength(1);
    expect(coral[0]?.getAttribute("aria-label")).toBe("Log what you paid at The Plan Door");
    act(() => coral[0]?.click());
    expect(log).toHaveBeenCalledTimes(1);

    const toolbar = host.querySelector('[role="toolbar"][aria-label="Venue actions"]');
    const ghosts = Array.from(toolbar?.querySelectorAll("button") ?? []);
    expect(ghosts.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Make it Stop 1: The Plan Door",
      "Ask for a table at The Plan Door",
      "Summon mates to The Plan Door",
      "Share The Plan Door",
    ]);
    expect(planControls()).toHaveLength(1);
    act(() => ghosts[0]?.click());
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])("phone %s: a recent wine price keeps the plan door primary", (phone) => {
    const accept = vi.fn();
    const log = vi.fn();
    act(() => root.render(createElement(PhoneSheet, {
      initialMode: "suggest", initialBuiltIds: [], onAcceptStop1: accept, onLog: log, phone,
      drops: [drop(66)], communityPrices: [communityPrice(66), communityPrice(1, "wine")],
    })));
    expect(peekDoor().textContent).toBe("Make it Stop 1");
    expect(host.querySelector('[role="toolbar"] [data-plan-door]')).toBeNull();
    act(() => peekDoor().click());
    expect(accept).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("the ghost follows the crawl like the coral did", () => {
    const toggle = vi.fn();
    act(() => root.render(createElement(PhoneSheet, {
      initialMode: "build", initialBuiltIds: [OTHER_ID], onAcceptStop1: vi.fn(), onToggle: toggle, drops: [],
    })));
    const ghost = () => {
      const door = host.querySelector<HTMLButtonElement>('[role="toolbar"] [data-plan-door]');
      if (!door) throw new Error("the action row carries no plan door");
      return door;
    };
    expect(ghost().textContent).toBe("Plan stop");
    act(() => ghost().click());
    expect(toggle).toHaveBeenLastCalledWith(VENUE_ID);
    expect(ghost().textContent).toBe("In plan");
    expect(ghost().getAttribute("aria-pressed")).toBe("true");
    expect(planControls()).toHaveLength(1);
  });
});
