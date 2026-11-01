// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  it("opens the venue sheet through the pin tap's handler, and a base pub through the base pin's", () => {
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
    });
    act(() => rows()[1]!.click());
    expect(onSelectVenue).toHaveBeenCalledWith("venue-crown");
    const base = rows().find((row) => row.dataset.venueId === BASE_PUB.id)!;
    expect(base.querySelector(".mapSplitListRowTrust")?.textContent).toBe("Other pub · no listed price");
    act(() => base.click());
    expect(onSelectUkBasePub).toHaveBeenCalledWith(BASE_PUB);
    expect(onSelectVenue).toHaveBeenCalledTimes(1);
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
    expect(focusMapSplitList()).toBe(true);
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
      rows()[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(document.activeElement).toBe(rows()[0]);
  });

  it("draws a page of rows and reveals the next on request, focusing the first new one", () => {
    const many = Array.from({ length: 45 }, (_, index) => venue(`venue-${index}`, `Pub ${String(index).padStart(2, "0")}`, 4 + index / 100));
    render({ visibleVenues: many, filteredVenues: many });
    expect(rows()).toHaveLength(40);
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

describe("where the list sits", () => {
  const css = readFileSync(join(process.cwd(), "components/map/mapSplitList.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const desktopBlock = css.slice(css.indexOf("@media (min-width: 1024px) {"));

  it("lays the column out from 1024px only, and draws nothing narrower", () => {
    expect(css).toMatch(/^\s*\.mapSplitList \{\s*display: none;\s*\}/);
    expect(desktopBlock).toMatch(/\.mapSplitList \{[^}]*display: flex;[^}]*width: var\(--desktop-split-list-width\);/);
  });

  it("starts the map stage and the left drawers at the column's right edge, so nothing lies over the list", () => {
    expect(desktopBlock).toMatch(/\.appShell:has\(> \.mapSplitList\) > \.mapStage \{\s*left: var\(--desktop-split-list-width\);/);
    expect(desktopBlock).toMatch(/\.appShell:has\(> \.mapSplitList\) > \.mapDrawer\.left \{\s*left: var\(--desktop-split-list-width\);/);
    // The bar spans the map lane, set on the stage so the floating site nav,
    // which reads the same figure from the shell, still spans the window.
    // Centred on the lane with the nav's own gutter on both sides, so its
    // right edge is the floating nav's right edge.
    expect(desktopBlock).toMatch(/> \.mapStage \{[^}]*--split-nav-gutter: calc\(\(100vw - min\(1240px, 100vw - 32px\)\) \/ 2\);/);
    expect(desktopBlock).toMatch(/> \.mapStage \{[^}]*--desktop-map-surface-width: calc\(\s*100vw - var\(--desktop-split-list-width\) - 2 \* var\(--split-nav-gutter\)\s*\);/);
    expect(desktopBlock).not.toMatch(/\.appShell:has\(> \.mapSplitList\) \{[^}]*--desktop-map-surface-width/);
    // The venue drawer narrows so a strip of map stays between it and the list.
    expect(desktopBlock).toMatch(/--desktop-venue-drawer-width: clamp\(\s*376px,\s*min\(46vw, calc\(100vw - var\(--desktop-split-list-width\) - 248px\)\),\s*640px\s*\)/);
  });

  it("declares the width on :root, where the document's opening prices can read it too", () => {
    const globals = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    // 0px below 1024px, so a reader needs no fallback (__tests__/tokenDebt.test.ts).
    expect(globals).toMatch(/^:root \{\s*--desktop-split-list-width: 0px;\s*\}/m);
    expect(globals).toMatch(/@media \(min-width: 1024px\) \{[\s\S]*?:root \{\s*--desktop-split-list-width: clamp\(400px, 30vw, 440px\);/);
    const preview = readFileSync(join(process.cwd(), "components/map/mapOpeningPreview.css"), "utf8");
    expect(preview).toMatch(/@media \(min-width: 1024px\) \{\s*\.mapOpeningPreview \{\s*left: var\(--desktop-split-list-width\);/);
  });
});

describe("the map shell's wiring", () => {
  const source = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");
  const splitList = source.slice(
    source.indexOf("function renderDesktopSplitList()"),
    source.indexOf("/* Desktop reader controls."),
  );

  it("opens a row's venue through the handler a pin tap uses", () => {
    expect(source).toMatch(/onVenueClick=\{handleVenueClick\}/);
    expect(splitList).toMatch(/onSelectVenue=\{handleVenueClick\}/);
    expect(splitList).toMatch(/onSelectUkBasePub=\{handleUkBasePubClick\}/);
    expect(source).toMatch(/onUkBasePubClick=\{handleUkBasePubClick\}/);
  });

  it("lists the map's own projected membership and mounts only from 1024px with a live canvas", () => {
    expect(splitList).toMatch(/visibleVenues=\{mapVenueListVenues\}/);
    expect(splitList).toMatch(/railViewport && !mapCanvasErrored && !mapCanvasUnavailable/);
    expect(source).toMatch(/onListOpenChange=\{railViewport \? focusMapSplitList : setMapListOpen\}/);
  });
});
