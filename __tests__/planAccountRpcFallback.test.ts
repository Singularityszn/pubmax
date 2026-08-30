// The five account-claim RPCs are live in production, but a keyless dev
// database or a deploy that lands before migrations 0124-0127 must not refuse
// every signed-in join, redeem or claim (0106 precedent). Only a MISSING
// FUNCTION may take a fallback: a genuine write failure stays a refusal.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingleResults: [] as Array<{ data: unknown; error: unknown }>,
}));

function chainBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "update", "eq", "is", "not"]) {
    builder[method] = chain;
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
import { claimPlanMembership, recoverPlanMembership } from "@/lib/planCrewIdentity";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { supabasePlanStore } from "@/lib/planStore";

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
    vi.spyOn(supabasePlanStore, "get").mockResolvedValue(STATE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("joins without the account stamp when migration 0126 has not been applied", async () => {
    supabase.maybeSingleResults.push({ data: { id: PLAN_ID }, error: null });
    supabase.rpc.mockImplementation(async (fn: string) =>
      fn === "join_plan_account_idempotent_atomic"
        ? missingFunction(fn)
        : { data: "joined", error: null });

    const result = await supabasePlanStore.join(PLAN_ID, "Priya", {
      idempotencyKey: "account-join-fallback",
      userId: USER_ID,
    });

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(supabase.rpc.mock.calls[0][0]).toBe("join_plan_account_idempotent_atomic");
    const fallback = supabase.rpc.mock.calls[1];
    expect(fallback[0]).toBe("join_plan_idempotent_atomic");
    expect(fallback[1]).not.toHaveProperty("p_user_id");
    expect(fallback[1]).toMatchObject({
      p_request_hash: supabase.rpc.mock.calls[0][1].p_request_hash,
    });
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

  it("redeems without the account stamp when migration 0126 has not been applied", async () => {
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

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(supabase.rpc.mock.calls[0][0]).toBe("redeem_plan_invite_account_idempotent_atomic");
    const fallback = supabase.rpc.mock.calls[1];
    expect(fallback[0]).toBe("redeem_plan_invite_idempotent_atomic");
    expect(fallback[1]).not.toHaveProperty("p_user_id");
  });

  it("stamps the member row through the legacy update when migration 0124 has not been applied", async () => {
    supabase.rpc.mockResolvedValue(missingFunction("claim_plan_membership"));
    supabase.maybeSingleResults.push({ data: { id: MEMBER_ID }, error: null });

    await expect(claimPlanMembership(PLAN_ID, MEMBER_ID, USER_ID)).resolves.toBe("claimed");

    supabase.maybeSingleResults.push({ data: null, error: null });
    supabase.maybeSingleResults.push({ data: { user_id: USER_ID }, error: null });
    await expect(claimPlanMembership(PLAN_ID, MEMBER_ID, USER_ID)).resolves.toBe("already_claimed");

    supabase.maybeSingleResults.push({ data: null, error: null });
    supabase.maybeSingleResults.push({ data: { user_id: "44444444-4444-4444-8444-444444444444" }, error: null });
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
