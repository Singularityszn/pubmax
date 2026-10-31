import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import MapVenueKindFilter from "@/components/map/MapVenueKindFilter";
import {
  defaultVenueKindVisibility,
  hiddenVenueKindCount,
  offeredVenueKinds,
  showAllVenueKinds,
  mapFilterRefinementCount,
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
  it("offers the curated kinds in every view", () => {
    expect(offeredVenueKinds("all")).toEqual(["pub", "bar", "food", "restaurant"]);
    expect(offeredVenueKinds("no-alcohol")).toEqual([
      "pub",
      "bar",
      "food",
      "restaurant",
    ]);
    // Food service can be stated by pubs and bars too. The badge and chips
    // offer the same four kinds while the lens narrows venue eligibility.
    expect(offeredVenueKinds("food")).toEqual(["pub", "bar", "food", "restaurant"]);
  });

  it("counts the offered kinds that are switched off", () => {
    const all = defaultVenueKindVisibility();
    expect(hiddenVenueKindCount(all, "all")).toBe(0);
    expect(hiddenVenueKindCount({ ...all, bar: false }, "all")).toBe(1);
    expect(
      hiddenVenueKindCount({ ...all, bar: false, restaurant: false }, "all"),
    ).toBe(2);
    expect(hiddenVenueKindCount({ ...all, bar: false }, "food")).toBe(1);
  });

  it("resets only the kinds the reader could see", () => {
    const held = { pub: false, bar: false, food: false, restaurant: false };
    expect(showAllVenueKinds(held, "food")).toEqual({
      pub: true,
      bar: true,
      food: true,
      restaurant: true,
    });
    expect(showAllVenueKinds(held, "all")).toEqual({
      pub: true,
      bar: true,
      food: true,
      restaurant: true,
    });
  });

  it("carries the count on the closed control, in words and in the label", () => {
    expect(venueKindFilterLabel(0)).toBe("Filters");
    expect(venueKindFilterLabel(2)).toBe("Filters · 2");
    expect(venueKindFilterAriaLabel(0)).toBe(
      "Filters: venue types, view and zone",
    );
    expect(venueKindFilterAriaLabel(1)).toBe(
      "Filters: venue types, view and zone, 1 filter on",
    );
    expect(venueKindFilterAriaLabel(2)).toBe(
      "Filters: venue types, view and zone, 2 filters on",
    );
  });

  it("counts every refinement the panel holds, not the kinds alone", () => {
    // The experience lens and the fare-zone picker moved into this panel on
    // 7 Sep 2026 (walk finding B9). A badge counting one of the three would
    // say the map is unfiltered while two filters are on.
    expect(
      mapFilterRefinementCount({
        hiddenKinds: 0,
        lensNarrowed: false,
        zoneNarrowed: false,
      }),
    ).toBe(0);
    expect(
      mapFilterRefinementCount({
        hiddenKinds: 2,
        lensNarrowed: true,
        zoneNarrowed: true,
      }),
    ).toBe(4);
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
    expect(html).toContain('aria-label="Filters: venue types, view and zone"');
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
    expect(html).toContain(
      'aria-label="Filters: venue types, view and zone, 2 filters on"',
    );
  });
});
