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
  // October in London starts at midnight BST, 23:00 UTC on 30 September.
  const SINCE = "2026-09-30T23:00:00.000Z";
  // The pub added was accepted in October; both fixes were resolved before it.
  const dated = (overrides: Partial<PointsDeps> = {}) =>
    deps("u-owner", {
      // A wrong month start finds nothing this month.
      addedPubs: async (_owner, since) => (since === undefined || since === SINCE ? 1 : 0),
      fixedPubs: async (_owner, since) => (since === undefined ? 2 : 0),
      ...overrides,
    });

  it("counts this month only from records dated inside it", async () => {
    const standing = await readPointsStanding(OWNER, "2026-10-01", dated());
    expect(standing).toMatchObject({ status: "ready", total: 1150, level: 6 });
    // The Lamb (diary 1 Oct) and the Seven Stars (drop 7 Oct) are new pubs:
    // 20. Two priced drops: 10, one checked: 10. WC1 finished this month: 50,
    // and with it the WC area: 1,000. The pub accepted in October: 20.
    // The September plan, the undated Been here save, both earlier fixes and
    // the drink reviews earn nothing this month.
    expect(standing.monthTotal).toBe(1110);
  });

  it("gives a month with no dated records nothing", async () => {
    const standing = await readPointsStanding(OWNER, "2026-11-01", dated({ addedPubs: async (_owner, since) => (since ? 0 : 1) }));
    expect(standing).toMatchObject({ total: 1150, monthTotal: 0 });
  });

  it("marks the standing degraded and credits no month points when a dated count fails", async () => {
    const standing = await readPointsStanding(
      OWNER,
      "2026-10-01",
      dated({
        addedPubs: async (_owner, since) => {
          if (since) throw new Error("submissions unavailable");
          return 1;
        },
      }),
    );
    expect(standing.status).toBe("degraded");
    expect(standing.total).toBe(1150);
    expect(standing.monthTotal).toBe(1090);
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
