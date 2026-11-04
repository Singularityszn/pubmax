// The passport rules (lib/profilePassport.ts): the Been fold across three
// sources, who may read what, the explicit overlap, the taste card in stored
// facts, and the top-ten share list.

import { describe, expect, it } from "vitest";

import {
  aggregateBeen,
  beenSourcesFor,
  buildTasteFacts,
  passportAccess,
  sharedTopFive,
  sharedWantToTry,
  topTenForShare,
  topTenTitle,
  type BeenSighting,
  type RankedVenue,
} from "@/lib/profilePassport";

describe("aggregateBeen", () => {
  it("folds the diary, drops and plans into one row per pub, newest day first", () => {
    const sightings: BeenSighting[] = [
      { venueId: "lamb", venueName: "The Lamb", date: "2026-10-01", source: "diary" },
      { venueId: "lamb", venueName: "", date: "2026-10-20T19:00:00.000Z", source: "pint_drop" },
      { venueId: "lamb", venueName: "The Lamb (Holborn)", date: "2026-09-02", source: "plan" },
      { venueId: "mitre", venueName: "Ye Olde Mitre", date: "2026-10-10", source: "plan" },
      { venueId: "stars", venueName: "Seven Stars", date: "2026-10-10", source: "pint_drop" },
      { venueId: "stars", venueName: "Seven Stars", date: "2026-10-10", source: "pint_drop" },
    ];
    const been = aggregateBeen(sightings);
    expect(been.map((venue) => venue.venueId)).toEqual(["lamb", "stars", "mitre"]);
    expect(been[0]).toEqual({
      venueId: "lamb",
      venueName: "The Lamb",
      lastDate: "2026-10-20",
      sources: ["diary", "pint_drop", "plan"],
    });
    expect(been[1]!.sources).toEqual(["pint_drop"]);
  });

  it("drops a record with no venue or no readable day", () => {
    expect(
      aggregateBeen([
        { venueId: "", venueName: "Nowhere", date: "2026-10-01", source: "diary" },
        { venueId: "x", venueName: "X", date: "not a day", source: "pint_drop" },
      ]),
    ).toEqual([]);
  });

  it("keeps a Been here row with no day, never gives it one, and sorts it after the dated rows", () => {
    const been = aggregateBeen([
      { venueId: "grapes", venueName: "The Grapes", date: "", source: "been_here" },
      { venueId: "anchor", venueName: "Anchor", date: "", source: "been_here" },
      { venueId: "lamb", venueName: "The Lamb", date: "2026-10-01", source: "diary" },
      // A day that rides in on a Been here row is ignored: the list has none.
      { venueId: "lamb", venueName: "The Lamb", date: "2026-11-01", source: "been_here" },
    ]);
    expect(been).toEqual([
      { venueId: "lamb", venueName: "The Lamb", lastDate: "2026-10-01", sources: ["diary", "been_here"] },
      { venueId: "anchor", venueName: "Anchor", lastDate: "", sources: ["been_here"] },
      { venueId: "grapes", venueName: "The Grapes", lastDate: "", sources: ["been_here"] },
    ]);
  });

  it("still drops an undated record from every dated source", () => {
    expect(
      aggregateBeen([
        { venueId: "a", venueName: "A", date: "", source: "diary" },
        { venueId: "b", venueName: "B", date: "", source: "plan" },
        { venueId: "c", venueName: "C", date: "", source: "pint_drop" },
      ]),
    ).toEqual([]);
  });
});

describe("passportAccess", () => {
  const cases: Array<[Parameters<typeof passportAccess>, string]> = [
    [["been", "owner", true], "full"],
    [["been", "mate", true], "shared"],
    [["been", "stranger", true], "none"],
    [["been", "stranger", false], "shared"],
    [["overlap", "owner", false], "none"],
    [["overlap", "mate", true], "full"],
    [["overlap", "stranger", false], "none"],
    [["taste", "owner", false], "full"],
    [["taste", "mate", false], "none"],
    [["taste", "stranger", false], "none"],
  ];
  it.each(cases)("%j is %s", (args, expected) => {
    expect(passportAccess(...args)).toBe(expected);
  });

  it("keeps the diary, plans and the Been here list for the owner alone", () => {
    expect(beenSourcesFor("full")).toEqual(["diary", "pint_drop", "plan", "been_here"]);
    expect(beenSourcesFor("shared")).toEqual(["pint_drop"]);
    expect(beenSourcesFor("none")).toEqual([]);
  });
});

function ranked(ids: string[]): RankedVenue[] {
  return ids.map((id, index) => ({ venueId: id, venueName: id.toUpperCase(), place: index + 1 }));
}

describe("explicit overlap", () => {
  it("lists pubs in both top fives, by name, never by either order", () => {
    const viewer = ranked(["e", "a", "c", "x", "y", "b"]);
    const owner = ranked(["b", "c", "a", "z", "w", "e"]);
    // b is sixth for the viewer and e sixth for the owner: neither is shared.
    expect(sharedTopFive(viewer, owner)).toEqual([
      { venueId: "a", venueName: "A" },
      { venueId: "c", venueName: "C" },
    ]);
  });

  it("matches want-to-try on resolved venues only", () => {
    expect(
      sharedWantToTry(
        [{ venueId: "", venueName: "" }, { venueId: "lamb", venueName: "The Lamb" }],
        [{ venueId: "", venueName: "" }, { venueId: "lamb", venueName: "The Lamb" }, { venueId: "mitre", venueName: "Mitre" }],
      ),
    ).toEqual([{ venueId: "lamb", venueName: "The Lamb" }]);
  });
});

describe("buildTasteFacts", () => {
  it("is empty with nothing stored, so the card does not render", () => {
    expect(buildTasteFacts({ drinks: [], ranked: [] })).toEqual([]);
  });

  it("states each stored fact with its day and leaves the rest out", () => {
    const facts = buildTasteFacts({
      drinks: [
        { drink: "Guinness", date: "2026-10-01T20:00:00.000Z" },
        { drink: "guinness", date: "2026-10-12T20:00:00.000Z" },
        { drink: "Neck Oil", date: "2026-10-20T20:00:00.000Z" },
      ],
      ranked: [
        { venueId: "lamb", venueName: "The Lamb", place: 1, borough: "Camden", dateLabel: "Built 1729", updatedAt: "2026-10-03T10:00:00.000Z" },
        { venueId: "new", venueName: "New Bar", place: 2, borough: "Hackney", dateLabel: null, updatedAt: "2026-10-05T10:00:00.000Z" },
      ],
    });
    expect(facts.map((fact) => fact.key)).toEqual(["drink", "borough", "era"]);
    expect(facts[0]).toMatchObject({ value: "guinness, logged 2 times", date: "2026-10-12" });
    expect(facts[1]).toMatchObject({ value: "Camden, where your number one, The Lamb, stands", date: "2026-10-03" });
    expect(facts[2]).toMatchObject({ value: "The Lamb: Built 1729", date: "2026-10-03" });
  });

  it("uses no score, percentage or personality word", () => {
    const text = JSON.stringify(
      buildTasteFacts({
        drinks: [{ drink: "Bitter", date: "2026-10-01" }],
        ranked: [{ venueId: "a", venueName: "A", place: 1, borough: "Islington", dateLabel: "1800s", updatedAt: "2026-10-01" }],
      }),
    );
    expect(text).not.toMatch(/%|score|match|you are|you're a/i);
  });
});

describe("topTenForShare", () => {
  it("lists ten names in rank order with the place as the only number", () => {
    const list = ranked(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]).reverse();
    const ten = topTenForShare(list);
    expect(ten).toHaveLength(10);
    expect(ten.map((venue) => venue.venueId)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    expect(ten.map((venue) => venue.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(Object.keys(ten[0]!).sort()).toEqual(["place", "venueId", "venueName"]);
  });

  it("titles the page in the owner's words", () => {
    expect(topTenTitle("sam")).toBe("@sam's top ten, in their order");
  });
});
