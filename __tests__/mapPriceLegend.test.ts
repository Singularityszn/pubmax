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
    expect(legend.ariaLabel).toContain("bars and late food");
    expect(legend.hint).toContain("within their type");
  });

  it("names selected drink and explains unknown prices", () => {
    const legend = mapPriceLegend(true, "Whisky");
    expect(legend.rows.map((row) => row.label)).toEqual([
      "≤ £5.50",
      "> £5.50–≤ £7",
      "> £7",
    ]);
    expect(legend.ariaLabel).toContain("Whisky price");
    expect(legend.title).toBe("Whisky price bands");
    expect(legend.hint).toContain("unknown");
    expect(legend.hint).not.toContain("pint");
  });

  it("keeps a truncated read painting trusted prices, saying so", () => {
    // A partial scan ANSWERED and its figures are already on the pins, so it
    // keeps the trusted-price sentence rather than borrowing the failure one.
    const partial = mapPriceLegend(true, "Whisky", "partial");
    expect(partial.hint).toContain("trusted whisky prices");
    expect(partial.hint).toContain("part of the list");
    expect(partial.hint).not.toContain("could not");
  });

  it("never lets an unreadable index read as a city with no prices", () => {
    const degraded = mapPriceLegend(true, "Whisky", "degraded");
    expect(degraded.hint).toContain("could not read");
    expect(degraded.hint).not.toContain("trusted whisky prices");
    expect(degraded.hint).not.toBe(mapPriceLegend(true, "Whisky").hint);
    expect(degraded.hint).not.toBe(
      mapPriceLegend(true, "Whisky", "partial").hint,
    );
  });

  it("says a read is still running rather than settling it early", () => {
    expect(mapPriceLegend(true, "Whisky", "loading").hint).toContain(
      "Checking whisky prices",
    );
    expect(mapPriceLegend(true, "Whisky", "idle").hint).toContain(
      "Checking whisky prices",
    );
  });
});
