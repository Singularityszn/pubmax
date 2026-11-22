// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import CuratedWalkPanel from "@/components/map/route/CuratedWalkPanel";
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
  const [selected, setSelected] = useState("");
  return createElement(CuratedWalkPanel, {
    crawl, walk, venues, mapped: true, onMap: () => {}, onHide: () => {},
    selectedStopId: selected,
    onSelectStop: (id: string) => {
      selections.push(id);
      if (walk.stops.some((stop) => stop.id === id)) setSelected(id);
    },
  });
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
