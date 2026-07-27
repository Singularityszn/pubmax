import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import FavoritePintPicker from "@/components/map/FavoritePintPicker";

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
});
