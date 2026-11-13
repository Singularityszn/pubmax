// The points read (lib/points.server.ts): what each record earns, who may
// read the breakdown, and what a failed store does to the total. Every store
// is a fake, so the breakdown is the whole of the proof.

import { promises as fs } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { readPointsBreakdown, readPointsStanding, readProfilePoints, type PointsDeps } from "@/lib/points.server";
import type { ProfileRecord } from "@/lib/profileStore";
import { resetVenueAliasesForTests } from "@/lib/venueAliases";
import * as venueIndex from "@/lib/venueIndex";

const OWNER = { id: "p-owner", handle: "owner", userId: "u-owner", visibility: "public" } as ProfileRecord;
const OTHER = { id: "p-other", handle: "other", userId: "u-other", visibility: "public" } as ProfileRecord;

function deps(caller: string | null, overrides: Partial<PointsDeps> = {}): PointsDeps {
  const profiles = new Map([
    [OWNER.handle, OWNER],
    [OTHER.handle, OTHER],
  ]);
  return {
    verifyCaller: async () => caller,
    profiles: {
      getByHandle: async (handle) => profiles.get(handle) ?? null,
      getByUserId: async (userId) => [...profiles.values()].find((row) => row.userId === userId) ?? null,
    },
    withdrawn: async () => false,
    // The Lamb is in the diary AND has a drop: one pub, not two.
    diary: async () => [{ venueId: "lamb", venueName: "The Lamb", date: "2026-10-01", source: "diary" }],
    plans: async () => [{ venueId: "mitre", venueName: "Ye Olde Mitre", date: "2026-09-01", source: "plan" }],
    beenHere: async () => [{ venueId: "anchor-old", venueName: "Anchor" }],
    venue: async (venueId) => ({ name: venueId, borough: "Camden" }),
    // A merged id counts as the pub it names now.
    venueAliases: async () => (venueId) => (venueId === "anchor-old" ? "anchor" : venueId),
    drops: async () => [
      { venueId: "lamb", createdAt: "2026-10-05T19:00:00.000Z", priced: true, checked: true },
      { venueId: "lamb", createdAt: "2026-10-06T19:00:00.000Z", priced: true, checked: false },
      { venueId: "stars", createdAt: "2026-10-07T19:00:00.000Z", priced: false, checked: false },
    ],
    addedPubs: async () => 1,
    fixedPubs: async () => 2,
    drinkReviews: async () => 2,
    londonDistricts: async () =>
      new Map([
        ["WC1", ["lamb", "mitre", "anchor"]],
        ["SE1", ["anchor", "george", "market"]],
      ]),
    challenges: async () => new Map(),
    ...overrides,
  };
}

const request = () => new Request("https://example.test/api/profiles/owner/points");

function line(breakdown: Awaited<ReturnType<typeof readPointsBreakdown>>, key: string) {
  return breakdown.lines.find((entry) => entry.key === key);
}

describe("readPointsBreakdown", () => {
  it("counts each record once at its own value", async () => {
    const breakdown = await readPointsBreakdown(OWNER, deps("u-owner"));
    expect(breakdown.status).toBe("ready");
    // lamb, mitre, anchor and stars: four distinct pubs.
    expect(line(breakdown, "been")).toMatchObject({ count: 4, points: 40 });
    // Two priced drops; the notes-only drop earns nothing.
    expect(line(breakdown, "priceLogged")).toMatchObject({ count: 2, points: 10 });
    expect(line(breakdown, "priceChecked")).toMatchObject({ count: 1, points: 10 });
    expect(line(breakdown, "district")).toMatchObject({ count: 1, points: 50 });
    expect(breakdown.districts).toEqual(["WC1"]);
    expect(line(breakdown, "pubAdded")).toMatchObject({ count: 1, points: 20 });
    expect(line(breakdown, "pubFixed")).toMatchObject({ count: 2, points: 10 });
    expect(line(breakdown, "drinkReview")).toMatchObject({ count: 2, points: 10 });
    expect(line(breakdown, "letterArea")).toMatchObject({ count: 1, points: 1000 });
    expect(breakdown.total).toBe(1150);
    expect(breakdown.level).toBe(6);
    expect(breakdown.nextLevelAt).toBe(1200);
  });

  it("gives a new account zero, level 1, and nothing invented", async () => {
    const breakdown = await readPointsBreakdown(
      OWNER,
      deps("u-owner", {
        diary: async () => [],
        plans: async () => [],
        beenHere: async () => [],
        drops: async () => [],
        addedPubs: async () => 0,
        fixedPubs: async () => 0,
        drinkReviews: async () => 0,
      }),
    );
    expect(breakdown).toMatchObject({ status: "ready", total: 0, level: 1, nextLevelAt: 50, districts: [] });
    expect(breakdown.lines.every((entry) => entry.count === 0 && entry.points === 0)).toBe(true);
  });

  it("marks the total degraded and counts nothing from a store that failed", async () => {
    const breakdown = await readPointsBreakdown(
      OWNER,
      deps("u-owner", {
        addedPubs: async () => {
          throw new Error("store down");
        },
      }),
    );
    expect(breakdown.status).toBe("degraded");
    expect(line(breakdown, "pubAdded")).toMatchObject({ count: 0, points: 0 });
    expect(breakdown.total).toBe(1130);
  });

  it("pays for finished challenges and doubles one finished inside its month", async () => {
    const breakdown = await readPointsBreakdown(
      OWNER,
      deps("u-owner", {
        beenHere: async () => [{ venueId: "anchor-old", venueName: "Anchor", savedAt: "2026-11-02T20:00:00.000Z" }],
        challenges: async () =>
          new Map([
            // Mitre's plan is September 2026, the Red Lion's month.
            ["red-lion", [{ label: "Mitre", venueIds: ["mitre"] }]],
            // The Lamb's first record is its 1 October diary day, the King's Head's month.
            ["kings-head", [{ label: "Lamb", venueIds: ["lamb"] }]],
            // Finished in October, which is not the Ship's month.
            ["ship", [{ label: "Lamb", venueIds: ["lamb"] }, { label: "Mitre", venueIds: ["mitre"] }]],
            // The Anchor was ticked on its old id in November, not December.
            ["every-district", [{ label: "SE1", venueIds: ["anchor"] }, { label: "N1", venueIds: ["nowhere"] }]],
          ]),
      }),
    );
    expect(breakdown.status).toBe("ready");
    expect(line(breakdown, "challenge")).toMatchObject({ count: 3, points: 1500 });
    expect(line(breakdown, "challengeDoubled")).toMatchObject({ count: 2, points: 1000 });
    expect(breakdown.total).toBe(1150 + 2500);
    expect(breakdown.challenges.map(({ id, done, total, finished, doubled }) => [id, done, total, finished, doubled])).toEqual([
      ["red-lion", 1, 1, true, true],
      ["kings-head", 1, 1, true, true],
      ["ship", 2, 2, true, false],
      ["every-district", 1, 2, false, false],
      ["trades", 0, 0, false, false],
      ["monopoly", 0, 0, false, false],
    ]);
    expect(breakdown.challenges[3]?.left).toEqual([{ label: "N1" }]);
  });

  it("never doubles a challenge finished by an undated Been here row", async () => {
    const breakdown = await readPointsBreakdown(
      OWNER,
      deps("u-owner", {
        diary: async () => [],
        plans: async () => [],
        drops: async () => [],
        beenHere: async () => [{ venueId: "mitre", venueName: "Mitre" }],
        challenges: async () => new Map([["red-lion", [{ label: "Mitre", venueIds: ["mitre"] }]]]),
      }),
    );
    expect(line(breakdown, "challenge")).toMatchObject({ count: 1, points: 500 });
    expect(line(breakdown, "challengeDoubled")).toMatchObject({ count: 0, points: 0 });
  });

  it.each([
    ["diary", "2026-08-20", 0],
    ["drops", "2026-09-01", 1],
    ["plans", "2026-09-01", 1],
    ["beenHere", "2026-09-01", 1],
    ["venueAliases", "2026-09-01", 1],
  ] as const)(
    "withholds the September bonus when %s cannot be read",
    async (failedRead, diaryDate, healthyBonuses) => {
      const records: Partial<PointsDeps> = {
        diary: async () => [{ venueId: "last", venueName: "Last Red Lion", date: diaryDate, source: "diary" }],
        plans: async () => [
          { venueId: "first", venueName: "First Red Lion", date: "2026-07-01", source: "plan" },
          { venueId: "last", venueName: "Last Red Lion", date: "2026-09-01", source: "plan" },
        ],
        beenHere: async () => [
          { venueId: "first", venueName: "First Red Lion", savedAt: "2026-07-01T19:00:00.000Z" },
          { venueId: "last", venueName: "Last Red Lion", savedAt: "2026-09-01T19:00:00.000Z" },
        ],
        drops: async () => [
          { venueId: "first", createdAt: "2026-07-01T19:00:00.000Z", priced: false, checked: false },
          { venueId: "last", createdAt: "2026-09-01T19:00:00.000Z", priced: false, checked: false },
        ],
        venueAliases: async () => (id) => id,
        challenges: async () => new Map([["red-lion", [
          { label: "First Red Lion", venueIds: ["first"] },
          { label: "Last Red Lion", venueIds: ["last"] },
        ]]]),
      };
      const healthy = await readPointsBreakdown(OWNER, deps("u-owner", records));
      expect(line(healthy, "challenge")).toMatchObject({ count: 1, points: 500 });
      expect(line(healthy, "challengeDoubled")).toMatchObject({ count: healthyBonuses, points: healthyBonuses * 500 });

      const breakdown = await readPointsBreakdown(OWNER, deps("u-owner", {
        ...records,
        [failedRead]: async () => { throw new Error("record read unavailable"); },
      }));
      expect(breakdown.status).toBe("degraded");
      expect(line(breakdown, "challengeDoubled")).toMatchObject({ count: 0, points: 0 });
      expect(breakdown.challenges.find((challenge) => challenge.id === "red-lion")).toMatchObject({
        finished: true,
        doubled: false,
        finishedAt: null,
      });
    },
  );

  it("finishes no challenge and marks the total degraded when challenges cannot be read", async () => {
    const breakdown = await readPointsBreakdown(
      OWNER,
      deps("u-owner", {
        challenges: async () => {
          throw new Error("pack missing");
        },
      }),
    );
    expect(breakdown.status).toBe("degraded");
    expect(line(breakdown, "challenge")).toMatchObject({ count: 0, points: 0 });
    expect(breakdown.challenges.every((challenge) => challenge.total === 0)).toBe(true);
  });

  it("finishes no district when the district list cannot be read", async () => {
    const breakdown = await readPointsBreakdown(
      OWNER,
      deps("u-owner", {
        londonDistricts: async () => {
          throw new Error("pack missing");
        },
      }),
    );
    expect(breakdown.status).toBe("degraded");
    expect(line(breakdown, "district")).toMatchObject({ count: 0, points: 0 });
  });

  it("marks points degraded when venue aliases cannot be read", async () => {
    const result = await readProfilePoints(
      request(),
      "owner",
      deps("u-owner", {
        diary: async () => [{ venueId: "anchor-old", venueName: "Anchor", date: "2026-10-01", source: "diary" }],
        drops: async () => [
          { venueId: "anchor", createdAt: "2026-10-05T19:00:00.000Z", priced: true, checked: false },
        ],
        venueAliases: async () => {
          throw new Error("alias file unavailable");
        },
      }),
    );
    expect(result).toMatchObject({ ok: true, body: { status: "degraded" } });
  });

  it("preserves a real alias-file failure through the default points reader", async () => {
    const indexRead = vi.spyOn(venueIndex, "readCityVenueIndex").mockResolvedValue(new Map());
    const fileRead = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("alias file missing"));
    resetVenueAliasesForTests();
    try {
      const breakdown = await readPointsBreakdown({ handle: "" });
      expect(breakdown).toMatchObject({ status: "degraded", total: 0 });
    } finally {
      fileRead.mockRestore();
      indexRead.mockRestore();
      resetVenueAliasesForTests();
    }
  });
});

describe("readPointsStanding", () => {
  it("ranks all records with the existing points and level", async () => {
    const standing = await readPointsStanding(OWNER, deps("u-owner"));
    expect(standing).toEqual({ status: "ready", total: 1150, level: 6 });
  });

  it("preserves points when a dated visit is also saved to Been here", async () => {
    const records = deps("u-owner", {
      diary: async () => [{ venueId: "lamb", venueName: "The Lamb", date: "2026-11-13", source: "diary" }],
      drops: async () => [],
      plans: async () => [],
      beenHere: async () => [],
      addedPubs: async () => 0,
      fixedPubs: async () => 0,
      drinkReviews: async () => 0,
      londonDistricts: async () => new Map(),
    });
    expect(await readPointsStanding(OWNER, records)).toEqual({ status: "ready", total: 10, level: 1 });
    records.beenHere = async () => [{ venueId: "lamb", venueName: "The Lamb" }];
    expect(await readPointsStanding(OWNER, records)).toEqual({ status: "ready", total: 10, level: 1 });
  });

  it("preserves degraded status when a record read fails", async () => {
    const standing = await readPointsStanding(
      OWNER,
      deps("u-owner", {
        addedPubs: async () => {
          throw new Error("submissions unavailable");
        },
      }),
    );
    expect(standing).toEqual({ status: "degraded", total: 1130, level: 6 });
  });
});

describe("readProfilePoints", () => {
  it("gives the owner their breakdown", async () => {
    const result = await readProfilePoints(request(), "owner", deps("u-owner"));
    expect(result.ok && result.body.total).toBe(1150);
  });

  it.each([
    ["a signed-out reader", null],
    ["another account", "u-other"],
  ])("refuses %s", async (_label, caller) => {
    const asked: string[] = [];
    const result = await readProfilePoints(
      request(),
      "owner",
      deps(caller, {
        diary: async () => {
          asked.push("diary");
          return [];
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, status: 403, code: "OWNER_ONLY" });
    expect(asked).toEqual([]);
  });

  it("answers an unknown or withdrawn handle as not found", async () => {
    expect(await readProfilePoints(request(), "nobody", deps("u-owner"))).toMatchObject({ ok: false, status: 404 });
    expect(
      await readProfilePoints(request(), "owner", deps("u-other", { withdrawn: async () => true })),
    ).toMatchObject({ ok: false, status: 404 });
  });
});
