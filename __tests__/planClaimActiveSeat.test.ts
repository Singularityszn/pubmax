// A REVOKED seat is not a seat (#1294), and linkPlanMemberUser now says so
// through the atomic RPC rather than a hand-rolled two-statement stamp.
//
// #1301 deliberately kept the hand-rolled body, because production's
// claim_plan_membership predated #1270's membership_revoked_at column and
// swapping would have reopened a guard that had shipped. Migration 0135 teaches
// the function the column and narrows 0128's unique index to match, so the swap
// is safe and this fence is what stops it being quietly reverted.
//
// The SQL semantics are proven against PostgreSQL 16 rather than asserted here;
// see the migration. What this file pins is the APP contract: that the stamp
// goes through the RPC, and that its outcomes map the way callers expect.
//
// NOT covered here, deliberately: #1298's keyless replay. Its fix site is
// inside #1270's own _0075_ join and redeem functions, which 0135 does not
// touch, so the new RPC path does not close it and a fence here would claim
// otherwise.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingleResults: [] as Array<{ data: unknown; error: unknown }>,
  queryCalls: [] as Array<[string, ...unknown[]]>,
}));

function chainBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "update", "eq", "is", "not"]) {
    builder[method] = (...args: unknown[]) => {
      supabase.queryCalls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = async () =>
    supabase.maybeSingleResults.shift() ?? { data: null, error: null };
  return builder;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => ({ rpc: supabase.rpc, from: () => chainBuilder() }),
}));

import { linkPlanMemberUser } from "@/lib/planCrewIdentity";

const PLAN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => {
  supabase.rpc.mockReset();
  supabase.maybeSingleResults.length = 0;
  supabase.queryCalls.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("linkPlanMemberUser goes through the atomic claim", () => {
  it("stamps through the RPC rather than its own update", async () => {
    supabase.rpc.mockResolvedValue({ data: "claimed", error: null });

    await expect(linkPlanMemberUser(PLAN, MEMBER, USER)).resolves.toBe(true);

    expect(supabase.rpc).toHaveBeenCalledWith("claim_plan_membership", {
      p_plan_id: PLAN,
      p_member_id: MEMBER,
      p_user_id: USER,
    });
    // The point of the swap: no hand-rolled update runs beside the RPC, so the
    // read-back that could interleave with another writer is gone.
    expect(supabase.queryCalls).toEqual([]);
  });

  it("treats an existing claim by the same account as success", async () => {
    supabase.rpc.mockResolvedValue({ data: "already_claimed", error: null });
    await expect(linkPlanMemberUser(PLAN, MEMBER, USER)).resolves.toBe(true);
  });

  it("refuses a seat the account may not have", async () => {
    // One account, one ACTIVE seat. After 0135 this answers conflict only when
    // the other seat is live; a revoked one no longer blocks, which is the
    // whole of #1294 and is proven in SQL by the migration.
    supabase.rpc.mockResolvedValue({ data: "conflict", error: null });
    await expect(linkPlanMemberUser(PLAN, MEMBER, USER)).resolves.toBe(false);
  });

  it("refuses a member that is not there, which is what a revoked seat now is", async () => {
    supabase.rpc.mockResolvedValue({ data: "not_found", error: null });
    await expect(linkPlanMemberUser(PLAN, MEMBER, USER)).resolves.toBe(false);
  });

  it("falls back to the revoked-aware stamp when the FUNCTION is missing", async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "function not found" },
    });
    supabase.maybeSingleResults.push({ data: { id: MEMBER }, error: null });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(linkPlanMemberUser(PLAN, MEMBER, USER)).resolves.toBe(true);

    // The fallback must still carry BOTH revoked-aware predicates, or a
    // database with the schema and without the function would stamp a seat the
    // RPC path refuses.
    const isCalls = supabase.queryCalls.filter(([method]) => method === "is");
    expect(isCalls).toContainEqual(["is", "membership_revoked_at", null]);
    expect(isCalls).toContainEqual(["is", "user_id", null]);
  });

  it("does not fall back on a genuine write failure", async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(linkPlanMemberUser(PLAN, MEMBER, USER)).resolves.toBe(false);
    // A refusal stays a refusal: no second attempt through the legacy path.
    expect(supabase.queryCalls).toEqual([]);
  });
});
