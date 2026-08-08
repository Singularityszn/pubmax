import { beforeEach, describe, expect, it, vi } from "vitest";

// F9 (token rotate/revoke) + F10 (guest-list caps) — invite hardening bundle.
// Mirrors __tests__/planInviteRsvpModerationRoute.test.ts's harness shape.

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import { POST as CREATE } from "@/app/api/plans/route";
import { GET as GET_PLAN } from "@/app/api/plans/[id]/route";
import { POST as JOIN } from "@/app/api/plans/[id]/join/route";
import { POST as CREATE_INVITE } from "@/app/api/plans/[id]/invites/route";
import { POST as ROTATE } from "@/app/api/plans/[id]/invite-rotate/route";
import { POST as RSVP } from "@/app/api/invite/[token]/rsvp/route";
import { __resetPlanCollaboration } from "@/lib/planCollaborationStore";
import { __resetMemoryPlans } from "@/lib/planStore";
import { __resetMemoryRsvps } from "@/lib/planInviteRsvpStore";
import { GUEST_LIST_DISPLAY_CAP, RSVP_PLAN_CEILING } from "@/lib/planInvite";
import { rsvpStore } from "@/lib/planInviteRsvpStore";

const PLANS_URL = "http://localhost/api/plans";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const tokenCtx = (token: string) => ({ params: Promise.resolve({ token }) });
const route = [{ venueId: "venue-1f5ygjb" }, { venueId: "venue-xjf3n0" }, { venueId: "venue-3h52h" }];

beforeEach(() => {
  __resetMemoryPlans();
  __resetMemoryRsvps();
  __resetPlanCollaboration();
});

async function createPlan() {
  const startTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const response = await CREATE(new Request(PLANS_URL, {
    method: "POST",
    headers: { "idempotency-key": `invite-hardening-${crypto.randomUUID()}` },
    body: JSON.stringify({ startTime, creatorName: "Host", stops: route }),
  }));
  return (await response.json()) as { plan: { plan: { id: string } }; memberToken: string; role: string };
}

async function ownInviteToken(planId: string, memberToken: string): Promise<string> {
  const response = await GET_PLAN(
    new Request(`${PLANS_URL}/${planId}`, { headers: { authorization: `Bearer ${memberToken}` } }),
    ctx(planId),
  );
  const body = (await response.json()) as { inviteToken?: string | null };
  expect(body.inviteToken).toBeTruthy();
  return body.inviteToken as string;
}

describe("POST /api/plans/[id]/invite-rotate", () => {
  it("rotates the token for the host, invalidating the old link", async () => {
    const host = await createPlan();
    const oldToken = await ownInviteToken(host.plan.plan.id, host.memberToken);

    const response = await ROTATE(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/invite-rotate`, {
        method: "POST",
        body: JSON.stringify({ memberToken: host.memberToken }),
      }),
      ctx(host.plan.plan.id),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; inviteToken: string };
    expect(body.ok).toBe(true);
    expect(body.inviteToken).toMatch(/^[0-9a-f]{32}$/);
    expect(body.inviteToken).not.toBe(oldToken);

    // Old token 404s once RSVP'd against — the classic invite resolve path.
    const rsvpOnOld = await RSVP(
      new Request(`http://localhost/api/invite/${oldToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName: "Late", status: "going", submitterId: "device-late" }),
      }),
      tokenCtx(oldToken),
    );
    expect(rsvpOnOld.status).toBe(404);

    // New token resolves fine.
    const rsvpOnNew = await RSVP(
      new Request(`http://localhost/api/invite/${body.inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName: "OnTime", status: "going", submitterId: "device-ontime" }),
      }),
      tokenCtx(body.inviteToken),
    );
    expect(rsvpOnNew.status).toBe(200);
  });

  it("rejects rotation from a guest's own capability token", async () => {
    const host = await createPlan();
    const inviteResponse = await CREATE_INVITE(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/invites`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${host.memberToken}`,
          "idempotency-key": "invite-hardening-guest-invite",
        },
        body: JSON.stringify({ expiresInMinutes: 30 }),
      }),
      ctx(host.plan.plan.id),
    );
    expect(inviteResponse.status).toBe(201);
    const collabInvite = (await inviteResponse.json()) as { token: string };
    const joined = await JOIN(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/join`, {
        method: "POST",
        headers: { "idempotency-key": "invite-hardening-guest-join" },
        body: JSON.stringify({ name: "Guest", inviteToken: collabInvite.token }),
      }),
      ctx(host.plan.plan.id),
    );
    expect(joined.status).toBe(200);
    const guest = (await joined.json()) as { memberToken: string };

    const response = await ROTATE(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/invite-rotate`, {
        method: "POST",
        body: JSON.stringify({ memberToken: guest.memberToken }),
      }),
      ctx(host.plan.plan.id),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Only the host can make a new link." });
  });

  it("rejects rotation with no capability token at all", async () => {
    const host = await createPlan();

    const response = await ROTATE(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/invite-rotate`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
      ctx(host.plan.plan.id),
    );

    expect(response.status).toBe(403);
  });
});

describe("POST /api/invite/[token]/rsvp guest-list ceiling", () => {
  it("refuses a brand-new guest once the plan is at the RSVP ceiling, but still allows an existing guest to change status", async () => {
    const host = await createPlan();
    const inviteToken = await ownInviteToken(host.plan.plan.id, host.memberToken);

    for (let i = 0; i < RSVP_PLAN_CEILING; i++) {
      const res = await RSVP(
        new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
          method: "POST",
          body: JSON.stringify({ displayName: `Guest ${i}`, status: "going", submitterId: `device-${i}` }),
        }),
        tokenCtx(inviteToken),
      );
      expect(res.status).toBe(200);
    }

    const overflow = await RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName: "Overflow", status: "going", submitterId: "device-overflow" }),
      }),
      tokenCtx(inviteToken),
    );
    expect(overflow.status).toBe(409);
    expect(await overflow.json()).toMatchObject({ error: "This guest list is full." });

    const existingChangesStatus = await RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ displayName: "Guest 0", status: "maybe", submitterId: "device-0" }),
      }),
      tokenCtx(inviteToken),
    );
    expect(existingChangesStatus.status).toBe(200);
  }, 20_000);
});

describe("guest-list display truncation", () => {
  it("caps the displayed guest list while counts stay honest", async () => {
    const host = await createPlan();
    const inviteToken = await ownInviteToken(host.plan.plan.id, host.memberToken);

    const total = GUEST_LIST_DISPLAY_CAP + 7;
    for (let i = 0; i < total; i++) {
      await RSVP(
        new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
          method: "POST",
          body: JSON.stringify({ displayName: `Guest ${i}`, status: "going", submitterId: `device-trunc-${i}` }),
        }),
        tokenCtx(inviteToken),
      );
    }

    const summary = await rsvpStore().summarize(host.plan.plan.id);
    expect(summary.guests.length).toBe(GUEST_LIST_DISPLAY_CAP);
    expect(summary.counts.going).toBe(total);
    expect(summary.counts.going + summary.counts.maybe - summary.guests.length).toBe(total - GUEST_LIST_DISPLAY_CAP);
  }, 20_000);
});
