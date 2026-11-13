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

  it("builds trades from pub signs without counting unrelated names or bars", () => {
    const trades = buildChallengeSet([
      { id: "brick", name: "The Bricklayer’s Arms" },
      { id: "carpenter", name: "Carpenters Arms", borough: "Camden" },
      { id: "carpenter", name: "Carpenters Arms", borough: "Camden" },
      { id: "other", name: "The Carpenters Workshop" },
      { id: "bar", name: "Bricklayers Arms", kind: "bar" },
    ]).get("trades");
    expect(trades?.flatMap((target) => target.venueIds).sort()).toEqual(["brick", "carpenter"]);
  });

  it("uses one stored pub per supported Monopoly street and omits unsupported streets", () => {
    const board = buildChallengeSet([
      { id: "kent", name: "The Windsor", borough: "Southwark", searchText: "the windsor 888 old kent rd london se15 1nq" },
      { id: "fleet-b", name: "Second", borough: "City of London", searchText: "second 1 fleet street london ec4a 2lt" },
      { id: "fleet-a", name: "First", borough: "City of London", searchText: "first 2 fleet st london ec4a 2lt" },
      { id: "brand", name: "Piccadilly Arms", borough: "Westminster", searchText: "piccadilly arms 5 other road london" },
      { id: "wrong-regent", name: "Parlour", borough: "Brent", searchText: "parlour 5 regent street london nw10 5lg" },
      { id: "not-pub", name: "Bar", kind: "bar", borough: "Westminster", searchText: "bar 1 whitehall london" },
    ]).get("monopoly");
    expect(board).toEqual([
      { label: "Old Kent Road: The Windsor", venueIds: ["kent"], mapVenueId: "kent" },
      { label: "Fleet Street: First", venueIds: ["fleet-a"], mapVenueId: "fleet-a" },
    ]);
  });

  it("uses the nearest pub within 150 metres of a stored street address", () => {
    const board = buildChallengeSet([
      { id: "address", name: "Restaurant", kind: "restaurant", borough: "Westminster", searchText: "restaurant 1 pall mall london", lat: 51.506, lng: -0.135 },
      { id: "near", name: "Near Pub", borough: "Westminster", lat: 51.5061, lng: -0.135 },
      { id: "further", name: "Further Pub", borough: "Westminster", lat: 51.507, lng: -0.135 },
      { id: "far-address", name: "Other Restaurant", kind: "restaurant", borough: "Westminster", searchText: "other restaurant 1 vine street london", lat: 51.51, lng: -0.14 },
    ]).get("monopoly");
    expect(board).toEqual([{ label: "Pall Mall: Near Pub", venueIds: ["near"], mapVenueId: "near" }]);
  });
});

describe("challengeOfTheMonth", () => {
  it("gives every challenge a turn, one month each", () => {
    const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
    expect(months.map(challengeOfTheMonth)).toEqual([
      "red-lion", "kings-head", "ship", "every-district", "trades", "monopoly", "red-lion",
    ]);
    expect(new Set(months.map(challengeOfTheMonth)).size).toBe(CHALLENGE_IDS.length);
    expect(["2025-01", "2027-01", "2028-01"].map(challengeOfTheMonth)).toEqual([
      "red-lion", "red-lion", "red-lion",
    ]);
  });

  it("has no challenge for a month it cannot read", () => {
    expect(challengeOfTheMonth("")).toBeNull();
    expect(challengeOfTheMonth("2026-11-13")).toBeNull();
    expect(challengeOfTheMonth("2026-00")).toBeNull();
    expect(challengeOfTheMonth("2026-13")).toBeNull();
  });
});

describe("challengeProgress", () => {
  const set: ChallengeSet = new Map([
    [
      "red-lion",
      [
        { label: "Red Lion A", venueIds: ["a"], mapVenueId: "a" },
        { label: "Red Lion B", venueIds: ["b"], mapVenueId: "b" },
      ],
    ],
    [
      "every-district",
      [
        { label: "E1", venueIds: ["e1a", "e1b"] },
        { label: "N1", venueIds: ["n1"] },
      ],
    ],
  ]);
  const months: Record<string, string | null> = {
    a: "2026-06",
    b: "2026-07",
    e1a: "2026-10",
    e1b: null,
    n1: "2026-10",
  };
  const month = (venueId: string) => months[venueId] ? `${months[venueId]}-01T19:00:00.000Z` : null;
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
    expect(progress(["a", "b"])["red-lion"]).toMatchObject({
      finished: true, doubled: true, finishedAt: "2026-07-01T19:00:00.000Z",
    });
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
