import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MenuCategoryGrid from "@/components/drinks/MenuCategoryGrid";

describe("MenuCategoryGrid empty state", () => {
  it("renders a contribution action when no drinks are on record", () => {
    const html = renderToStaticMarkup(
      createElement(MenuCategoryGrid, {
        tiles: [],
        onOpenDrinks: () => {},
        onAddDrink: () => {},
      }),
    );

    expect(html).toContain(
      '<button type="button" class="menuHubEmptyAction">Add what you’re drinking</button>',
    );
  });
});
