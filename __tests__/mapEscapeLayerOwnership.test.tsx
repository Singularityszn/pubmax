// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapToolbar from "@/components/map/MapToolbar";
import { useMapKeyboardShortcuts } from "@/components/map/pubmap/useMapKeyboardShortcuts";
import { dispatchDismissKey } from "@/lib/nativeBackGesture";
import { initialFilters } from "@/lib/venues";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const noop = () => undefined;

function MapJourney() {
  const [drawerOpen, setDrawerOpen] = useState(true);
  useMapKeyboardShortcuts({
    mobileViewport: false,
    planningOpen: false,
    selectedVenueId: drawerOpen ? "selected-pub" : null,
    onBack: () => setDrawerOpen(false),
    onInterruptReveal: noop,
    logIntentFallbackVisible: false,
    dismissLogIntent: noop,
  });
  return (
    <div className={drawerOpen ? "appShell detail-open" : "appShell"}>
      <MapToolbar
        query="Camden"
        onQueryChange={noop}
        searchContent={<input aria-label="Search pubs" value="Camden" readOnly />}
        favoritePint={null}
        onFavoritePintChange={noop}
        drinkFiltersActive
        drinkCategory="wine"
        drinkBrand=""
        onDrinkBrandChange={noop}
        onDrinkLaneChange={noop}
        drinkLaneStatus="ready"
        spoonsValueOn={false}
        spoonsValueLens={{ status: "idle" }}
        onSpoonsValueChange={noop}
        personaId={null}
        onPersonaSelect={noop}
        personaTonightCategory={null}
        planningOpen={false}
        detailOpen={drawerOpen}
        desktopLaneActive
        onTogglePlanning={noop}
        filters={{ ...initialFilters, query: "Camden", drinkCategory: "wine" }}
        onFiltersChange={noop}
        searchSettled
        filteredVenueCount={10}
        searchableVenueCount={10}
        zoneIndex={{}}
        experienceLens="all"
        experienceSummary=""
        onExperienceLensChange={noop}
      />
      {drawerOpen ? <aside className="mapDrawer right open">Selected pub</aside> : null}
    </div>
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<MapJourney />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function control<T extends HTMLElement>(selector: string): T {
  const element = host.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}

function openTray() {
  const trigger = control<HTMLButtonElement>(".mapToolbarDrinkLaneBtn");
  act(() => { trigger.focus(); trigger.click(); });
  return trigger;
}

function pressEscape(target: HTMLElement) {
  act(() => target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
}

function expectHeldJourney() {
  expect(host.querySelector(".mapDrawer.right.open")).not.toBeNull();
  expect(control<HTMLInputElement>('[aria-label="Search pubs"]').value).toBe("Camden");
  expect(control<HTMLButtonElement>(".mapToolbarDrinkLaneBtn").textContent).toBe("Drink: Wine");
}

describe("one Escape leaves one map layer", () => {
  it("closes the drink tray before the previously registered drawer shortcut", () => {
    const trigger = openTray();
    pressEscape(trigger);
    expect(host.querySelector(".mapToolbarDrinkChoices")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expectHeldJourney();
    pressEscape(trigger);
    expect(host.querySelector(".mapDrawer.right.open")).toBeNull();
  });

  it("native Back leaves the nested persona picker before the tray and drawer", () => {
    const trigger = openTray();
    const persona = control<HTMLButtonElement>(".personaLensTrigger");
    act(() => persona.click());
    expect(host.querySelector(".personaLensPanel")).not.toBeNull();
    let dismissed = false;
    act(() => { dismissed = dispatchDismissKey(); });
    expect(dismissed).toBe(true);
    expect(host.querySelector(".personaLensPanel")).toBeNull();
    expect(host.querySelector(".mapToolbarDrinkChoices")).not.toBeNull();
    expect(document.activeElement).toBe(persona);
    expectHeldJourney();
    act(() => { dismissed = dispatchDismissKey(); });
    expect(dismissed).toBe(true);
    expect(host.querySelector(".mapToolbarDrinkChoices")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expectHeldJourney();
  });

  it("preserves a consumed persona Escape and then leaves the tray on the next key", () => {
    const trigger = openTray();
    const persona = control<HTMLButtonElement>(".personaLensTrigger");
    act(() => persona.click());
    const input = control<HTMLInputElement>('[aria-label="Search personas by name or drink"]');
    pressEscape(input);
    expect(host.querySelector(".personaLensPanel")).toBeNull();
    expect(host.querySelector(".mapToolbarDrinkChoices")).not.toBeNull();
    expect(document.activeElement).toBe(persona);
    expectHeldJourney();
    pressEscape(persona);
    expect(host.querySelector(".mapToolbarDrinkChoices")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expectHeldJourney();
  });

  it("leaves an already-consumed key to its original control", () => {
    const trigger = openTray();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    act(() => trigger.dispatchEvent(event));
    expect(host.querySelector(".mapToolbarDrinkChoices")).not.toBeNull();
    expectHeldJourney();
  });

  it("dismisses the nested picker when its trigger owns keyboard focus", () => {
    openTray();
    const persona = control<HTMLButtonElement>(".personaLensTrigger");
    act(() => { persona.click(); persona.focus(); });
    pressEscape(persona);
    expect(host.querySelector(".personaLensPanel")).toBeNull();
    expect(host.querySelector(".mapToolbarDrinkChoices")).not.toBeNull();
    expect(document.activeElement).toBe(persona);
    expectHeldJourney();
  });
});
