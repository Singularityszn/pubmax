// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapSplitList, { type MapSplitListMap } from "@/components/map/MapSplitList";
import { MAP_SPLIT_LIST_DEBOUNCE_MS } from "@/lib/mapSplitList";
import { MAP_SPLIT_LIST_ID, focusMapSplitList } from "@/lib/mapSplitListFocus";
import { FOCUS_TRAP_EXEMPT_ATTRIBUTE } from "@/lib/useFocusTrap";
import type { UkBasePub } from "@/lib/ukBasePubs";
import type { Venue } from "@/lib/venues";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof MapSplitList>;

function venue(id: string, name: string, cheapestPrice: number | null, longitude = -0.13): Venue {
  return {
    id,
    name,
    latitude: 51.513,
    longitude,
    cheapestPrice,
    prices: [],
    primaryBorough: "Westminster",
    amenities: {},
    ...(cheapestPrice !== null ? { priceSource: "greeneking.co.uk", priceObservedAt: "2026-10-20" } : {}),
  } as unknown as Venue;
}

const CROWN = venue("venue-crown", "The Crown", 5.4);
const ANCHOR = venue("venue-anchor", "The Anchor", 4.2, -0.131);
const LAMB = venue("venue-lamb", "The Lamb", 6.1, -0.129);
const BASE_PUB = { id: "venue-uk-n1", name: "The Unlisted", lng: -0.132, lat: 51.513 } as UkBasePub;

const EMPTY_BASE: Props["ukBaseModel"] = { rows: [], total: 0, shown: 0, truncated: false };
const EMPTY_RESTAURANTS: Props["restaurantModel"] = { rows: [], total: 0, shown: 0, truncated: false };

/** A stand-in for the live MapLibre map: a container and a projection. */
function fakeMap() {
  const container = document.createElement("div");
  const handlers = new Map<string, Set<() => void>>();
  const map = {
    getContainer: () => container,
    project: ([lng, lat]: [number, number]) => ({ x: Math.round((lng + 0.14) * 10_000), y: Math.round((51.52 - lat) * 10_000) }),
    on: (type: string, handler: () => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
      return map;
    },
    off: (type: string, handler: () => void) => {
      handlers.get(type)?.delete(handler);
      return map;
    },
  };
  return {
    map: map as unknown as MapSplitListMap,
    container,
    halo: () => container.querySelector<HTMLElement>(".mapSplitListHalo"),
    listening: (type: string) => handlers.get(type)?.size ?? 0,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T12:00:00.000Z"));
  // A 1440px desktop: the only width PubMap mounts the list at.
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: /min-width:\s*1024px/.test(query),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function props(overrides: Partial<Props> = {}): Props {
  return {
    cityName: "London",
    visibleVenues: [CROWN, ANCHOR],
    filteredVenues: [CROWN, ANCHOR, LAMB],
    ukBaseModel: EMPTY_BASE,
    restaurantModel: EMPTY_RESTAURANTS,
    dropSignals: new Map(),
    viewportCenter: [-0.13, 51.513],
    reader: null,
    loaded: true,
    viewLanding: false,
    map: null,
    onSelectVenue: () => {},
    onSelectUkBasePub: () => {},
    onPrefetchVenue: () => {},
    ...overrides,
  };
}

function render(overrides: Partial<Props> = {}) {
  act(() => root.render(createElement(MapSplitList, props(overrides))));
}

const rows = () => Array.from(host.querySelectorAll<HTMLButtonElement>("[data-split-row]"));
const rowNames = () => rows().map((row) => row.querySelector(".mapSplitListRowName")?.textContent);
const status = () => host.querySelector(".mapSplitListCount")?.textContent;

function button(name: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!found) throw new Error(`no ${name} button`);
  return found;
}

function pointer(target: Element, type: "pointerover" | "pointerout") {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: document.body }));
  });
}

describe("the list beside the map, at desktop width", () => {
  it("shows the French House anchor item, source and full read date without a pint band", () => {
    const french = { ...venue("venue-1kpe609", "The French House", 3.4), kind: "bar" as const,
      anchorLabel: "Half pint house lager", anchorObservedAt: "2026-07-26",
      anchorSourceUrl: "https://www.frenchhousesoho.com/" };
    const onSelectVenue = vi.fn();
    render({ visibleVenues: [french, CROWN], filteredVenues: [french, CROWN], onSelectVenue });
    expect(rowNames()).toEqual(["The Crown", "The French House"]);
    const row = rows()[1]!;
    expect(row.textContent).toContain("Half pint house lager");
    expect(row.textContent).toContain("£3.40");
    expect(row.textContent).toContain("frenchhousesoho.com");
    expect(row.textContent).toContain("26 Jul 2026");
    expect(row.querySelector(".price-plaque, [class*=price-band], [class*=priceBand]")).toBeNull();
    expect(row.querySelector("a, button")).toBeNull();
    act(() => { row.focus(); row.click(); });
    expect(onSelectVenue).toHaveBeenCalledWith("venue-1kpe609");
  });

  it.each(["2026-07", "2026", "2026-02-30", "2027-01-01"])(
    "does not invent an anchor read day from %s", (date) => {
      const bar = { ...venue("bar-date", "Bar", 4), kind: "bar" as const,
        anchorLabel: "House cocktail", anchorObservedAt: date,
        anchorSourceUrl: "https://example.com/menu" };
      render({ visibleVenues: [bar], filteredVenues: [bar] });
      expect(rows()[0]?.textContent).toContain("Read date unavailable");
      expect(rows()[0]?.textContent).not.toMatch(/read \d/);
    },
  );

  it("keeps a selected drink lens price and its own caption on an anchor venue", () => {
    const bar = { ...venue("bar-lens", "Bar", 4), kind: "bar" as const,
      anchorLabel: "House cocktail", anchorObservedAt: "2026-07-26",
      anchorSourceUrl: "https://example.com/menu" };
    render({ visibleVenues: [bar], filteredVenues: [bar], lensNoun: "Wine", lensPrices: new Map([
      [bar.id, { venueId: bar.id, category: "wine", categoryLabel: "House wine", priceGbp: 6.4,
        observedAt: "2026-10-28", source: "community" }],
    ]) });
    const row = rows()[0]!;
    expect(row.textContent).toContain("£6.40");
    expect(row.textContent).toContain("House wine");
    expect(row.textContent).not.toContain("House cocktail");
    expect(row.textContent).not.toContain("example.com");
  });

  it("names missing anchor evidence without changing ordinary price rows", () => {
    const bar = { ...venue("bar-no-source", "Bar", 4), kind: "bar" as const, anchorLabel: "House cocktail" };
    render({ visibleVenues: [bar, CROWN], filteredVenues: [bar, CROWN] });
    const ordinary = rows().find((row) => row.textContent?.includes("The Crown"))!;
    const anchor = rows().find((row) => row.textContent?.includes("House cocktail"))!;
    expect(anchor.textContent).toContain("Read date not recorded");
    expect(anchor.textContent).toContain("Publisher not recorded");
    expect(anchor.querySelector(".price-plaque")).toBeNull();
    expect(ordinary.querySelector(".price-plaque")?.textContent).toBe("£5.40");
  });

  it("lists the venues in view, cheapest first, with the sheet's price, its words and its day", () => {
    render();
    const list = host.querySelector(`#${MAP_SPLIT_LIST_ID}`);
    expect(list?.getAttribute("aria-label")).toBe("London pubs in this view");
    expect(list?.hasAttribute(FOCUS_TRAP_EXEMPT_ATTRIBUTE)).toBe(true);
    expect(host.querySelector(".mapSplitListTitle")?.textContent).toBe("Pubs in this view");
    expect(status()).toBe("2 places, cheapest first");
    expect(rowNames()).toEqual(["The Anchor", "The Crown"]);

    const first = rows()[0]!;
    expect(first.querySelector(".price-plaque")?.textContent).toBe("£4.20");
    expect(first.querySelector(".mapSplitListRowTrust")?.textContent).toBe(
      "On record · greeneking.co.uk · read 20 Oct",
    );
    expect(first.querySelector(".mapSplitListRowFacts")?.textContent).toBe("Westminster");
    expect(button("Cheapest").getAttribute("aria-pressed")).toBe("true");
    const follow = host.querySelector<HTMLInputElement>(".mapSplitListFollow input");
    expect(follow?.checked).toBe(true);
    expect(follow?.closest("label")?.textContent).toBe("Search as I move the map");
  });

  it("gives a walk time only when the map knows where the reader is", () => {
    render();
    expect(host.querySelector(".mapSplitListRowWalk")).toBeNull();
    render({ reader: { lng: -0.13, lat: 51.513 } });
    expect(host.querySelector(".mapSplitListRowWalk")?.textContent).toBe("1 min walk");
    expect(status()).toBe("2 places, cheapest first");
    act(() => button("Nearest").click());
    expect(status()).toBe("2 places, nearest you first");
    expect(rowNames()).toEqual(["The Crown", "The Anchor"]);
  });

  it("re-reads the view only once the map has settled", () => {
    render();
    render({ visibleVenues: [LAMB] });
    expect(rowNames()).toEqual(["The Anchor", "The Crown"]);
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS - 1));
    expect(rowNames()).toEqual(["The Anchor", "The Crown"]);
    act(() => vi.advanceTimersByTime(1));
    expect(rowNames()).toEqual(["The Lamb"]);
  });

  it("holds its rows while the pointer is over the list, so a click opens the row it pressed", () => {
    const onSelectVenue = vi.fn();
    render({ onSelectVenue });
    const list = host.querySelector(".mapSplitList")!;
    pointer(list, "pointerover");

    // Pubs keep arriving as the map streams in more of the view.
    const boot = venue("venue-boot", "The Boot", 3.9);
    render({ onSelectVenue, visibleVenues: [CROWN, ANCHOR, boot] });
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(rowNames()).toEqual(["The Anchor", "The Crown"]);
    act(() => rows()[1]!.click());
    expect(onSelectVenue).toHaveBeenLastCalledWith("venue-crown");

    pointer(list, "pointerout");
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(rowNames()).toEqual(["The Boot", "The Anchor", "The Crown"]);
  });

  it("holds a row's price and position when Pint Drops arrive during a press", () => {
    const onSelectVenue = vi.fn();
    render({ onSelectVenue });
    const list = host.querySelector(".mapSplitList")!;
    pointer(list, "pointerover");
    const pressed = rows()[1]!;
    act(() => pressed.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    render({ onSelectVenue, dropSignals: new Map([[CROWN.id, {
      hasPintDrops: true,
      latestContributorPrice: 3.5,
      latestContributorAt: Date.now(),
      pintTrust: "corroborated",
    }]]) });
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(rowNames()).toEqual(["The Anchor", "The Crown"]);
    expect(pressed.querySelector(".price-plaque")?.textContent).toBe("£5.40");
    act(() => pressed.click());
    expect(onSelectVenue).toHaveBeenLastCalledWith(CROWN.id);

    pointer(list, "pointerout");
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS - 1));
    expect(rowNames()).toEqual(["The Anchor", "The Crown"]);
    act(() => vi.advanceTimersByTime(1));
    expect(rowNames()).toEqual(["The Crown", "The Anchor"]);
    expect(rows()[0]?.querySelector(".price-plaque")?.textContent).toBe("£3.50");
  });

  it.each([false, true])("lets results arrive under the pointer when an empty list has loaded=%s", (loaded) => {
    render({ visibleVenues: [], loaded });
    const list = host.querySelector(".mapSplitList")!;
    pointer(list, "pointerover");
    render({ visibleVenues: [CROWN], loaded: true });
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(rowNames()).toEqual(["The Crown"]);
    expect(status()).toBe("1 place, cheapest first");
    expect(host.querySelector(".mapSplitListEmpty")).toBeNull();
  });

  it("is busy until its rows are the settled view, then ready", () => {
    const busy = () => host.querySelector(".mapSplitList")?.getAttribute("aria-busy");
    render({ visibleVenues: [ANCHOR], viewLanding: true });
    expect(busy()).toBe("true");
    render({ visibleVenues: [CROWN, ANCHOR], viewLanding: false });
    expect(busy()).toBe("true");
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(busy()).toBe("false");

    const list = host.querySelector(".mapSplitList")!;
    pointer(list, "pointerover");
    render({ visibleVenues: [LAMB] });
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(rowNames()).toEqual(["The Anchor", "The Crown"]);
    expect(busy()).toBe("true");
    pointer(list, "pointerout");
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(rowNames()).toEqual(["The Lamb"]);
    expect(busy()).toBe("false");
  });

  it("does not hold selectable rows while the list is loading", () => {
    render();
    const list = host.querySelector(".mapSplitList")!;
    pointer(list, "pointerover");
    render({ visibleVenues: [LAMB], loaded: false });
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(rowNames()).toEqual(["The Lamb"]);
  });

  it("holds lens captions and walk times but applies both sort controls while pointing", () => {
    render();
    const list = host.querySelector(".mapSplitList")!;
    pointer(list, "pointerover");
    render({ reader: { lng: -0.13, lat: 51.513 }, lensNoun: "Wine", lensStatus: "partial", lensPrices: new Map([
      [CROWN.id, { venueId: CROWN.id, category: "wine", categoryLabel: "House wine", priceGbp: 6.4,
        observedAt: "2026-10-28", source: "community" }],
      [ANCHOR.id, { venueId: ANCHOR.id, category: "wine", categoryLabel: "House wine", priceGbp: 4.8,
        observedAt: "2026-10-28", source: "community" }],
    ]) });
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(rowNames()).toEqual(["The Anchor", "The Crown"]);
    expect(rows()[0]?.querySelector(".price-plaque")?.textContent).toBe("£4.20");
    expect(rows()[0]?.textContent).not.toContain("House wine");
    expect(host.querySelector(".mapSplitListRowWalk")).toBeNull();
    expect(host.querySelector(".mapSplitListNote")).toBeNull();
    act(() => button("Nearest").click());
    expect(rowNames()).toEqual(["The Crown", "The Anchor"]);
    expect(rows()[0]?.textContent).toContain("House wine");
    expect(host.querySelector(".mapSplitListRowWalk")).not.toBeNull();
    expect(host.querySelector(".mapSplitListNote")).not.toBeNull();
    act(() => button("Cheapest").click());
    expect(rowNames()).toEqual(["The Anchor", "The Crown"]);
  });

  it("applies the follow toggle and a requested search during pointer holds", () => {
    render();
    const list = host.querySelector(".mapSplitList")!;
    pointer(list, "pointerover");
    const follow = host.querySelector<HTMLInputElement>(".mapSplitListFollow input")!;
    act(() => follow.click());
    render({ visibleVenues: [LAMB] });
    pointer(list, "pointerout");
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(rowNames()).toEqual(["The Anchor", "The Crown"]);
    pointer(list, "pointerover");
    act(() => button("Show pubs in this view").click());
    expect(rowNames()).toEqual(["The Lamb"]);
    render();
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(rowNames()).toEqual(["The Lamb"]);
    act(() => follow.click());
    expect(rowNames()).toEqual(["The Anchor", "The Crown"]);
  });

  it("holds the search button's presence during a press until the pointer leaves and settles", () => {
    const onSelectVenue = vi.fn();
    render({ onSelectVenue });
    const list = host.querySelector(".mapSplitList")!;
    const follow = host.querySelector<HTMLInputElement>(".mapSplitListFollow input")!;
    act(() => follow.click());
    pointer(list, "pointerover");
    const pressed = rows()[1]!;
    act(() => pressed.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));

    render({ onSelectVenue, visibleVenues: [CROWN, ANCHOR, LAMB] });
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(host.querySelector(".mapSplitListSearchHere")).toBeNull();
    expect(rowNames()).toEqual(["The Anchor", "The Crown"]);
    act(() => pressed.click());
    expect(onSelectVenue).toHaveBeenLastCalledWith(CROWN.id);

    pointer(list, "pointerout");
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS - 1));
    expect(host.querySelector(".mapSplitListSearchHere")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(button("Show pubs in this view")).toBeDefined();

    pointer(list, "pointerover");
    render({ onSelectVenue });
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(button("Show pubs in this view")).toBeDefined();
    pointer(list, "pointerout");
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS - 1));
    expect(button("Show pubs in this view")).toBeDefined();
    act(() => vi.advanceTimersByTime(1));
    expect(host.querySelector(".mapSplitListSearchHere")).toBeNull();
  });

  it("shows only projected venues and removes a departed venue's pin halo", () => {
    const fake = fakeMap();
    render({ map: fake.map });
    expect(rowNames()).toEqual(["The Anchor", "The Crown"]);
    act(() => rows()[0]!.focus());
    expect(fake.halo()?.hidden).toBe(false);

    render({ map: fake.map, visibleVenues: [LAMB] });
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(rowNames()).toEqual(["The Lamb"]);
    expect(fake.halo()?.hidden).toBe(true);
    act(() => { focusMapSplitList(); });
    expect(document.activeElement).toBe(rows()[0]);
  });

  it("holds the searched view while Search as I move the map is off, and searches the new view on request", () => {
    render();
    const follow = host.querySelector<HTMLInputElement>(".mapSplitListFollow input")!;
    act(() => follow.click());
    expect(follow.checked).toBe(false);

    render({ visibleVenues: [LAMB] });
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(rowNames()).toEqual(["The Anchor", "The Crown"]);
    expect(status()).toBe("2 places from your last search, cheapest first");

    act(() => button("Show pubs in this view").click());
    expect(rowNames()).toEqual(["The Lamb"]);
    expect(host.querySelector(".mapSplitListSearchHere")).toBeNull();

    // A filter that takes a held pub off the map takes it off the list too.
    render({ visibleVenues: [CROWN], filteredVenues: [CROWN] });
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(rowNames()).toEqual([]);

    act(() => follow.click());
    expect(follow.checked).toBe(true);
    expect(rowNames()).toEqual(["The Crown"]);
  });

  it("selects listed venues and restaurants by id, and unlisted pubs by their base record", () => {
    const onSelectVenue = vi.fn();
    const onSelectUkBasePub = vi.fn();
    render({
      onSelectVenue,
      onSelectUkBasePub,
      ukBaseModel: {
        rows: [{ id: BASE_PUB.id, name: BASE_PUB.name, priceLabel: "Other pub · no listed price", pub: BASE_PUB }],
        total: 1,
        shown: 1,
        truncated: false,
      },
      restaurantModel: {
        rows: [{ id: "restaurant-kitchen", name: "The Kitchen", priceLabel: "Restaurant · no listed price", lng: -0.13, lat: 51.513 }],
        total: 1,
        shown: 1,
        truncated: false,
      },
    });
    act(() => rows()[1]!.click());
    expect(onSelectVenue).toHaveBeenCalledWith("venue-crown");
    const base = rows().find((row) => row.dataset.venueId === BASE_PUB.id)!;
    expect(base.querySelector(".mapSplitListRowTrust")?.textContent).toBe("Other pub · no listed price");
    act(() => base.click());
    expect(onSelectUkBasePub).toHaveBeenCalledWith(BASE_PUB);
    expect(onSelectVenue).toHaveBeenCalledTimes(1);
    const restaurant = rows().find((row) => row.dataset.venueId === "restaurant-kitchen")!;
    expect(restaurant.textContent).toContain("Restaurant · no listed price");
    act(() => restaurant.click());
    expect(onSelectVenue).toHaveBeenLastCalledWith("restaurant-kitchen");
    expect(onSelectUkBasePub).toHaveBeenCalledTimes(1);
  });

  it("rings the row's pin while the reader points at the row, and lets go after", () => {
    const fake = fakeMap();
    const onPrefetchVenue = vi.fn();
    render({ map: fake.map, onPrefetchVenue });
    const halo = fake.halo();
    expect(halo?.hidden).toBe(true);
    expect(halo?.getAttribute("aria-hidden")).toBe("true");
    expect(fake.listening("move")).toBe(1);

    const anchor = rows()[0]!;
    pointer(anchor, "pointerover");
    expect(halo?.hidden).toBe(false);
    expect(halo?.style.transform).toBe("translate(90px, 70px)");
    expect(onPrefetchVenue).toHaveBeenCalledWith("venue-anchor");

    pointer(anchor, "pointerout");
    expect(halo?.hidden).toBe(true);

    // Keyboard focus rings the pin too.
    act(() => rows()[1]!.focus());
    expect(halo?.hidden).toBe(false);
    expect(halo?.style.transform).toBe("translate(100px, 70px)");

    act(() => root.unmount());
    expect(fake.halo()).toBeNull();
    expect(fake.listening("move")).toBe(0);
    root = createRoot(host);
  });

  it("is one tab stop, moved with the arrow keys, and Layers' List view hands focus to it", () => {
    render({ visibleVenues: [CROWN, ANCHOR, LAMB] });
    expect(rows().map((row) => row.tabIndex)).toEqual([0, -1, -1]);
    let focused = false;
    act(() => { focused = focusMapSplitList(); });
    expect(focused).toBe(true);
    expect(document.activeElement).toBe(rows()[0]);

    act(() => {
      rows()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(rows()[1]);
    expect(rows().map((row) => row.tabIndex)).toEqual([-1, 0, -1]);

    act(() => {
      rows()[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(document.activeElement).toBe(rows()[2]);
    act(() => {
      rows()[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(rows()[2]);
    act(() => {
      rows()[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(document.activeElement).toBe(rows()[1]);
    act(() => { focusMapSplitList(); });
    expect(document.activeElement).toBe(rows()[1]);
    act(() => {
      rows()[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(document.activeElement).toBe(rows()[0]);
    act(() => {
      rows()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(document.activeElement).toBe(rows()[0]);
  });

  it("draws a page of rows and reveals the next on request, focusing the first new one", () => {
    const many = Array.from({ length: 45 }, (_, index) => venue(`venue-${index}`, `Pub ${String(index).padStart(2, "0")}`, 4 + index / 100));
    render({ visibleVenues: many, filteredVenues: many });
    pointer(host.querySelector(".mapSplitList")!, "pointerover");
    expect(rows()).toHaveLength(40);
    render({ visibleVenues: [LAMB], filteredVenues: [LAMB] });
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    act(() => button("Show 5 more").click());
    expect(rows()).toHaveLength(45);
    expect(document.activeElement).toBe(rows()[40]);
  });

  it("says when nothing is in view, and waits honestly while the view is still being read", () => {
    render({ visibleVenues: [], loaded: false });
    expect(status()).toBe("Counting them up…");
    expect(host.querySelector(".mapSplitListEmpty")).toBeNull();
    render({ visibleVenues: [], loaded: true });
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expect(status()).toBe("Nothing in view");
    expect(host.querySelector(".mapSplitListEmpty")?.textContent).toMatch(/^Nothing in view fits that/);
  });
});
