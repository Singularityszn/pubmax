import { describe, expect, it } from "vitest";

import { formatPintDatasetAsOf } from "@/lib/dataFreshness";
import {
  venuePriceCaption,
  venuePriceFreshnessLabel,
} from "@/lib/venuePriceFreshness";

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

describe("venuePriceCaption", () => {
  it("attributes a sourced price to its linked publisher and observation", () => {
    expect(venuePriceCaption({
      cheapestPrice: 4.8,
      latestContributorPrice: null,
      latestContributorAt: null,
      sourcedPrice: {
        sourceLabel: "The Test Arms",
        sourceUrl: "https://example.test/menu",
        observedAt: "2026-08-25T12:00:00.000Z",
      },
    }, NOW)).toEqual({
      label: "The Test Arms",
      href: "https://example.test/menu",
      freshness: "observed 2 days ago",
    });
  });

  it("attributes the winning community figure to a contributor", () => {
    expect(venuePriceCaption({
      cheapestPrice: 4.2,
      latestContributorPrice: 4.2,
      latestContributorAt: "2026-08-27T10:00:00.000Z",
      sourcedPrice: null,
    }, NOW)).toEqual({
      label: "Contributor price",
      href: null,
      freshness: "logged 2h ago",
    });
  });

  it("links the named publisher that owns a baseline price", () => {
    expect(venuePriceCaption({
      cheapestPrice: 4.8,
      latestContributorPrice: null,
      latestContributorAt: null,
      sourcedPrice: null,
      prices: [{
        app_price_id: "price-1",
        pint_name: "Test Bitter",
        price_gbp: 4.8,
        pub_url: "https://www.pint-prices.com/pubs/test-arms",
      }],
    }, NOW)).toEqual({
      label: "Pint Prices",
      href: "https://www.pint-prices.com/pubs/test-arms",
      freshness: formatPintDatasetAsOf(),
    });
  });

  it("states when a baseline price has no publisher", () => {
    expect(venuePriceCaption({
      cheapestPrice: 4.8,
      latestContributorPrice: null,
      latestContributorAt: null,
      sourcedPrice: null,
      prices: [{
        app_price_id: "price-1",
        pint_name: "Test Bitter",
        price_gbp: 4.8,
      }],
    }, NOW)).toEqual({
      label: "Publisher not recorded",
      href: null,
      freshness: formatPintDatasetAsOf(),
    });
  });

  it("attributes a non-pub anchor to its own source", () => {
    expect(venuePriceCaption({
      kind: "bar",
      cheapestPrice: 12,
      latestContributorPrice: null,
      latestContributorAt: null,
      sourcedPrice: null,
      anchorLabel: "House cocktail",
      anchorObservedAt: "2026-07-20T12:00:00.000Z",
      anchorSourceUrl: "https://example.test/cocktails",
    }, NOW)).toEqual({
      label: "House cocktail",
      href: "https://example.test/cocktails",
      freshness: "observed 38 days ago",
    });
  });

  it("does not link an unsafe non-pub anchor URL", () => {
    expect(venuePriceCaption({
      kind: "bar",
      cheapestPrice: 12,
      latestContributorPrice: null,
      latestContributorAt: null,
      sourcedPrice: null,
      anchorLabel: "House cocktail",
      anchorObservedAt: "2026-07-20T12:00:00.000Z",
      anchorSourceUrl: "javascript:alert('test')",
    }, NOW)).toEqual({
      label: "House cocktail",
      href: null,
      freshness: "observed 38 days ago",
    });
  });
});
