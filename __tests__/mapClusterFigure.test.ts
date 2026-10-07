import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import { afterEach, describe, expect, it } from "vitest";

import {
  CLUSTER_FIGURE_EXPR,
  CLUSTER_PRICE_NONE,
} from "@/components/map/canvas/filters";
import { formatPinPriceLabel } from "@/components/map/canvas/geojson";

// The disc's figure is written by a MapLibre expression on the GL layer and by
// formatPinPriceLabel on the desktop donut. They are one claim in two languages,
// so this holds them to the same answer rather than trusting two hand-written
// copies to agree.
function figureFor(properties: Record<string, unknown>): string {
  const compiled = createExpression(CLUSTER_FIGURE_EXPR as never, {
    type: "string",
    "property-type": "data-driven",
    expression: { interpolated: false, parameters: ["zoom", "feature"] },
  } as never);
  if (compiled.result !== "success") throw new Error("CLUSTER_FIGURE_EXPR did not compile");
  return String(compiled.value.evaluate({ zoom: 12 } as never, { type: 1, properties } as never));
}

describe("CLUSTER_FIGURE_EXPR", () => {
  it.each([3.2, 5.4, 5.45, 6, 12.5, 4.95, 5.405, 6.999, 0.5, 10])(
    "writes %s the way a pin writes it",
    (price) => {
      expect(figureFor({ minPrice: price, point_count_abbreviated: 94 })).toBe(
        formatPinPriceLabel(price),
      );
    },
  );

  it("prints the count where no pub in the cluster says a price", () => {
    expect(figureFor({ minPrice: CLUSTER_PRICE_NONE, point_count_abbreviated: 94 })).toBe("94");
    expect(figureFor({ point_count_abbreviated: "1.5k" })).toBe("1.5k");
  });

  describe("under a reader whose default locale writes a decimal comma", () => {
    const RealNumberFormat = Intl.NumberFormat;
    afterEach(() => {
      Intl.NumberFormat = RealNumberFormat;
    });

    it("still writes the pence the way a pin does", () => {
      Intl.NumberFormat = function (
        locales?: string | string[],
        options?: Intl.NumberFormatOptions,
      ) {
        const unset = locales === undefined || (Array.isArray(locales) && locales.length === 0);
        return new RealNumberFormat(unset ? "de-DE" : locales, options);
      } as unknown as typeof Intl.NumberFormat;
      expect(new Intl.NumberFormat(undefined, { minimumFractionDigits: 2 }).format(5.4)).toBe(
        "5,40",
      );
      expect(figureFor({ minPrice: 5.4, point_count_abbreviated: 94 })).toBe(
        formatPinPriceLabel(5.4),
      );
    });
  });
});
