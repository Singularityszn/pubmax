// @vitest-environment jsdom

import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import CuratedWalkPanel from "@/components/map/route/CuratedWalkPanel";
import { useCuratedWalkFocus } from "@/components/map/route/useCuratedWalkFocus";
import { curatedCrawls } from "@/lib/curatedCrawls";
import type { Venue } from "@/lib/venues";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const crawl = curatedCrawls.find((entry) => entry.id === "london-christmas-walk")!;
const walk = crawl.walk!;
const first = walk.stops[0]!;
const second = walk.stops[1]!;

function pub(id: string, name: string, stop: typeof first, cheapestPrice: number | null): Venue {
  return {
    id, name, kind: "pub", latitude: stop.latitude, longitude: stop.longitude,
    cheapestPrice, priceSource: "Pub menu", priceObservedAt: "2026-01-01",
  } as Venue;
}

const venues = [
  pub("venue-a", "The Punch", first, 6.8),
  pub("venue-b", "The Nag", first, null),
  pub("venue-c", "The Crown", second, 6.45),
];

let host: HTMLDivElement;
let root: Root;
let selections: string[];

function Harness() {
  const selection = useCuratedWalkFocus(walk, () => {}, () => {}, () => {}, () => {});
  const selectStop = (id: string) => {
    selections.push(id);
    selection.selectRouteStop(id);
  };
  return createElement(Fragment, null,
    createElement("button", {
      "data-marker-stop-id": first.id,
      onClick: () => selectStop(first.id),
    }, first.name),
    createElement(CuratedWalkPanel, {
      crawl, walk, venues, mapped: true, onMap: () => {}, onHide: () => {},
      selectedStopId: selection.selectedWalkStopId,
      selectedStopToken: selection.selectedWalkStopToken,
      onSelectStop: selectStop,
    }),
  );
}

function stopButton(id: string): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>(`[data-stop-id="${id}"] > button`)!;
}

function pubNames(): string[] {
  return Array.from(host.querySelectorAll("[data-venue-id]"), (row) => row.textContent ?? "");
}

beforeEach(() => {
  selections = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(Harness)));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("counts each stop's pubs and opens only the selected stop's list", () => {
  expect(stopButton(first.id).textContent).toContain("2 pubsfrom £6.80");
  expect(stopButton(second.id).textContent).toContain("1 pubfrom £6.45");
  expect(pubNames()).toEqual([]);

  act(() => stopButton(first.id).click());
  expect(stopButton(first.id).getAttribute("aria-expanded")).toBe("true");
  expect(pubNames()).toEqual(["The Punch0 m£6.80", "The Nag0 mPrice TBD"]);

  act(() => stopButton(second.id).click());
  expect(stopButton(first.id).getAttribute("aria-expanded")).toBe("false");
  expect(pubNames()).toEqual(["The Crown0 m£6.45"]);
});

it("opens the pub a walker taps and keeps the stop's list open", () => {
  act(() => stopButton(first.id).click());
  act(() => host.querySelector<HTMLButtonElement>('[data-venue-id="venue-b"]')!.click());
  expect(selections).toEqual([first.id, "venue-b"]);
  expect(pubNames()).toHaveLength(2);
});

it.each([
  { priceSource: undefined, priceObservedAt: undefined, qualification: /Publisher not recorded.*may have changed/ },
  { priceSource: "Pub menu", priceObservedAt: undefined, qualification: /Pub menu.*may have changed/ },
  { priceSource: undefined, priceObservedAt: "2026-11-20", qualification: /Publisher not recorded.*read/ },
])("qualifies a walk pub price with incomplete provenance ($priceSource, $priceObservedAt)", ({ priceSource, priceObservedAt, qualification }) => {
  const unsourced = {
    ...pub("venue-unsourced", "The Unsourced Arms", first, 1.1),
    priceSource,
    priceObservedAt,
  };
  act(() => root.render(createElement(CuratedWalkPanel, {
    crawl, walk, venues: [...venues, unsourced], mapped: true,
    onMap: () => {}, onHide: () => {}, onSelectStop: () => {}, selectedStopId: first.id,
  })));

  const row = host.querySelector<HTMLButtonElement>('[data-venue-id="venue-unsourced"]')!;
  expect(row.textContent).toContain("£1.10");
  expect(row.textContent).toMatch(qualification);
  expect(host.querySelector(".curatedWalkSummary")!.textContent).toContain("Pints from £6.45");
});

it.each([
  [false, "list"], [false, "map"], [true, "list"], [true, "map"],
] as const)("keeps an opened stop visible through sheet movement and repeated taps (reduced motion: %s, source: %s)", async (reducedMotion, source) => {
  const selectAgain = () => (source === "list"
    ? stopButton(first.id)
    : host.querySelector<HTMLButtonElement>(`[data-marker-stop-id="${first.id}"]`)!).click();
  let frameTop = 100;
  let height = 800;
  let resize = () => {};
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() { resize = () => {}; }
  });
  vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion }));
  vi.stubGlobal("CSS", { ...globalThis.CSS, escape: (value: string) => value });
  host.style.overflowY = "auto";
  host.style.scrollPaddingTop = "66px";
  host.style.scrollPaddingBottom = "16px";
  Object.defineProperties(host, {
    clientHeight: { get: () => height },
    scrollHeight: { value: 2000 },
  });
  vi.spyOn(host, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, frameTop, 700, height));
  host.scrollTo = (options: ScrollToOptions | number = {}, y?: number) => {
    host.scrollTop = typeof options === "number" ? y ?? 0 : options.top ?? host.scrollTop;
  };
  const row = stopButton(first.id).parentElement!;
  vi.spyOn(row, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, frameTop + 500 - host.scrollTop, 700, 160));

  act(() => stopButton(first.id).click());
  expect(host.scrollTop).toBe(0);

  await act(async () => {
    frameTop = 450;
    host.style.transform = "translateY(350px)";
    host.style.scrollPaddingBottom = "366px";
  });
  expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(884);
  expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(516);

  await act(async () => {
    frameTop = 100;
    host.style.transform = "none";
    host.style.scrollPaddingBottom = "16px";
  });
  act(() => { height = 420; resize(); });
  expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(504);
  expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(166);

  for (const gesture of ["wheel", "touchmove"]) {
    act(() => host.dispatchEvent(new Event(gesture)));
    host.scrollTop = 0;
    await act(async () => {
      host.style.scrollPaddingBottom = gesture === "wheel" ? "20px" : "24px";
    });
    expect(host.scrollTop).toBe(0);
    act(selectAgain);
    expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(500);
    expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(166);
  }

  host.scrollTop = 1000;
  act(selectAgain);
  expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(166);
  expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(496);
  expect(selections).toEqual(Array(4).fill(first.id));
});
