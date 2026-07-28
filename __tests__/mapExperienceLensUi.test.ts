import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MapExperienceLens from "@/components/map/MapExperienceLens";
import TonightArcChips from "@/components/map/TonightArcChips";

describe("MapExperienceLens", () => {
  it("offers all, no-alcohol, and food views with selected state and status copy", () => {
    const html = renderToStaticMarkup(
      createElement(MapExperienceLens, {
        lens: "no-alcohol",
        summary:
          "No alcohol-free or soft drink prices logged here yet. Food venues still show sourced menu prices.",
        onChange: () => undefined,
      }),
    );

    expect(html).toContain(">All<");
    expect(html).toContain(">No alcohol<");
    expect(html).toContain(">Food<");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("No alcohol-free or soft drink prices logged here yet.");
  });

  it("ships 44px targets and wraps safely at 390px", () => {
    const css = readFileSync(
      join(process.cwd(), "components/map/mapExperienceLens.css"),
      "utf8",
    );
    expect(css).toMatch(/\.mapExperienceLensOption\s*{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.mapExperienceLensOptions\s*{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.mapExperienceLens\s*{[^}]*min-width:\s*0/);
  });

  it("removes pint-only controls while an experience view owns the map", () => {
    const pubMap = readFileSync(
      join(process.cwd(), "components/PubMap.tsx"),
      "utf8",
    );
    const toolbar = readFileSync(
      join(process.cwd(), "components/map/MapToolbar.tsx"),
      "utf8",
    );

    expect(pubMap).toMatch(
      /experienceLens === "all"\s*\?\s*\([\s\S]*?<DrinkShapeChips/,
    );
    expect(pubMap).toMatch(
      /activeLensPrices !== null\s*\?\s*\([\s\S]*?selectedLensPrice[\s\S]*?Unknown/,
    );
    // The peek is a single-row read of the same index the list and the sheet
    // report on, so it uses their helper rather than a fifth sentence that
    // could settle a partial or unread index as "none logged".
    expect(pubMap).toMatch(
      /selectedLensPrice\?\.categoryLabel \?\?\s*\n?\s*drinkLensUnknownRowLabel\(/,
    );
    expect(pubMap).not.toContain("No price logged");
    expect(pubMap).toContain("experienceLens={experienceLens}");
    expect(pubMap).toContain(
      'drinkCategory={experienceLens === "all" ? filters.drinkCategory || null : null}',
    );
    expect(pubMap).toContain(
      "const mobileShellReady = !mapLoadingActive;",
    );
    expect(pubMap).toContain("food: true,");
    expect(pubMap).toContain("restaurant: true,");
    expect(pubMap).toMatch(
      /!mobileViewport && experienceLens === "all"\s*\?\s*\([\s\S]*?<MapPriceControl/,
    );
    expect(pubMap).toMatch(
      /experienceLens === "all"\s*\?\s*\(\s*<TabsTrigger value="prices">/,
    );
    expect(pubMap).toMatch(
      /experienceLens === "all"\s*\?\s*\(\s*<TabsContent value="prices"/,
    );
    expect(toolbar).toMatch(
      /experienceLens === "all"\s*\?\s*\([\s\S]*?mapToolbarDrinksBtn/,
    );
    const overview = readFileSync(
      join(
        process.cwd(),
        "components/map/inspector/VenueOverviewTab.tsx",
      ),
      "utf8",
    );
    expect(overview).toContain('experienceLens === "food"');
    expect(overview).toMatch(
      /experienceLens !== "no-alcohol" \|\|[\s\S]*?venue\.kind === "food"[\s\S]*?<VenuePriceSummary/,
    );
    expect(overview).toMatch(
      /experienceLens === "all"\s*\?\s*\([\s\S]*?<VenuePriceThen/,
    );
  });

  it("renames pubs for no-alcohol nights and keeps food view food-first", () => {
    const visibility = {
      pub: true,
      bar: true,
      food: true,
      restaurant: true,
    };
    const noAlcohol = renderToStaticMarkup(
      createElement(TonightArcChips, {
        visibility,
        experienceLens: "no-alcohol",
        onChange: () => undefined,
      }),
    );
    expect(noAlcohol).toContain(">Pubs<");
    expect(noAlcohol).not.toContain(">Pints<");

    const food = renderToStaticMarkup(
      createElement(TonightArcChips, {
        visibility,
        experienceLens: "food",
        onChange: () => undefined,
      }),
    );
    expect(food).toContain(">Food<");
    expect(food).toContain(">Restaurants<");
    expect(food).not.toContain(">Pints<");
    expect(food).not.toContain(">Bars<");
  });
});
