// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapSearchSuggest from "@/components/map/MapSearchSuggest";
import { useMapKeyboardShortcuts } from "@/components/map/pubmap/useMapKeyboardShortcuts";
import { dispatchDismissKey } from "@/lib/nativeBackGesture";
import type { Venue } from "@/lib/venues";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/mapSearchIndexLoader", () => ({
  loadMapSearchIndex: vi.fn(() => Promise.resolve({ cities: [], venues: [] })),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const noop = () => undefined;
const venue = {
  id: "venue-princess-louise",
  name: "Princess Louise",
  kind: "pub",
  latitude: 51.5175,
  longitude: -0.1197,
  primaryBorough: "Camden",
  cheapestPrice: 6.5,
  latestContributorPrice: null,
} as Venue;

function SearchBesideDrawer() {
  const [query, setQuery] = useState("Princess");
  const [drawerOpen, setDrawerOpen] = useState(true);
  useMapKeyboardShortcuts({
    mobileViewport: false,
    planningOpen: false,
    selectedVenueId: drawerOpen ? venue.id : null,
    onBack: () => setDrawerOpen(false),
    onInterruptReveal: noop,
    logIntentFallbackVisible: false,
    dismissLogIntent: noop,
  });
  return (
    <div>
      <MapSearchSuggest
        id="mapSearchInput"
        mode="toolbar"
        cityId="london"
        query={query}
        onQueryChange={setQuery}
        venues={[venue]}
        localities={[]}
        userLocation={null}
        mapCenter={[-0.1276, 51.5072]}
        placeholder="Search the map"
        onSelectVenue={noop}
        onFlyToArea={noop}
      />
      {drawerOpen ? <aside className="mapDrawer right open">Selected pub</aside> : null}
    </div>
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<SearchBesideDrawer />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

function control<T extends HTMLElement>(selector: string): T {
  const element = host.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}

async function focusSearchClose() {
  const input = control<HTMLInputElement>("#mapSearchInput");
  await act(async () => { input.focus(); input.click(); });
  expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  const close = control<HTMLButtonElement>('[aria-label="Close search results"]');
  // Moving keyboard focus to this internal control must not blur-close the
  // popup and make its missing Escape ownership look like a successful exit.
  await act(async () => close.focus());
  expect(document.activeElement).toBe(close);
  expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  return { input, close };
}

function expectSearchOnlyClosed(input: HTMLInputElement) {
  expect(host.querySelector('[role="listbox"]')).toBeNull();
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(input.value).toBe("Princess");
  expect(document.activeElement).toBe(input);
  expect(host.querySelector(".mapDrawer.right.open")).not.toBeNull();
}

describe("toolbar search owns Escape throughout its popup", () => {
  it("closes only results when the Close button has keyboard focus", async () => {
    const { input, close } = await focusSearchClose();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => close.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expectSearchOnlyClosed(input);
  });

  it("native window Back closes results before the selected pub drawer", async () => {
    const { input } = await focusSearchClose();
    let consumed = false;
    await act(async () => { consumed = dispatchDismissKey(); });
    expect(consumed).toBe(true);
    expectSearchOnlyClosed(input);
  });
});
