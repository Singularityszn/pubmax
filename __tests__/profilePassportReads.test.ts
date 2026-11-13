// The visibility matrix for the three passport reads
// (lib/profilePassport.server.ts): anonymous, a signed-in stranger, a mate and
// the owner, against a public and a private account. Every store is a fake, so
// what each reader receives is the whole of the proof.

import { describe, expect, it, vi } from "vitest";

import type { AccountVisibility } from "@/lib/accountVisibility";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { PASSPORT_COPY, TASTE_COPY } from "@/lib/profilePassport";
import {
  CappedRead,
  defaultPassportDeps,
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
    liveMutual: async () => true,
    withdrawn: async () => false,
    dropViewer: async () => (USER_FOR[reader] ? { handle: reader, mutualHandles: new Set<string>() } : undefined),
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
    dropVenueIds: async () => ["lamb", "stars"],
    // The author's own complete list answers like the public one unless a case
    // sets it, so a case that names one author's venues covers both reads.
    ownDropVenueIds: async (author) => (overrides.dropVenueIds ?? (async () => ["lamb", "stars"]))(author, undefined),
    venue: async (venueId) => ({ name: venueId.toUpperCase(), borough: "Camden", point: [-0.12, 51.52] }),
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
  it.each(["blocked", "unavailable"])("refuses overlap when the live mate check is %s", async (state) => {
    const result = await readPassportOverlap(request(), "owner", deps("mate", "public", {
      liveMutual: async () => {
        if (state === "unavailable") throw new Error("relationship unavailable");
        return false;
      },
    }));
    expect(result).toEqual({
      ok: false,
      status: 403,
      code: "MATES_ONLY",
      error: "Only mates see this.",
    });
  });

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
        been: {
          both: [
            { venueId: "lamb", venueName: "LAMB", point: [-0.12, 51.52] },
            { venueId: "stars", venueName: "STARS", point: [-0.12, 51.52] },
          ],
          onlyYou: [{ venueId: "mitre", venueName: "Ye Olde Mitre", point: [-0.12, 51.52] }],
          onlyThem: [],
        },
      },
    });
  });

  it("compares the viewer's whole Been list with only the mate's shared one", async () => {
    const askedFor: string[] = [];
    const result = await readPassportOverlap(
      request(),
      "owner",
      deps("mate", "private", {
        diary: async (userId) => (askedFor.push(`diary:${userId}`), []),
        plans: async (userId) => (askedFor.push(`plans:${userId}`), []),
        beenHere: async (handle) => (askedFor.push(`beenHere:${handle}`), [{ venueId: "grapes", venueName: "The Grapes" }]),
        drops: async (author) =>
          author === "owner"
            ? [{ venueId: "anchor", drink: "Guinness", createdAt: "2026-10-05T19:00:00.000Z" }]
            : [],
        dropVenueIds: async (author) => (author === "owner" ? ["anchor"] : []),
      }),
    );
    expect(askedFor.sort()).toEqual(["beenHere:mate", "diary:u-mate", "plans:u-mate"]);
    expect(result.ok && result.body.been).toEqual({
      both: [],
      onlyYou: [{ venueId: "grapes", venueName: "The Grapes", point: [-0.12, 51.52] }],
      onlyThem: [{ venueId: "anchor", venueName: "ANCHOR", point: [-0.12, 51.52] }],
    });
  });

  it("compares a saved Cambridge pub with a mate's drop across enabled cities", async () => {
    const read = vi.spyOn(pintDropsStore(), "listVisibleAuthorVenueIds").mockImplementation(
      async (author, _viewer, cityId) => {
        if (cityId === "cambridge" && author === "owner") return ["cambridge:eagle", "lamb"];
        return cityId === "london" ? ["lamb"] : [];
      },
    );
    try {
      const dropVenueIds = defaultPassportDeps().dropVenueIds;
      expect((await dropVenueIds("owner", { handle: "mate" })).sort()).toEqual(["cambridge:eagle", "lamb"]);
      const result = await readPassportOverlap(request(), "owner", deps("mate", "public", {
        diary: async () => [],
        plans: async () => [],
        drops: async () => [],
        beenHere: async () => [{ venueId: "cambridge:eagle", venueName: "The Eagle" }],
        dropVenueIds,
      }));
      expect(result.ok && result.body.been).toEqual({
        both: [
          { venueId: "lamb", venueName: "LAMB", point: [-0.12, 51.52] },
          { venueId: "cambridge:eagle", venueName: "The Eagle", point: [-0.12, 51.52] },
        ],
        onlyYou: [],
        onlyThem: [],
      });
    } finally {
      read.mockRestore();
    }
  });

  it.each(["owner", "mate"])("compares nothing when %s's Cambridge drop read fails", async (failedAuthor) => {
    const read = vi.spyOn(pintDropsStore(), "listVisibleAuthorVenueIds").mockImplementation(
      async (author, _viewer, cityId) => {
        if (author === failedAuthor && cityId === "cambridge") throw new Error("city read unavailable");
        return cityId === "london" ? ["lamb"] : [];
      },
    );
    try {
      const result = await readPassportOverlap(request(), "owner", deps("mate", "public", {
        dropVenueIds: defaultPassportDeps().dropVenueIds,
      }));
      expect(result.ok).toBe(true);
      expect(result.ok && result.body.been).toBeNull();
    } finally {
      read.mockRestore();
    }
  });

  it("puts a pub on the map only where the venue index places it", async () => {
    const result = await readPassportOverlap(
      request(),
      "owner",
      deps("mate", "public", {
        venue: async (venueId) =>
          venueId === "stars" ? { name: "STARS", borough: "Camden", point: null } : { name: venueId.toUpperCase(), borough: "Camden", point: [-0.1, 51.5] },
      }),
    );
    expect(result.ok && result.body.been?.both).toEqual([
      { venueId: "lamb", venueName: "LAMB", point: [-0.1, 51.5] },
      { venueId: "stars", venueName: "STARS", point: null },
    ]);
  });

  it("counts a mate's pub that fell off their capped drop timeline", async () => {
    // The timeline read stops at its cap, so the mate's old drop at the Anchor is
    // missing from it. The complete venue read still has it, so the Anchor is a
    // pub you have both been to, never "only you".
    const result = await readPassportOverlap(
      request(),
      "owner",
      deps("mate", "public", {
        plans: async () => [{ venueId: "anchor", venueName: "Anchor", date: "2026-09-01", source: "plan" }],
        drops: async () => [{ venueId: "stars", drink: "Guinness", createdAt: "2026-10-06T19:00:00.000Z" }],
        dropVenueIds: async (author) => (author === "owner" ? ["stars", "anchor"] : ["stars"]),
      }),
    );
    expect(result.ok && result.body.been?.both.map((venue) => venue.venueId)).toEqual(["anchor", "stars"]);
    expect(result.ok && result.body.been?.onlyYou.map((venue) => venue.venueId)).toEqual(["lamb"]);
  });

  it.each([
    ["diary", { diary: async () => { throw new CappedRead([{ venueId: "lamb", venueName: "The Lamb", date: "2026-10-01", source: "diary" }]); } }],
    ["plans", { plans: async () => { throw new CappedRead([{ venueId: "mitre", venueName: "Ye Olde Mitre", date: "2026-09-01", source: "plan" }]); } }],
    ["Been here", { beenHere: async () => { throw new CappedRead([{ venueId: "grapes", venueName: "The Grapes" }]); } }],
  ] as const)("keeps a capped %s read in the Been list but compares nothing", async (_source, override) => {
    const been = await readPassportBeen(request(), "owner", deps("owner", "public", override as Partial<PassportDeps>));
    expect(been.ok && been.body.status).toBe("ready");
    expect(been.ok && been.body.count).toBeGreaterThan(0);

    const overlap = await readPassportOverlap(request(), "owner", deps("mate", "public", override as Partial<PassportDeps>));
    expect(overlap.ok).toBe(true);
    expect(overlap.ok && overlap.body.been).toBeNull();
  });

  it("compares nothing when the mate's drop context lost its friends graph", async () => {
    // A graph outage leaves the context with a handle and no mutuals, so
    // friends-only drops would vanish from the mate's side without an error.
    const result = await readPassportOverlap(
      request(),
      "owner",
      deps("mate", "public", { dropViewer: async () => ({ handle: "mate" }) }),
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.body.been).toBeNull();
  });

  it("keeps the Been read but compares nothing when venue aliases cannot be read", async () => {
    const venueAliases = async (): Promise<(venueId: string) => string> => {
      throw new Error("alias files unavailable");
    };
    const been = await readPassportBeen(request(), "owner", deps("owner", "public", { venueAliases }));
    expect(been.ok && been.body.count).toBe(3);
    const overlap = await readPassportOverlap(request(), "owner", deps("mate", "public", { venueAliases }));
    expect(overlap.ok && overlap.body.been).toBeNull();
  });

  it("counts the viewer's own anonymous drops on their side", async () => {
    // The public venue read leaves out anonymous drops even for their author,
    // so the viewer's side reads their own complete list instead.
    const result = await readPassportOverlap(
      request(),
      "owner",
      deps("mate", "public", {
        diary: async () => [],
        plans: async () => [],
        drops: async () => [],
        dropVenueIds: async (author) => (author === "owner" ? ["anchor"] : []),
        ownDropVenueIds: async (author) => (author === "mate" ? ["anchor"] : []),
      }),
    );
    expect(result.ok && result.body.been?.both.map((venue) => venue.venueId)).toEqual(["anchor"]);
    expect(result.ok && result.body.been?.onlyThem).toEqual([]);
  });

  it("drops the Been comparison when the complete drop read fails", async () => {
    const result = await readPassportOverlap(
      request(),
      "owner",
      deps("mate", "public", {
        dropVenueIds: async () => {
          throw new Error("drops down");
        },
      }),
    );
    expect(result.ok && result.body.been).toBeNull();
  });

  it("drops the Been comparison when either list could not be read whole", async () => {
    const result = await readPassportOverlap(
      request(),
      "owner",
      deps("mate", "public", {
        diary: async () => {
          throw new Error("diary down");
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.been).toBeNull();
    expect(result.body.topFive.length).toBeGreaterThan(0);
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
        been: expect.any(Object),
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
      body: { topFive: [{ venueId: "lamb", venueName: "LAMB-OLD" }], wantToTry: [], been: expect.any(Object) },
    });
  });
});
