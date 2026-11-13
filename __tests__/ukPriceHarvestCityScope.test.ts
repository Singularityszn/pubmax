import { describe, expect, it } from "vitest";

import { harvestCityScope, hostsTouchingCityScope } from "../scripts/harvest/uk-prices/cityScope.mjs";
import { defined } from "@/__tests__/helpers/defined";

function scopeOf(ids: string[]) {
  const scope = harvestCityScope(ids);
  if (!scope) throw new Error(`expected a scope for ${ids.join(",")}`);
  return scope;
}

const MANCHESTER_PUB = { name: "Briton's Protection", lat: 53.4746, lng: -2.2467 };
const LEEDS_PUB = { name: "Whitelock's", lat: 53.7983, lng: -1.5423 };
const BARNSLEY_PUB = { name: "The Botanist", lat: 53.553, lng: -1.4817 };

describe("uk price harvest city scope", () => {
  it("contains a pub inside a named city's map box and nothing outside it", () => {
    const scope = scopeOf(["Manchester", " leeds "]);
    expect(scope.ids).toEqual(["manchester", "leeds"]);
    expect(scope.contains(MANCHESTER_PUB)).toBe(true);
    expect(scope.contains(LEEDS_PUB)).toBe(true);
    expect(scope.contains(BARNSLEY_PUB)).toBe(false);
    expect(scope.contains({ lat: null, lng: null })).toBe(false);
  });

  it("refuses a city with no map box and sends London to its own scope", () => {
    expect(() => harvestCityScope(["sheffield"])).toThrow(/not a city/);
    expect(() => harvestCityScope(["london"])).toThrow(/--london/);
    expect(harvestCityScope([""])).toBeNull();
  });

  it("keeps every pub of an estate host that serves one pub in scope", () => {
    const scope = scopeOf(["manchester"]);
    const estate = { host: "estate.example", pubs: [MANCHESTER_PUB, BARNSLEY_PUB] };
    const elsewhere = { host: "barnsley.example", pubs: [BARNSLEY_PUB] };
    const { hosts, hostsOutsideScope } = hostsTouchingCityScope([estate, elsewhere], scope);
    expect(hosts).toEqual([estate]);
    expect(defined(hosts[0]).pubs).toHaveLength(2);
    expect(hostsOutsideScope).toBe(1);
  });
});
