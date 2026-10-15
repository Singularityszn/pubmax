// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import MobileMapShell from "@/components/mobile/MobileMapShell";
import { EMPTY_MAP_SURFACE_STATE, useMapSurfaceNavigation } from "@/components/map/pubmap/useMapSurfaceNavigation";
import { readMapSurfaceHistory } from "@/lib/mapSurfaceHistory";
import type { MapOverlay } from "@/lib/mobileShell";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/mapSearchIndexLoader", () => ({ loadMapSearchIndex: async () => ({ cities: [], venues: [] }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const noop = () => undefined;

function Journey({ limited }: { limited: boolean }) {
  const [overlay, setOverlay] = useState<MapOverlay>("none");
  const [query, setQuery] = useState("Blackfriar");
  const trail = useMapSurfaceNavigation({
    arrivalSearch: "", surfaceId: overlay, surfaceTitle: overlay === "search" ? "Search" : "Drink choices",
    surfaceState: EMPTY_MAP_SURFACE_STATE, selectionHint: "",
    onRestore: (entry) => setOverlay((entry?.id ?? "none") as MapOverlay),
    onHome: () => setOverlay("none"), onSurfaceClose: noop,
  });
  return <>
    <output data-query>{query}</output>
    <output data-back>{trail.backLabel}</output>
    <output data-overlay>{overlay}</output>
    <MobileMapShell cityId="london" cityLabel="London" limitedCoverage={limited}
      overlay={overlay} onOverlayChange={setOverlay} backLabel={trail.backLabel} onBack={trail.back} onHome={trail.home}
      activeQuery={query} onClearQuery={() => setQuery("")} onNearMe={noop} nearMeStatus="idle" nearMeError={null}
      onDismissNearMeError={noop} nearbyCount={0} tflCount={0} tflStatus="clear" priceLabel="Any price"
      drinkFiltersActive={false} drinkLaneLabel="Pints" drinkLaneSelected={false} priceCapActive={false}
      planOpen={false} planActive={false} planStopCount={0} planInteractive venueListOpen={false} bandNoticeOpen={false} onPlan={noop}
      searchProps={{ id: "mobileMapSearchInput", mode: "overlay", cityId: "london", query, onQueryChange: setQuery,
        venues: [], localities: [], userLocation: null, mapCenter: [-0.12, 51.5], placeholder: "Search the map",
        onSelectVenue: noop, onFlyToArea: noop, onClose: () => setOverlay("none") }}
      filtersContent={null} drinkContent={<p>Choose a drink</p>} tflContent={null} tonightContent={null}
      layersContent={null} palContent={null} momentContent={null} nearMeContent={null} areaContent={null} chooseAreaContent={null}
    />
  </>;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.history.replaceState(null, "", "/map");
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function settle(action: () => void = noop) {
  await act(async () => { action(); await new Promise((resolve) => setTimeout(resolve, 60)); });
}
function control<T extends HTMLElement>(selector: string): T {
  const element = host.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control ${selector}`);
  return element;
}
function escape() {
  const input = control<HTMLInputElement>("#mobileMapSearchInput");
  input.focus();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

it.each([false, true])("consumes Search Escape history with limited coverage=%s", async (limited) => {
  await settle(() => root.render(<Journey limited={limited} />));
  await settle(() => control<HTMLButtonElement>('[aria-label="Search the map"]').click());
  await settle();
  expect(control<HTMLInputElement>("#mobileMapSearchInput").value).toBe("Blackfriar");
  expect(readMapSurfaceHistory(window.history.state)?.map((entry) => entry.id)).toEqual(["search"]);
  await settle(escape);
  expect(control("[data-overlay]").textContent).toBe("none");
  expect(readMapSurfaceHistory(window.history.state)).toEqual([]);
  expect(document.activeElement).toBe(control('[aria-label="Search the map"]'));
  expect(control("[data-query]").textContent).toBe("Blackfriar");
  await settle(() => window.history.forward());
  await settle();
  expect(control<HTMLInputElement>("#mobileMapSearchInput").value).toBe("Blackfriar");
  expect(document.activeElement).toBe(control("#mobileMapSearchInput"));
  await settle(() => window.history.back());
  expect(control("[data-overlay]").textContent).toBe("none");
  await settle(() => control<HTMLButtonElement>('[aria-label="Search the map"]').click());
  await settle(() => control<HTMLButtonElement>('[aria-label="Search the map"]').click());
  expect(readMapSurfaceHistory(window.history.state)).toEqual([]);
  if (limited) return;
  await settle(() => control<HTMLButtonElement>('[aria-label="Drink shown on the map: Pints. Choose another drink"]').click());
  expect(control("[data-back]").textContent).toBe("");
  expect(readMapSurfaceHistory(window.history.state)?.map((entry) => entry.id)).toEqual(["drink"]);
  await settle(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(control("[data-overlay]").textContent).toBe("none");
  expect(host.querySelector("#mobileMapSearchInput")).toBeNull();
  expect(readMapSurfaceHistory(window.history.state)).toEqual([]);
  expect(control("[data-query]").textContent).toBe("Blackfriar");
});
