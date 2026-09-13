import { describe, expect, it } from "vitest";

import { CITIES } from "@/lib/cities";
import {
  BASE_TABS,
  DEFAULT_TAB,
  gettingHomeLabel,
  resolveVenueTab,
  tabsForCity,
  tabsForVenue,
} from "@/lib/venueInspectorTabs";

describe("venueInspectorTabs", () => {
  it("opens on the useful venue overview", () => {
    expect(DEFAULT_TAB).toBe("overview");
    expect(BASE_TABS.map((tab) => tab.label)).toEqual([
      "Overview",
      "Photos",
      "Drinks",
      "Stories",
      "Lore",
    ]);
  });

  /**
   * Captain, 5 Sep 2026: "The alignment, buttons and ui is fucking ugly." The
   * site audit of 13 Sep (D10) measured seven tabs wrapping into two rows on a
   * 390px phone (rows at y=556 and y=602, a 98px tablist). A scrolling strip
   * hid the last tabs past the edge, which is worse. Five tabs share one row,
   * so every section is one tap away and none is hidden.
   */
  it("never asks a phone row to hold more than five tabs, for any city or kind", () => {
    for (const cityId of Object.keys(CITIES) as (keyof typeof CITIES)[]) {
      expect(tabsForCity(cityId).length, cityId).toBeLessThanOrEqual(5);
      expect(tabsForVenue(cityId, "pub").length, cityId).toBeLessThanOrEqual(5);
    }
  });

  it("folds Ask into Lore and the getting-home card into Overview", () => {
    const keys = tabsForCity("london").map((tab) => tab.key);
    expect(keys).not.toContain("ask");
    expect(keys).not.toContain("getting-home");
    // A held trail entry or an old caller may still name a retired tab; it
    // lands on the tab that now carries that section.
    expect(resolveVenueTab("ask")).toBe("story");
    expect(resolveVenueTab("getting-home")).toBe("overview");
    expect(resolveVenueTab("menu")).toBe("menu");
    expect(resolveVenueTab("")).toBe(DEFAULT_TAB);
    expect(resolveVenueTab("nonsense")).toBe(DEFAULT_TAB);
  });

  it("names the getting-home section by the city's own last-ride mode", () => {
    // London's card is branded "Last Pint", so the section names the transport
    // mode instead, and does not collide with Pint Drops.
    expect(gettingHomeLabel("london")).toBe("Last train");
    expect(gettingHomeLabel("manchester")).toBe("Last Tram");
  });

  it("never renders two tabs with the same short label, for any city", () => {
    for (const cityId of Object.keys(CITIES) as (keyof typeof CITIES)[]) {
      const tabs = tabsForCity(cityId);
      const shortLabels = tabs.map((t) => t.shortLabel);
      const unique = new Set(shortLabels);
      expect(unique.size, `duplicate shortLabel for city "${cityId}": ${shortLabels.join(", ")}`).toBe(
        shortLabels.length,
      );
    }
  });

  it("removes Pint Drop stories from non-pub venue tabs", () => {
    expect(tabsForVenue("london", "bar").map((tab) => tab.key)).not.toContain("pints");
    expect(tabsForVenue("london", "food").map((tab) => tab.key)).not.toContain("pints");
    expect(tabsForVenue("london", undefined).map((tab) => tab.key)).toContain("pints");
  });
});
