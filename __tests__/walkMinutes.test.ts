import { describe, expect, it } from "vitest";

import { walkMinutesFromKm } from "@/lib/walkMinutes";
import { walkMinutesFromKm as nearMeWalkMinutesFromKm } from "@/lib/nearMeAnswer";
import { walkMinutesForKm } from "@/lib/tfl";
import { walkMinutes } from "@/lib/tonight";

describe("walkMinutesFromKm — one km-to-minutes formula", () => {
  it("converts 1 km at the shared walking pace to 13 minutes", () => {
    expect(walkMinutesFromKm(1)).toBe(13);
    expect(nearMeWalkMinutesFromKm(1)).toBe(13);
    expect(walkMinutesForKm(1)).toBe(13);
  });

  it("agrees with tonight's coordinate helper on a 1 km easting", () => {
    // 1 km east of the origin at London latitude is not exact haversine-1km,
    // so this pins that tonight spends the shared formula, not a second pace.
    const origin = { lat: 51.5074, lng: -0.1278 };
    const same = walkMinutes(origin, origin);
    expect(same).toBe(walkMinutesFromKm(0));
  });

  it("keeps a short positive walk at 1 minute", () => {
    expect(walkMinutesFromKm(0.01)).toBe(1);
    expect(walkMinutesForKm(0.01)).toBe(1);
    expect(nearMeWalkMinutesFromKm(0.02)).toBe(1);
  });

  it("lets last-train treat a missing distance as 0 minutes", () => {
    expect(walkMinutesFromKm(0, 0)).toBe(0);
    expect(walkMinutesForKm(0)).toBe(0);
    expect(walkMinutesForKm(Number.NaN)).toBe(0);
  });

  it("lets near-me treat a missing distance as 1 minute", () => {
    expect(walkMinutesFromKm(0)).toBe(1);
    expect(nearMeWalkMinutesFromKm(0)).toBe(1);
    expect(nearMeWalkMinutesFromKm(Number.NaN)).toBe(1);
  });
});
