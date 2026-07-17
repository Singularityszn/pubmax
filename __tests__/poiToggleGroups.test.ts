import { describe, expect, it } from "vitest";

import {
  POI_TOGGLE_GROUPS,
  defaultPoiHidden,
  defaultPoiHiddenMobile,
  isPoiGroupOn,
  isTransitNetworkVisible,
  resolveTransitNetworkVisibility,
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

  it("keeps Tube and Rail visible on mobile while hiding denser ambient POIs", () => {
    const hidden = defaultPoiHiddenMobile();
    expect(hidden.tube).toBe(false);
    expect(hidden.rail).toBe(false);
    expect(hidden.bus).toBe(true);
    expect(hidden.park).toBe(true);
    expect(isTransitNetworkVisible(hidden)).toBe(true);
    expect(resolveTransitNetworkVisibility(hidden, false)).toBe("none");
    expect(resolveTransitNetworkVisibility(hidden, true)).toBe("visible");
  });

  it("toggles Tube independently of Rail; lines follow Tube only", () => {
    const hidden = defaultPoiHidden();
    const tube = POI_TOGGLE_GROUPS.find((group) => group.id === "tube")!;
    expect(isPoiGroupOn(hidden, tube)).toBe(true);
    expect(isTransitNetworkVisible(hidden)).toBe(true);
    const off = togglePoiGroup(hidden, tube);
    expect(off.tube).toBe(true);
    expect(off.rail).toBe(false);
    expect(isTransitNetworkVisible(off)).toBe(false);
    const railOff = togglePoiGroup(hidden, POI_TOGGLE_GROUPS.find((g) => g.id === "rail")!);
    expect(railOff.rail).toBe(true);
    expect(railOff.tube).toBe(false);
    expect(isTransitNetworkVisible(railOff)).toBe(true);
  });
});
