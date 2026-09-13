import { describe, expect, it } from "vitest";

import { MOBILE_MAX_WIDTH } from "@/lib/breakpoints";
import { routeOwnsScreenFoot } from "@/lib/promptBudget";

// ON A PHONE THE MAP OWNS THE FOOT OF THE SCREEN. Site audit 13 Sep 2026, D3:
// on the phone map the consent card was lifted above "Describe the outing" and,
// with the top chrome and the dock, 38 percent of the map was chrome. The
// native push and create-password sheets read this answer, so they neither
// claim nor paint on a phone-width map route. A desktop map has no outing pill
// or dock at its foot, so it owns nothing.

const PHONE = 390;

describe("routeOwnsScreenFoot", () => {
  it.each(["/map", "/map/", "/map/london", "/map/london/soho", "/map?sel=venue-1", "/map#log"])(
    "answers true for the map family at phone width: %s",
    (pathname) => {
      expect(routeOwnsScreenFoot(pathname, PHONE)).toBe(true);
    },
  );

  it.each([320, MOBILE_MAX_WIDTH])("answers true up to the phone breakpoint: %spx", (width) => {
    expect(routeOwnsScreenFoot("/map", width)).toBe(true);
  });

  it.each([MOBILE_MAX_WIDTH + 1, 1280])("answers false for the desktop map: %spx", (width) => {
    expect(routeOwnsScreenFoot("/map", width)).toBe(false);
    expect(routeOwnsScreenFoot("/map/london", width)).toBe(false);
  });

  it.each(["/", "/tonight", "/places", "/mapping", "/maps", "/plan", "/u/you"])(
    "answers false off the map: %s",
    (pathname) => {
      expect(routeOwnsScreenFoot(pathname, PHONE)).toBe(false);
    },
  );

  it.each([null, undefined, ""])("answers false for a pathname it cannot read: %s", (pathname) => {
    expect(routeOwnsScreenFoot(pathname, PHONE)).toBe(false);
  });

  it("answers false for a width it cannot read", () => {
    expect(routeOwnsScreenFoot("/map", Number.NaN)).toBe(false);
  });
});
