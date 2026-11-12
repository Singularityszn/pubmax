// Been here postcode progress (lib/beenHereProgress.ts): every figure is a
// count of real rows, and a pub with no postcode is never guessed into one.

import { describe, expect, it } from "vitest";

import { BEEN_HERE_LIST } from "@/lib/beenHere";
import { beenHereIds, beenHereProgress, postcodeDistrict } from "@/lib/beenHereProgress";

describe("postcodeDistrict", () => {
  it("reads the district from a whole postcode and folds a sub-district into it", () => {
    expect(postcodeDistrict("the lamb 94 lamb's conduit street, london, wc1n 3lz camden")).toBe("WC1");
    expect(postcodeDistrict("dog & duck 18 bateman street, w1d 3af westminster")).toBe("W1");
    expect(postcodeDistrict("x 1 road, sw1a 2aa")).toBe("SW1");
    expect(postcodeDistrict("x 1 road, n16 7ab hackney")).toBe("N16");
    expect(postcodeDistrict("x 1 road, se10 9nn")).toBe("SE10");
  });

  it("answers null when the address has no whole postcode", () => {
    expect(postcodeDistrict("the e1 bar, whitechapel")).toBeNull();
    expect(postcodeDistrict("")).toBeNull();
    expect(postcodeDistrict(undefined)).toBeNull();
  });
});

describe("beenHereIds", () => {
  it("keeps only the Been here list", () => {
    const ids = beenHereIds([
      { venueId: "a", listType: BEEN_HERE_LIST },
      { venueId: "b", listType: "Pubs to try" },
      { venueId: "c", listType: BEEN_HERE_LIST },
    ]);
    expect([...ids].sort()).toEqual(["a", "c"]);
  });
});

describe("beenHereProgress", () => {
  const pubs = [
    { id: "n1-a", lat: 51.5, lng: -0.1, searchText: "a, n1 1aa" },
    { id: "n1-b", lat: 51.6, lng: -0.2, searchText: "b, n1 2bb" },
    { id: "n1-c", lat: 51.7, lng: -0.3, searchText: "c, n1c 3cc" },
    { id: "w1-a", lat: 51.51, lng: -0.13, searchText: "d, w1f 0dq" },
    { id: "w1-b", lat: 51.52, lng: -0.14, searchText: "e, w1d 3af" },
    { id: "se1-a", lat: 51.5, lng: -0.09, searchText: "f, se1 9dd" },
    { id: "no-postcode", lat: 51.5, lng: -0.1, searchText: "g, borough market" },
  ];

  it("counts visited and total per district from the list's own rows", () => {
    const { districts } = beenHereProgress(pubs, new Set(["n1-a", "w1-a", "w1-b"]));
    expect(districts).toEqual([
      { district: "W1", visited: 2, total: 2, percent: 100, lng: -0.135, lat: 51.515 },
      { district: "N1", visited: 1, total: 3, percent: 33, lng: expect.closeTo(-0.2), lat: expect.closeTo(51.6) },
    ]);
  });

  it("rounds down, so a district reads 100% only when every pub is ticked", () => {
    const many = Array.from({ length: 201 }, (_, i) => ({
      id: `p${i}`,
      lat: 51.5,
      lng: -0.1,
      searchText: `x, e1 ${i % 10}aa`,
    }));
    const visited = new Set(many.slice(0, 200).map((pub) => pub.id));
    expect(beenHereProgress(many, visited).districts[0]?.percent).toBe(99);
  });

  it("leaves out districts with no visit and never places a pub with no postcode", () => {
    const result = beenHereProgress(pubs, new Set(["no-postcode", "somewhere-else"]));
    expect(result.districts).toEqual([]);
    expect(result.visitedWithoutPostcode).toBe(1);
  });

  it("counts a repeated row once", () => {
    const { districts } = beenHereProgress([pubs[5]!, pubs[5]!], new Set(["se1-a"]));
    expect(districts[0]).toMatchObject({ district: "SE1", visited: 1, total: 1, percent: 100 });
  });
});
