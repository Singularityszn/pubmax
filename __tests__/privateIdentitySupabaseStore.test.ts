import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const existing = {
  user_id: "user-1",
  date_of_birth: "2015-02-03",
  full_name: null,
  sex: null,
  created_at: "2026-07-29T10:00:00.000Z",
  updated_at: "2026-07-29T10:00:00.000Z",
};

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  beforeWrite: null as (() => Promise<void>) | null,
}));

vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({
    getByUserId: async () => ({ id: "profile-1", handle: "night_owl" }),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  requireSupabaseAdmin: () => {
    function write(
      mode: "insert" | "update" | "upsert",
      row: Record<string, unknown>,
    ) {
      const filters: [string, unknown][] = [];
      const query = {
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return query;
        },
        select() {
          return query;
        },
        async limit() {
          const beforeWrite = state.beforeWrite;
          state.beforeWrite = null;
          await beforeWrite?.();
          const current = state.rows.find((entry) => entry.user_id === row.user_id);
          if (mode === "insert" && current) {
            return {
              data: null,
              error: { message: "Duplicate user_id", code: "23505" },
            };
          }
          if (
            mode === "update" &&
            (!current || filters.some(([column, value]) => current[column] !== value))
          ) {
            return { data: [], error: null };
          }
          const stored = { ...current, ...row };
          state.rows = [...state.rows.filter((entry) => entry !== current), stored];
          return { data: [stored], error: null };
        },
      };
      return query;
    }
    return {
      from: () => ({
        select: () => ({
          eq: (_column: string, userId: string) => ({
            limit: async () => ({
              data: state.rows.filter((row) => row.user_id === userId),
              error: null,
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => write("insert", row),
        update: (row: Record<string, unknown>) => write("update", row),
        upsert: (row: Record<string, unknown>) => write("upsert", row),
      }),
    };
  },
}));

import { accountIsAdult } from "@/lib/adultGate";
import { supabasePrivateIdentityStore } from "@/lib/privateIdentityStore";

beforeEach(() => {
  state.rows = [];
  state.beforeWrite = null;
  vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
});

afterEach(() => vi.useRealTimers());

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Supabase private identity updates", () => {
  it("preserves stored date of birth during optional-field edits", async () => {
    state.rows = [{ ...existing }];

    await expect(
      supabasePrivateIdentityStore.updateDetails("user-1", {
        fullName: "Night Owl",
      }),
    ).resolves.toMatchObject({
      dateOfBirth: "2015-02-03",
      fullName: "Night Owl",
    });
    expect(state.rows[0]).toMatchObject({
      user_id: "user-1",
      date_of_birth: "2015-02-03",
      full_name: "Night Owl",
    });
  });

  it("refuses to write an adult date of birth over a stored under-18 one", async () => {
    state.rows = [{ ...existing }];

    await expect(
      supabasePrivateIdentityStore.updateDetails("user-1", {
        dateOfBirth: "1990-01-01",
      }),
    ).resolves.toBe("under_18_locked");
    expect(state.rows[0]).toEqual(existing);

    await expect(
      supabasePrivateIdentityStore.updateDetails("user-1", {
        dateOfBirth: "2016-03-04",
      }),
    ).resolves.toMatchObject({ dateOfBirth: "2016-03-04" });
  });

  it("creates the identity row for a claim-path account that has none", async () => {
    // The production deadlock: a handle claimed through the early path stores
    // no date of birth, so there is no row, and refusing the save for the row's
    // own absence left the date of birth the owner typed with nowhere to go.
    expect(state.rows).toHaveLength(0);

    await expect(
      supabasePrivateIdentityStore.updateDetails("user-1", {
        dateOfBirth: "1990-01-01",
        fullName: "Karan Founder",
      }),
    ).resolves.toMatchObject({
      dateOfBirth: "1990-01-01",
      fullName: "Karan Founder",
    });
    expect(state.rows[0]).toMatchObject({
      user_id: "user-1",
      date_of_birth: "1990-01-01",
    });
    await expect(
      supabasePrivateIdentityStore.read("user-1"),
    ).resolves.toMatchObject({ dateOfBirth: "1990-01-01" });
  });

  it("refuses a first save that carries no date of birth", async () => {
    // date_of_birth is NOT NULL, so a row cannot be built without one. The
    // route names that finding rather than blaming account setup.
    await expect(
      supabasePrivateIdentityStore.updateDetails("user-1", {
        fullName: "Karan Founder",
      }),
    ).resolves.toBeNull();
    expect(state.rows).toEqual([]);
  });

  it("allows an adult date of birth to be corrected to another adult date", async () => {
    state.rows = [{ ...existing, date_of_birth: "1990-01-01" }];

    await expect(
      supabasePrivateIdentityStore.updateDetails("user-1", {
        dateOfBirth: "1991-02-03",
      }),
    ).resolves.toMatchObject({ dateOfBirth: "1991-02-03" });
    const [row] = state.rows;
    if (!row) throw new Error("Expected a persisted identity row");
    expect(row).toMatchObject({ date_of_birth: "1991-02-03" });
  });

  it.each([
    {
      name: "an optional-field edit",
      stored: "1990-01-01",
      details: { fullName: "Stale Name" },
    },
    {
      name: "an explicit adult DOB edit",
      stored: "1990-01-01",
      details: { dateOfBirth: "1991-02-03" },
    },
    {
      name: "a first identity save",
      stored: null,
      details: { dateOfBirth: "1990-01-01" },
    },
  ])("prevents $name from overwriting a concurrent under-18 save", async ({ stored, details }) => {
    state.rows = stored ? [{ ...existing, date_of_birth: stored }] : [];
    const started = deferred();
    const release = deferred();
    state.beforeWrite = async () => {
      started.resolve();
      await release.promise;
    };
    const staleSave = supabasePrivateIdentityStore
      .updateDetails("user-1", details)
      .then(() => "saved", () => "refused");
    await started.promise;

    try {
      await expect(
        supabasePrivateIdentityStore.updateDetails("user-1", {
          dateOfBirth: "2015-02-03",
        }),
      ).resolves.toMatchObject({ dateOfBirth: "2015-02-03" });
    } finally {
      release.resolve();
    }

    expect(await staleSave).toBe("refused");
    const identity = await supabasePrivateIdentityStore.read("user-1");
    expect(identity).toMatchObject({ dateOfBirth: "2015-02-03" });
    expect(accountIsAdult({ dateOfBirth: identity?.dateOfBirth })).toBe(false);
    const [row] = state.rows;
    if (!row) throw new Error("Expected a persisted identity row");
    expect(row).not.toMatchObject({ full_name: "Stale Name" });
  });
});
