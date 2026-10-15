// @vitest-environment jsdom

import pack from "../public/data/food_price_updates/latest.json";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FoodMenu from "@/components/food/FoodMenu";
import type { FoodItem } from "@/lib/food";
import { applyFoodPriceUpdatesToMenu, parseFoodPriceUpdates } from "@/lib/foodPriceUpdates";

const item = {
  id: "food-lunch",
  name: "Vegetable curry",
  category: "mains",
  priceGbp: 12.5,
  source: "https://www.theeagle.co.uk/food-drink",
  provenance: { source: "Young's official menu", licence: "Attributed price facts", observedAt: "2026-07-11T12:00:00Z" },
} satisfies FoodItem;

function renderFood(overrides: Partial<FoodItem> = {}) {
  return renderToStaticMarkup(createElement(FoodMenu, { items: [{ ...item, ...overrides }], venueName: "The Eagle" }));
}

describe("food menu price evidence", () => {
  it("shows one attribution when the price and calories share the exact observation", () => {
    const html = renderFood({ caloriesKcal: 650, caloriesProvenance: {
      ...item.provenance, sourceUrl: item.source,
    } });
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector(".foodCalories")?.textContent).toContain("650 kcal on the menu");
    expect(doc.querySelectorAll(".drinkRow a")).toHaveLength(1);
    expect(doc.querySelectorAll(".drinkRow time")).toHaveLength(1);
    expect(doc.querySelector(".drinkRowSide")?.textContent).toContain("Price and calories");
  });

  it.each([
    { sourceUrl: "https://example.com/calorie-menu" },
    { observedAt: "2026-06-01T12:00:00Z" },
    { source: "Earlier publisher" },
    { licence: "Different attribution terms" },
  ])("keeps separate evidence when an observation field differs: %j", (different) => {
    const caloriesProvenance = { ...item.provenance, sourceUrl: item.source, ...different };
    const doc = new DOMParser().parseFromString(renderFood({ caloriesKcal: 650, caloriesProvenance }), "text/html");
    expect(doc.querySelector(".foodCalories a")?.getAttribute("href")).toBe(caloriesProvenance.sourceUrl);
    expect(doc.querySelector(".foodCalories time")?.getAttribute("datetime")).toBe(caloriesProvenance.observedAt);
    expect(doc.querySelectorAll(".drinkRow a")).toHaveLength(2);
    expect(doc.querySelectorAll(".drinkRow time")).toHaveLength(2);
  });

  it("shows published calories with their own source and date after a price-only update", () => {
    const html = renderFood({ caloriesKcal: 650, caloriesProvenance: {
      source: "Earlier food menu", licence: "Attributed calorie fact", observedAt: "2026-06-01T12:00:00Z",
      sourceUrl: "https://example.com/earlier-menu",
    } });
    const doc = new DOMParser().parseFromString(html, "text/html");
    const calories = doc.querySelector(".foodCalories");
    expect(calories?.textContent).toContain("650 kcal on the menu");
    expect(calories?.querySelector("a")?.href).toBe("https://example.com/earlier-menu");
    expect(calories?.querySelector("time")?.getAttribute("datetime")).toBe("2026-06-01T12:00:00Z");
    expect(html).not.toContain("healthy");
    expect(doc.querySelector(".drinkRowSide time")?.getAttribute("datetime")).toBe(item.provenance.observedAt);
  });

  it("keeps unknown calories absent and preserves a published zero", () => {
    expect(renderFood()).not.toContain("kcal");
    expect(renderFood({ caloriesKcal: 0, caloriesProvenance: {
      ...item.provenance, sourceUrl: item.source,
    } })).toContain("0 kcal on the menu");
  });

  it("does not present malformed or demo calorie values as publisher facts", () => {
    for (const caloriesKcal of [NaN, Infinity, -1]) {
      expect(renderFood({ caloriesKcal, caloriesProvenance: {
        ...item.provenance, sourceUrl: item.source,
      } })).not.toContain("kcal");
    }
    expect(renderFood({ caloriesKcal: 650, caloriesProvenance: {
      source: "seed", licence: "demo", observedAt: item.provenance.observedAt, sourceUrl: item.source,
    } })).not.toContain("kcal");
  });
  it("links the named publisher and shows the original collection date beside the price", () => {
    const html = renderFood();
    expect(html).toContain('href="https://www.theeagle.co.uk/food-drink"');
    const time = new DOMParser().parseFromString(html, "text/html").querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-07-11T12:00:00Z");
    expect(time?.textContent).toBe("11 July 2026");
    expect(html).toContain("Snapshot from");
    expect(html).toContain("£12.50");
  });

  it("keeps publisher attribution without making an unsafe source clickable", () => {
    const html = renderFood({ source: "javascript:alert(1)" });
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Young&#x27;s official menu");
    expect(html).toContain("Link unavailable");
  });

  it("does not present a demo menu as a dated publisher snapshot", () => {
    const html = renderFood({ provenance: { source: "seed", licence: "demo", observedAt: "2026-07-11T12:00:00Z" }, source: undefined });
    expect(html).toContain("Demo");
    expect(html).not.toContain("<time");
    expect(html).not.toContain("Snapshot from");
  });
});

it("renders factual portions through the food update consumer without changing whole-serving facts", () => {
  const updates = parseFoodPriceUpdates(pack);
  const items = applyFoodPriceUpdatesToMenu("the eagle|215 askew rd, london w12 9az, uk|51.50060|-0.23933", [], updates);
  const iceCream = items.find((row) => row.id === "food-1j3poi9");
  expect(iceCream).toMatchObject({ id: "food-1j3poi9", servingSize: "3 scoops", priceGbp: 5.5, caloriesKcal: 238 });
  const html = renderToStaticMarkup(createElement(FoodMenu, { items: iceCream ? [iceCream] : [] }));
  const doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelector(".drinkRow")?.textContent).toContain("3 scoops");
  expect(doc.querySelector(".drinkRow")?.textContent).toContain("238 kcal");
  expect(doc.querySelector(".drinkPrice")?.textContent).toContain("£5.50");
  const ribs = items.find((row) => row.name === "1kg Brewhouse Pork Ribs");
  expect(ribs).toBeDefined();
  const ribsDoc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(FoodMenu, { items: ribs ? [ribs] : [] })), "text/html");
  expect(ribsDoc.querySelector(".drinkServing")?.textContent).toBe("1kg");
  expect(ribsDoc.querySelector(".drinkPrice")?.textContent).toBe("£40.00");
  expect(ribsDoc.querySelector(".foodCalories")?.textContent).toContain("3102 kcal");
  expect(new DOMParser().parseFromString(renderFood({ name: "8oz Bavette steak" }), "text/html").querySelector(".drinkServing")?.textContent).toBe("8oz");
  expect(new DOMParser().parseFromString(renderFood(), "text/html").querySelector(".drinkServing")).toBeNull();
});
