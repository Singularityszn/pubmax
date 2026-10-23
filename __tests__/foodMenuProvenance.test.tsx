// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FoodMenu from "@/components/food/FoodMenu";
import { buildFoodPricePack } from "../scripts/build_food_price_updates.mjs";
import type { FoodItem } from "@/lib/food";
import { venueFoodMenuForInspector } from "@/lib/venueFoodMenu";
import {
  applyFoodPriceUpdatesToMenu,
  parseFoodPriceUpdates,
} from "@/lib/foodPriceUpdates";

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
  it("keeps the dietary publisher and date beside its label after a parsed price-only update", () => {
    const now = Date.parse("2026-10-14T06:51:38.364Z");
    const original = {
      venueKey: "the-eagle-test",
      itemName: "Mango sorbet (2 scoops)",
      category: "desserts",
      priceGbp: 3.5,
      caloriesKcal: 0,
      dietary: ["vegan"],
      source: {
        label: "The Eagle - official published menu",
        url: "https://www.theeaglew12.co.uk/food-drink",
        licence: "First-party facts, with the observation date and link",
      },
      observedAt: "2026-10-13T06:51:38.364Z",
    };
    const initial = applyFoodPriceUpdatesToMenu(
      "the-eagle-test", [], parseFoodPriceUpdates([original], now),
    );
    const updates = parseFoodPriceUpdates([{
      venueKey: original.venueKey,
      itemName: original.itemName,
      category: original.category,
      priceGbp: 4,
      source: {
        ...original.source,
        label: "Later price source",
        url: "https://www.theeaglew12.co.uk/prices",
      },
      observedAt: "2026-10-14T06:00:00.000Z",
    }], now);
    const items = applyFoodPriceUpdatesToMenu("the-eagle-test", initial, updates);
    const html = renderToStaticMarkup(createElement(FoodMenu, { items, venueName: "The Eagle" }));
    const doc = new DOMParser().parseFromString(html, "text/html");
    const price = doc.querySelector(".drinkRowSide");
    expect(price?.textContent).toContain("£4.00");
    expect(price?.querySelector("a")?.textContent).toBe("Later price source");
    expect(price?.querySelector("a")?.getAttribute("href")).toBe("https://www.theeaglew12.co.uk/prices");
    expect(price?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-14T06:00:00.000Z");
    const dietary = doc.querySelector(".drinkServing");
    expect(dietary?.textContent).toContain("vegan");
    expect(dietary?.querySelector("a")?.textContent).toBe("The Eagle - official published menu");
    expect(dietary?.querySelector("a")?.getAttribute("href")).toBe("https://www.theeaglew12.co.uk/food-drink");
    expect(dietary?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-13T06:51:38.364Z");
    expect(dietary?.querySelector("time")?.textContent).toBe("13 October 2026");
  });

  it("retains older dietary and calorie evidence when the inspector receives a normalized price history", () => {
    const updates = parseFoodPriceUpdates([
      {
        venueKey: "the-eagle-test",
        itemName: "Mango sorbet (2 scoops)",
        category: "desserts",
        priceGbp: 3.5,
        caloriesKcal: 0,
        dietary: ["vegan"],
        source: {
          label: "The Eagle - official published menu",
          url: "https://www.theeaglew12.co.uk/food-drink",
          licence: "First-party facts, with the observation date and link",
        },
        observedAt: "2026-10-13T06:51:38.364Z",
      },
      {
        venueKey: "the-eagle-test",
        itemName: "Mango sorbet (2 scoops)",
        category: "desserts",
        priceGbp: 4,
        source: {
          label: "Later price source",
          url: "https://www.theeaglew12.co.uk/prices",
          licence: "First-party price, with the observation date and link",
        },
        observedAt: "2026-10-14T06:00:00.000Z",
      },
    ], Date.parse("2026-10-14T06:51:38.364Z"));
    const items = venueFoodMenuForInspector({ id: "the-eagle-test", prices: [] }, updates);
    const html = renderToStaticMarkup(createElement(FoodMenu, { items, venueName: "The Eagle" }));
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = doc.querySelectorAll(".drinkRow");
    expect(rows).toHaveLength(1);
    const row = rows.item(0);
    expect(row.textContent).toContain("Mango sorbet (2 scoops)");
    const price = row.querySelector(".drinkRowSide");
    expect(price?.textContent).toContain("£4.00");
    expect(price?.querySelector("a")?.textContent).toBe("Later price source");
    expect(price?.querySelector("a")?.getAttribute("href")).toBe("https://www.theeaglew12.co.uk/prices");
    expect(price?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-14T06:00:00.000Z");
    const dietary = row.querySelector(".drinkServing");
    expect(dietary?.textContent).toContain("vegan");
    expect(dietary?.querySelector("a")?.textContent).toBe("The Eagle - official published menu");
    expect(dietary?.querySelector("a")?.getAttribute("href")).toBe("https://www.theeaglew12.co.uk/food-drink");
    expect(dietary?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-13T06:51:38.364Z");
    expect(dietary?.querySelector("time")?.textContent).toBe("13 October 2026");
    const calories = row.querySelector(".foodCalories");
    expect(calories?.textContent).toContain("0 kcal on the menu");
    expect(calories?.querySelector("a")?.textContent).toBe("The Eagle - official published menu");
    expect(calories?.querySelector("a")?.getAttribute("href")).toBe("https://www.theeaglew12.co.uk/food-drink");
    expect(calories?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-13T06:51:38.364Z");
  });

  it.each([
    { order: "oldest first", dietary: [], label: "withdrawn" },
    { order: "newest first", dietary: [], label: "withdrawn" },
    { order: "oldest first", dietary: ["vegetarian"], label: "vegetarian" },
    { order: "newest first", dietary: ["vegetarian"], label: "vegetarian" },
  ])("keeps $label dietary evidence and published zero calories with rows $order", ({ order, dietary, label }) => {
    const source = {
      label: "Menu publisher",
      url: "https://example.com/menu",
      licence: "Attributed menu facts",
    };
    const original = {
      venueKey: "menu-history-test",
      itemName: "Soup (one bowl)",
      category: "starters",
      priceGbp: 5,
      caloriesKcal: 52,
      dietary: ["vegan"],
      source,
      observedAt: "2026-10-12T12:00:00.000Z",
    };
    const rows = [
      original,
      { ...original, caloriesKcal: 0, dietary, observedAt: "2026-10-13T12:00:00.000Z",
        caloriesProvenance: { source: "Untrusted input", sourceUrl: "https://example.com/untrusted", observedAt: "2026-10-14T12:00:00.000Z", licence: "Unknown" } },
      { ...original, priceGbp: 6, caloriesKcal: undefined, dietary: undefined,
        source: { ...source, label: "New price publisher", url: "https://example.com/prices" },
        observedAt: "2026-10-14T12:00:00.000Z" },
    ];
    const updates = parseFoodPriceUpdates(order === "newest first" ? rows.toReversed() : rows, Date.parse("2026-10-15T12:00:00.000Z"));
    const items = venueFoodMenuForInspector({ id: "menu-history-test", prices: [] }, updates);
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(FoodMenu, { items })), "text/html");
    expect(doc.querySelectorAll(".drinkRow")).toHaveLength(1);
    expect(doc.querySelector(".drinkName")?.textContent).toBe("Soup (one bowl)");
    expect(doc.querySelector(".drinkPrice")?.textContent).toBe("£6.00");
    expect(doc.querySelector(".drinkRowSide a")?.textContent).toBe("New price publisher");
    expect(doc.querySelector(".drinkRowSide time")?.getAttribute("datetime")).toBe("2026-10-14T12:00:00.000Z");
    const dietaryEvidence = doc.querySelector(".drinkServing");
    if (label === "withdrawn") {
      expect(dietaryEvidence).toBeNull();
    } else {
      expect(dietaryEvidence?.textContent).toContain("vegetarian");
      expect(dietaryEvidence?.textContent).not.toContain("vegan");
      expect(dietaryEvidence?.querySelector("a")?.getAttribute("href")).toBe("https://example.com/menu");
      expect(dietaryEvidence?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-13T12:00:00.000Z");
    }
    const calories = doc.querySelector(".foodCalories");
    expect(calories?.textContent).toContain("0 kcal on the menu");
    expect(calories?.querySelector("a")?.textContent).toBe("Menu publisher");
    expect(calories?.querySelector("a")?.getAttribute("href")).toBe("https://example.com/menu");
    expect(calories?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-13T12:00:00.000Z");
    expect(doc.body.textContent).not.toContain("Untrusted input");
  });

  it.each([1, 2])("keeps fact provenance after %i pack rebuild and serialization cycles", (cycles) => {
    const now = Date.parse("2026-10-15T12:00:00.000Z");
    const original = {
      venueKey: "retained-menu-test",
      itemName: "Soup (one bowl)",
      category: "starters",
      priceGbp: 5,
      caloriesKcal: 0,
      dietary: ["vegan"],
      source: { label: "Original menu", url: "https://example.com/menu", licence: "Published facts" },
      observedAt: "2026-10-12T12:00:00.000Z",
    };
    let serialized = JSON.stringify({ updates: [
      original,
      { ...original, priceGbp: 6, caloriesKcal: undefined, dietary: undefined,
        source: { label: "Later price", url: "https://example.com/prices", licence: "Published price" },
        observedAt: "2026-10-13T12:00:00.000Z" },
    ] });
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      const { pack } = buildFoodPricePack({
        existing: JSON.parse(serialized),
        harvested: [{ ...original, venueKey: "different-pub", observedAt: "2026-10-14T12:00:00.000Z" }],
        now,
      });
      serialized = JSON.stringify(pack);
    }
    const updates = parseFoodPriceUpdates(JSON.parse(serialized), now);
    const items = venueFoodMenuForInspector({ id: "retained-menu-test", prices: [] }, updates);
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(FoodMenu, { items })), "text/html");
    expect(doc.querySelectorAll(".drinkRow")).toHaveLength(1);
    expect(doc.querySelector(".drinkName")?.textContent).toBe("Soup (one bowl)");
    expect(doc.querySelector(".drinkPrice")?.textContent).toBe("£6.00");
    expect(doc.querySelector(".drinkRowSide a")?.textContent).toBe("Later price");
    expect(doc.querySelector(".drinkRowSide a")?.getAttribute("href")).toBe("https://example.com/prices");
    expect(doc.querySelector(".drinkRowSide time")?.getAttribute("datetime")).toBe("2026-10-13T12:00:00.000Z");
    const dietary = doc.querySelector(".drinkServing");
    expect(dietary?.textContent).toContain("vegan");
    expect(dietary?.querySelector("a")?.textContent).toBe("Original menu");
    expect(dietary?.querySelector("a")?.getAttribute("href")).toBe("https://example.com/menu");
    expect(dietary?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-12T12:00:00.000Z");
    const calories = doc.querySelector(".foodCalories");
    expect(calories?.textContent).toContain("0 kcal on the menu");
    expect(calories?.querySelector("a")?.textContent).toBe("Original menu");
    expect(calories?.querySelector("a")?.getAttribute("href")).toBe("https://example.com/menu");
    expect(calories?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-12T12:00:00.000Z");
  });

  it("keeps dietary evidence beside the labels when it matches the price observation", () => {
    const doc = new DOMParser().parseFromString(renderFood({
      dietary: ["vegan", "vegetarian", "gluten-free"],
      dietaryProvenance: { ...item.provenance, sourceUrl: item.source },
    }), "text/html");
    const dietary = doc.querySelector(".drinkServing");
    expect(dietary?.textContent).toContain("vegan · vegetarian · gluten free");
    expect(dietary?.querySelector("a")?.textContent).toBe("Young's official menu");
    expect(dietary?.querySelector("a")?.getAttribute("href")).toBe(item.source);
    expect(dietary?.querySelector("time")?.getAttribute("datetime")).toBe(item.provenance.observedAt);
    expect(dietary?.querySelector("time")?.textContent).toBe("11 July 2026");
    expect(doc.querySelector(".drinkRowSide a")?.getAttribute("href")).toBe(item.source);
    expect(doc.querySelector(".drinkRowSide time")?.getAttribute("datetime")).toBe(item.provenance.observedAt);
  });

  it.each([
    undefined,
    { ...item.provenance, sourceUrl: item.source, source: "" },
    { ...item.provenance, sourceUrl: item.source, source: "   " },
    { ...item.provenance, sourceUrl: item.source, licence: "   " },
    { ...item.provenance, sourceUrl: item.source, observedAt: "not-a-date" },
    { ...item.provenance, sourceUrl: "" },
    { ...item.provenance, sourceUrl: "javascript:alert(1)" },
    { ...item.provenance, sourceUrl: item.source, source: "seed" },
    { ...item.provenance, sourceUrl: item.source, source: "Example demo menu" },
  ])("does not display a dietary claim with missing, malformed, or demo evidence: %j", (dietaryProvenance) => {
    const html = renderFood({ dietary: ["vegan"], dietaryProvenance });
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector(".drinkServing")).toBeNull();
    expect(doc.body.textContent).not.toContain("vegan");
    expect(doc.querySelector(".drinkRowSide")?.textContent).toContain("£12.50");
    expect(doc.querySelector(".drinkRowSide a")?.getAttribute("href")).toBe(item.source);
    expect(doc.querySelector(".drinkRowSide time")?.getAttribute("datetime")).toBe(item.provenance.observedAt);
    expect(html).not.toContain("javascript:");
  });

  it.each([undefined, []])("does not display dietary evidence without dietary tags: %j", (dietary) => {
    const doc = new DOMParser().parseFromString(renderFood({
      dietary,
      dietaryProvenance: {
        ...item.provenance, source: "Independent dietary menu", sourceUrl: "https://example.com/dietary-menu",
      },
    }), "text/html");
    expect(doc.querySelector(".drinkServing")).toBeNull();
    expect(doc.body.textContent).not.toContain("Independent dietary menu");
    expect(doc.querySelectorAll(".drinkRow a")).toHaveLength(1);
    expect(doc.querySelectorAll(".drinkRow time")).toHaveLength(1);
  });

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
