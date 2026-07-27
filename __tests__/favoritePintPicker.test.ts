import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import FavoritePintPicker from "@/components/map/FavoritePintPicker";
import { MAP_LENS_DRINK_CATEGORIES } from "@/lib/mapExperienceLens";

function renderPicker(drinkCategory: string) {
  return renderToStaticMarkup(
    createElement(FavoritePintPicker, {
      value: null,
      onChange: vi.fn(),
      drinkCategory,
      drinkBrand: "",
      onDrinkLensChange: vi.fn(),
    }),
  );
}

describe("FavoritePintPicker", () => {
  it("keeps pint brand choice on the pint path", () => {
    expect(renderPicker("")).toContain('aria-label="Favourite pint or beer brand"');
  });

  it("does not imply category prices are specific to a whisky brand", () => {
    const html = renderPicker("whisky");
    expect(html).not.toContain('aria-label="Whisky brand"');
    expect(html).toContain("Whisky prices cover any whisky");
  });

  it("does not offer Other as a map lens", () => {
    // Other stays submittable (a liqueur, a cider), but a pin reading
    // "£6 Other" over a pint glass would label a figure with no drink name.
    const html = renderPicker("");
    expect(html).not.toContain('value="other"');
    for (const category of MAP_LENS_DRINK_CATEGORIES) {
      expect(html).toContain(`value="${category}"`);
    }
  });

  it("falls back to the pint lens for a category the map cannot lens", () => {
    const html = renderPicker("other");
    expect(html).toContain('aria-label="Favourite pint or beer brand"');
    expect(html).not.toContain("Other prices cover any other");
  });
});
