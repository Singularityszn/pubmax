// @vitest-environment jsdom

import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DrinkLanePicker from "@/components/map/DrinkLanePicker";
import MapExperienceLensControl from "@/components/map/MapExperienceLens";
import { drinkLaneLabel } from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";
import type { MapExperienceLens } from "@/lib/mapExperienceLens";
import type { MapOverlay } from "@/lib/mobileShell";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { default: MobileMapShell } = await import("@/components/mobile/MobileMapShell");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function mount(view: MapExperienceLens, initialLane: DrinkCategory = "beer") {
  const opened = vi.fn();
  const backed = vi.fn();
  const changedView = vi.fn();
  const changedDrink = vi.fn();

  function Harness() {
    const [overlay, setOverlay] = useState<MapOverlay>("none");
    const [currentView, setView] = useState(view);
    const [lane, setLane] = useState(initialLane);
    const experienceFilterLabel = currentView === "no-alcohol" ? "no-alcohol view" as const
      : currentView === "food" ? "food view" as const : undefined;
    return createElement(MobileMapShell, {
      cityId: "london", cityLabel: "London", limitedCoverage: false,
      overlay,
      onOverlayChange: (next: MapOverlay) => { opened(next); setOverlay(next); },
      onBack: () => { backed(); setOverlay("none"); },
      onHome: () => setOverlay("none"), backLabel: null,
      activeQuery: "", onClearQuery: vi.fn(),
      onNearMe: vi.fn(), nearMeStatus: "idle", nearMeError: null,
      onDismissNearMeError: vi.fn(), nearbyCount: 0,
      tonightCount: 0, tonightNearReader: false, tflCount: 0, tflStatus: "clear",
      priceLabel: "Any price", drinkFiltersActive: false,
      // This is the real host contract: experience views stand the category
      // down to beer, while their independent view state owns map pricing.
      drinkLaneLabel: currentView === "all" ? drinkLaneLabel(lane) : "Pints",
      drinkLaneSelected: currentView === "all" && lane !== "beer",
      experienceFilterLabel,
      priceCapActive: false, planOpen: false, planActive: false, planStopCount: 0,
      planInteractive: true, venueListOpen: false, bandNoticeOpen: false,
      onPlan: vi.fn(), searchContent: null,
      filtersContent: createElement(MapExperienceLensControl, {
        lens: currentView, summary: "",
        onChange: (next: MapExperienceLens) => { changedView(next); setView(next); },
      }),
      drinkContent: createElement(DrinkLanePicker, {
        lane, variant: "sheet",
        onChange: (next: DrinkCategory) => { changedDrink(next); setLane(next); },
      }),
      tflContent: null, tonightContent: null, layersContent: null,
      palContent: null, momentContent: null, nearMeContent: null,
      areaContent: null, chooseAreaContent: null,
    });
  }
  act(() => root.render(createElement(Harness)));
  return { opened, backed, changedView, changedDrink };
}

function mapChip(): HTMLButtonElement {
  const chip = container.querySelector<HTMLButtonElement>(".mobileMapDrinkChip");
  expect(chip, "One mounted primary map price/view control must be reachable").not.toBeNull();
  return chip!;
}

function buttonNamed(scope: Element, label: string): HTMLButtonElement {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")]
    .find((node) => node.textContent?.trim() === label);
  expect(button, `The real panel must offer ${label}`).toBeDefined();
  return button!;
}

describe("mobile chip names and opens the map's active price view", () => {
  it.each([
    { view: "no-alcohol" as const, label: "No alcohol", nextView: "food", nextLabel: "Food" },
    { view: "food" as const, label: "Food", nextView: "no-alcohol", nextLabel: "No alcohol" },
  ])("$label names the actual view and opens existing Prices and places", ({ view, label, nextView, nextLabel }) => {
    const events = mount(view);
    const chip = mapChip();
    expect(chip.textContent?.trim()).toBe(label);
    expect(chip.getAttribute("aria-label")).toBe(`Map view: ${label}. Change view`);
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll(".mobileMapDrinkChip")).toHaveLength(1);

    act(() => chip.click());
    expect(events.opened).toHaveBeenCalledExactlyOnceWith("filters");
    const panel = document.body.querySelector('.mobileSheetPortal[data-sheet-kind="filters"]');
    expect(panel).not.toBeNull();
    expect(panel!.querySelector("h2")?.textContent).toBe("Prices and places");
    const mapView = panel!.querySelector('[role="group"][aria-label="Map view"]');
    expect(mapView).not.toBeNull();
    expect(buttonNamed(mapView!, label).getAttribute("aria-pressed")).toBe("true");
    expect(panel!.querySelector('[aria-label="Drink prices shown on the map"]')).toBeNull();
    expect(mapChip().getAttribute("aria-expanded")).toBe("true");

    // Use the real view control, then follow the updated mounted chip. The
    // action must reach existing view controls, not an inert label or picker.
    act(() => buttonNamed(mapView!, nextLabel).click());
    expect(events.changedView).toHaveBeenCalledExactlyOnceWith(nextView);
    expect(events.changedDrink).not.toHaveBeenCalled();
    expect(mapChip().textContent?.trim()).toBe(nextLabel);
    expect(mapChip().getAttribute("aria-label")).toBe(`Map view: ${nextLabel}. Change view`);
    act(() => mapChip().click());
    expect(events.backed).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector(".mobileSheetPortal")).toBeNull();
    expect(mapChip().getAttribute("aria-expanded")).toBe("false");
  });

  it.each([
    { lane: "beer" as const, label: "Pints" },
    { lane: "gin" as const, label: "Gin" },
  ])("All retains $label and its actual drink picker action", ({ lane, label }) => {
    const events = mount("all", lane);
    const chip = mapChip();
    expect(chip.textContent?.trim()).toBe(label);
    expect(chip.getAttribute("aria-label")).toBe(`Drink shown on the map: ${label}. Choose another drink`);
    act(() => chip.click());
    expect(events.opened).toHaveBeenCalledExactlyOnceWith("drink");
    const panel = document.body.querySelector('.mobileSheetPortal[data-sheet-kind="drink"]');
    expect(panel).not.toBeNull();
    expect(panel!.querySelector("h2")?.textContent).toBe("Drink");
    const choices = panel!.querySelector('[role="group"][aria-label="Drink prices shown on the map"]');
    expect(choices).not.toBeNull();
    expect(buttonNamed(choices!, label).getAttribute("aria-pressed")).toBe("true");
    act(() => buttonNamed(choices!, "Wine").click());
    expect(events.changedDrink).toHaveBeenCalledExactlyOnceWith("wine");
    expect(events.changedView).not.toHaveBeenCalled();
    expect(mapChip().textContent?.trim()).toBe("Wine");
  });
});
