import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";

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
      expect(figureFor({ minPrice: price, point_count_abbreviated: "94" })).toBe(
        formatPinPriceLabel(price),
      );
    },
  );

  it("prints the count where no pub in the cluster says a price", () => {
    expect(figureFor({ minPrice: CLUSTER_PRICE_NONE, point_count_abbreviated: "94" })).toBe("94");
    expect(figureFor({ point_count_abbreviated: "1.5k" })).toBe("1.5k");
  });
});
