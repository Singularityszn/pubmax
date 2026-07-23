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
  it("keeps four destinations and models Moment separately", () => {
    expect(PRIMARY_NAV_ITEMS.map(({ label }) => label)).toEqual([
      "Map",
      "Tonight",
      "Stories",
      "You",
    ]);
    expect(MOMENT_NAV_ACTION).toMatchObject({ label: "Moment", href: "/moment" });
  });

  it("keeps capture separate from the map and sends Stories to the social feed", () => {
    expect(PRIMARY_NAV_ITEMS.map(({ href }) => href)).toEqual([
      "/map",
      "/tonight",
      "/feed",
      "/u/you",
    ]);
  });

  it("lights Stories for /feed and its aliases, not for borough pages", () => {
    const stories = PRIMARY_NAV_ITEMS.find((item) => item.key === "stories");
    expect(stories?.match).toEqual(["/discover", "/feed", "/stories", "/crawls"]);
    expect(primaryNavKeyForPath("/feed")).toBe("stories");
    expect(primaryNavKeyForPath("/feed/friends")).toBe("stories");
    expect(primaryNavKeyForPath("/stories")).toBe("stories");
    expect(primaryNavKeyForPath("/discover")).toBe("stories");
    expect(primaryNavKeyForPath("/crawls/soho")).toBe("stories");
    expect(primaryNavKeyForPath("/borough")).toBeUndefined();
    expect(primaryNavKeyForPath("/borough/soho")).toBeUndefined();
    expect(navPathMatches("/feed", stories!.match)).toBe(true);
  });

  it("accepts only safe Moment return destinations", () => {
    expect(momentHref("/feed")).toBe("/moment?returnTo=%2Ffeed");
    expect(safeMomentReturnTo("https://example.com/steal")).toBe("/map");
    expect(safeMomentReturnTo("/u/you?tab=moments")).toBe("/u/you?tab=moments");
    expect(safeMomentReturnTo("/map/manchester?sel=pub-1#sheet")).toBe("/map/manchester?sel=pub-1#sheet");
    expect(safeMomentReturnTo("/moment?returnTo=/admin")).toBe("/map");
  });
});
