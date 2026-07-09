import { describe, expect, it } from "vitest";

import {
  POI_TOGGLE_GROUPS,
  defaultPoiHidden,
  defaultPoiHiddenMobile,
  isPoiGroupOn,
  isTransitNetworkVisible,
  togglePoiGroup,
} from "@/lib/poiToggleGroups";

describe("poiToggleGroups", () => {
  it("merges tube and rail under Transit", () => {
    const transit = POI_TOGGLE_GROUPS.find((group) => group.id === "transit");
    expect(transit?.categories).toEqual(["tube", "rail"]);
    expect(transit?.label).toBe("Transit");
  });

  it("defaults Transit, Parks, and Sights on for desktop", () => {
    const hidden = defaultPoiHidden();
    expect(hidden.tube).toBe(false);
    expect(hidden.rail).toBe(false);
    expect(hidden.park).toBe(false);
    expect(hidden.sight).toBe(false);
    expect(hidden.bus).toBe(true);
    expect(hidden.historic).toBe(true);
  });

  it("hides every POI layer on mobile by default", () => {
    const hidden = defaultPoiHiddenMobile();
    for (const value of Object.values(hidden)) {
      expect(value).toBe(true);
    }
  });

  it("toggles Transit as a pair", () => {
    const hidden = defaultPoiHidden();
    const transit = POI_TOGGLE_GROUPS.find((group) => group.id === "transit")!;
    expect(isPoiGroupOn(hidden, transit)).toBe(true);
    const off = togglePoiGroup(hidden, transit);
    expect(off.tube).toBe(true);
    expect(off.rail).toBe(true);
    expect(isTransitNetworkVisible(off)).toBe(false);
    const on = togglePoiGroup(off, transit);
    expect(on.tube).toBe(false);
    expect(on.rail).toBe(false);
    expect(isTransitNetworkVisible(on)).toBe(true);
  });
});
