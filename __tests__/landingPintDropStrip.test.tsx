// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PintDropStrip from "@/components/landing/PintDropStrip";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("landing community Pint Drops", () => {
  it.each([
    { evidence: "unchecked", measure: "pint", price: 3, band: null, warning: true },
    { evidence: "receipt", measure: "pint", price: 3, band: "cheap", warning: false },
    { evidence: undefined, measure: "pint", price: 3, band: "cheap", warning: false },
    { evidence: "unchecked", measure: "half", price: 3, band: null, warning: true },
    { evidence: "receipt", measure: "half", price: 3, band: null, warning: false },
    { evidence: "unchecked", measure: "pint", price: null, band: null, warning: false },
  ])("renders $evidence $measure price $price with band $band and warning $warning", async ({ evidence, measure, price, band, warning }) => {
    // The unchecked-price contract requires neutral figures and a warning.
    // £3 is below London's cheap threshold in the published price-band table.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      drops: [{
        id: "drop-evidence",
        handle: "riverdrinker",
        drink: "Lager",
        measure,
        priceGbp: price,
        priceEvidence: evidence,
        passedDownNote: "A drink by the Thames.",
        provenance: "contributor",
        venueId: "venue-test",
        createdAt: "2026-10-01T12:00:00Z",
      }],
    }))));

    await act(async () => root.render(createElement(PintDropStrip)));

    const badge = container.querySelector(".dropStripPrice");
    expect(badge?.textContent).toBe(price === null ? "–" : "£3.00");
    expect(badge?.classList.contains("priceBand-cheap")).toBe(band === "cheap");
    expect(badge?.classList.contains("priceBand-average")).toBe(false);
    expect(badge?.classList.contains("priceBand-expensive")).toBe(false);
    expect(container.textContent?.includes("Logged by @riverdrinker, not checked")).toBe(warning);
    expect(container.textContent).toContain("logged 2026-10-01");
    expect(container.textContent).toContain(measure === "half" ? "Lager · Half" : "Lager · Pint");
  });

  it("paints nothing while the feed loads, and nothing for a feed that hangs", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    await act(async () => root.render(createElement(PintDropStrip)));
    // No grey cards while waiting: the strip arrives whole or not at all.
    expect(container.childElementCount).toBe(0);

    await act(async () => { vi.advanceTimersByTime(8_000); });
    expect(container.childElementCount).toBe(0);
  });

  it("keeps a successful feed visible when the hang deadline passes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      drops: [{
        id: "drop-test",
        handle: "London drinker",
        priceGbp: 5,
        passedDownNote: "A pint by the Thames.",
        provenance: "contributor",
        venueId: "venue-test",
        createdAt: "2026-10-01T12:00:00Z",
      }],
    }))));
    await act(async () => root.render(createElement(PintDropStrip)));
    expect(container.textContent).toContain("Recent prices");
    expect(container.textContent).toContain("London drinker");
    expect(container.textContent).toContain("A pint by the Thames.");
    expect(container.querySelectorAll(".dropStripCard")).toHaveLength(1);

    await act(async () => { vi.advanceTimersByTime(8_000); });
    expect(container.textContent).toContain("London drinker");
  });

  it.each([
    { name: "an empty feed", fetchFeed: () => Promise.resolve(new Response(JSON.stringify({ drops: [] }))) },
    { name: "an HTTP error", fetchFeed: () => Promise.resolve(new Response("", { status: 503 })) },
    { name: "a network error", fetchFeed: () => Promise.reject(new Error("Offline")) },
  ])("silently hides $name", async ({ fetchFeed }) => {
    vi.stubGlobal("fetch", vi.fn(fetchFeed));
    await act(async () => root.render(createElement(PintDropStrip)));
    expect(container.childElementCount).toBe(0);
  });
});
