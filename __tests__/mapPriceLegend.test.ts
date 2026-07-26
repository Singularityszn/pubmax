import { describe, expect, it } from "vitest";

import { mapPriceLegend } from "@/lib/mapPriceLegend";

describe("mapPriceLegend", () => {
  it("keeps absolute pint thresholds for pub-only maps", () => {
    const legend = mapPriceLegend(false);
    expect(legend.rows.map((row) => row.label)).toEqual([
      "≤ £5.50",
      "> £5.50–≤ £7",
      "> £7",
    ]);
    expect(legend.ariaLabel).toContain("Pint price");
  });

  it("explains shared colours as type-relative for bars and late food", () => {
    const legend = mapPriceLegend(true);
    expect(legend.rows.map((row) => row.label)).toEqual([
      "≤ £5.50 · relative low",
      "> £5.50–≤ £7 · relative middle",
      "> £7 · relative high",
    ]);
    expect(legend.ariaLabel).toContain("cocktail bars and late food");
    expect(legend.hint).toContain("within their type");
  });
});
