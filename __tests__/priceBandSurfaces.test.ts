import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import PriceBadge from "@/components/PriceBadge";
import CompactVenuePrice from "@/components/map/CompactVenuePrice";
import FeedCard from "@/components/feed/FeedCard";
import { normalizePintDrop } from "@/lib/feed";
import type { DrinkMeasure } from "@/lib/drinkMeasure";
import { hoverCardCopy } from "@/components/map/canvas/hoverCard";
import { priceBand } from "@/lib/priceBand";
import { priceBucket } from "@/lib/communityPrice";
import { orientationLegendRows } from "@/lib/mapPriceLegend";
import type { Venue } from "@/lib/venues";

describe("rendered price bands", () => {
  describe.each([null, "https://cdn.example/pint.jpg"])("feed photo %s", (pintPhotoUrl) => {
    it.each<{
      measure: DrinkMeasure | undefined;
      measureLabel?: string;
      label: string;
      banded: boolean;
    }>([
      { measure: "pint", label: "£2.50", banded: true },
      { measure: "half", label: "£2.50 · Half", banded: false },
      { measure: "125ml", label: "£2.50 · 125 ml", banded: false },
      { measure: "175ml", label: "£2.50 · 175 ml", banded: false },
      { measure: "250ml", label: "£2.50 · 250 ml", banded: false },
      { measure: "bottle", label: "£2.50 · Bottle", banded: false },
      { measure: "single", label: "£2.50 · Single", banded: false },
      { measure: "double", label: "£2.50 · Double", banded: false },
      { measure: "other", measureLabel: "Schooner", label: "£2.50 · Schooner", banded: false },
      { measure: undefined, label: "£2.50 · Measure unknown", banded: false },
    ])("labels $measure and reserves pint bands", ({ measure, measureLabel, label, banded }) => {
      const item = normalizePintDrop({
        id: "serving-drop", handle: "alice", venueId: "venue-1", drink: "Lager",
        priceGbp: 2.5, measure, measureLabel, passedDownNote: "", era: "",
        provenance: "contributor", createdAt: "2026-11-20T12:00:00Z",
        pintPhotoUrl, venuePhotoUrl: null,
      });
      const html = renderToStaticMarkup(createElement(FeedCard, {
        item, summary: { counts: {}, mine: [] }, onToggleReaction: () => {},
      }));
      expect(html).toContain(label);
      expect(/priceBand-(cheap|average|expensive)/.test(html)).toBe(banded);
    });
  });

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
