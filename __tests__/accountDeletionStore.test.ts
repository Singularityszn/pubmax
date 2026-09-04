import { beforeEach, describe, expect, it, vi } from "vitest";

// `deleteOwnAccount` — the ONE writer behind account deletion.
//
// Two things are held here. The write is a SINGLE call to
// `auth.admin.deleteUser`, because migration `0078`'s trigger owns everything
// downstream and a second cleanup pass would drift away from it. And the answer
// is THREE-WAY: an account that is already gone is a success, while a delete we
// could not run is a failure the reader may retry.

type AdminError = { status?: number; code?: string; message?: string } | null;

const adminState = vi.hoisted(() => ({
  calls: [] as string[],
  error: null as AdminError,
  throws: null as unknown,
}));

vi.mock("@/lib/supabase", () => ({
  requireSupabaseAdmin: () => ({
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          adminState.calls.push(id);
          if (adminState.throws) throw adminState.throws;
          return { data: null, error: adminState.error };
        },
      },
    },
  }),
}));

const logged = vi.hoisted(() => ({ events: [] as string[] }));
vi.mock("@/lib/log", () => ({
  log: (_level: string, event: string) => {
    logged.events.push(event);
  },
}));

import { accountIsDeleted } from "@/lib/accountDeletion";
import { deleteOwnAccount } from "@/lib/accountDeletion.server";

beforeEach(() => {
  adminState.calls = [];
  adminState.error = null;
  adminState.throws = null;
  logged.events = [];
});

describe("deleteOwnAccount", () => {
  it("deletes the named account with one admin call and nothing else", async () => {
    expect(await deleteOwnAccount("user-1")).toBe("deleted");
    expect(adminState.calls).toEqual(["user-1"]);
  });

  it("reads an account that is already gone as a success", async () => {
    adminState.error = { status: 404, code: "user_not_found", message: "User not found" };

    const outcome = await deleteOwnAccount("user-2");

    expect(outcome).toBe("already-gone");
    expect(accountIsDeleted(outcome)).toBe(true);
    // Not an outage, so nothing is logged as one.
    expect(logged.events).toEqual([]);
  });

  it("reads a message-only not-found the same way", async () => {
    adminState.error = { message: "User not found" };

    expect(await deleteOwnAccount("user-3")).toBe("already-gone");
  });

  it("reports a delete it could not run as unavailable, and logs it", async () => {
    adminState.error = { status: 500, message: "database unavailable" };

    const outcome = await deleteOwnAccount("user-4");

    expect(outcome).toBe("unavailable");
    expect(accountIsDeleted(outcome)).toBe(false);
    expect(logged.events).toEqual(["account.delete_failed"]);
  });

  it("survives a throwing client rather than taking the route down", async () => {
    adminState.throws = new Error("network down");

    expect(await deleteOwnAccount("user-5")).toBe("unavailable");
    expect(logged.events).toEqual(["account.delete_failed"]);
  });

  it("never calls the admin client for an empty id", async () => {
    expect(await deleteOwnAccount("   ")).toBe("unavailable");
    expect(adminState.calls).toEqual([]);
  });
});
