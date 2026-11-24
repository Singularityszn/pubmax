// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
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

  it.each([
    { drink: "Lager", measure: "pint", label: "Pint", eligible: true },
    { drink: "Lager", measure: "half", label: "Half", eligible: false },
    { drink: "Wine", measure: "125ml", label: "125 ml", eligible: false },
    { drink: "Wine", measure: "175ml", label: "175 ml", eligible: false },
    { drink: "Wine", measure: "250ml", label: "250 ml", eligible: false },
    { drink: "Lager", measure: "bottle", label: "Bottle", eligible: false },
    { drink: "Whisky", measure: "single", label: "Single", eligible: false },
    { drink: "Whisky", measure: "double", label: "Double", eligible: false },
    { drink: "Ale", measure: "other", measureLabel: "Schooner", label: "Schooner", eligible: false },
    { drink: "Half of lager", measure: "pint", label: "Pint", eligible: false },
    { drink: "330 ml lager", measure: "pint", label: "Pint", eligible: false },
    { drink: "Lager", label: "Measure unknown", eligible: false },
  ])("retains $drink ($label) and its pint colour eligibility", async ({ label, eligible, ...serving }) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      drops: [{
        id: "serving-drop", venueId: "venue-test", handle: "tester", priceGbp: 3,
        ...serving, passedDownNote: "A recent visit", provenance: "contributor", createdAt: "2026-11-20T12:00:00Z",
      }],
    }))));
    await act(async () => root.render(createElement(PintDropStrip)));

    const card = container.querySelector(".dropStripCard");
    expect(container.querySelectorAll(".dropStripCard")).toHaveLength(1);
    expect(card?.textContent).toContain(`${serving.drink} · ${label}`);
    const price = card?.querySelector(".priceBadge");
    expect(price?.textContent).toBe("£3.00");
    expect(price?.classList.contains("priceBand-cheap")).toBe(eligible);
    expect(price?.classList.contains("priceBand-average")).toBe(false);
    expect(price?.classList.contains("priceBand-expensive")).toBe(false);
  });

  it("reserves the strip in the server HTML, before any script runs", () => {
    const html = renderToString(createElement(PintDropStrip));
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("dropStripCard");
  });

  it("draws the wait from the card, and keeps the frame when the feed hangs", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    await act(async () => root.render(createElement(PintDropStrip)));
    expect(container.querySelector(".dropStrip")?.getAttribute("data-state")).toBe("loading");
    expect(container.querySelectorAll('[aria-busy="true"] .dropStripCard').length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("£");

    await act(async () => { vi.advanceTimersByTime(8_000); });
    expect(container.querySelector(".dropStrip")?.getAttribute("data-state")).toBe("failed");
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(container.querySelectorAll(".dropStripCard")).toHaveLength(1);
    expect(container.querySelector(".dropStripQuietLine")?.textContent).toBeTruthy();
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
    { name: "an empty feed", state: "empty", fetchFeed: () => Promise.resolve(new Response(JSON.stringify({ drops: [] }))) },
    { name: "an HTTP error", state: "failed", fetchFeed: () => Promise.resolve(new Response("", { status: 503 })) },
    { name: "a network error", state: "failed", fetchFeed: () => Promise.reject(new Error("Offline")) },
  ])("keeps the frame and says why for $name", async ({ fetchFeed, state }) => {
    vi.stubGlobal("fetch", vi.fn(fetchFeed));
    await act(async () => root.render(createElement(PintDropStrip)));
    expect(container.querySelector(".dropStrip")?.getAttribute("data-state")).toBe(state);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(container.querySelectorAll(".dropStripCard")).toHaveLength(1);
    expect(container.querySelector(".dropStripQuietLine")?.textContent).toBeTruthy();
  });
});
