import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-31T23:00:00.000Z");
const IDEMPOTENCY_KEY = "lost-private-invite-response";
const INVITE_TOKEN = "private-invite-token";

const harness = vi.hoisted(() => ({
  mode: "recovered" as "recovered" | "missing" | "pre-migration" | "generic-error" | "permission-error",
  boundary: "legacy" as "legacy" | "social",
  rpc: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  is: vi.fn(),
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({ rpc: harness.rpc, from: harness.from }),
  };
});

vi.mock("@/lib/planStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/planStore")>();
  return {
    ...actual,
    planStateResult: async () => harness.boundary === "social"
      ? { ok: true, plan: null }
      : {
          ok: true,
          plan: {
            plan: {
              id: PLAN_ID,
              title: "Ended Plan",
              startTime: "2026-08-30T19:00:00.000Z",
              createdAt: "2026-08-30T12:00:00.000Z",
              status: "draft",
            },
            stops: [],
            crew: [],
            context: null,
          },
        },
    planStore: () => ({
      get: async () => ({
        plan: {
          id: PLAN_ID,
          title: "Ended Plan",
          startTime: "2026-08-30T19:00:00.000Z",
          createdAt: "2026-08-30T12:00:00.000Z",
          status: "draft",
        },
        stops: [],
        crew: [],
        context: null,
      }),
    }),
  };
});

import {
  hashPlanMemberToken,
  planIdempotencyDigest,
  planIdempotentUuid,
  planRequestDigest,
} from "@/lib/planStore";
import { planCollaborationStore } from "@/lib/planCollaborationStore";

describe("private invite lost-response replay", () => {
  beforeEach(() => {
    harness.mode = "recovered";
    harness.boundary = "legacy";
    vi.stubEnv("PLAN_IDEMPOTENCY_SECRET", "stable-plan-identity-secret-0123456789abcdef");
    harness.rpc.mockReset();
    harness.from.mockReset();
    harness.eq.mockReset();
    harness.is.mockReset();
    const memberId = planIdempotentUuid(`plan-invite-join-member:${PLAN_ID}`, IDEMPOTENCY_KEY);
    const memberToken = planIdempotencyDigest(`plan-invite-join-token:${PLAN_ID}`, IDEMPOTENCY_KEY);
    const inviteHash = createHash("sha256")
      .update(`pubmax-plan-invite:${INVITE_TOKEN}`)
      .digest("hex");
    const query = {
      select: vi.fn(),
      eq: harness.eq,
      is: harness.is,
      maybeSingle: vi.fn(async () => harness.mode === "pre-migration" ? ({
        data: null,
        error: { code: "PGRST204", message: "Could not find the crew_committed_at column in the schema cache" },
      }) : harness.mode === "generic-error" ? ({
        data: null,
        error: { code: "PGRST204", message: "Schema cache lookup failed for plan_crew_members" },
      }) : harness.mode === "permission-error" ? ({
        data: null,
        error: { code: "42703", message: "permission denied for column crew_committed_at" },
      }) : ({
        data: harness.mode === "missing" ? null : {
          id: memberId,
          token_hash: hashPlanMemberToken(memberToken),
          join_key_hash: planIdempotencyDigest(`plan-invite-join-key:${PLAN_ID}`, IDEMPOTENCY_KEY),
          join_request_hash: planRequestDigest({ name: "Priya", inviteHash }),
          crew_committed_at: "2026-08-30T18:00:00.000Z",
          crew_committed_event_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        },
        error: null,
      })),
    };
    query.select.mockReturnValue(query);
    harness.eq.mockReturnValue(query);
    harness.is.mockReturnValue(query);
    harness.from.mockReturnValue(query);
  });

  it("falls back before migration 0125 without commitment evidence", async () => {
    harness.mode = "missing";
    harness.rpc.mockImplementation(async (name: string) => (
      name === "redeem_plan_invite_idempotent_with_crew_commitment_atomic"
        ? { data: null, error: { code: "PGRST202", message: "Could not find the function public.redeem_plan_invite_idempotent_with_crew_commitment_atomic" } }
        : { data: "joined", error: null }
    ));

    const result = await planCollaborationStore().redeemInviteAndJoin(
      PLAN_ID,
      INVITE_TOKEN,
      "Priya",
      new Date("2026-08-30T18:00:00.000Z"),
      { idempotencyKey: IDEMPOTENCY_KEY },
    );

    expect(result).toMatchObject({ ok: true, crewCommittedAt: null, crewCommittedEventId: null });
    expect(harness.rpc.mock.calls.map(([name]) => name)).toEqual([
      "redeem_plan_invite_idempotent_with_crew_commitment_atomic",
      "redeem_plan_invite_idempotent_atomic",
    ]);
  });

  it("continues normal end checks when commitment columns are not installed", async () => {
    harness.mode = "pre-migration";

    await expect(planCollaborationStore().redeemInviteAndJoin(
      PLAN_ID,
      INVITE_TOKEN,
      "Priya",
      NOW,
      { idempotencyKey: IDEMPOTENCY_KEY },
    )).resolves.toEqual({ ok: false, error: "expired" });
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("fails on a generic schema-cache replay-probe error", async () => {
    harness.mode = "generic-error";

    await expect(planCollaborationStore().redeemInviteAndJoin(
      PLAN_ID,
      INVITE_TOKEN,
      "Priya",
      NOW,
      { idempotencyKey: IDEMPOTENCY_KEY },
    )).resolves.toEqual({ ok: false, error: "error" });
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("fails on a permission replay-probe error that names a commitment column", async () => {
    harness.mode = "permission-error";

    await expect(planCollaborationStore().redeemInviteAndJoin(
      PLAN_ID,
      INVITE_TOKEN,
      "Priya",
      NOW,
      { idempotencyKey: IDEMPOTENCY_KEY },
    )).resolves.toEqual({ ok: false, error: "error" });
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("recovers the exact active membership before rejecting an ended Plan", async () => {
    const result = await planCollaborationStore().redeemInviteAndJoin(
      PLAN_ID,
      INVITE_TOKEN,
      "Priya",
      NOW,
      { idempotencyKey: IDEMPOTENCY_KEY },
    );

    expect(result).toMatchObject({
      ok: true,
      memberId: planIdempotentUuid(`plan-invite-join-member:${PLAN_ID}`, IDEMPOTENCY_KEY),
      crewCommittedAt: "2026-08-30T18:00:00.000Z",
      crewCommittedEventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    expect(harness.rpc).not.toHaveBeenCalled();
    expect(harness.eq).toHaveBeenCalledWith("plan_id", PLAN_ID);
    expect(harness.eq).toHaveBeenCalledWith(
      "id",
      planIdempotentUuid(`plan-invite-join-member:${PLAN_ID}`, IDEMPOTENCY_KEY),
    );
    expect(harness.is).toHaveBeenCalledWith("membership_revoked_at", null);
  });

  it("refuses a Social-bound Plan before probing an exact private replay", async () => {
    harness.boundary = "social";

    await expect(planCollaborationStore().redeemInviteAndJoin(
      PLAN_ID,
      INVITE_TOKEN,
      "Priya",
      NOW,
      { idempotencyKey: IDEMPOTENCY_KEY },
    )).resolves.toEqual({ ok: false, error: "not_found" });
    expect(harness.from).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled();
  });
});
