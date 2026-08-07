import { beforeEach, describe, expect, it, vi } from "vitest";

// Task: plan-invite-host-ui, deliverable 3. app/api/invite/[token]/rsvp's
// DELETE handler is participant-fenced host-only (docs/CLAUDE.md route ruling
// 4's moderation clause), and this is the only route-level proof of that gate
// — UI components have no Vitest render harness in this codebase
// (vitest.config.ts: "UI components are excluded; they're covered by the
// Playwright E2E suite instead"), so the host-only remove control itself is
// proven live in e2e/plan-invite.spec.ts, and this file proves the server
// contract it depends on.

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
import { POST as RSVP, DELETE as REMOVE_RSVP } from "@/app/api/invite/[token]/rsvp/route";
import { __resetMemoryPlans } from "@/lib/planStore";
import { __resetMemoryRsvps } from "@/lib/planInviteRsvpStore";

const PLANS_URL = "http://localhost/api/plans";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const tokenCtx = (token: string) => ({ params: Promise.resolve({ token }) });
const route = [{ venueId: "venue-1f5ygjb" }, { venueId: "venue-xjf3n0" }, { venueId: "venue-3h52h" }];

beforeEach(() => {
  __resetMemoryPlans();
  __resetMemoryRsvps();
});

async function createPlan() {
  const startTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const response = await CREATE(new Request(PLANS_URL, {
    method: "POST",
    headers: { "idempotency-key": `rsvp-mod-host-${crypto.randomUUID()}` },
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

async function submitRsvp(token: string, displayName: string) {
  const response = await RSVP(
    new Request(`http://localhost/api/invite/${token}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ displayName, status: "going", submitterId: `submitter-${displayName}` }),
    }),
    tokenCtx(token),
  );
  const body = (await response.json()) as { summary: { guests: Array<{ id: string; displayName: string }> } };
  const guest = body.summary.guests.find((candidate) => candidate.displayName === displayName);
  expect(guest).toBeDefined();
  return guest!.id;
}

describe("DELETE /api/invite/[token]/rsvp", () => {
  it("removes a guest RSVP for the host's real capability token", async () => {
    const host = await createPlan();
    const inviteToken = await ownInviteToken(host.plan.plan.id, host.memberToken);
    const rsvpId = await submitRsvp(inviteToken, "Priya");

    const response = await REMOVE_RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "DELETE",
        body: JSON.stringify({ rsvpId, memberToken: host.memberToken }),
      }),
      tokenCtx(inviteToken),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it("rejects removal from a guest's own capability token", async () => {
    const host = await createPlan();
    const inviteToken = await ownInviteToken(host.plan.plan.id, host.memberToken);
    const rsvpId = await submitRsvp(inviteToken, "Priya");

    const joined = await JOIN(
      new Request(`${PLANS_URL}/${host.plan.plan.id}/join`, {
        method: "POST",
        headers: { "idempotency-key": "rsvp-mod-guest-join" },
        body: JSON.stringify({ name: "Guest" }),
      }),
      ctx(host.plan.plan.id),
    );
    const guest = (await joined.json()) as { memberToken: string };

    const response = await REMOVE_RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "DELETE",
        body: JSON.stringify({ rsvpId, memberToken: guest.memberToken }),
      }),
      tokenCtx(inviteToken),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Only the host can remove an RSVP." });
  });

  it("rejects removal with no capability token at all", async () => {
    const host = await createPlan();
    const inviteToken = await ownInviteToken(host.plan.plan.id, host.memberToken);
    const rsvpId = await submitRsvp(inviteToken, "Priya");

    const response = await REMOVE_RSVP(
      new Request(`http://localhost/api/invite/${inviteToken}/rsvp`, {
        method: "DELETE",
        body: JSON.stringify({ rsvpId }),
      }),
      tokenCtx(inviteToken),
    );

    expect(response.status).toBe(403);
  });
});
