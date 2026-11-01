// The visibility matrix for the three passport reads
// (lib/profilePassport.server.ts): anonymous, a signed-in stranger, a mate and
// the owner, against a public and a private account. Every store is a fake, so
// what each reader receives is the whole of the proof.

import { describe, expect, it } from "vitest";

import type { AccountVisibility } from "@/lib/accountVisibility";
import { PASSPORT_COPY, TASTE_COPY } from "@/lib/profilePassport";
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
    beenHere: async () => [],
    rankings: async (profileId) =>
      profileId === OWNER.id ? rankedRows(["lamb", "stars", "mitre", "a", "b"]) : rankedRows(["stars", "z", "lamb"]),
    nightProfile: async () => ({ patch: "Soho" }),
    venue: async (venueId) => ({ name: venueId.toUpperCase(), borough: "Camden" }),
    heritageDateLabel: async (venueId) => (venueId === "lamb" ? "Built 1729" : null),
    venueAliases: async () => (venueId) => venueId,
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
    expect(result.body.cover).toEqual({ patch: "Soho" });
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
        beenHere: async () => (asked.push("beenHere"), []),
      }),
    );
    expect(asked).toEqual([]);
  });

  it("folds the owner's own Been here list in as undated rows that say so", async () => {
    const beenHere = async () => [
      { venueId: "grapes", venueName: "The Grapes" },
      // Already in the diary: one pub, one row, and the diary's day stands.
      { venueId: "lamb", venueName: "The Lamb" },
    ];
    const result = await readPassportBeen(request(), "owner", deps("owner", "public", { beenHere }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.count).toBe(4);
    const grapes = result.body.venues.find((venue) => venue.venueId === "grapes");
    expect(grapes).toEqual({ venueId: "grapes", venueName: "The Grapes", lastDate: "", sources: ["been_here"] });
    const lamb = result.body.venues.find((venue) => venue.venueId === "lamb");
    expect(lamb?.lastDate).toBe("2026-10-05");
    expect(lamb?.sources).toEqual(["diary", "pint_drop", "been_here"]);
    // The undated row sorts after every dated one.
    expect(result.body.venues.at(-1)?.venueId).toBe("grapes");
    expect(PASSPORT_COPY.undated).toBe("No date");
  });

  it.each<Reader>(["anon", "stranger", "mate"])(
    "never shows %s the owner's Been here list, and never asks for it",
    async (reader) => {
      const asked: string[] = [];
      const result = await readPassportBeen(
        request(),
        "owner",
        deps(reader, "public", {
          beenHere: async () => (asked.push("beenHere"), [{ venueId: "grapes", venueName: "The Grapes" }]),
        }),
      );
      expect(asked).toEqual([]);
      expect(result.ok && result.body.venues.some((venue) => venue.venueId === "grapes")).toBe(false);
      expect(result.ok && result.body.venues.every((venue) => !venue.sources.includes("been_here"))).toBe(true);
    },
  );

  it("reads degraded, never empty, when the Been here list cannot be read", async () => {
    const result = await readPassportBeen(
      request(),
      "owner",
      deps("owner", "public", { beenHere: async () => { throw new Error("saved lists down"); } }),
    );
    expect(result.ok && result.body.status).toBe("degraded");
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
    expect(result.body.facts.map((fact) => fact.key)).toEqual(["drink", "borough", "era"]);
    expect(result.body.facts.every((fact) => /^\d{4}-\d{2}-\d{2}$/.test(fact.date))).toBe(true);
  });

  it("answers an empty list when nothing is stored", async () => {
    const result = await readPassportTaste(
      request(),
      "owner",
      deps("owner", "public", { drops: async () => [], rankings: async () => [] }),
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

// Review finding 1 (PR 2402): the Night Profile holds a per-person ROUTE
// budget, not a fair price for one pint, and the passport printed it as "Fair
// pint". The captain's decision removes the field: the passport has no
// fair-pint line at all, on the cover or on the taste card.
describe("the passport has no fair-pint line", () => {
  it("prints no pint figure from a route budget, on the cover or the taste card", async () => {
    const { defaultPassportDeps } = await import("@/lib/profilePassport.server");
    const { memoryNightProfileStore, __resetNightProfileStore } = await import("@/lib/nightProfileStore");
    const { DEFAULT_NIGHT_PROFILE_INPUT } = await import("@/lib/nightProfile");
    __resetNightProfileStore();
    // A £40 route budget for the night.
    const nightBudgetPence = 4000;
    await memoryNightProfileStore.put(
      OWNER.userId,
      { ...DEFAULT_NIGHT_PROFILE_INPUT, context: { ...DEFAULT_NIGHT_PROFILE_INPUT.context, budgetLimitPence: nightBudgetPence } },
      null,
    );
    const production = defaultPassportDeps().nightProfile;
    const stored = await production(OWNER.userId);
    expect(Object.keys(stored ?? {})).toEqual(["patch"]);

    const been = await readPassportBeen(request(), "owner", deps("owner", "public", { nightProfile: production }));
    expect(been.ok).toBe(true);
    if (!been.ok) return;
    expect(Object.keys(been.body.cover ?? {})).toEqual(["patch"]);
    expect(JSON.stringify(been.body)).not.toMatch(/fair|£40|4000/i);
    const taste = await readPassportTaste(request(), "owner", deps("owner", "public", { nightProfile: production }));
    expect(taste.ok).toBe(true);
    if (!taste.ok) return;
    expect(taste.body.facts.map((fact) => fact.key as string)).not.toContain("fair_pint");
    expect(JSON.stringify(taste.body)).not.toMatch(/fair|£40/i);
    expect(PASSPORT_COPY).not.toHaveProperty("fairPint");
    expect(TASTE_COPY).not.toHaveProperty("fairPint");
    __resetNightProfileStore();
  });
});

// Review finding 2 (PR 2402): a former venue id and its successor are one pub.
// "lamb-old" was merged into "lamb"; the alias map says so.
describe("a former venue id and its successor are one pub", () => {
  const ALIASES: Record<string, string> = { "lamb-old": "lamb" };
  const canonical = async () => (id: string) => ALIASES[id] ?? id;

  it("counts the diary row under the old id and the drop under the new id once", async () => {
    const result = await readPassportBeen(
      request(),
      "owner",
      deps("owner", "public", {
        venueAliases: canonical,
        diary: async () => [{ venueId: "lamb-old", venueName: "The Lamb", date: "2026-10-01", source: "diary" }],
        plans: async () => [],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.count).toBe(2);
    expect(result.body.venues.map((venue) => venue.venueId).sort()).toEqual(["lamb", "stars"]);
    // The merged row keeps every record that put the owner there.
    expect(result.body.venues.find((venue) => venue.venueId === "lamb")?.sources).toEqual(["diary", "pint_drop"]);
  });

  it("finds the overlap when one mate ranked the old id and the other the new one", async () => {
    const result = await readPassportOverlap(
      request(),
      "owner",
      deps("mate", "public", {
        venueAliases: canonical,
        rankings: async (profileId) =>
          profileId === OWNER.id ? rankedRows(["lamb", "stars"]) : rankedRows(["lamb-old", "z"]),
        wanted: async (profileId) =>
          profileId === OWNER.id
            ? [{ venueId: "lamb", venueName: "The Lamb" }]
            : [{ venueId: "lamb-old", venueName: "The Lamb" }],
      }),
    );
    expect(result).toEqual({
      ok: true,
      body: {
        topFive: [{ venueId: "lamb", venueName: "LAMB" }],
        wantToTry: [{ venueId: "lamb", venueName: "The Lamb" }],
      },
    });
  });

  it("ranks the taste card's top five on the current id", async () => {
    const asked: string[] = [];
    await readPassportTaste(
      request(),
      "owner",
      deps("owner", "public", {
        venueAliases: canonical,
        rankings: async () => rankedRows(["lamb-old"]),
        venue: async (venueId) => (asked.push(venueId), { name: venueId.toUpperCase(), borough: "Camden" }),
      }),
    );
    expect(asked).toEqual(["lamb"]);
  });

  // Review P3b (PR 2402): after alias mapping one pub could sit twice in a
  // top five, ranked once under its old id and once under its current id.
  // The best-placed row is the one that stays.
  it("keeps one row per pub in the taste card's top five, at its best place", async () => {
    const asked: string[] = [];
    const result = await readPassportTaste(
      request(),
      "owner",
      deps("owner", "public", {
        venueAliases: canonical,
        rankings: async () => rankedRows(["a", "lamb-old", "b", "lamb", "c"]),
        venue: async (venueId) => (asked.push(venueId), { name: venueId.toUpperCase(), borough: "Camden" }),
      }),
    );
    expect(result.ok).toBe(true);
    expect(asked.sort()).toEqual(["a", "b", "c", "lamb"]);
    // The row that stays is the one ranked at place 2, under the old id's name.
    if (!result.ok) return;
    const dated = result.body.facts.filter((fact) => fact.value.includes("LAMB"));
    expect(dated).toHaveLength(1);
    expect(dated[0]?.value).toContain("LAMB-OLD");
  });

  it("intersects the shared top five once when one mate ranked a pub under both ids", async () => {
    const result = await readPassportOverlap(
      request(),
      "owner",
      deps("mate", "public", {
        venueAliases: canonical,
        rankings: async (profileId) =>
          profileId === OWNER.id ? rankedRows(["a", "lamb-old", "b", "lamb", "c"]) : rankedRows(["lamb", "lamb-old"]),
        wanted: async () => [],
      }),
    );
    expect(result).toEqual({
      ok: true,
      body: { topFive: [{ venueId: "lamb", venueName: "LAMB-OLD" }], wantToTry: [] },
    });
  });
});
