import { describe, expect, it } from "vitest";

import {
  MOMENT_NAV_ACTION,
  PRIMARY_NAV_ITEMS,
  momentHref,
  navPathMatches,
  primaryNavKeyForPath,
  safeMomentReturnTo,
} from "@/components/nav/navigationModel";

describe("PUBMAXX primary navigation", () => {
  it("keeps four destinations on the loop and models Moment separately", () => {
    expect(PRIMARY_NAV_ITEMS.map(({ label }) => label)).toEqual([
      "Map",
      "Tonight",
      "Plan",
      "You",
    ]);
    expect(MOMENT_NAV_ACTION).toMatchObject({ label: "Moment", href: "/moment" });
    // Social and Moment are not front doors: neither is a primary destination.
    const keys: string[] = PRIMARY_NAV_ITEMS.map(({ key }) => key);
    expect(keys).not.toContain("social");
    expect(keys).not.toContain("moment");
    // Out folded into Tonight, and Places is a setting, not a door.
    expect(keys).not.toContain("out");
    expect(keys).not.toContain("places");
  });

  it("sends every destination to its own shell", () => {
    expect(PRIMARY_NAV_ITEMS.map(({ href }) => href)).toEqual([
      "/map",
      "/tonight",
      "/plan",
      "/u/you",
    ]);
    expect(PRIMARY_NAV_ITEMS.find((item) => item.key === "now")?.match).toEqual([
      "/tonight",
    ]);
    expect(primaryNavKeyForPath("/today")).toBeUndefined();
    expect(primaryNavKeyForPath("/tonight")).toBe("now");
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

  it("claims no tab for the city picker or the folded Out address", () => {
    // /places is reached from the map's city chip and the footer; it is a
    // setting, so it lights no door. /out 308s to /tonight at the edge and
    // /choose-city 308s to /places, so no client is on either pathname.
    expect(primaryNavKeyForPath("/places")).toBeUndefined();
    expect(primaryNavKeyForPath("/out")).toBeUndefined();
    expect(primaryNavKeyForPath("/choose-city")).toBeUndefined();
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
