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

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, handle: null, loading: false, configured: false }),
}));

import VenueActionCard from "@/components/map/inspector/VenueActionCard";
import VenueActionSummary from "@/components/map/inspector/VenueActionSummary";
import VenuePeekPlanDoor from "@/components/map/inspector/VenuePeekPlanDoor";
import { SheetFooterContext } from "@/components/mobile/sheetFooterContext";
import type { CrawlMode, Venue } from "@/lib/venues";
import { crawlInProgress, phoneVenuePlanDoor } from "@/lib/venuePlanDoor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VENUE_ID = "venue-plan-door";
const OTHER_ID = "venue-other-stop";

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
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
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
  phone = true,
}: {
  initialMode: CrawlMode;
  initialBuiltIds: string[];
  onAcceptStop1: () => void;
  onToggle?: (id: string) => void;
  phone?: boolean;
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
  const card = createElement(VenueActionCard, {
    venue: pub,
    summary: createElement(VenueActionSummary, {
      label: "The Plan Door summary",
      price: createElement("span", null, "£4.80"),
      walkMinutes: null,
      planDoor: createElement(VenuePeekPlanDoor, {
        door: phoneVenuePlanDoor({ isPub: true, mode, builtIds, venueId: pub.id, canAcceptStop1: true }),
        venueId: pub.id,
        venueName: pub.name,
        onAcceptStop1,
        onToggleStop: toggle,
      }),
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
    expect(peekDoor().getAttribute("aria-label")).toBe("Make The Plan Door Stop 1");
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

  it("the card in the phone footer holds the one door, Ask for a table and Share, in either mode", () => {
    for (const mode of ["suggest", "build"] as const) {
      act(() => root.render(createElement(PhoneSheet, {
        key: mode, initialMode: mode, initialBuiltIds: [VENUE_ID], onAcceptStop1: vi.fn(),
      })));
      const footer = host.querySelector(".mobileSharedSheetFooter");
      expect(footer?.querySelector(".venueActionCard")).toBeTruthy();
      const toolbar = footer?.querySelector('[role="toolbar"][aria-label="Venue actions"]');
      const names = Array.from(toolbar?.querySelectorAll("button") ?? [], (button) =>
        button.getAttribute("aria-label") ?? button.textContent?.trim());
      expect(names).toEqual(["Ask The Plan Door for a table", "Share The Plan Door"]);
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
    expect(buttons().map((button) => button.textContent?.trim())).toEqual(["Plan stop", "Ask for a table", "Share"]);
    expect(planControls()).toHaveLength(1);
    act(() => peekDoor().click());
    expect(toggle).toHaveBeenCalledWith(VENUE_ID);
    expect(accept).not.toHaveBeenCalled();
  });
});
