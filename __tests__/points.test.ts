// The points rules (lib/points.ts): which postcode a pub sits in, when a
// London postcode district is finished, and which level a total reaches.

import { describe, expect, it } from "vitest";

import {
  finishedDistricts,
  finishedLetterAreas,
  levelFor,
  londonDistricts,
  londonPostcodeDistrict,
} from "@/lib/points";

describe("londonPostcodeDistrict", () => {
  it.each([
    ["arnos arms 338 bowes road, arnos grove, london, n11 1an enfield", "N11"],
    ["the lamb 94 lamb's conduit st, london wc1n 3lz camden", "WC1"],
    ["ye olde mitre 1 ely ct, london ec1n 6sj", "EC1"],
    ["the dog and duck 18 bateman st, london w1d 3aj", "W1"],
    ["the grapes 76 narrow st, london e14 8bp", "E14"],
    ["the albert 52 victoria st, london sw1h 0nr", "SW1"],
    ["the eagle 2 shepherdess walk, london n1 7lb", "N1"],
  ])("reads %s as %s", (text, district) => {
    expect(londonPostcodeDistrict(text)).toBe(district);
  });

  it.each([
    ["a pub in watford wd3 1aa"],
    ["a pub in croydon cr0 1aa"],
    ["the swan, sw19 but no full postcode"],
    [""],
  ])("finds no London district in %s", (text) => {
    expect(londonPostcodeDistrict(text)).toBeNull();
  });
});

describe("London districts", () => {
  const rows = [
    { id: "a", searchText: "a london se1 1aa" },
    { id: "b", searchText: "b london se1 2bb" },
    { id: "c", searchText: "c london se1 3cc" },
    { id: "bar", kind: "bar", searchText: "a bar london se1 4dd" },
    { id: "d", searchText: "d london n19 1aa" },
    { id: "e", searchText: "e london n19 2bb" },
    { id: "nopostcode", searchText: "f london" },
  ];

  it("groups every listed district and leaves out bars and unplaced pubs", () => {
    const districts = londonDistricts(rows);
    expect([...districts.keys()]).toEqual(["SE1", "N19"]);
    expect(districts.get("SE1")).toEqual(["a", "b", "c"]);
    expect(districts.get("N19")).toEqual(["d", "e"]);
  });

  it("finishes a district only when every pub in it is on the Been list", () => {
    const districts = londonDistricts(rows);
    expect(finishedDistricts(districts, new Set(["a", "b"]))).toEqual([]);
    expect(finishedDistricts(districts, new Set(["a", "b", "c", "d"]))).toEqual(["SE1"]);
  });
  it("finishes small districts and requires every district for a letter area", () => {
    const districts = londonDistricts([
      ...rows,
      { id: "f", searchText: "f london n11 1aa" },
    ]);
    const partial = finishedDistricts(districts, new Set(["a", "b", "c", "d", "e"]));
    expect(partial).toEqual(["N19", "SE1"]);
    expect(finishedLetterAreas(districts, partial)).toEqual(["SE"]);
    const full = finishedDistricts(districts, new Set(["a", "b", "c", "d", "e", "f"]));
    expect(finishedLetterAreas(districts, full)).toEqual(["N", "SE"]);
    expect(finishedLetterAreas(new Map(), [])).toEqual([]);
  });
});

describe("levelFor", () => {
  it("starts everybody at level 1 with the next level in sight", () => {
    expect(levelFor(0)).toEqual({ level: 1, floor: 0, next: 50 });
    expect(levelFor(49)).toEqual({ level: 1, floor: 0, next: 50 });
  });

  it("moves up on the floor of each level", () => {
    expect(levelFor(50)).toEqual({ level: 2, floor: 50, next: 150 });
    expect(levelFor(151)).toEqual({ level: 3, floor: 150, next: 300 });
  });

  it("has a top level with no next one", () => {
    const top = levelFor(1_000_000);
    expect(top.next).toBeNull();
    expect(top.level).toBeGreaterThan(3);
  });
});
