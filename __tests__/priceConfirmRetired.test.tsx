// @vitest-environment jsdom

// "Confirmed" means one thing. The anonymous price-confirm lane is retired, and
// lib/priceAuthorityLint.mjs fences its route, store and callers. What is left
// on the Golden Thread is one door: "It's changed" opens the Pint Drop
// composer, because a correction is a new dated observation by a named drinker.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VenuePriceStory from "@/components/map/VenuePriceStory";
import type { Venue } from "@/lib/venues";

const venue = {
  id: "v1",
  name: "The Anchor",
  primaryBorough: "",
  visibleBoroughs: [],
  cheapestPint: "",
  curation: {},
  cheapestPrice: 4,
  prices: [
    {
      pint_name: "Guinness",
      measure: "pint",
      price_gbp: 4,
      pub_url: "https://pint-prices.com/pub/anchor",
      scraped_at_values: "2026-10-02T12:00:00Z",
    },
  ],
} as unknown as Venue;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
});

const door = () =>
  host.querySelector<HTMLButtonElement>(
    'button[aria-label="The price has changed. Log the new price for this pub"]',
  );

describe("the surviving price door", () => {
  it("opens the Pint Drop composer and confirms nothing itself", () => {
    const onPriceChanged = vi.fn();
    act(() => root.render(createElement(VenuePriceStory, { venue, drops: [], onPriceChanged })));

    expect(door()?.textContent).toBe("It’s changed");
    expect(host.textContent).not.toMatch(/confirmed/i);

    act(() => door()?.click());
    expect(onPriceChanged).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toMatch(/confirmed/i);
  });

  it("is not offered where no composer can open", () => {
    act(() => root.render(createElement(VenuePriceStory, { venue, drops: [] })));
    expect(host.textContent).toContain("£4.00");
    expect(door()).toBeNull();
  });
});
