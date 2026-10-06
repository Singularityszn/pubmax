import { describe, expect, it } from "vitest";

import {
  MOMENT_NAV_ACTION,
  PRIMARY_NAV_ITEMS,
  momentHref,
  navPathMatches,
  primaryNavKeyForPath,
  safeMomentReturnTo,
} from "@/components/nav/navigationModel";
import { defined } from "@/__tests__/helpers/defined";

describe("PUBMAXX primary navigation", () => {
  it("keeps six destinations on the loop and models Moment separately", () => {
    expect(PRIMARY_NAV_ITEMS.map(({ label }) => label)).toEqual([
      "Tonight",
      "Map",
      "Places",
      "Out",
      "Plan",
      "You",
    ]);
    expect(MOMENT_NAV_ACTION).toMatchObject({ label: "Moment", href: "/moment" });
    // Social and Moment are not front doors: neither is a primary destination.
    const keys: string[] = PRIMARY_NAV_ITEMS.map(({ key }) => key);
    expect(keys).not.toContain("social");
    expect(keys).not.toContain("moment");
  });

  it("sends every destination to its own shell", () => {
    expect(PRIMARY_NAV_ITEMS.map(({ href }) => href)).toEqual([
      "/tonight",
      "/map",
      "/places",
      "/out",
      "/plan",
      "/u/you",
    ]);
    expect(PRIMARY_NAV_ITEMS.find((item) => item.key === "now")?.match).toEqual([
      "/today",
      "/tonight",
    ]);
  });

  it("lights Plan for the composer and a shared plan, and no tab for Social", () => {
    const plan = PRIMARY_NAV_ITEMS.find((item) => item.key === "plan");
    expect(plan?.match).toEqual(["/plan"]);
    expect(primaryNavKeyForPath("/plan")).toBe("plan");
    expect(primaryNavKeyForPath("/plan/abc123")).toBe("plan");
    expect(navPathMatches("/plan", plan!.match)).toBe(true);
    // Social lives under More now, so its routes and aliases light no tab.
    for (const path of ["/social", "/discover", "/drinks", "/feed", "/stories", "/crawls/soho"]) {
      expect(primaryNavKeyForPath(path)).toBeUndefined();
    }
    expect(primaryNavKeyForPath("/borough")).toBeUndefined();
    expect(primaryNavKeyForPath("/borough/soho")).toBeUndefined();
    expect(primaryNavKeyForPath("/moment")).toBeUndefined();
  });

  it("lights Places for the tab, and claims no address the picker has left", () => {
    const places = PRIMARY_NAV_ITEMS.find((item) => item.key === "places");
    expect(places?.match).toEqual(["/places"]);
    expect(primaryNavKeyForPath("/places")).toBe("places");
    expect(primaryNavKeyForPath(defined("/places?city=manchester".split("?")[0]))).toBe("places");
    // /choose-city has no page and 308s at the edge, so no client is on it.
    expect(primaryNavKeyForPath("/choose-city")).toBeUndefined();
    // Map and Places are separate destinations: neither may claim the other.
    expect(primaryNavKeyForPath("/map")).toBe("map");
    expect(primaryNavKeyForPath("/map/manchester")).toBe("map");
  });

  it("accepts only safe Moment return destinations", () => {
    expect(momentHref("/social")).toBe("/moment?returnTo=%2Fsocial");
    expect(safeMomentReturnTo("https://example.com/steal")).toBe("/map");
    expect(safeMomentReturnTo("/u/you?tab=moments")).toBe("/u/you?tab=moments");
    expect(safeMomentReturnTo("/map/manchester?sel=pub-1#sheet")).toBe("/map/manchester?sel=pub-1#sheet");
    expect(safeMomentReturnTo("/moment?returnTo=/admin")).toBe("/map");
  });
});
