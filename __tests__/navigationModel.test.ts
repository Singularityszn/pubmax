import { describe, expect, it } from "vitest";

import {
  PHONE_NAV_ITEMS,
  MOMENT_NAV_ACTION,
  PRIMARY_NAV_ITEMS,
  SOCIAL_NAV_MATCH,
  momentHref,
  navPathMatches,
  primaryNavKeyForPath,
  primaryNavLabel,
  safeMomentReturnTo,
} from "@/components/nav/navigationModel";
import { socialSurfaceName } from "@/lib/socialLaunch";

describe("PUBMAXX primary navigation", () => {
  it("keeps the phone dock to five tabs and Spoons off it (captain, 1 Nov 2026)", () => {
    // Launch plan decision 13: Explore, Tonight, Plan, Social, You.
    expect(PHONE_NAV_ITEMS.map(({ label }) => label)).toEqual(["Explore", "Tonight", "Plan", "Social", "You"]);
    expect(PHONE_NAV_ITEMS).toHaveLength(5);
    expect(PRIMARY_NAV_ITEMS.filter((item) => item.desktopOnly).map(({ key }) => key)).toEqual(["spoons"]);
  });

  it("names the map Explore and still sends it to /map", () => {
    const explore = PRIMARY_NAV_ITEMS.find((item) => item.key === "map");
    expect(explore).toMatchObject({ label: "Explore", href: "/map", match: ["/map"] });
    expect(PRIMARY_NAV_ITEMS.some((item) => item.label === "Map")).toBe(false);
  });

  it("keeps the five-door phone loop, Spoons on desktop only, and models Moment separately", () => {
    // Captain, 16 Oct 2026: Social is a main tab, between Plan and You.
    expect(PRIMARY_NAV_ITEMS.map(({ label }) => label)).toEqual([
      "Explore",
      "Tonight",
      "Plan",
      "Spoons",
      "Social",
      "You",
    ]);
    expect(MOMENT_NAV_ACTION).toMatchObject({ label: "Moment", href: "/moment" });
    // Moment is a compose action, never a primary destination.
    const keys: string[] = PRIMARY_NAV_ITEMS.map(({ key }) => key);
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
      "/spoons-value",
      "/social",
      "/u/you",
    ]);
    expect(PRIMARY_NAV_ITEMS.find((item) => item.key === "now")?.match).toEqual([
      "/today",
      "/tonight",
    ]);
    expect(primaryNavKeyForPath("/today")).toBe("now");
    expect(primaryNavKeyForPath("/tonight")).toBe("now");
  });

  it("lights Plan for the composer and a shared plan, and Social for its aliases", () => {
    const plan = PRIMARY_NAV_ITEMS.find((item) => item.key === "plan");
    expect(plan?.match).toEqual(["/plan", "/crawls"]);
    expect(primaryNavKeyForPath("/plan")).toBe("plan");
    expect(primaryNavKeyForPath("/plan/abc123")).toBe("plan");
    expect(navPathMatches("/plan", plan!.match)).toBe(true);
    // Social owns its shell and every retired alias that still lands there.
    for (const path of ["/social", "/discover", "/drinks", "/feed", "/stories"]) {
      expect(primaryNavKeyForPath(path)).toBe("social");
    }
    // The crawl routes are walks to plan, reached from planning doors, so they
    // light Plan rather than Social (taste pass, 18 Oct 2026).
    expect(primaryNavKeyForPath("/crawls")).toBe("plan");
    expect(primaryNavKeyForPath("/crawls/soho")).toBe("plan");
    expect(primaryNavKeyForPath("/crawlspace")).toBeUndefined();
    expect(PRIMARY_NAV_ITEMS.find((item) => item.key === "social")?.match).toEqual([...SOCIAL_NAV_MATCH]);
    expect(primaryNavKeyForPath("/socialite")).toBeUndefined();
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

  it("names Social for its launch state and every other door as written", () => {
    const social = PRIMARY_NAV_ITEMS.find((item) => item.key === "social")!;
    const plan = PRIMARY_NAV_ITEMS.find((item) => item.key === "plan")!;
    expect(primaryNavLabel(social, socialSurfaceName(true))).toBe("Social");
    expect(primaryNavLabel(social, socialSurfaceName(false))).toBe("Social preview");
    expect(primaryNavLabel(plan, socialSurfaceName(false))).toBe("Plan");
  });

  it("accepts only safe Moment return destinations", () => {
    expect(momentHref("/social")).toBe("/moment?returnTo=%2Fsocial");
    expect(safeMomentReturnTo("https://example.com/steal")).toBe("/map");
    expect(safeMomentReturnTo("/u/you?tab=moments")).toBe("/u/you?tab=moments");
    expect(safeMomentReturnTo("/map/manchester?sel=pub-1#sheet")).toBe("/map/manchester?sel=pub-1#sheet");
    expect(safeMomentReturnTo("/moment?returnTo=/admin")).toBe("/map");
  });
});
