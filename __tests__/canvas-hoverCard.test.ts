import { describe, expect, it } from "vitest";

import {
  hoverCardCopy,
  hoverPriceLine,
  withBoundedHoverDetailCache,
  hoverImageUrlFor,
} from "@/components/map/canvas/hoverCard";
import type { VenueSignal, FailedHoverImage } from "@/components/map/canvas/types";
import type { Venue } from "@/lib/venues";
import { proxiedVenueImageUrl } from "@/lib/venueImages";

describe("hoverPriceLine", () => {
  it("prefers community price", () => {
    const line = hoverPriceLine(
      { latestContributorPrice: 4.5 } as Venue,
      { latestContributorPrice: 4.5 } as VenueSignal,
      null,
    );
    expect(line.price).toBe(4.5);
    expect(line.provenance.startsWith("Community")).toBe(true);
  });

  it("pairs a signal price with that signal's own freshness timestamp", () => {
    const now = Date.now();
    const line = hoverPriceLine(
      {
        latestContributorPrice: 5.5,
        latestContributorAt: new Date(now - 3 * 86_400_000).toISOString(),
      } as Venue,
      {
        hasPintDrops: false,
        latestContributorPrice: 4.5,
        latestContributorAt: now - 120_000,
      } satisfies VenueSignal,
      null,
    );

    expect(line).toEqual({
      price: 4.5,
      provenance: "Community · logged 2m ago",
    });
  });

  it("falls to sourced with cheapestPrice", () => {
    const line = hoverPriceLine(
      { cheapestPrice: 6, sourcedPrice: { observedAt: null } } as unknown as Venue,
      undefined,
      null,
    );
    expect(line.price).toBe(6);
    expect(line.provenance.startsWith("Sourced")).toBe(true);
  });

  it("falls to baseline", () => {
    const line = hoverPriceLine({ cheapestPrice: 5 } as Venue, undefined, null);
    expect(line.price).toBe(5);
    expect(line.provenance).toBe("Baseline · tap for detail");
  });

  it("returns tap-for-detail when nothing is known", () => {
    const line = hoverPriceLine({} as Venue, undefined, null);
    expect(line.price).toBeNull();
    expect(line.provenance).toBe("Tap for detail");
  });
});

describe("hoverCardCopy", () => {
  it("uses cocktail anchor metadata and ignores Pint Drop signals for bars", () => {
    const copy = hoverCardCopy(
      {
        kind: "bar",
        cheapestPrice: 25,
        anchorLabel: "Welcome to The Savoy",
        anchorObservedAt: "2026-07-26",
        anchorSourceUrl:
          "https://www.thesavoylondon.com/restaurants-and-bars/american-bar",
      } as Venue,
      {
        hasPintDrops: true,
        latestContributorPrice: 4.5,
        latestContributorAt: Date.now(),
      },
      null,
    );

    expect(copy).toEqual({
      venueTypeLabel: "Cocktail bar",
      price: 25,
      priceSuffix: "Welcome to The Savoy",
      provenance: "Anchor · Jul · thesavoylondon.com",
      detailLabel: "venue detail",
    });
    expect(copy.priceSuffix).not.toContain("pint");
  });

  it("uses the large doner anchor label for late-food venues", () => {
    const copy = hoverCardCopy(
      {
        kind: "food",
        cheapestPrice: 15,
        anchorLabel: "Large lamb doner",
        anchorObservedAt: "2026-07-26",
        anchorSourceUrl: "https://tbtk.co.uk/",
      } as Venue,
      undefined,
      null,
    );

    expect(copy.venueTypeLabel).toBe("Late food");
    expect(copy.price).toBe(15);
    expect(copy.priceSuffix).toBe("Large lamb doner");
    expect(copy.provenance).toBe("Anchor · Jul · tbtk.co.uk");
  });
});

describe("withBoundedHoverDetailCache", () => {
  it("moves a re-inserted id to newest", () => {
    let cache = new Map<string, Venue | null>();
    cache = withBoundedHoverDetailCache(cache, "a", null);
    cache = withBoundedHoverDetailCache(cache, "b", null);
    cache = withBoundedHoverDetailCache(cache, "a", null);
    expect([...cache.keys()]).toEqual(["b", "a"]);
  });

  it("caps the size at 24, evicting the oldest", () => {
    let cache = new Map<string, Venue | null>();
    for (let i = 0; i < 30; i++) {
      cache = withBoundedHoverDetailCache(cache, `id-${i}`, null);
    }
    expect(cache.size).toBe(24);
    expect(cache.has("id-0")).toBe(false);
    expect(cache.has("id-29")).toBe(true);
  });
});

describe("hoverImageUrlFor", () => {
  it("returns '' when the failed image matches the hovered id + url", () => {
    const detail = { imageUrl: "http://example.com/x.jpg" } as Venue;
    const src = proxiedVenueImageUrl("http://example.com/x.jpg");
    const failed: FailedHoverImage = { venueId: "v1", url: src };
    expect(hoverImageUrlFor(detail, failed, "v1")).toBe("");
  });

  it("returns the proxied src otherwise", () => {
    const detail = { imageUrl: "http://example.com/x.jpg" } as Venue;
    const src = proxiedVenueImageUrl("http://example.com/x.jpg");
    expect(hoverImageUrlFor(detail, null, "v1")).toBe(src);
  });
});
