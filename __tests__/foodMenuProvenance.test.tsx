import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import FoodMenu from "@/components/food/FoodMenu";
import type { FoodItem } from "@/lib/food";

const item: FoodItem = {
  id: "food-lunch",
  name: "Vegetable curry",
  category: "mains",
  priceGbp: 12.5,
  source: "https://www.theeagle.co.uk/food-drink",
  provenance: { source: "Young's official menu", licence: "Attributed price facts", observedAt: "2026-07-11T12:00:00Z" },
};

function renderFood(overrides: Partial<FoodItem> = {}) {
  return renderToStaticMarkup(createElement(FoodMenu, { items: [{ ...item, ...overrides }], venueName: "The Eagle" }));
}

describe("food menu price evidence", () => {
  it("shows published calories with their own source and date after a price-only update", () => {
    const html = renderFood({ caloriesKcal: 650, caloriesProvenance: {
      source: "Earlier food menu", licence: "Attributed calorie fact", observedAt: "2026-06-01T12:00:00Z",
      sourceUrl: "https://example.com/earlier-menu",
    } });
    const doc = new JSDOM(html).window.document;
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
      source: "seed", licence: "demo", observedAt: item.provenance.observedAt,
    } })).not.toContain("kcal");
  });
  it("links the named publisher and shows the original collection date beside the price", () => {
    const html = renderFood();
    expect(html).toContain('href="https://www.theeagle.co.uk/food-drink"');
    const time = new JSDOM(html).window.document.querySelector("time");
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
