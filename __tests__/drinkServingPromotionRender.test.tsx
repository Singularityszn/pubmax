// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import DrinkMenu from "@/components/drinks/DrinkMenu";
import { applyDrinkPriceUpdatesToMenu, parseDrinkPriceUpdates, reviewedDrinkItemId } from "@/lib/drinkPriceUpdates";
import { legacyPricesToDrinks } from "@/lib/drinks";
import fixture from "@/__tests__/fixtures/harvest/eagle-reviewed-drinks-20261013.json";

afterEach(() => { document.body.innerHTML = ""; });

describe("reviewed serving labels in the real Menu renderer", () => {
  it("shows each glass and bottle with its own label, price, source date and disclosure", () => {
    const updates = parseDrinkPriceUpdates(fixture.updates.map((row) => ({
      ...row, itemId: reviewedDrinkItemId(row),
    })), Date.parse("2026-10-13T12:00:00.000Z"));
    const drinks = applyDrinkPriceUpdatesToMenu(fixture.updates[0]!.venueKey, [], updates);
    document.body.innerHTML = renderToStaticMarkup(createElement(DrinkMenu, {
      drinks, venueId: fixture.venueId, venueName: "The Eagle",
    }));
    const rows = Array.from(document.querySelectorAll("li.drinkRow"));
    expect(rows).toHaveLength(22);
    for (const [name, expected] of [
      ["Steinbock, Riesling, Germany", [["125ml", "£7.10"], ["750ml", "£35.50"]]],
      ["Nooh La Coste Rosé, Provence", [["125ml", "£8.90"], ["750ml", "£46.50"]]],
    ] as const) {
      const named = rows.filter((row) => row.querySelector(".drinkName")?.textContent === name);
      expect(named.map((row) => [
        row.querySelector(".drinkServing")?.textContent,
        row.querySelector(".drinkPrice")?.textContent,
      ])).toEqual(expected);
      expect(new Set(named.map((row) => row.querySelector(".drinkDisclosure")?.getAttribute("aria-controls"))).size).toBe(2);
      for (const row of named) {
        expect(row.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-13T10:19:25.911Z");
        expect(row.querySelector("a")?.getAttribute("href")).toBe(fixture.updates[0]!.source.url);
      }
    }
    expect(document.querySelectorAll(".drinkLowNoChip")).toHaveLength(12);
    expect(document.querySelectorAll(".drinkServing")).toHaveLength(4);
    expect(document.body.textContent).not.toContain("0%");
  });

  it("names no pint and paints no pint band on a bottle from the pint lane", () => {
    const drinks = legacyPricesToDrinks([
      { app_price_id: "bottle", pint_name: "BOTTLED BEER", price_gbp: 8 },
      { app_price_id: "half", pint_name: "Lager", measure: "half", price_gbp: 3.1 },
      { app_price_id: "pint", pint_name: "Guinness", price_gbp: 6.2 },
    ]);
    document.body.innerHTML = renderToStaticMarkup(createElement(DrinkMenu, {
      drinks, venueId: "venue-1etf22r", venueName: "Lotus Bar",
    }));
    const row = (name: string) => Array.from(document.querySelectorAll("li.drinkRow"))
      .find((item) => item.querySelector(".drinkName")?.textContent === name)!;
    expect(row("BOTTLED BEER").querySelector(".drinkServing")).toBeNull();
    expect(row("BOTTLED BEER").querySelector(".drinkPrice")?.className).not.toMatch(/(?:^|\s)priceBand-/);
    expect(row("Lager").querySelector(".drinkServing")?.textContent).toBe("half");
    expect(row("Lager").querySelector(".drinkPrice")?.className).not.toMatch(/(?:^|\s)priceBand-/);
    expect(row("Guinness").querySelector(".drinkServing")?.textContent).toBe("pint");
    expect(row("Guinness").querySelector(".drinkPrice")?.className).toMatch(/(?:^|\s)priceBand-/);
  });
});
