import { createElement } from "react";
import { priceBandLegendLabel } from "@/lib/priceBand";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MapKey from "@/components/map/MapKey";
import MobilePriceChoices from "@/components/map/MobilePriceChoices";
import { mapPriceLegend } from "@/lib/mapPriceLegend";

describe("MobilePriceChoices", () => {
  it("renders the same derived MapKey tree and rows used by the map key", () => {
    const renderedState = {
      priceBands: [
        { meaning: "pint", bucket: 0 },
        { meaning: "pint", bucket: 3 },
      ],
      storyColour: null,
      clusterPrices: false,
    } as const;
    const legend = mapPriceLegend({ kind: "default", renderedState });
    const expectedKey = renderToStaticMarkup(createElement(MapKey, { legend }));
    const html = renderToStaticMarkup(
      createElement(MobilePriceChoices, {
        maxPrice: 7,
        legend,
        onMaxPriceChange: () => undefined,
      }),
    );

    expect(html).toContain(expectedKey);
    expect(legend.rows.map((row) => row.label)).toEqual([
      priceBandLegendLabel("cheap"),
      "No pint price on the map",
    ]);
    for (const row of legend.rows) {
      expect(html).toContain(row.label);
    }
    expect(html).not.toContain(priceBandLegendLabel("average"));
    expect(html).not.toContain("mobilePriceBandLegend");
  });
});
