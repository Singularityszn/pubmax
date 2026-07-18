import { describe, expect, it } from "vitest";
import { buildTabs } from "@/components/nav/MobileTabBar";

// Six-tab contract for the mobile bar (owner-locked journey order). The shared
// PRIMARY_NAV_ITEMS model stays four destinations by its own contract test;
// Today and Moment are injected by the bar, so THIS test locks what a thumb
// actually meets: order, destinations, and the centre action.

describe("mobile tab bar contract", () => {
  it("renders exactly six tabs in the journey order", () => {
    const tabs = buildTabs("/map", "/tonight");
    expect(tabs.map((tab) => tab.label)).toEqual([
      "Today",
      "Map",
      "Moment",
      "Tonight",
      "Stories",
      "You",
    ]);
  });

  it("routes every tab to its owned destination", () => {
    const tabs = buildTabs("/map/london", "/tonight");
    const byLabel = Object.fromEntries(tabs.map((tab) => [tab.label, tab]));
    expect(byLabel.Today.href).toBe("/today");
    // Map follows the preferred city.
    expect(byLabel.Map.href).toBe("/map/london");
    expect(byLabel.Moment.href).toBe("/moment?returnTo=%2Ftonight");
    expect(byLabel.Tonight.href).toBe("/tonight");
    expect(byLabel.Stories.href).toBe("/feed");
    expect(byLabel.You.href).toBe("/u/you");
  });

  it("marks only Moment as the raised centre action, in the centre slot", () => {
    const tabs = buildTabs("/map", "/map");
    expect(tabs.filter((tab) => tab.primary).map((tab) => tab.label)).toEqual(["Moment"]);
    expect(tabs[2].label).toBe("Moment");
  });
});
