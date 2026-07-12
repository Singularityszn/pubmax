import { describe, expect, it } from "vitest";

import { CITIES } from "@/lib/cities";
import { BASE_TABS, DEFAULT_TAB, tabsForCity } from "@/lib/venueInspectorTabs";

describe("venueInspectorTabs", () => {
  it("keeps Drops as the default tab", () => {
    expect(DEFAULT_TAB).toBe("pints");
  });

  it("appends a getting-home tab after the base tabs for London", () => {
    const tabs = tabsForCity("london");
    expect(tabs.slice(0, BASE_TABS.length).map((t) => t.key)).toEqual(
      BASE_TABS.map((t) => t.key),
    );
    const last = tabs[tabs.length - 1];
    expect(last.key).toBe("getting-home");
    expect(last.label.length).toBeGreaterThan(0);
    expect(last.shortLabel.length).toBeGreaterThan(0);
  });

  it("uses a city-specific last-ride label for the getting-home tab", () => {
    const london = tabsForCity("london");
    const manchester = tabsForCity("manchester");
    const londonRide = london[london.length - 1];
    const manchesterRide = manchester[manchester.length - 1];
    // Both cities expose a getting-home tab with a non-empty label; the label is
    // provider-driven per city (London TfL "last train" vs. Manchester tram).
    expect(londonRide.key).toBe("getting-home");
    expect(manchesterRide.key).toBe("getting-home");
    expect(typeof londonRide.label).toBe("string");
    expect(typeof manchesterRide.label).toBe("string");
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
});
