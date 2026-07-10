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
  it("exposes Tube and Rail as separate Layers chips", () => {
    const tube = POI_TOGGLE_GROUPS.find((group) => group.id === "tube");
    const rail = POI_TOGGLE_GROUPS.find((group) => group.id === "rail");
    expect(tube?.categories).toEqual(["tube"]);
    expect(tube?.label).toBe("Tube");
    expect(rail?.categories).toEqual(["rail"]);
    expect(rail?.label).toBe("Rail");
  });

  it("defaults Tube, Rail, Parks, and Sights on for desktop", () => {
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

  it("toggles Tube independently of Rail", () => {
    const hidden = defaultPoiHidden();
    const tube = POI_TOGGLE_GROUPS.find((group) => group.id === "tube")!;
    expect(isPoiGroupOn(hidden, tube)).toBe(true);
    const off = togglePoiGroup(hidden, tube);
    expect(off.tube).toBe(true);
    expect(off.rail).toBe(false);
    expect(isTransitNetworkVisible(off)).toBe(true);
    const bothOff = togglePoiGroup(off, POI_TOGGLE_GROUPS.find((g) => g.id === "rail")!);
    expect(bothOff.tube).toBe(true);
    expect(bothOff.rail).toBe(true);
    expect(isTransitNetworkVisible(bothOff)).toBe(false);
  });
});
