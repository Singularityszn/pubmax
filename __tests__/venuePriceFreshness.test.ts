import { describe, expect, it } from "vitest";

import { formatPintDatasetAsOf } from "@/lib/dataFreshness";
import { venuePriceFreshnessLabel } from "@/lib/venuePriceFreshness";

const NOW = new Date("2026-08-27T12:00:00.000Z");

describe("venuePriceFreshnessLabel", () => {
  it("uses sourced observation time when a sourced price owns the figure", () => {
    expect(venuePriceFreshnessLabel({
      cheapestPrice: 4.8,
      latestContributorPrice: 4.2,
      latestContributorAt: "2026-08-26T12:00:00.000Z",
      sourcedPrice: { observedAt: "2026-08-25T12:00:00.000Z" },
    }, NOW)).toBe("observed 2 days ago");
  });

  it("uses contributor time only when that observation owns the figure", () => {
    expect(venuePriceFreshnessLabel({
      cheapestPrice: 4.2,
      latestContributorPrice: 4.2,
      latestContributorAt: "2026-08-27T10:00:00.000Z",
      sourcedPrice: null,
    }, NOW)).toBe("logged 2h ago");
  });

  it("uses a non-pub anchor observation instead of the pint baseline", () => {
    expect(venuePriceFreshnessLabel({
      kind: "bar",
      cheapestPrice: 12,
      latestContributorPrice: null,
      latestContributorAt: null,
      sourcedPrice: null,
      anchorObservedAt: "2026-07-20T12:00:00.000Z",
    }, NOW)).toBe("observed 38 days ago");
  });

  it("keeps baseline time when another contributor figure is present", () => {
    expect(venuePriceFreshnessLabel({
      cheapestPrice: 4.8,
      latestContributorPrice: 4.2,
      latestContributorAt: "2026-08-27T10:00:00.000Z",
      sourcedPrice: null,
    }, NOW)).toBe(formatPintDatasetAsOf());
  });
});
