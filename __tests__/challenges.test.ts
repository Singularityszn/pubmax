// The challenge rules (lib/challenges.ts): which pubs a named challenge takes,
// which month is the challenge of the month, and when a finish is doubled.

import { describe, expect, it } from "vitest";

import {
  CHALLENGE_IDS,
  buildChallengeSet,
  challengeOfTheMonth,
  challengeProgress,
  namePlate,
  type ChallengeSet,
} from "@/lib/challenges";

describe("namePlate", () => {
  it.each([
    ["The Red Lion", "", "red lion"],
    ["Ye Olde Red Lion", "Sutton", "red lion"],
    ["Old Red Lion, Holborn", "Camden", "red lion"],
    ["Red Lion (Moorgate)", "City of London", "red lion"],
    ["The Kings Head Harrow", "Harrow", "kings head"],
    ["The Old King’s Head", "Southwark", "kings head"],
    ["Ship Tavern, London", "Camden", "ship"],
    ["The Ship EC3", "City of London", "ship"],
    ["Old ship pub & hotel Hackney", "Hackney", "ship"],
  ])("reads %s as %s", (name, borough, plate) => {
    expect(namePlate(name, borough)).toBe(plate);
  });

  it.each([
    ["Red Lion & Sun", "red lion and sun"],
    ["The Red Lion & Pineapple - JD Wetherspoon", "red lion and pineapple"],
    ["The Ship Aground", "ship aground"],
    ["Ship and Shovell", "ship and shovell"],
    ["Fellowship Inn", "fellowship"],
  ])("keeps %s a different pub", (name, plate) => {
    expect(namePlate(name)).toBe(plate);
  });
});

describe("buildChallengeSet", () => {
  const set = buildChallengeSet([
    { id: "rl1", name: "The Red Lion", borough: "Hackney", searchText: "red lion london n16 1aa" },
    { id: "rl2", name: "Ye Olde Red Lion", borough: "Sutton" },
    { id: "rl2", name: "Ye Olde Red Lion", borough: "Sutton" },
    { id: "rlbar", name: "Red Lion", kind: "bar", borough: "Soho", searchText: "red lion london w1d 3aj" },
    { id: "sun", name: "Red Lion & Sun", borough: "Haringey", searchText: "london n6 4aa" },
    { id: "ship", name: "The Ship", borough: "Southwark", searchText: "the ship london se1 2aa" },
  ]);

  it("takes each listed pub of that name once and leaves bars out", () => {
    expect(set.get("red-lion")).toEqual([
      { label: "The Red Lion, Hackney N16", venueIds: ["rl1"], mapVenueId: "rl1" },
      { label: "Ye Olde Red Lion, Sutton", venueIds: ["rl2"], mapVenueId: "rl2" },
    ]);
    expect(set.get("kings-head")).toEqual([]);
    expect(set.get("ship")?.map((target) => target.venueIds)).toEqual([["ship"]]);
  });

  it("makes one target per London postcode district with its pubs", () => {
    expect(set.get("every-district")).toEqual([
      { label: "N6", venueIds: ["sun"] },
      { label: "N16", venueIds: ["rl1"] },
      { label: "SE1", venueIds: ["ship"] },
    ]);
  });
});

describe("challengeOfTheMonth", () => {
  it("gives every challenge a turn, one month each", () => {
    const months = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"];
    expect(months.map(challengeOfTheMonth)).toEqual([...CHALLENGE_IDS, CHALLENGE_IDS[0]]);
  });

  it("has no challenge for a month it cannot read", () => {
    expect(challengeOfTheMonth("")).toBeNull();
    expect(challengeOfTheMonth("2026-11-13")).toBeNull();
  });
});

describe("challengeProgress", () => {
  const set: ChallengeSet = new Map([
    // Red Lion is the challenge of the month in September 2026.
    [
      "red-lion",
      [
        { label: "Red Lion A", venueIds: ["a"], mapVenueId: "a" },
        { label: "Red Lion B", venueIds: ["b"], mapVenueId: "b" },
      ],
    ],
    // The district challenge is the challenge of the month in December 2026.
    [
      "every-district",
      [
        { label: "E1", venueIds: ["e1a", "e1b"] },
        { label: "N1", venueIds: ["n1"] },
      ],
    ],
  ]);
  const months: Record<string, string | null> = {
    a: "2026-08",
    b: "2026-09",
    e1a: "2026-12",
    e1b: null,
    n1: "2026-12",
  };
  const month = (venueId: string) => months[venueId] ?? null;
  const progress = (visited: string[]) =>
    Object.fromEntries(challengeProgress(set, new Set(visited), month).map((entry) => [entry.id, entry]));

  it("counts targets done and lists what is left", () => {
    const red = progress(["a"])["red-lion"];
    expect(red).toMatchObject({ done: 1, total: 2, finished: false, doubled: false });
    expect(red?.left).toEqual([{ label: "Red Lion B", venueId: "b" }]);
  });

  it("never finishes a challenge with nothing listed", () => {
    expect(progress(["a", "b"]).ship).toMatchObject({ done: 0, total: 0, finished: false, left: [] });
  });

  it("doubles a challenge finished inside its own month", () => {
    expect(progress(["a", "b"])["red-lion"]).toMatchObject({ finished: true, doubled: true });
  });

  it("does not double a finish in another month", () => {
    const set2: ChallengeSet = new Map([["red-lion", [{ label: "A", venueIds: ["a"] }]]]);
    const [red] = challengeProgress(set2, new Set(["a"]), month);
    expect(red).toMatchObject({ finished: true, doubled: false });
  });

  it("does not double when a pub that may have finished it has no known month", () => {
    expect(progress(["e1a", "e1b", "n1"])["every-district"]).toMatchObject({ finished: true, doubled: false });
    expect(progress(["e1a", "n1"])["every-district"]).toMatchObject({ finished: true, doubled: true });
  });
});
