// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import TonightArcChips from "@/components/map/TonightArcChips";
import {
  defaultVenueKindVisibility,
  filterVenuesByKind,
  type VenueKindVisibility,
} from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const venues = ["pub", "bar", "club", "food", "restaurant"].map((kind) => ({
  id: kind, kind,
})) as Venue[];

function Journey({ initial, variant }: {
  initial: VenueKindVisibility;
  variant: "popover" | "sheet";
}) {
  const [visibility, setVisibility] = useState(initial);
  return <>
    <TonightArcChips visibility={visibility} variant={variant} onChange={setVisibility} />
    <ul aria-label="Visible venues">
      {filterVenuesByKind(venues, visibility).map((venue) => <li key={venue.id}>{venue.id}</li>)}
    </ul>
  </>;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function rows() {
  return [...host.querySelectorAll("li")].map((row) => row.textContent);
}
function chip(label: string) {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
  if (!button) throw new Error(`Missing ${label} control`);
  return button;
}

for (const variant of ["popover", "sheet"] as const) {
  it(`hides every visible kind through the ${variant} controls`, () => {
    act(() => root.render(<Journey initial={defaultVenueKindVisibility()} variant={variant} />));
    expect(rows()).toEqual(["pub", "bar", "club", "food", "restaurant"]);
    const selected = [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]')];
    for (const button of selected) act(() => button.click());
    expect(host.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(0);
    expect(rows()).toEqual([]);
    expect(chip("Clubs").getAttribute("aria-pressed")).toBe("false");
  });

  it(`lets a legacy ${variant} reader choose Clubs independently`, () => {
    const initial = { pub: true, bar: true, food: true, restaurant: true };
    const before = { ...initial };
    act(() => root.render(<Journey initial={initial} variant={variant} />));
    expect(chip("Clubs").getAttribute("aria-pressed")).toBe("true");
    act(() => chip("Clubs").click());
    expect(rows()).toEqual(["pub", "bar", "food", "restaurant"]);
    expect(chip("Bars").getAttribute("aria-pressed")).toBe("true");
    act(() => chip("Bars").click());
    act(() => chip("Clubs").click());
    expect(rows()).toEqual(["pub", "club", "food", "restaurant"]);
    expect(chip("Bars").getAttribute("aria-pressed")).toBe("false");
    expect(initial).toEqual(before);
  });
}
