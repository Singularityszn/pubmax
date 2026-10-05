// The account-claim RPCs are live in production. Signed-in joins and invite
// redemptions must never fall back to account-blind writes when an account RPC
// is unavailable. Claims keep their bounded compatibility fallback.

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

import type { PlanState } from "@/lib/plan";
import {
  claimPlanMembership,
  linkPlanOwnerUser,
  recoverPlanMembership,
} from "@/lib/planCrewIdentity";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { supabasePlanStore } from "@/lib/planStore";
import { defined } from "@/__tests__/helpers/defined";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const STATE: PlanState = {
  plan: {
    id: PLAN_ID,
    title: "Tonight",
    startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    status: "draft",
  },
  stops: [
    { venueId: "venue-a", venueName: "A", position: 0 },
    { venueId: "venue-b", venueName: "B", position: 1 },
    { venueId: "venue-c", venueName: "C", position: 2 },
  ],
  crew: [],
  context: null,
};

function missingFunction(name: string): { data: null; error: { code: string; message: string } } {
  return {
    data: null,
    error: {
      code: "PGRST202",
      message: `Could not find the function public.${name} in the schema cache`,
    },
  };
}

describe("account claim RPC fallbacks", () => {
  beforeEach(() => {
    supabase.rpc.mockReset();
    supabase.maybeSingleResults = [];
    supabase.queryCalls = [];
    vi.spyOn(supabasePlanStore, "get").mockResolvedValue(STATE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses a signed-in join when the account join function is unavailable", async () => {
    supabase.maybeSingleResults.push({ data: { id: PLAN_ID }, error: null });
    supabase.rpc.mockImplementation(async (fn: string) =>
      fn === "join_plan_account_idempotent_atomic"
        ? missingFunction(fn)
        : { data: "joined", error: null });

    const result = await supabasePlanStore.join(PLAN_ID, "Priya", {
      idempotencyKey: "account-join-fallback",
      userId: USER_ID,
    });

    expect(result).toEqual({ ok: false, error: "error" });
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(defined(supabase.rpc.mock.calls[0])[0]).toBe("join_plan_account_idempotent_atomic");
    expect(supabase.rpc).not.toHaveBeenCalledWith("join_plan_idempotent_atomic", expect.anything());
  });

  it("reports a genuine account-join failure rather than retrying it unguarded", async () => {
    supabase.maybeSingleResults.push({ data: { id: PLAN_ID }, error: null });
    supabase.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key" } });

    const result = await supabasePlanStore.join(PLAN_ID, "Priya", {
      idempotencyKey: "account-join-failure",
      userId: USER_ID,
    });

    expect(result).toEqual({ ok: false, error: "error" });
    expect(supabase.rpc).toHaveBeenCalledOnce();
  });

  it("does not pre-read or mutate an account seat when the account join function is unavailable", async () => {
    supabase.maybeSingleResults.push({ data: { id: PLAN_ID }, error: null });
    supabase.rpc.mockResolvedValue(missingFunction("join_plan_account_idempotent_atomic"));

    const result = await supabasePlanStore.join(PLAN_ID, "Priya", {
      idempotencyKey: "account-join-second-seat",
      userId: USER_ID,
    });

    expect(result).toEqual({ ok: false, error: "error" });
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(defined(supabase.rpc.mock.calls[0])[0]).toBe("join_plan_account_idempotent_atomic");
    expect(supabase.queryCalls).not.toContainEqual(["eq", "user_id", USER_ID]);
  });

  it("refuses a signed-in invite redemption when the account function is unavailable", async () => {
    supabase.rpc.mockImplementation(async (fn: string) =>
      fn === "redeem_plan_invite_account_idempotent_atomic"
        ? missingFunction(fn)
        : { data: "joined", error: null });

    const result = await planCollaborationStore().redeemInviteAndJoin(
      PLAN_ID,
      "invite-token",
      "Priya",
      new Date(),
      { idempotencyKey: "account-redeem-fallback", userId: USER_ID },
    );

    expect(result).toEqual({ ok: false, error: "error" });
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(defined(supabase.rpc.mock.calls[0])[0]).toBe("redeem_plan_invite_account_idempotent_atomic");
    expect(supabase.rpc).not.toHaveBeenCalledWith("redeem_plan_invite_idempotent_atomic", expect.anything());
  });

  it("does not pre-read or consume an invite when the account function is unavailable", async () => {
    supabase.rpc.mockResolvedValue(missingFunction("redeem_plan_invite_account_idempotent_atomic"));

    const result = await planCollaborationStore().redeemInviteAndJoin(
      PLAN_ID,
      "invite-token",
      "Priya",
      new Date(),
      { idempotencyKey: "account-redeem-second-seat", userId: USER_ID },
    );

    expect(result).toEqual({ ok: false, error: "error" });
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(defined(supabase.rpc.mock.calls[0])[0]).toBe("redeem_plan_invite_account_idempotent_atomic");
    expect(supabase.rpc).not.toHaveBeenCalledWith("redeem_plan_invite_idempotent_atomic", expect.anything());
    expect(supabase.queryCalls).not.toContainEqual(["eq", "user_id", USER_ID]);
  });

  it("stamps the member row when the account claim function is unavailable", async () => {
    supabase.rpc.mockResolvedValue(missingFunction("claim_plan_membership"));
    supabase.maybeSingleResults.push({ data: { id: MEMBER_ID }, error: null });

    await expect(claimPlanMembership(PLAN_ID, MEMBER_ID, USER_ID)).resolves.toBe("claimed");
    expect(supabase.queryCalls.filter(([method, field, value]) =>
      method === "is" && field === "membership_revoked_at" && value === null,
    )).toHaveLength(1);

    supabase.queryCalls = [];
    supabase.maybeSingleResults.push({ data: null, error: null });
    supabase.maybeSingleResults.push({ data: { user_id: USER_ID }, error: null });
    await expect(claimPlanMembership(PLAN_ID, MEMBER_ID, USER_ID)).resolves.toBe("already_claimed");
    expect(supabase.queryCalls.filter(([method, field, value]) =>
      method === "is" && field === "membership_revoked_at" && value === null,
    )).toHaveLength(2);

    supabase.maybeSingleResults.push({ data: null, error: null });
    supabase.maybeSingleResults.push({ data: { user_id: "44444444-4444-4444-8444-444444444444" }, error: null });
    await expect(claimPlanMembership(PLAN_ID, MEMBER_ID, USER_ID)).resolves.toBe("conflict");
  });

  it("stamps the Plan owner through the configured store", async () => {
    supabase.maybeSingleResults.push({ data: { id: PLAN_ID }, error: null });

    await expect(linkPlanOwnerUser(PLAN_ID, USER_ID)).resolves.toBe(true);
  });

  it("maps the fallback membership unique violation to a conflict", async () => {
    supabase.rpc.mockResolvedValue(missingFunction("claim_plan_membership"));
    supabase.maybeSingleResults.push({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });

    await expect(claimPlanMembership(PLAN_ID, MEMBER_ID, USER_ID)).resolves.toBe("conflict");
  });

  it("answers not_found when the recovery RPC is missing instead of a retryable error", async () => {
    supabase.rpc.mockResolvedValue(missingFunction("recover_plan_account_membership_atomic"));

    await expect(recoverPlanMembership(PLAN_ID, USER_ID, "member-token")).resolves.toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
