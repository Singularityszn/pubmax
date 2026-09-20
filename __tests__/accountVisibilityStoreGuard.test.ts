// THE ADDITIVE-ROLLOUT GUARD FOR 0154, WHICH IS THE OPPOSITE OF THE ONE BESIDE IT.
//
// `0153`'s receipt-photo guard saves the drop WITHOUT its column when the column
// is not deployed, because losing a photo is a cost and losing a price is not
// acceptable. This one refuses, because losing a privacy choice is not a cost:
// answering 200 to somebody who just asked to be private, and leaving them
// public, is a lie about what the product did with their decision.
//
// So the two directions are pinned here rather than reasoned about:
//   - a patch CARRYING the choice, against a cluster with no column, throws
//     `ProfileVisibilityUnavailableError` and writes nothing at all - the rest
//     of the patch travels with it rather than being half-applied;
//   - a patch NOT carrying the choice is untouched by the guard, so an ordinary
//     bio edit against the same cluster still fails the way it always did.

import { beforeEach, describe, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({
  /** The error PostgREST answers, or null for a clean write. */
  error: null as { code?: string; message?: string } | null,
  /** Every row the store tried to write. */
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/storeBackend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storeBackend")>()),
  admin: () => ({
    from: () => ({
      update: (row: Record<string, unknown>) => {
        wire.rows.push(row);
        const result = {
          data: wire.error ? null : [{ handle: "ken", id: "p1", created_at: "t", updated_at: "t" }],
          error: wire.error,
        };
        const thenable = {
          eq: () => thenable,
          select: () => thenable,
          limit: () => Promise.resolve(result),
        };
        return thenable;
      },
    }),
  }),
}));

import {
  ProfileVisibilityUnavailableError,
  supabaseProfileStore,
} from "@/lib/profileStore";

/** What PostgreSQL says when the column is not there. */
const PG_MISSING = {
  code: "42703",
  message: 'column "visibility" of relation "profiles" does not exist',
};

/** What PostgREST says when its schema cache has not got it. */
const POSTGREST_MISSING = {
  code: "PGRST204",
  message: "Could not find the 'visibility' column of 'profiles' in the schema cache",
};

beforeEach(() => {
  wire.error = null;
  wire.rows.length = 0;
});

describe("a visibility write with no column REFUSES rather than dropping the column", () => {
  it("throws its own error on the PostgreSQL fault", async () => {
    wire.error = PG_MISSING;
    await expect(
      supabaseProfileStore.update("ken", { visibility: "private", bio: "Camden." }),
    ).rejects.toBeInstanceOf(ProfileVisibilityUnavailableError);
  });

  it("throws its own error on the PostgREST fault", async () => {
    wire.error = POSTGREST_MISSING;
    await expect(
      supabaseProfileStore.update("ken", { visibility: "private" }),
    ).rejects.toBeInstanceOf(ProfileVisibilityUnavailableError);
  });

  it("names the choice, because the generic line would read as if the rest had saved", async () => {
    wire.error = PG_MISSING;
    let failure: unknown;
    try {
      await supabaseProfileStore.update("ken", { visibility: "private" });
    } catch (err) {
      failure = err;
    }
    expect(failure).toBeInstanceOf(ProfileVisibilityUnavailableError);
    const thrown = failure as ProfileVisibilityUnavailableError;
    expect(thrown.code).toBe("PROFILE_VISIBILITY_UNAVAILABLE");
    expect(thrown.message).toContain("Who can see your profile");
  });

  it("retries nothing: the rest of the patch does not travel on its own", async () => {
    wire.error = PG_MISSING;
    await supabaseProfileStore
      .update("ken", { visibility: "private", bio: "Camden." })
      .catch(() => null);
    expect(wire.rows, "one attempt, and no second write without the column").toHaveLength(1);
    expect(wire.rows[0]).toHaveProperty("visibility", "private");
  });
});

describe("the guard reaches no further than the write it is about", () => {
  it("leaves an ordinary edit's failure exactly as it was", async () => {
    wire.error = PG_MISSING;
    await expect(
      supabaseProfileStore.update("ken", { bio: "Camden." }),
    ).rejects.not.toBeInstanceOf(ProfileVisibilityUnavailableError);
  });

  it("does not claim a missing OTHER column is a visibility fault", async () => {
    wire.error = {
      code: "42703",
      message: 'column "workplace" of relation "profiles" does not exist',
    };
    await expect(
      supabaseProfileStore.update("ken", { visibility: "private", workplace: "The Brewery" }),
    ).rejects.not.toBeInstanceOf(ProfileVisibilityUnavailableError);
  });

  it("lets a clean write through and carries the choice to the row", async () => {
    await supabaseProfileStore.update("ken", { visibility: "private" });
    expect(wire.rows[0]).toHaveProperty("visibility", "private");
  });
});
