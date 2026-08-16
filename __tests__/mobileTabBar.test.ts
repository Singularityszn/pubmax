import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  buildTabs,
  shouldShowMobileTabBar,
  tourSpotlightColumn,
} from "@/components/nav/MobileTabBar";
import { TOUR_TARGET_TAB_KEY, navPathMatches } from "@/components/nav/navigationModel";

// Five-tab contract for the mobile bar. Moment is a floating + action, never
// a destination, so it is not in this row. Today and Tonight share the Now
// tab; the URL is the truth.

function activeLabel(pathname: string, mapHref = "/map"): string | undefined {
  const tabs = buildTabs(mapHref, pathname);
  return tabs.find((tab) => !tab.primary && navPathMatches(pathname, tab.match ?? [tab.href]))?.label;
}

describe("mobile tab bar contract", () => {
  it("keeps app navigation off the exact landing pathname only", () => {
    expect(shouldShowMobileTabBar("/")).toBe(false);
    expect(shouldShowMobileTabBar("/near")).toBe(true);
    expect(shouldShowMobileTabBar("/map")).toBe(true);
    expect(shouldShowMobileTabBar("/plan")).toBe(true);
    expect(shouldShowMobileTabBar("/out")).toBe(true);
    expect(shouldShowMobileTabBar("/area/clapham/drink/guinness")).toBe(true);
  });

  it("renders exactly five tabs in the journey order", () => {
    const tabs = buildTabs("/map", "/tonight");
    expect(tabs.map((tab) => tab.label)).toEqual([
      "Now",
      "Map",
      "Out",
      "Social",
      "You",
    ]);
  });

  it("routes every tab to its owned destination", () => {
    const tabs = buildTabs("/map/london", "/tonight", "/u/you", "/tonight");
    const byLabel = Object.fromEntries(tabs.map((tab) => [tab.label, tab]));
    expect(byLabel.Now.href).toBe("/tonight");
    expect(byLabel.Now.match).toEqual(["/today", "/tonight"]);
    expect(byLabel.Map.href).toBe("/map/london");
    expect(byLabel.Out.href).toBe("/out");
    expect(byLabel.Social.href).toBe("/social");
    expect(byLabel.You.href).toBe("/u/you");
  });

  it("points You at the device handle when known (skips /u/you sentinel hop)", () => {
    const tabs = buildTabs("/map", "/today", "/u/karan");
    const you = tabs.find((tab) => tab.label === "You");
    expect(you?.href).toBe("/u/karan");
    expect(you?.match).toEqual(["/u"]);
  });

  it("keeps Moment out of the tab row", () => {
    const tabs = buildTabs("/map", "/map");
    expect(tabs.filter((tab) => tab.primary)).toEqual([]);
    expect(tabs.some((tab) => tab.label === "Moment")).toBe(false);
  });

  it("marks Now active on both /today and /tonight", () => {
    expect(activeLabel("/today")).toBe("Now");
    expect(activeLabel("/tonight")).toBe("Now");
    expect(activeLabel("/out")).toBe("Out");
    expect(activeLabel("/social")).toBe("Social");
    expect(activeLabel("/feed")).toBe("Social");
    expect(activeLabel("/moment")).toBeUndefined();
  });

  it("mounts the floating create action next to the tab bar", () => {
    const layout = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");
    expect(layout).toMatch(/CreateFab/);
    const fab = readFileSync(join(process.cwd(), "components/nav/CreateFab.tsx"), "utf8");
    expect(fab).toMatch(/Post a moment/);
    expect(fab).toMatch(/Log a price/);
    expect(fab).toMatch(/Start a plan/);
    expect(fab).toMatch(/momentHref/);
    expect(fab).toMatch(/\/map\?log=1/);
    expect(fab).toMatch(/["']\/plan["']/);
  });
});

describe("first-run tour spotlight geometry", () => {
  const tabs = buildTabs("/map", "/map");

  it("maps each tour target to the key it names", () => {
    expect(TOUR_TARGET_TAB_KEY).toEqual({ map: "map", drop: "create-fab", social: "social" });
  });

  it("anchors 'map' to the Map column", () => {
    const { index, total } = tourSpotlightColumn("map");
    expect(total).toBe(5);
    expect(index).toBe(1);
    expect(tabs[index]!.label).toBe("Map");
  });

  it("anchors 'drop' at the floating create action, not a tab column", () => {
    const { index, total } = tourSpotlightColumn("drop");
    expect(total).toBe(5);
    expect(index).toBe(-1);
  });

  it("anchors 'social' to the Social column", () => {
    const { index, total } = tourSpotlightColumn("social");
    expect(total).toBe(5);
    expect(index).toBe(3);
    expect(tabs[index]!.label).toBe("Social");
  });
});
