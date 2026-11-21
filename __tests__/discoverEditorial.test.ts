import { describe, expect, it } from "vitest";

import {
  DISCOVER_EDITORIAL,
  discoverDrinkBrowseLede,
} from "@/app/discover/DiscoverPageClient";
import {
  categoryLabel,
  MAP_LENS_DRINK_CATEGORIES,
} from "@/lib/drinks";


describe("Discover drink browse lede", () => {
  it("lists every map-lens category so coffee cannot drift out", () => {
    const lede = discoverDrinkBrowseLede();
    expect(lede.startsWith("Browse ")).toBe(true);
    expect(lede.endsWith(".")).toBe(true);
    for (const category of MAP_LENS_DRINK_CATEGORIES) {
      const label =
        category === "alcohol-free"
          ? "alcohol-free drinks"
          : categoryLabel(category).toLocaleLowerCase("en-GB");
      expect(lede).toContain(label);
    }
    expect(lede).toContain("coffee");
    expect(lede).not.toMatch(/\bother\b/i);
  });
});

describe("Discover editorial map deep-links", () => {
  it("curated editorial cards open a built crawl", () => {
    expect(DISCOVER_EDITORIAL.length).toBeGreaterThanOrEqual(4);
    for (const card of DISCOVER_EDITORIAL.filter((card) => card.id !== "tonights-crawl")) {
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

  it("opens the planner before choosing an outing", () => {
    const tonight = DISCOVER_EDITORIAL.find((card) => card.id === "tonights-crawl");
    expect(tonight?.href).toBe("/plan");
  });

  it("keeps London editorial on /map (never /map/<other-city>)", () => {
    for (const card of DISCOVER_EDITORIAL.filter((card) => card.id !== "tonights-crawl")) {
      expect(card.href, card.id).toMatch(/^\/map\?/);
      expect(card.href, card.id).not.toMatch(/^\/map\/[^/]+\?/);
    }
  });
});
