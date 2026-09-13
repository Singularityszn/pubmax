import { describe, expect, it } from "vitest";

import {
  BASE_TABS,
  DEFAULT_TAB,
  gettingHomeLabel,
  resolveVenueTab,
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
  it("never asks a phone row to hold more than five tabs, for any kind", () => {
    expect(tabsForVenue("pub").length).toBeLessThanOrEqual(5);
    expect(tabsForVenue(undefined).length).toBeLessThanOrEqual(5);
    expect(tabsForVenue("bar").length).toBeLessThanOrEqual(5);
  });

  it("folds Ask into Lore and the getting-home card into Overview", () => {
    const keys = tabsForVenue("pub").map((tab) => tab.key);
    expect(keys).not.toContain("ask");
    expect(keys).not.toContain("getting-home");
    // The route-end door asks for the getting-home fold by name; it lands on
    // the tab that carries it.
    expect(resolveVenueTab("getting-home", "pub")).toBe("overview");
    expect(resolveVenueTab("menu", "pub")).toBe("menu");
    expect(resolveVenueTab("", "pub")).toBe(DEFAULT_TAB);
    expect(resolveVenueTab("nonsense", "pub")).toBe(DEFAULT_TAB);
  });

  it("opens Stories only on a venue that has a Stories tab", () => {
    expect(resolveVenueTab("pints", "pub")).toBe("pints");
    expect(resolveVenueTab("pints", "bar")).toBe(DEFAULT_TAB);
    expect(resolveVenueTab("getting-home", "bar")).toBe("overview");
  });

  it("names the getting-home section by the city's own last-ride mode", () => {
    // London's card is branded "Last Pint", so the section names the transport
    // mode instead, and does not collide with Pint Drops.
    expect(gettingHomeLabel("london")).toBe("Last train");
    expect(gettingHomeLabel("manchester")).toBe("Last Tram");
  });

  it("never renders two tabs with the same short label", () => {
    const shortLabels = BASE_TABS.map((t) => t.shortLabel);
    expect(new Set(shortLabels).size, `duplicate shortLabel: ${shortLabels.join(", ")}`).toBe(
      shortLabels.length,
    );
  });

  it("removes Pint Drop stories from non-pub venue tabs", () => {
    expect(tabsForVenue("bar").map((tab) => tab.key)).not.toContain("pints");
    expect(tabsForVenue("food").map((tab) => tab.key)).not.toContain("pints");
    expect(tabsForVenue(undefined).map((tab) => tab.key)).toContain("pints");
  });
});
