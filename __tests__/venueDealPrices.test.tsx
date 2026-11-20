// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import VenueDealPrices, { VenueDealPricesView } from "@/components/map/VenueDealPrices";
import type { DealPrice } from "@/lib/dealPrice";
import type { MapExperienceLens } from "@/lib/mapExperienceLens";
import type { DrinkCategory } from "@/lib/drinks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("updates a deal label at its start, end and freshness boundary", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-20T15:59:00Z"));
  const deal: DealPrice = { id: "timed", venueId: "venue-timed", drinkCategory: "beer", drink: "Lager", measure: "pint", measureLabel: "", priceGbp: 4.5, schedule: { days: [5], start: "16:00", end: "19:00" }, reportedAt: "2026-11-20T12:00:00Z", endDate: null, conditions: "With a meal" };
  const container = document.createElement("div");
  const root = createRoot(container);
  const show = async (rows: DealPrice[]) => {
    await act(async () => root.render(createElement(VenueDealPricesView, { result: { status: "ready", venueId: deal.venueId, deals: rows }, experienceLens: "all" })));
  };
  try {
    await show([deal]);
    expect(container.textContent).not.toContain("On now");
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(container.textContent).toContain("On now");
    expect(container.textContent).toContain("With a meal");
    await act(async () => { vi.advanceTimersByTime(3 * 60 * 60 * 1000); });
    expect(container.textContent).not.toContain("On now");
    vi.setSystemTime(new Date("2026-11-20T17:00:30Z"));
    await show([{ ...deal, reportedAt: "2026-10-21T17:00:30Z" }]);
    expect(container.textContent).toContain("On now");
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(container.textContent).not.toContain("On now");
    expect(container.textContent).toContain("£4.50");
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
});

// Fetch's Body contract requires each response to be consumed or cancelled.
// These request paths must release real bodies while preserving their UI result.
it.each([200, 503])("releases a deal report response with status %s", async (status) => {
  const response = new Response(JSON.stringify({ ok: status === 200 }), { status });
  vi.stubGlobal("fetch", vi.fn(async () => response));
  const deal: DealPrice = { id: "reported", venueId: "venue-reported", drinkCategory: "beer", drink: "Lager", measure: "pint", measureLabel: "", priceGbp: 4.5, schedule: { days: [5], start: "16:00", end: "19:00" }, reportedAt: "2026-11-20T12:00:00Z", endDate: null, conditions: "" };
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(VenueDealPricesView, {
      result: { status: "ready", venueId: deal.venueId, deals: [deal] }, experienceLens: "all",
    })));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelector(status === 200 ? '[role="status"]' : '[role="alert"]')).not.toBeNull();
    expect(response.bodyUsed).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it.each([200, 503])("releases a deal read response with status %s", async (status) => {
  const response = new Response(JSON.stringify({ deals: [] }), { status });
  vi.stubGlobal("fetch", vi.fn(async () => response));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(VenueDealPrices, {
      venueId: "venue-read", experienceLens: "all",
    })));
    expect(container.textContent).toBe(status === 200 ? "" : "Deal information is unavailable right now.");
    expect(response.bodyUsed).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it.each<{
  lens: MapExperienceLens;
  category?: DrinkCategory;
  expected: string[];
}>([
  { lens: "all", expected: ["Lager", "Cola", "Zero lager", "Coffee"] },
  { lens: "no-alcohol", expected: ["Cola", "Zero lager"] },
  { lens: "no-alcohol", category: "beer", expected: ["Cola", "Zero lager"] },
  { lens: "food", expected: [] },
  { lens: "food", category: "coffee", expected: [] },
  { lens: "all", category: "coffee", expected: ["Coffee"] },
])("shows only eligible deals for $lens and $category", async ({ lens, category, expected }) => {
  const base: DealPrice = { id: "lager", venueId: "venue-lenses", drinkCategory: "beer", drink: "Lager", measure: "pint", measureLabel: "", priceGbp: 4.5, schedule: { days: [5], start: "16:00", end: "19:00" }, reportedAt: "2026-11-20T12:00:00Z", endDate: null, conditions: "" };
  const deals: DealPrice[] = [base,
    { ...base, id: "cola", drinkCategory: "soft-drink", drink: "Cola" },
    { ...base, id: "zero", drinkCategory: "alcohol-free", drink: "Zero lager" },
    { ...base, id: "coffee", drinkCategory: "coffee", drink: "Coffee" },
  ];
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(VenueDealPricesView, {
      result: { status: "ready", venueId: base.venueId, deals }, experienceLens: lens, drinkLensCategory: category,
    })));
    expect(Array.from(container.querySelectorAll("strong"), (row) => row.textContent?.split(" · ")[1])).toEqual(expected);
    if (!expected.length) expect(container.querySelector("section")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
