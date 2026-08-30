import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const CLASSIC_TOKEN = "a".repeat(32);
const harness = vi.hoisted(() => ({
  join: vi.fn(),
  redeem: vi.fn(),
  rsvpUpsert: vi.fn(),
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => true };
});
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});
vi.mock("@/lib/authServer", () => ({ callerUserId: async () => null }));
vi.mock("@/lib/crewFriendEdges", () => ({ formFriendEdgesForPlanJoin: vi.fn() }));
vi.mock("@/lib/planStore", () => ({
  isPlanIdempotencyKey: (value: unknown) => typeof value === "string" && value.length >= 8,
  planInviteRsvpSubmitterDigest: () => "b".repeat(64),
  planMemberIdentity: vi.fn(),
  planMemberIdentityResult: async () => ({
    ok: true,
    identity: { memberId: "22222222-2222-4222-8222-222222222222", role: "guest", collaborationAuthorized: false },
  }),
  planStateResult: async () => ({
    ok: true,
    plan: {
      plan: {
        id: PLAN_ID,
        title: "Crew preflight",
        startTime: "2026-09-01T19:00:00.000Z",
        createdAt: "2026-08-30T12:00:00.000Z",
        status: "ready",
      },
      stops: [],
      crew: [],
      context: null,
    },
  }),
  resolvePlanIdByInviteToken: async () => ({ ok: true, planId: PLAN_ID }),
  planStore: () => ({ join: harness.join }),
}));
vi.mock("@/lib/planCollaborationStore", () => ({
  planCollaborationStore: () => ({ redeemInviteAndJoin: harness.redeem }),
}));
vi.mock("@/lib/planInviteResolve", () => ({
  resolveClassicInvitePlan: async () => ({ planId: PLAN_ID }),
}));
vi.mock("@/lib/planInviteRsvpStore", () => ({
  PlanCrewFullError: class PlanCrewFullError extends Error {},
  PlanInviteMembershipMismatchError: class PlanInviteMembershipMismatchError extends Error {},
  RsvpCapExceededError: class RsvpCapExceededError extends Error {},
  UnknownPlanError: class UnknownPlanError extends Error {},
  rsvpStore: () => ({ upsert: harness.rsvpUpsert }),
}));

import { POST as RSVP } from "@/app/api/invite/[token]/rsvp/route";
import { POST as JOIN } from "@/app/api/plans/[id]/join/route";
import { POST as UPDATE_RSVP } from "@/app/api/plans/[id]/invite-rsvp/route";

const context = { params: Promise.resolve({ id: PLAN_ID }) };
const tokenContext = { params: Promise.resolve({ token: CLASSIC_TOKEN }) };

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.PLAN_IDEMPOTENCY_SECRET = "stable-plan-identity-secret-0123456789abcdef";
  process.env.RATE_LIMIT_SALT = "stable-rate-limit-secret-0123456789abcdef";
  delete process.env.CREW_DELIVERY_SIGNING_SECRET;
  harness.join.mockReset().mockResolvedValue({
    ok: true,
    plan: null,
    memberId: "22222222-2222-4222-8222-222222222222",
    memberToken: "member-token",
    role: "guest",
    collaborationAuthorized: false,
    crewCommittedAt: null,
    crewCommittedEventId: null,
  });
  harness.redeem.mockReset().mockResolvedValue({
    ok: true,
    plan: null,
    memberId: "22222222-2222-4222-8222-222222222222",
    memberToken: "member-token",
    role: "guest",
    collaborationAuthorized: true,
    crewCommittedAt: null,
    crewCommittedEventId: null,
  });
  harness.rsvpUpsert.mockReset().mockResolvedValue({
    summary: { counts: { going: 1, maybe: 0 }, guests: [] },
    isUpdate: false,
    membership: null,
    crewCommittedAt: null,
    crewCommittedEventId: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.PLAN_IDEMPOTENCY_SECRET;
  delete process.env.RATE_LIMIT_SALT;
  delete process.env.CREW_DELIVERY_SIGNING_SECRET;
});

describe("crew commitment signing preflight", () => {
  it("fails classic and private joins before either durable mutation", async () => {
    const request = (inviteToken: string) => new Request(`http://localhost/api/plans/${PLAN_ID}/join`, {
      method: "POST",
      headers: { "idempotency-key": "crew-preflight-join" },
      body: JSON.stringify({ name: "Priya", inviteToken }),
    });

    const classic = await JOIN(request(CLASSIC_TOKEN), context);
    const privateInvite = await JOIN(request("private-invite-token"), context);

    expect(classic.status).toBe(503);
    expect(privateInvite.status).toBe(503);
    expect(harness.join).not.toHaveBeenCalled();
    expect(harness.redeem).not.toHaveBeenCalled();
  });

  it("fails both Going-capable RSVP routes before durable mutation", async () => {
    const publicRsvp = await RSVP(new Request(`http://localhost/api/invite/${CLASSIC_TOKEN}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ displayName: "Priya", status: "going", submitterId: "rsvp-device" }),
    }), tokenContext);
    const memberRsvp = await UPDATE_RSVP(new Request(`http://localhost/api/plans/${PLAN_ID}/invite-rsvp`, {
      method: "POST",
      body: JSON.stringify({
        inviteToken: CLASSIC_TOKEN,
        displayName: "Priya",
        status: "going",
        submitterId: "rsvp-device",
        memberToken: "member-token",
      }),
    }), context);

    expect(publicRsvp.status).toBe(503);
    expect(memberRsvp.status).toBe(503);
    expect(harness.rsvpUpsert).not.toHaveBeenCalled();
  });
});
