import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import PriceBadge from "@/components/PriceBadge";
import CompactVenuePrice from "@/components/map/CompactVenuePrice";
import { hoverCardCopy } from "@/components/map/canvas/hoverCard";
import { priceBand } from "@/lib/priceBand";
import { priceBucket } from "@/lib/communityPrice";
import { orientationLegendRows } from "@/lib/mapPriceLegend";
import type { Venue } from "@/lib/venues";

describe("rendered price bands", () => {
  it("PriceBadge takes the band as a prop and paints the class family, or nothing", () => {
    const banded = renderToStaticMarkup(createElement(PriceBadge, { band: "expensive" }, "£6.50"));
    expect(banded).toMatch(/class="priceBadge priceBadge--neutral priceBand-expensive /);
    const bare = renderToStaticMarkup(createElement(PriceBadge, {}, "£6.50"));
    expect(bare).not.toContain("priceBand-");
  });

  it("a List view figure wears its band inside the compact price", () => {
    const html = renderToStaticMarkup(
      createElement(CompactVenuePrice, { priceLabel: "£4.20", anchor: null, band: "cheap" }),
    );
    expect(html).toContain('<span class="priceBand-cheap">£4.20</span>');
  });

  it("the hover card carries the band of a pint and none for an anchor", () => {
    const pub = { id: "venue-x", kind: "pub", cheapestPrice: 6.5, name: "X" } as unknown as Venue;
    expect(hoverCardCopy(pub, undefined, null).priceBand).toBe("expensive");
    const bar = { id: "venue-y", kind: "bar", cheapestPrice: 12, anchorLabel: "Cocktail" } as unknown as Venue;
    expect(hoverCardCopy(bar, undefined, null).priceBand).toBeNull();
  });

  it("the pin bucket, the legend and the band module agree on one £6.50", () => {
    expect(priceBucket(6.5)).toBe(2);
    expect(priceBand(6.5)).toBe("expensive");
    expect(orientationLegendRows()[2]).toMatchObject({ tone: "red", label: "Over £6.20" });
  });
});
