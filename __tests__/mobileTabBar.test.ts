import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { buildTabs, shouldShowMobileTabBar } from "@/components/nav/MobileTabBar";
import { navPathMatches } from "@/components/nav/navigationModel";

const tabBarSource = readFileSync(
  join(process.cwd(), "components/nav/MobileTabBar.tsx"),
  "utf8",
);

// Six-tab contract for the mobile bar. Moment is a floating + action, never
// a destination, so it is not in this row. Today and Tonight share the Now
// tab; the URL is the truth. Places is the city choice the Map, Out and Near
// surfaces all read, which is why it is a destination rather than a map control.

function activeLabel(pathname: string): string | undefined {
  const tabs = buildTabs();
  return tabs.find((tab) => navPathMatches(pathname, tab.match ?? [tab.href]))?.label;
}

describe("mobile tab bar contract", () => {
  it("shows the app tab bar on every route, including the landing pathname", () => {
    expect(shouldShowMobileTabBar("/")).toBe(true);
    expect(shouldShowMobileTabBar("/pal/chat")).toBe(true);
    expect(shouldShowMobileTabBar("/near")).toBe(true);
    expect(shouldShowMobileTabBar("/map")).toBe(true);
    expect(shouldShowMobileTabBar("/plan")).toBe(true);
    expect(shouldShowMobileTabBar("/out")).toBe(true);
    expect(shouldShowMobileTabBar("/area/clapham/drink/guinness")).toBe(true);
  });

  it("renders exactly six tabs in the journey order", () => {
    const tabs = buildTabs();
    expect(tabs.map((tab) => tab.label)).toEqual([
      "Now",
      "Map",
      "Places",
      "Out",
      "Social",
      "You",
    ]);
  });

  it("keeps gated Social visible as a preview destination", () => {
    const tabs = buildTabs("/u/you", "/today", false);
    const social = tabs.find((tab) => tab.label === "Social");
    expect(tabs.map((tab) => tab.label)).toEqual([
      "Now",
      "Map",
      "Places",
      "Out",
      "Social",
      "You",
    ]);
    expect(social?.preview).toBe(true);
    expect(social?.ariaLabel).toBe("Social preview");
  });

  it("routes every tab to its owned destination", () => {
    const tabs = buildTabs("/u/you", "/tonight");
    const byLabel = Object.fromEntries(tabs.map((tab) => [tab.label, tab]));
    expect(byLabel.Now.href).toBe("/tonight");
    expect(byLabel.Now.match).toEqual(["/today", "/tonight"]);
    expect(byLabel.Map.href).toBe("/map");
    expect(byLabel.Places.href).toBe("/places");
    expect(byLabel.Out.href).toBe("/out");
    expect(byLabel.Social.href).toBe("/social");
    expect(byLabel.You.href).toBe("/u/you");
  });

  it("accepts the preferred-city Map destination, and Places keeps its own", () => {
    const tabs = buildTabs("/u/you", "/today", true, "/map/glasgow");
    expect(tabs.find((tab) => tab.label === "Map")?.href).toBe("/map/glasgow");
    // Places is where the city is CHOSEN, so it never follows the chosen one.
    expect(tabs.find((tab) => tab.label === "Places")?.href).toBe("/places");
  });

  it("points You at the device handle when known (skips /u/you sentinel hop)", () => {
    const tabs = buildTabs("/u/karan");
    const you = tabs.find((tab) => tab.label === "You");
    expect(you?.href).toBe("/u/karan");
    expect(you?.match).toEqual(["/u"]);
  });

  it("keeps Moment out of the tab row", () => {
    const tabs = buildTabs();
    expect(tabs.some((tab) => tab.label === "Moment")).toBe(false);
    expect(tabs.some((tab) => tab.href.startsWith("/moment"))).toBe(false);
    expect(tabs.map((tab) => tab.key)).not.toContain("moment");
  });

  it("replaces history on a tab tap, never pushing (MOBILE_FLOW_SPEC §4.1)", () => {
    // Back must never walk the reader backward through tabs they tapped, so
    // the tab row's Link carries `replace`; in-tab pushes keep pushing.
    const tabLink = tabBarSource.match(/<Link\b[\s\S]*?>/);
    expect(tabLink?.[0]).toContain("href={tab.href}");
    expect(tabLink?.[0]).toMatch(/^\s+replace$/m);
  });

  it("marks Now active on both /today and /tonight", () => {
    expect(activeLabel("/today")).toBe("Now");
    expect(activeLabel("/tonight")).toBe("Now");
    expect(activeLabel("/out")).toBe("Out");
    expect(activeLabel("/places")).toBe("Places");
    expect(activeLabel("/choose-city")).toBe("Places");
    expect(activeLabel("/social")).toBe("Social");
    expect(activeLabel("/feed")).toBe("Social");
    expect(activeLabel("/moment")).toBeUndefined();
  });
});
