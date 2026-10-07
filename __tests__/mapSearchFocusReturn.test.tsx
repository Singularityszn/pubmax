// @vitest-environment jsdom

import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MapSearchIndex } from "@/lib/mapSearchIndex";
import { FOCUS_TRAP_EXEMPT_ATTRIBUTE, useFocusTrap } from "@/lib/useFocusTrap";
import type { Venue } from "@/lib/venues";

// QA journeys T1. Closing the pub drawer hands focus back to the toolbar search
// field, and the stale suggestions list reopened over the map with it. The list
// opens on typing or a click, never on a focus the drawer returns.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const SEARCH_INDEX = { cities: [], venues: [] } satisfies MapSearchIndex;

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/mapSearchIndexLoader", () => ({
  loadMapSearchIndex: vi.fn(() => Promise.resolve(SEARCH_INDEX)),
}));

import MapSearchSuggest from "@/components/map/MapSearchSuggest";

const VENUE = {
  id: "venue-princess-louise",
  name: "Princess Louise",
  kind: "pub",
  latitude: 51.5175,
  longitude: -0.1197,
  primaryBorough: "Camden",
  cheapestPrice: 6.5,
  latestContributorPrice: null,
} as Venue;

type Surface = "drawer" | "planner" | null;

/**
 * The desktop map's shape: a live toolbar (search and Plan) beside a pub
 * drawer that traps focus and returns it to the search field when it closes.
 */
function DesktopMap() {
  const [query, setQuery] = useState("Princess");
  const [surface, setSurface] = useState<Surface>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const originRef = useRef<HTMLElement | null>(null);
  useFocusTrap(surface === "drawer", drawerRef, "map-surface", originRef);
  return (
    <div>
      <div className="mapToolbar" {...{ [FOCUS_TRAP_EXEMPT_ATTRIBUTE]: "" }}>
        <MapSearchSuggest
          id="mapSearchInput"
          mode="toolbar"
          cityId="london"
          query={query}
          onQueryChange={setQuery}
          venues={[VENUE]}
          localities={[]}
          userLocation={null}
          mapCenter={[-0.1276, 51.5072]}
          placeholder="Search the map"
          onSelectVenue={() => {
            originRef.current = document.getElementById("mapSearchInput");
            setSurface("drawer");
          }}
          onFlyToArea={() => undefined}
        />
        <button type="button" className="planBtn" onClick={() => setSurface("planner")}>
          Plan an outing
        </button>
      </div>
      {surface === "drawer" ? (
        <aside ref={drawerRef} className="mapDrawer right open">
          <button type="button" aria-label="Close" onClick={() => setSurface(null)}>
            X
          </button>
        </aside>
      ) : null}
      {surface === "planner" ? <aside className="mapDrawer left open">Planner</aside> : null}
    </div>
  );
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
  vi.clearAllMocks();
});

async function settle(action: () => void = () => undefined) {
  await act(async () => {
    action();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function search(): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>("#mapSearchInput");
  if (!input) throw new Error("search field missing");
  return input;
}

function listbox(): HTMLElement | null {
  return host.querySelector<HTMLElement>('[role="listbox"]');
}

function button(selector: string): HTMLButtonElement {
  const node = host.querySelector<HTMLButtonElement>(selector);
  if (!node) throw new Error(`${selector} missing`);
  return node;
}

function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setValue?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Search for a pub and pick it, so a drawer opens over a stale query. */
async function openDrawerFromSearch() {
  await settle(() => root.render(createElement(DesktopMap)));
  await settle(() => {
    search().focus();
    search().click();
  });
  const option = host.querySelector<HTMLElement>(
    '[role="option"][data-venue-id="venue-princess-louise"]',
  );
  expect(option).not.toBeNull();
  await settle(() => option!.click());
  expect(host.querySelector(".mapDrawer.right.open")).not.toBeNull();
  expect(listbox()).toBeNull();
}

describe("toolbar search after the pub drawer closes", () => {
  it("returns focus without the suggestions when the drawer closes with X", async () => {
    await openDrawerFromSearch();

    await settle(() => button('[aria-label="Close"]').click());

    expect(host.querySelector(".mapDrawer.right.open")).toBeNull();
    expect(document.activeElement).toBe(search());
    expect(search().value).toBe("Princess");
    expect(search().getAttribute("aria-expanded")).toBe("false");
    expect(listbox()).toBeNull();

    // An explicit click on the field still opens the list.
    await settle(() => search().click());
    expect(listbox()).not.toBeNull();
    expect(search().getAttribute("aria-expanded")).toBe("true");
  });

  it("returns focus without the suggestions when Plan replaces the drawer", async () => {
    await openDrawerFromSearch();

    await settle(() => button(".planBtn").click());

    expect(host.querySelector(".mapDrawer.right.open")).toBeNull();
    expect(host.querySelector(".mapDrawer.left.open")).not.toBeNull();
    expect(document.activeElement).toBe(search());
    expect(search().getAttribute("aria-expanded")).toBe("false");
    expect(listbox()).toBeNull();

    // Typing still opens the list.
    await settle(() => type(search(), "Princess L"));
    expect(listbox()).not.toBeNull();
    expect(search().getAttribute("aria-expanded")).toBe("true");
  });
});
