// @vitest-environment jsdom

// THE PHONE PUB SHEET HAS ONE PLAN DOOR, AND IT FOLLOWS THE CRAWL (owner
// decision, option C, 16 Oct 2026). No crawl in progress: the one coral door
// is `Make it Stop 1` and hands the pub to Plan. A crawl in progress: it is
// `Plan stop` / `In plan` and adds the pub to or takes it off the crawl on the
// map. In build mode the phone sheet shows that one door and nothing else
// that plans: the footer bar's Stop 1 and Crawl ghosts are desktop's alone.

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VenuePeekPlanDoor from "@/components/map/inspector/VenuePeekPlanDoor";
import VenueStickyBar from "@/components/map/inspector/VenueStickyBar";
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
 * The phone sheet as PubMap composes it: the peek's door plus the command bar
 * portalled into the sheet footer, over the same mode and built list. The
 * toggle is PubMap's own shape (components/PubMap.tsx, `toggleBuiltStop`):
 * a picked stop puts the map in build mode.
 */
function PhoneSheet({
  initialMode,
  initialBuiltIds,
  onAcceptStop1,
  onToggle,
}: {
  initialMode: CrawlMode;
  initialBuiltIds: string[];
  onAcceptStop1: () => void;
  onToggle?: (id: string) => void;
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
  return createElement(
    "div",
    null,
    createElement(
      "div",
      { className: "mobileVenuePeekSummary" },
      createElement(VenuePeekPlanDoor, {
        door: phoneVenuePlanDoor({ isPub: true, mode, builtIds, venueId: pub.id, canAcceptStop1: true }),
        venueId: pub.id,
        venueName: pub.name,
        onAcceptStop1,
        onToggleStop: toggle,
      }),
    ),
    createElement("div", { className: "mobileSharedSheetFooter", ref: setFooter }),
    footer
      ? createElement(
          SheetFooterContext.Provider,
          { value: footer },
          createElement(VenueStickyBar, {
            venue: pub,
            mode,
            inCrawl: builtIds.includes(pub.id),
            onToggleStop: toggle,
            onAcceptStop1,
            shareVenue: async () => {},
            currentShareFeedback: null,
          }),
        )
      : null,
  );
}

function buttons(): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll("button"));
}

function planControls(): HTMLButtonElement[] {
  return buttons().filter((button) =>
    /Stop 1|Plan stop|In plan|Crawl|Remove/.test(
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

  it("the phone footer bar keeps Share and no plan control, in either mode", () => {
    for (const mode of ["suggest", "build"] as const) {
      act(() => root.render(createElement(PhoneSheet, {
        key: mode, initialMode: mode, initialBuiltIds: [VENUE_ID], onAcceptStop1: vi.fn(),
      })));
      const footer = host.querySelector(".mobileSharedSheetFooter");
      const names = Array.from(footer?.querySelectorAll("button") ?? [], (button) =>
        button.getAttribute("aria-label") ?? button.textContent?.trim());
      expect(names).toEqual(["Share The Plan Door"]);
    }
  });
});

describe("desktop is unchanged", () => {
  it("outside the phone sheet the bar still carries the Stop 1 and Crawl ghosts beside Share", () => {
    const accept = vi.fn();
    const toggle = vi.fn();
    act(() => root.render(createElement(VenueStickyBar, {
      venue: venue(), mode: "build", inCrawl: false, onToggleStop: toggle,
      onAcceptStop1: accept, shareVenue: async () => {}, currentShareFeedback: null,
    })));
    expect(buttons().map((button) => button.textContent?.trim())).toEqual(["Make it Stop 1", "Crawl", "Share"]);
    act(() => buttons()[0]?.click());
    act(() => buttons()[1]?.click());
    expect(accept).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledWith(VENUE_ID);
  });
});
