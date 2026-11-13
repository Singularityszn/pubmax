import { describe, expect, it } from "vitest";

import { createMemoryLeagueStore } from "@/lib/leagueStore";
import {
  LEAGUE_MAX_MEMBERS,
  LEAGUE_MAX_PER_PERSON,
  leagueDistricts,
  normalizeInviteCode,
  parseLeagueBoard,
  parseLeagueName,
} from "@/lib/leagues";
import {
  createLeague,
  newInviteCode,
  readLeague,
  type LeagueDependencies,
  type LeagueViewer,
} from "@/lib/leagues.server";
import type { ProfileRecord } from "@/lib/profileStore";

const person = (n: number) => ({ userId: `u-${n}`, profileId: `p-${n}` });

describe("invite codes and names", () => {
  it("reads a typed code whatever its case, spaces and dashes, and refuses look-alike characters", () => {
    expect(normalizeInviteCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normalizeInviteCode("AB CD EF GH")).toBe("ABCDEFGH");
    expect(normalizeInviteCode("ABCDEFG0")).toBeNull();
    expect(normalizeInviteCode("ABCDEFGI")).toBeNull();
    expect(normalizeInviteCode("ABCDEFG")).toBeNull();
    expect(normalizeInviteCode(12345678)).toBeNull();
  });

  it("tidies a name's spaces and holds it to 1 to 40 characters", () => {
    expect(parseLeagueName("  The   Regulars ")).toBe("The Regulars");
    expect(parseLeagueName("   ")).toBeNull();
    expect(parseLeagueName("x".repeat(41))).toBeNull();
    expect(parseLeagueName("x".repeat(40))).toHaveLength(40);
  });
});

describe("who leads each district", () => {
  const pubs = new Map<string, readonly string[]>([
    ["E2", ["e2a", "e2b"]],
    ["E1", ["e1a", "e1b", "e1c"]],
    ["SE1", ["se1a"]],
    ["N1", ["n1a"]],
    ["CR0", ["cr0a"]],
  ]);
  const people = [
    { handle: "me", self: true, visited: new Set(["e1a", "e2a", "se1a"]) },
    { handle: "ada", self: false, visited: new Set(["e1a", "e1b", "se1a"]) },
    { handle: "bo", self: false, visited: new Set(["e2a"]) },
  ];

  it("names the one member with the most pubs, a shared lead, and nobody, in numeric order", () => {
    const districts = leagueDistricts(pubs, people);
    expect(districts.map((row) => row.district)).toEqual(["E1", "E2", "N1", "SE1"]);
    expect(districts[0]).toEqual({ district: "E1", pubs: 3, top: 2, leaders: ["ada"], you: 1 });
    expect(districts[1]).toEqual({ district: "E2", pubs: 2, top: 1, leaders: ["bo", "me"], you: 1 });
    expect(districts[2]).toEqual({ district: "N1", pubs: 1, top: 0, leaders: [], you: 0 });
    expect(districts[3]?.leaders).toEqual(["ada", "me"]);
  });

  it("parses the board it sends back, and refuses one with a district outside London", () => {
    const body = {
      league: { id: "00000000-0000-4000-8000-000000000001", name: "Regulars", code: "ABCDEFGH", owner: true },
      status: "ready",
      rows: [{ handle: "me", self: true, total: 10, level: 1, owner: true }],
      districts: leagueDistricts(pubs, people),
    };
    expect(parseLeagueBoard(JSON.parse(JSON.stringify(body)))?.districts).toHaveLength(4);
    expect(parseLeagueBoard({ ...body, districts: null })?.districts).toBeNull();
    expect(parseLeagueBoard({ ...body, districts: [{ district: "CR0", pubs: 1, top: 0, leaders: [], you: 0 }] })).toBeNull();
  });
});

describe("the memory league store", () => {
  it("makes a league with its owner in it, and joins a code once", async () => {
    const store = createMemoryLeagueStore();
    const made = await store.create(person(1), "Regulars", "ABCDEFGH");
    expect(made.status).toBe("created");
    const id = made.status === "created" ? made.leagueId : "";
    expect(await store.join(person(2), "ABCDEFGH")).toEqual({ status: "joined", leagueId: id });
    expect(await store.join(person(2), "ABCDEFGH")).toEqual({ status: "already", leagueId: id });
    expect(await store.join(person(3), "ZZZZZZZZ")).toEqual({ status: "not_found" });
    expect((await store.read(id, "u-2"))?.members.map((member) => member.userId)).toEqual(["u-1", "u-2"]);
    expect(await store.read(id, "u-3")).toBeNull();
  });

  it("holds a league to its member limit and a person to their league limit", async () => {
    const store = createMemoryLeagueStore();
    await store.create(person(1), "Big", "BBBBBBBB");
    for (let n = 2; n <= LEAGUE_MAX_MEMBERS; n += 1) expect((await store.join(person(n), "BBBBBBBB")).status).toBe("joined");
    expect(await store.join(person(99), "BBBBBBBB")).toEqual({ status: "full" });

    for (let n = 0; n < LEAGUE_MAX_PER_PERSON; n += 1) {
      expect((await store.create(person(50), "Mine", `CCCCCCC${"23456789AB"[n]}`)).status).toBe("created");
    }
    expect(await store.create(person(50), "One too many", "DDDDDDDD")).toEqual({ status: "limit" });
  });

  it("lets a member leave, keeps the owner in, and deletes only for the owner", async () => {
    const store = createMemoryLeagueStore();
    const made = await store.create(person(1), "Regulars", "ABCDEFGH");
    const id = made.status === "created" ? made.leagueId : "";
    await store.join(person(2), "ABCDEFGH");
    expect(await store.leave(id, "u-1")).toBe("owner");
    expect(await store.remove(id, "u-2")).toBe(false);
    expect(await store.leave(id, "u-2")).toBe("left");
    expect(await store.leave(id, "u-2")).toBe("not_found");
    expect(await store.remove(id, "u-1")).toBe(true);
    expect(await store.read(id, "u-1")).toBeNull();
  });

  it("a new code works and the old one stops at once; only the owner can change it", async () => {
    const store = createMemoryLeagueStore();
    const made = await store.create(person(1), "Regulars", "ABCDEFGH");
    const id = made.status === "created" ? made.leagueId : "";
    await store.create(person(9), "Other", "QTHERCDE");
    expect(await store.setInviteCode(id, "u-2", "HGFEDCBA")).toBe("not_found");
    expect(await store.setInviteCode(id, "u-1", "QTHERCDE")).toBe("code_taken");
    expect(await store.setInviteCode(id, "u-1", "HGFEDCBA")).toBe("set");
    expect(await store.join(person(3), "ABCDEFGH")).toEqual({ status: "not_found" });
    expect((await store.join(person(3), "HGFEDCBA")).status).toBe("joined");
  });
});

// ── Who the reader sees ─────────────────────────────────────────────────────

const VIEWER: LeagueViewer = { profileId: "p-1", handle: "me", accountId: "a-1", authUserId: "u-1" };

const HANDLES: Record<string, string> = { "p-1": "me", "p-2": "ada", "p-3": "bo", "p-4": "cy", "p-5": "di" };

function profile(id: string, extra: Partial<ProfileRecord> = {}): ProfileRecord {
  return { id, handle: HANDLES[id]!, userId: id.replace("p-", "u-"), ...extra } as ProfileRecord;
}

async function leagueOfFive() {
  const store = createMemoryLeagueStore();
  const made = await store.create(person(1), "Regulars", "ABCDEFGH");
  const id = made.status === "created" ? made.leagueId : "";
  for (const n of [2, 3, 4, 5]) await store.join(person(n), "ABCDEFGH");
  return { store, id };
}

/** Each member has been to the pubs named after them; ada leads N1 alone. */
const VISITS: Record<string, string[]> = {
  me: ["e1a"],
  ada: ["n1a", "n1b"],
  bo: ["n1a", "n1b", "n1c"],
  cy: ["e1a", "e1b"],
  di: [],
};

function leagueDeps(store: LeagueDependencies["store"], overrides: Partial<LeagueDependencies> = {}): Partial<LeagueDependencies> {
  return {
    store,
    profile: async (id) => (HANDLES[id] ? profile(id) : null),
    relationship: async () => "other",
    mutes: async () => false,
    withdrawn: async () => new Set(),
    standing: async (member) => ({
      status: "ready",
      total: VISITS[member.handle]!.length * 10,
      level: 1,
      visited: new Set(VISITS[member.handle]),
    }),
    districtPubs: async () => new Map([["E1", ["e1a", "e1b"]], ["N1", ["n1a", "n1b", "n1c"]]]),
    ...overrides,
  };
}

describe("readLeague", () => {
  it("ranks every member the reader may see, and names who leads each district", async () => {
    const { store, id } = await leagueOfFive();
    const board = await readLeague(VIEWER, id, leagueDeps(store));
    expect(board?.league).toMatchObject({ id, name: "Regulars", code: "ABCDEFGH", owner: true });
    expect(board?.rows.map((row) => row.handle)).toEqual(["me", "ada", "bo", "cy", "di"]);
    expect(board?.rows.find((row) => row.self)).toMatchObject({ handle: "me", owner: true, total: 10 });
    expect(board?.districts?.find((row) => row.district === "N1")?.leaders).toEqual(["bo"]);
    expect(board?.districts?.find((row) => row.district === "E1")).toMatchObject({ leaders: ["cy"], you: 1 });
  });

  it("leaves out a blocked, a muted, a withdrawn and a private non-mate member, from the table and the map", async () => {
    const { store, id } = await leagueOfFive();
    const board = await readLeague(VIEWER, id, leagueDeps(store, {
      profile: async (id) => (id === "p-5" ? profile(id, { visibility: "private" }) : profile(id)),
      relationship: async (_viewer, member) => (member.handle === "bo" ? "blocked" : "other"),
      mutes: async (_viewer, member) => member.handle === "cy",
      withdrawn: async (handles) => new Set(handles.filter((handle) => handle === "ada")),
    }));
    expect(board?.rows.map((row) => row.handle)).toEqual(["me"]);
    expect(board?.districts?.find((row) => row.district === "N1")).toMatchObject({ top: 0, leaders: [] });
    expect(board?.districts?.find((row) => row.district === "E1")).toMatchObject({ leaders: ["me"] });
  });

  it("shows a private member to the reader when the two are mates", async () => {
    const { store, id } = await leagueOfFive();
    const board = await readLeague(VIEWER, id, leagueDeps(store, {
      profile: async (id) => profile(id, { visibility: "private" }),
      relationship: async (_viewer, member) => (member.handle === "di" ? "mutual" : "other"),
    }));
    expect(board?.rows.map((row) => row.handle)).toEqual(["me", "di"]);
  });

  it("answers null to somebody who is not in the league, and fails when a relationship cannot be read", async () => {
    const { store, id } = await leagueOfFive();
    const stranger = { ...VIEWER, authUserId: "u-77", profileId: "p-77" };
    expect(await readLeague(stranger, id, leagueDeps(store))).toBeNull();
    await expect(readLeague(VIEWER, id, leagueDeps(store, {
      relationship: async () => {
        throw new Error("down");
      },
    }))).rejects.toThrow("down");
  });

  it("still ranks the table when the London pub list does not load", async () => {
    const { store, id } = await leagueOfFive();
    const board = await readLeague(VIEWER, id, leagueDeps(store, {
      districtPubs: async () => {
        throw new Error("London unavailable");
      },
    }));
    expect(board?.rows).toHaveLength(5);
    expect(board?.districts).toBeNull();
  });
});

describe("codes the service draws", () => {
  it("draws again when a code is taken, and gives up after three", async () => {
    const store = createMemoryLeagueStore();
    await store.create(person(9), "Taken", "TAKEMCDE");
    const draws = ["TAKEMCDE", "FRESHCDE"];
    const made = await createLeague(VIEWER, "Mine", { store, inviteCode: () => draws.shift()! });
    expect(made.status).toBe("created");
    const id = made.status === "created" ? made.id : "";
    expect((await store.read(id, "u-1"))?.league.inviteCode).toBe("FRESHCDE");

    expect(await newInviteCode(VIEWER, id, { store, inviteCode: () => "TAKEMCDE" })).toEqual({ status: "unavailable" });
    expect(await newInviteCode({ ...VIEWER, authUserId: "u-2" }, id, { store, inviteCode: () => "NEWCQDE2" })).toEqual({ status: "not_found" });
  });
});
