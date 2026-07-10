import { describe, expect, it } from "vitest";

import { DISCOVER_EDITORIAL } from "@/app/discover/DiscoverPageClient";

// Discover editorial CTAs must open map-first crawl/route URLs (polyline),
// not bare /map or filter-only arrivals.

describe("Discover editorial map deep-links", () => {
  it("every editorial card opens /map with a built crawl polyline", () => {
    expect(DISCOVER_EDITORIAL.length).toBeGreaterThanOrEqual(4);
    for (const card of DISCOVER_EDITORIAL) {
      expect(card.href, card.id).toMatch(/^\/map\?/);
      expect(card.href, card.id).toContain("mode=build");
      expect(card.href, card.id).toContain("crawl=");
      expect(card.href, card.id).toContain("pubs=");
    }
  });

  it("heritage card opens Victorian Soho", () => {
    const card = DISCOVER_EDITORIAL.find((c) => c.id === "golden-days");
    expect(card?.href).toContain("crawl=victorian-soho");
  });

  it("coding pint card opens barbican-coding-pint", () => {
    const card = DISCOVER_EDITORIAL.find((c) => c.id === "coding-pint");
    expect(card?.href).toContain("crawl=barbican-coding-pint");
  });

  it("cheap crawl and tonight cards open distinct pack lead crawls", () => {
    const cheap = DISCOVER_EDITORIAL.find((c) => c.id === "then-vs-now");
    const tonight = DISCOVER_EDITORIAL.find((c) => c.id === "tonights-crawl");
    expect(cheap?.href).toMatch(/crawl=/);
    expect(tonight?.href).toMatch(/crawl=/);
    expect(cheap?.href).not.toBe(tonight?.href);
  });
});
