import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MapVenueList from "@/components/map/MapVenueList";
import type { MapVenueListModel, UkBasePubListModel } from "@/lib/mapVenueList";

describe("MapVenueList", () => {
  it("announces rendered base pubs as a distinct group without a listed price", () => {
    const curated: MapVenueListModel = {
      rows: [
        {
          id: "venue-curated",
          name: "Curated Arms",
          typeLabel: "Pub",
          priceLabel: "£4.50",
          anchor: null,
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      coverageNote: null,
    };
    const base: UkBasePubListModel = {
      rows: [
        {
          id: "venue-uk-n123",
          name: "Base Arms",
          priceLabel: "Other pub · no listed price",
          pub: {
            id: "venue-uk-n123",
            name: "Base Arms",
            address: "",
            lat: 53.8,
            lng: -1.55,
            curatedVenueId: "",
          },
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: base,
        cityName: "UK",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
      }),
    );

    expect(html).toContain('aria-label="Listed pubs and venues"');
    expect(html).toContain('aria-label="Other pubs with no listed price"');
    expect(html).toContain("Base Arms");
    expect(html).toContain("Other pub · no listed price");
  });
});
