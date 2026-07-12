import { describe, expect, it } from "vitest";

import {
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
