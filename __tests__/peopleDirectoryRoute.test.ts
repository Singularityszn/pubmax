// The people directory: browse who has joined, without widening what a public
// profile read has ever given away.
//
// The defect this guards is the easy one: a "list everybody" route that reaches
// for the whole row and ships email, date of birth or a user id along with the
// handle. The projection here is the same four fields the handle search already
// publishes, and the row set is the same claimed-and-live one.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProfileRecord } from "@/lib/profileStore";

const state = vi.hoisted(() => ({
  limited: false,
  rows: [] as ProfileRecord[],
  fail: false,
  lastInput: null as unknown,
}));

vi.mock("@/lib/pintDrops", () => ({
  isLimited: vi.fn(async () => state.limited),
}));

vi.mock("@/lib/supabase", () => ({
  clientIp: () => "127.0.0.1",
  hashIp: (value: string) => `hashed-${value}`,
  isSupabaseConfigured: () => false,
  requiresSupabaseStore: () => false,
}));

vi.mock("@/lib/profileStore", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/profileStore")>();
  return {
    ...original,
    profileStore: () => ({
      listClaimedProfiles: async (input: unknown) => {
        state.lastInput = input;
        if (state.fail) throw new Error("down");
        return state.rows;
      },
    }),
  };
});

import { GET as directory } from "@/app/api/profiles/directory/route";

function profile(handle: string, overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id: `id-${handle}`,
    handle,
    userId: `user-${handle}`,
    displayName: `${handle} the drinker`,
    bio: "a bio",
    homeCity: "London",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as ProfileRecord;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.limited = false;
  state.fail = false;
  state.rows = [profile("alice"), profile("bob")];
  state.lastInput = null;
});

describe("people directory", () => {
  it("lists claimed handles with the public projection and nothing else", async () => {
    const response = await directory(new Request("https://x.test/api/profiles/directory"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { people: Record<string, unknown>[] };
    expect(body.people).toHaveLength(2);
    for (const person of body.people) {
      expect(Object.keys(person).sort()).toEqual(["displayName", "handle", "id"]);
    }
  });

  it("never lets a private field reach the wire, whatever the row holds", async () => {
    state.rows = [
      profile("alice", {
        userId: "auth-user-1",
        email: "alice@example.com",
        dateOfBirth: "1990-01-01",
      } as unknown as Partial<ProfileRecord>),
    ];
    const response = await directory(new Request("https://x.test/api/profiles/directory"));
    const raw = await response.text();
    expect(raw).not.toContain("alice@example.com");
    expect(raw).not.toContain("1990-01-01");
    expect(raw).not.toContain("auth-user-1");
    expect(raw).not.toContain("tombstone");
  });

  it("drops an unclaimed or tombstoned row even when a store hands one over", async () => {
    state.rows = [
      profile("alice"),
      profile("ghost", { userId: undefined }),
      profile("gone", { tombstonedAt: "2026-02-02T00:00:00.000Z" } as Partial<ProfileRecord>),
    ];
    const response = await directory(new Request("https://x.test/api/profiles/directory"));
    const body = (await response.json()) as { people: { handle: string }[] };
    expect(body.people.map((person) => person.handle)).toEqual(["alice"]);
  });

  it("pages by handle and only offers a cursor when there is another page", async () => {
    state.rows = [profile("alice"), profile("bob"), profile("cara")];
    const response = await directory(
      new Request("https://x.test/api/profiles/directory?limit=2"),
    );
    const body = (await response.json()) as {
      people: { handle: string }[];
      nextCursor: string | null;
    };
    expect(body.people.map((person) => person.handle)).toEqual(["alice", "bob"]);
    expect(body.nextCursor).toBe("bob");

    state.rows = [profile("alice"), profile("bob")];
    const last = await directory(
      new Request("https://x.test/api/profiles/directory?limit=2"),
    );
    await expect(last.json()).resolves.toMatchObject({ nextCursor: null });
  });

  it("carries the cursor back to the store", async () => {
    await directory(
      new Request("https://x.test/api/profiles/directory?limit=2&after=bob"),
    );
    expect(state.lastInput).toMatchObject({ afterHandle: "bob" });
  });

  it("refuses a limit outside its own window", async () => {
    for (const limit of ["0", "49", "2.5", "lots"]) {
      const response = await directory(
        new Request(`https://x.test/api/profiles/directory?limit=${limit}`),
      );
      expect(response.status).toBe(400);
    }
  });

  it("is rate limited like every other public read", async () => {
    state.limited = true;
    const response = await directory(new Request("https://x.test/api/profiles/directory"));
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("answers a store outage as retryable rather than as an empty city", async () => {
    state.fail = true;
    const response = await directory(new Request("https://x.test/api/profiles/directory"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ retryable: true });
  });
});
