import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import MapVenueKindFilter from "@/components/map/MapVenueKindFilter";
import {
  defaultVenueKindVisibility,
  hiddenVenueKindCount,
  offeredVenueKinds,
  showAllVenueKinds,
  venueKindFilterAriaLabel,
  venueKindFilterLabel,
} from "@/lib/venueKindFilters";

/**
 * PlanAstra item 9. From 641px up the five venue-type chips floated over the
 * map as a permanent band, part of the 20 to 24 controls a tablet met before
 * it had tapped a pin. They live behind ONE control now, and the rule the
 * control has to keep is that a closed panel may not hide which kinds the map
 * is leaving out - the same rule "Show me" and "Drink" keep beside it.
 */
describe("the venue-type filter counts what the panel offers", () => {
  it("offers the curated kinds, narrowed by the view the map is under", () => {
    expect(offeredVenueKinds("all")).toEqual(["pub", "bar", "food", "restaurant"]);
    expect(offeredVenueKinds("no-alcohol")).toEqual([
      "pub",
      "bar",
      "food",
      "restaurant",
    ]);
    // The food view offers the two kinds its own chips draw, so the badge can
    // never count a kind the open panel does not show.
    expect(offeredVenueKinds("food")).toEqual(["food", "restaurant"]);
  });

  it("counts the offered kinds that are switched off", () => {
    const all = defaultVenueKindVisibility();
    expect(hiddenVenueKindCount(all, "all")).toBe(0);
    expect(hiddenVenueKindCount({ ...all, bar: false }, "all")).toBe(1);
    expect(
      hiddenVenueKindCount({ ...all, bar: false, restaurant: false }, "all"),
    ).toBe(2);
    // A kind the food view does not offer is not counted against it.
    expect(hiddenVenueKindCount({ ...all, bar: false }, "food")).toBe(0);
  });

  it("resets only the kinds the reader could see", () => {
    const held = { pub: false, bar: false, food: false, restaurant: false };
    expect(showAllVenueKinds(held, "food")).toEqual({
      pub: false,
      bar: false,
      food: true,
      restaurant: true,
    });
    expect(showAllVenueKinds(held, "all")).toEqual(defaultVenueKindVisibility());
  });

  it("carries the count on the closed control, in words and in the label", () => {
    expect(venueKindFilterLabel(0)).toBe("Filters");
    expect(venueKindFilterLabel(2)).toBe("Filters · 2");
    expect(venueKindFilterAriaLabel(0)).toBe("Filters: venue types");
    expect(venueKindFilterAriaLabel(1)).toBe(
      "Filters: venue types, 1 type hidden",
    );
    expect(venueKindFilterAriaLabel(2)).toBe(
      "Filters: venue types, 2 types hidden",
    );
  });
});

describe("the control the desktop map opens", () => {
  function render(visibility = defaultVenueKindVisibility()): string {
    return renderToStaticMarkup(
      createElement(MapVenueKindFilter, {
        visibility,
        onChange: vi.fn(),
      }),
    );
  }

  it("is closed at rest, and says so", () => {
    const html = render();
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Filters: venue types"');
    // Closed means closed: no chips in the document until the reader opens it.
    expect(html).not.toContain("tonightArcChip");
  });

  it("names the hidden kinds on the closed control", () => {
    const html = render({
      pub: true,
      bar: false,
      food: false,
      restaurant: true,
    });
    // The word and the count are two elements, because the word is what the
    // 641 to 900px toolbar budget drops and the count is what stays.
    expect(html).toContain('class="mapVenueKindFilterWord"');
    expect(html).toContain('class="mapVenueKindFilterCount"');
    expect(html).toContain(">2<");
    expect(html).toContain('aria-label="Filters: venue types, 2 types hidden"');
    const css = readFileSync(
      join(process.cwd(), "components/map/mapVenueKindFilter.css"),
      "utf8",
    );
    expect(css).toMatch(
      /@media \(min-width: 641px\) and \(max-width: 900px\)[\s\S]*?\.mapVenueKindFilterWord\s*{[\s\S]*?display:\s*none/,
    );
  });
});
