// The visibility matrix for the three passport reads
// (lib/profilePassport.server.ts): anonymous, a signed-in stranger, a mate and
// the owner, against a public and a private account. Every store is a fake, so
// what each reader receives is the whole of the proof.

import { describe, expect, it } from "vitest";

import type { AccountVisibility } from "@/lib/accountVisibility";
import {
  readPassportBeen,
  readPassportOverlap,
  readPassportRanked,
  readPassportTaste,
  type PassportDeps,
  type PassportRankedRow,
} from "@/lib/profilePassport.server";
import type { ProfileRecord } from "@/lib/profileStore";

const OWNER = { id: "p-owner", handle: "owner", userId: "u-owner" };
const MATE = { id: "p-mate", handle: "mate", userId: "u-mate" };
const STRANGER = { id: "p-stranger", handle: "stranger", userId: "u-stranger" };

type Reader = "anon" | "stranger" | "mate" | "owner";
const USER_FOR: Record<Reader, string | null> = {
  anon: null,
  stranger: STRANGER.userId,
  mate: MATE.userId,
  owner: OWNER.userId,
};

function row(base: typeof OWNER, visibility: AccountVisibility = "public"): ProfileRecord {
  return { ...base, visibility } as ProfileRecord;
}

function rankedRows(ids: string[]): PassportRankedRow[] {
  return ids.map((id, index) => ({ venueId: id, venueName: id.toUpperCase(), place: index + 1, updatedAt: "2026-10-01T10:00:00.000Z" }));
}

function deps(reader: Reader, visibility: AccountVisibility, overrides: Partial<PassportDeps> = {}): PassportDeps {
  const profiles = new Map([
    [OWNER.handle, row(OWNER, visibility)],
    [MATE.handle, row(MATE)],
    [STRANGER.handle, row(STRANGER)],
  ]);
  // owner <-> mate is mutual; stranger follows owner one way.
  const edges = new Set(["mate>owner", "owner>mate", "stranger>owner"]);
  return {
    verifyCaller: async () => USER_FOR[reader],
    profiles: {
      getByHandle: async (handle) => profiles.get(handle) ?? null,
      getByUserId: async (userId) => [...profiles.values()].find((entry) => entry.userId === userId) ?? null,
    },
    follows: { isFollowing: async (a, b) => edges.has(`${a}>${b}`) },
    withdrawn: async () => false,
    dropViewer: async () => (USER_FOR[reader] ? { handle: reader } : undefined),
    diary: async () => [{ venueId: "lamb", venueName: "The Lamb", date: "2026-10-01", source: "diary" }],
    drops: async () => [
      { venueId: "lamb", drink: "Guinness", createdAt: "2026-10-05T19:00:00.000Z" },
      { venueId: "stars", drink: "Guinness", createdAt: "2026-10-06T19:00:00.000Z" },
    ],
    plans: async () => [{ venueId: "mitre", venueName: "Ye Olde Mitre", date: "2026-09-01", source: "plan" }],
    wanted: async (profileId) =>
      profileId === OWNER.id
        ? [{ venueId: "cittie", venueName: "Cittie of Yorke" }, { venueId: "", venueName: "" }]
        : [{ venueId: "cittie", venueName: "Cittie of Yorke" }],
    rankings: async (profileId) =>
      profileId === OWNER.id ? rankedRows(["lamb", "stars", "mitre", "a", "b"]) : rankedRows(["stars", "z", "lamb"]),
    nightProfile: async () => ({ fairPintPence: 550, patch: "Soho", updatedAt: "2026-09-20T10:00:00.000Z" }),
    venue: async (venueId) => ({ name: venueId.toUpperCase(), borough: "Camden" }),
    heritageDateLabel: async (venueId) => (venueId === "lamb" ? "Built 1729" : null),
    ...overrides,
  };
}

const request = () => new Request("https://example.test/api/profiles/owner/been");

describe("GET been", () => {
  it("gives the owner every source, the counts and their own cover", async () => {
    const result = await readPassportBeen(request(), "owner", deps("owner", "private"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.access).toBe("full");
    expect(result.body.count).toBe(3);
    expect(result.body.venues.map((venue) => venue.venueId).sort()).toEqual(["lamb", "mitre", "stars"]);
    expect(result.body.venues.find((venue) => venue.venueId === "lamb")?.sources).toEqual(["diary", "pint_drop"]);
    expect(result.body.wantToTryCount).toBe(2);
    expect(result.body.cover).toEqual({ fairPintPence: 550, patch: "Soho" });
  });

  it.each<Reader>(["anon", "stranger", "mate"])(
    "gives %s only the drops of a public account, and no cover",
    async (reader) => {
      const result = await readPassportBeen(request(), "owner", deps(reader, "public"));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.body.access).toBe("shared");
      expect(result.body.venues.map((venue) => venue.venueId)).toEqual(["stars", "lamb"]);
      expect(result.body.venues.every((venue) => venue.sources.join() === "pint_drop")).toBe(true);
      expect(result.body.cover).toBeNull();
    },
  );

  it.each<Reader>(["anon", "stranger"])("refuses %s on a private account", async (reader) => {
    const result = await readPassportBeen(request(), "owner", deps(reader, "private"));
    expect(result).toMatchObject({ ok: false, status: 403, code: "PRIVATE_ACCOUNT" });
  });

  it("lets a mate read a private account's shared list", async () => {
    const result = await readPassportBeen(request(), "owner", deps("mate", "private"));
    expect(result.ok && result.body.access).toBe("shared");
  });

  it("never asks the private stores for a reader who is not the owner", async () => {
    const asked: string[] = [];
    await readPassportBeen(
      request(),
      "owner",
      deps("mate", "public", {
        diary: async () => (asked.push("diary"), []),
        plans: async () => (asked.push("plans"), []),
        nightProfile: async () => (asked.push("night"), null),
      }),
    );
    expect(asked).toEqual([]);
  });

  it("answers a withdrawn or unknown handle as not found", async () => {
    expect(await readPassportBeen(request(), "nobody", deps("owner", "public"))).toMatchObject({ status: 404 });
    expect(
      await readPassportBeen(request(), "owner", deps("anon", "public", { withdrawn: async () => true })),
    ).toMatchObject({ status: 404 });
  });

  it("treats a failed bearer check as a stranger", async () => {
    const result = await readPassportBeen(
      request(),
      "owner",
      deps("owner", "private", { verifyCaller: async () => { throw new Error("jwks down"); } }),
    );
    expect(result).toMatchObject({ status: 403 });
  });
});

describe("GET overlap", () => {
  it("gives a mate the two name lists and nothing else", async () => {
    const result = await readPassportOverlap(request(), "owner", deps("mate", "private"));
    expect(result).toEqual({
      ok: true,
      body: {
        topFive: [
          { venueId: "lamb", venueName: "LAMB" },
          { venueId: "stars", venueName: "STARS" },
        ],
        wantToTry: [{ venueId: "cittie", venueName: "Cittie of Yorke" }],
      },
    });
  });

  it.each<Reader>(["anon", "stranger", "owner"])("refuses %s, even on a public account", async (reader) => {
    expect(await readPassportOverlap(request(), "owner", deps(reader, "public"))).toMatchObject({
      ok: false,
      status: 403,
      code: "MATES_ONLY",
    });
  });
});

describe("GET taste", () => {
  it("gives the owner stored facts with days", async () => {
    const result = await readPassportTaste(request(), "owner", deps("owner", "public"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.facts.map((fact) => fact.key)).toEqual(["drink", "borough", "era", "fair_pint"]);
    expect(result.body.facts.every((fact) => /^\d{4}-\d{2}-\d{2}$/.test(fact.date))).toBe(true);
  });

  it("answers an empty list when nothing is stored", async () => {
    const result = await readPassportTaste(
      request(),
      "owner",
      deps("owner", "public", { drops: async () => [], rankings: async () => [], nightProfile: async () => null }),
    );
    expect(result).toEqual({ ok: true, body: { facts: [] } });
  });

  it.each<Reader>(["anon", "stranger", "mate"])("refuses %s", async (reader) => {
    expect(await readPassportTaste(request(), "owner", deps(reader, "public"))).toMatchObject({
      status: 403,
      code: "OWNER_ONLY",
    });
  });
});

describe("the ranked list behind the share", () => {
  it.each<Reader>(["anon", "stranger", "mate"])("is the owner's alone, not %s's", async (reader) => {
    expect(await readPassportRanked(request(), "owner", deps(reader, "public"))).toMatchObject({ status: 403 });
  });

  it("carries place and name only", async () => {
    const result = await readPassportRanked(request(), "owner", deps("owner", "public"));
    expect(result.ok && Object.keys(result.body.ranked[0]!).sort()).toEqual(["place", "venueId", "venueName"]);
  });
});
