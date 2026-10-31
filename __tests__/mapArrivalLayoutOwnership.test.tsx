// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MapArrivalCard from "@/components/map/MapArrivalCard";

let host: HTMLDivElement;
let root: Root;
let height: number;
const resizeCallbacks = new Set<ResizeObserverCallback>();

function Fixture() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  return <div className="appShell">
    <button aria-label="Filters" aria-expanded={open} onClick={() => setOpen(!open)}>Filters</button>
    {!dismissed && <MapArrivalCard onUseLocation={() => {}} onChooseArea={() => {}} onDismiss={() => setDismissed(true)} />}
  </div>;
}

function hiddenByToolbar() {
  return host.querySelector('button[aria-label="Filters"]')?.getAttribute("aria-expanded") === "true";
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); height = 143.25;
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resizeCallbacks.add(callback); }
    observe() {}
    disconnect() { resizeCallbacks.clear(); }
  });
  const originalBox = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("mapArrivalCard")
      ? new DOMRect(20, 293, 601, hiddenByToolbar() ? 0 : height)
      : originalBox.call(this);
  });
  const originalRects = HTMLElement.prototype.getClientRects;
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains("mapArrivalCard")) return originalRects.call(this);
    const values = hiddenByToolbar() ? [] : [this.getBoundingClientRect()];
    return Object.assign(values, { item: (index: number) => values[index] ?? null });
  });
});

afterEach(() => {
  act(() => root.unmount()); host.remove(); resizeCallbacks.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("publishes its occupied height, updates on resize and releases it after public dismissal", () => {
  act(() => root.render(<Fixture />));
  const shell = host.querySelector<HTMLElement>(".appShell")!;
  expect(shell.style.getPropertyValue("--map-arrival-occupied-height")).toBe("144px");
  height = 180.5;
  act(() => { for (const callback of resizeCallbacks) callback([], {} as ResizeObserver); });
  expect(shell.style.getPropertyValue("--map-arrival-occupied-height")).toBe("181px");
  act(() => host.querySelector<HTMLButtonElement>(".mapArrivalCardClose")!.click());
  expect(host.querySelector(".mapArrivalCard")).toBeNull();
  expect(shell.style.getPropertyValue("--map-arrival-occupied-height")).toBe("");
});

it("releases the hidden toolbar berth and republishes when the public toolbar closes", () => {
  act(() => root.render(<Fixture />));
  const shell = host.querySelector<HTMLElement>(".appShell")!;
  const filters = host.querySelector<HTMLButtonElement>('button[aria-label="Filters"]')!;
  act(() => { filters.click(); });
  act(() => { for (const callback of resizeCallbacks) callback([], {} as ResizeObserver); });
  expect(shell.style.getPropertyValue("--map-arrival-occupied-height")).toBe("");
  act(() => { filters.click(); });
  act(() => { for (const callback of resizeCallbacks) callback([], {} as ResizeObserver); });
  expect(shell.style.getPropertyValue("--map-arrival-occupied-height")).toBe("144px");
});
