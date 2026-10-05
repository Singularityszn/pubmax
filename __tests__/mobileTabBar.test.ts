import type { Route } from "next";
import { describe, expect, it } from "vitest";
import { buildTabs, shouldShowMobileTabBar } from "@/components/nav/MobileTabBar";
import { navPathMatches } from "@/components/nav/navigationModel";
import { defined } from "@/__tests__/helpers/defined";

// Six-tab contract for the mobile bar, in the order of the loop: find (Tonight,
// Map, Places, Out), plan (Plan), and You. Moment is a floating + action, never
// a destination, and Social lives under More, so neither is in this row. Today
// and Tonight share the Tonight tab; the URL is the truth.

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

  it("renders exactly six tabs in the loop order", () => {
    const tabs = buildTabs();
    expect(tabs.map((tab) => tab.label)).toEqual([
      "Tonight",
      "Map",
      "Places",
      "Out",
      "Plan",
      "You",
    ]);
  });

  it("names every tab on the link itself, so hiding the word at large text costs nothing", () => {
    for (const tab of buildTabs()) expect(tab.ariaLabel).toBe(tab.label);
  });

  it("keeps Social and Moment out of the dock", () => {
    const tabs = buildTabs();
    expect(tabs.some((tab) => tab.label === "Social")).toBe(false);
    expect(tabs.some((tab) => tab.href.startsWith("/social"))).toBe(false);
    expect(tabs.some((tab) => tab.label === "Moment")).toBe(false);
    expect(tabs.some((tab) => tab.href.startsWith("/moment"))).toBe(false);
    expect(tabs.map((tab) => tab.key as string)).not.toContain("moment");
  });

  it("routes every tab to its owned destination", () => {
    const tabs = buildTabs();
    const byLabel = Object.fromEntries(tabs.map((tab) => [tab.label, tab]));
    expect(defined(byLabel.Tonight).href).toBe("/tonight");
    expect(defined(byLabel.Tonight).match).toEqual(["/today", "/tonight"]);
    expect(defined(byLabel.Map).href).toBe("/map");
    expect(defined(byLabel.Places).href).toBe("/places");
    expect(defined(byLabel.Out).href).toBe("/out");
    expect(defined(byLabel.Plan).href).toBe("/plan");
    expect(defined(byLabel.You).href).toBe("/u/you");
  });

  it("accepts the preferred-city Map destination, and Places keeps its own", () => {
    const tabs = buildTabs("/u/you" as Route, "/map/glasgow" as Route);
    expect(tabs.find((tab) => tab.label === "Map")?.href).toBe("/map/glasgow");
    // Places is where the city is CHOSEN, so it never follows the chosen one.
    expect(tabs.find((tab) => tab.label === "Places")?.href).toBe("/places");
  });

  it("points You at the device handle when known (skips /u/you sentinel hop)", () => {
    const tabs = buildTabs("/u/karan" as Route);
    const you = tabs.find((tab) => tab.label === "You");
    expect(you?.href).toBe("/u/karan");
    expect(you?.match).toEqual(["/u"]);
  });

  it("marks Tonight active on both /today and /tonight", () => {
    expect(activeLabel("/today")).toBe("Tonight");
    expect(activeLabel("/tonight")).toBe("Tonight");
    expect(activeLabel("/out")).toBe("Out");
    expect(activeLabel("/places")).toBe("Places");
    expect(activeLabel("/plan")).toBe("Plan");
    expect(activeLabel("/plan/abc123")).toBe("Plan");
    expect(activeLabel("/choose-city")).toBeUndefined();
    expect(activeLabel("/social")).toBeUndefined();
    expect(activeLabel("/feed")).toBeUndefined();
    expect(activeLabel("/moment")).toBeUndefined();
  });
});
