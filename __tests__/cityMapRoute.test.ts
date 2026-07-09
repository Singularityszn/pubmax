import { describe, expect, it } from "vitest";

import {
  CITIES,
  getCity,
  listEnabledCities,
  parseCityId,
  type CityId,
} from "@/lib/cities";

/** Route gate used by `app/map/[city]/page.tsx`: parse + enabled. */
function resolveMapCity(raw: string | null | undefined): CityId | null {
  const id = parseCityId(raw);
  if (!id) return null;
  return CITIES[id].enabled ? id : null;
}

describe("city map route resolution", () => {
  it("resolves every shipped city pack", () => {
    for (const id of Object.keys(CITIES) as CityId[]) {
      expect(resolveMapCity(id)).toBe(id);
      expect(resolveMapCity(id.toUpperCase())).toBe(id);
    }
  });

  it("returns null for unknown city ids", () => {
    expect(resolveMapCity("paris")).toBeNull();
    expect(resolveMapCity("")).toBeNull();
    expect(resolveMapCity(null)).toBeNull();
    expect(resolveMapCity(undefined)).toBeNull();
  });

  it("listEnabledCities matches the route gate and includes all nine cities", () => {
    const enabled = listEnabledCities();
    expect(enabled).toHaveLength(9);
    for (const city of enabled) {
      expect(resolveMapCity(city.id)).toBe(city.id);
      expect(city.enabled).toBe(true);
    }
  });

  it("getCity still falls back to london for unknown ids (non-route callers)", () => {
    expect(getCity("not-a-city").id).toBe("london");
  });
});
