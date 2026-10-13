// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapToolbar from "@/components/map/MapToolbar";
import MapLayersControl from "@/components/map/MapLayersControl";
import SiteNavMore from "@/components/nav/SiteNavMore";
import { useMapKeyboardShortcuts } from "@/components/map/pubmap/useMapKeyboardShortcuts";
import { dispatchDismissKey } from "@/lib/nativeBackGesture";
import { POI_CATEGORIES, type PoiCategory } from "@/lib/pois";
import { SPOONS_VALUE_LENS_OFF } from "@/lib/spoonsValue";
import { defaultVenueKindVisibility } from "@/lib/venueKindFilters";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { initialFilters } from "@/lib/venues";
import { computeZonePintIndex } from "@/lib/zones";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const noop = () => undefined;
const poiHidden = Object.fromEntries(
  POI_CATEGORIES.map((category) => [category, true]),
) as Record<PoiCategory, boolean>;

function MapJourney() {
  const [drawerOpen, setDrawerOpen] = useState(true);
  useMapKeyboardShortcuts({
    mobileViewport: false,
    planningOpen: false,
    selectedVenueId: drawerOpen ? "selected-pub" : "",
    onBack: () => setDrawerOpen(false),
    onInterruptReveal: noop,
    logIntentFallbackVisible: false,
    dismissLogIntent: noop,
  });
  return (
    <div className={drawerOpen ? "appShell detail-open" : "appShell"}>
      <SiteNavMore />
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
        spoonsValueLens={SPOONS_VALUE_LENS_OFF}
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
        zoneIndex={computeZonePintIndex([])}
        experienceLens="all"
        experienceSummary=""
        onExperienceLensChange={noop}
        venueKindVisibility={defaultVenueKindVisibility()}
        onVenueKindVisibilityChange={noop}
      />
      <MapLayersControl poiHidden={poiHidden} onPoiHiddenChange={noop} />
      {drawerOpen ? <aside className="mapDrawer right open">Selected pub</aside> : null}
    </div>
  );
}

function StrictModal() {
  const [open, setOpen] = useState(true);
  const modalRef = useRef<HTMLElement>(null);
  useFocusTrap(open, modalRef, "strict-modal");
  useDismissOnEscape(open, () => setOpen(false), modalRef);
  return open ? (
    <section ref={modalRef} className="escapeOwnershipModal" role="dialog" aria-modal="true" aria-label="Account dialog">
      <button type="button">Account action</button>
    </section>
  ) : null;
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

// jsdom does not synthesize a native button click from Enter. Complete that
// default action without pointerdown, so toolbar outside-click logic cannot
// hide an existing tray and mask the keyboard ownership regression.
function activateWithKeyboard(target: HTMLButtonElement) {
  act(() => {
    target.focus();
    const key = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    target.dispatchEvent(key);
    if (!key.defaultPrevented) target.click();
  });
}

function expectHeldJourney() {
  expect(host.querySelector(".mapDrawer.right.open")).not.toBeNull();
  expect(control<HTMLInputElement>('[aria-label="Search pubs"]').value).toBe("Camden");
  expect(control<HTMLButtonElement>(".mapToolbarDrinkLaneBtn").textContent).toBe("Drink: Wine");
}

describe("one Escape leaves one map layer", () => {
  it.each([
    { label: "Filters", trigger: ".mapVenueKindFilterBtn", panel: ".mapVenueKindFilterPanel" },
    { label: "City", trigger: ".citySwitcherTrigger", panel: ".citySwitcherList" },
    { label: "Layers", trigger: ".mapLayersFab", panel: ".mapLayersPanel" },
    { label: "More", trigger: ".siteNavMoreBtn", panel: ".siteNavMoreMenu" },
  ])("a strict modal leaves the inert $label popup and journey intact", async ({ trigger: selector, panel }) => {
    openTray();
    const trigger = control<HTMLButtonElement>(selector);
    activateWithKeyboard(trigger);
    const modalHost = document.body.appendChild(document.createElement("div"));
    const modalRoot = createRoot(modalHost);
    try {
      act(() => modalRoot.render(<StrictModal />));
      expect(host.inert).toBe(true);
      const action = modalHost.querySelector<HTMLButtonElement>("button");
      expect(action).not.toBeNull();
      act(() => action!.focus());
      pressEscape(action!);
      // The shared focus trap releases inert ownership in a microtask, before
      // the next user key can reach the formerly covered map controls.
      await act(async () => { await Promise.resolve(); });
      expect(Boolean(host.inert)).toBe(false);
      expect(modalHost.querySelector(".escapeOwnershipModal")).toBeNull();
      expect(document.querySelector(panel)).not.toBeNull();
      expect(host.querySelector(".mapToolbarDrinkChoices")).not.toBeNull();
      expectHeldJourney();
      pressEscape(trigger);
      expect(document.querySelector(panel)).toBeNull();
      expect(host.querySelector(".mapToolbarDrinkChoices")).not.toBeNull();
      expect(document.activeElement).toBe(trigger);
      expectHeldJourney();
    } finally {
      act(() => modalRoot.unmount());
      modalHost.remove();
    }
  });

  it.each([
    { label: "Filters", trigger: ".mapVenueKindFilterBtn", panel: ".mapVenueKindFilterPanel" },
    { label: "City", trigger: ".citySwitcherTrigger", panel: ".citySwitcherList" },
    { label: "Layers", trigger: ".mapLayersFab", panel: ".mapLayersPanel" },
    { label: "More", trigger: ".siteNavMoreBtn", panel: ".siteNavMoreMenu" },
  ])("closes keyboard-opened $label before the drink tray", ({ trigger: selector, panel }) => {
    const drink = openTray();
    const trigger = control<HTMLButtonElement>(selector);
    activateWithKeyboard(trigger);
    expect(document.querySelector(panel)).not.toBeNull();
    expect(host.querySelector(".mapToolbarDrinkChoices")).not.toBeNull();

    pressEscape(trigger);

    expect(document.querySelector(panel)).toBeNull();
    expect(host.querySelector(".mapToolbarDrinkChoices")).not.toBeNull();
    expect(document.activeElement).toBe(trigger);
    expectHeldJourney();
    pressEscape(trigger);
    expect(host.querySelector(".mapToolbarDrinkChoices")).toBeNull();
    expect(document.activeElement).toBe(drink);
    expectHeldJourney();
  });

  it.each([
    { label: "Filters", trigger: ".mapVenueKindFilterBtn", panel: ".mapVenueKindFilterPanel" },
    { label: "City", trigger: ".citySwitcherTrigger", panel: ".citySwitcherList" },
    { label: "Layers", trigger: ".mapLayersFab", panel: ".mapLayersPanel" },
    { label: "More", trigger: ".siteNavMoreBtn", panel: ".siteNavMoreMenu" },
  ])("native window Back closes keyboard-opened $label before the tray", ({ trigger: selector, panel }) => {
    openTray();
    const trigger = control<HTMLButtonElement>(selector);
    activateWithKeyboard(trigger);
    expect(document.querySelector(panel)).not.toBeNull();
    let consumed = false;
    act(() => { consumed = dispatchDismissKey(); });
    expect(consumed).toBe(true);
    expect(document.querySelector(panel)).toBeNull();
    expect(host.querySelector(".mapToolbarDrinkChoices")).not.toBeNull();
    expect(document.activeElement).toBe(trigger);
    expectHeldJourney();
  });

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
