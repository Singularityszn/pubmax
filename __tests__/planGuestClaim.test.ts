import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  status: "absent" as "absent" | "invalid" | "unavailable" | "verified",
  userId: "11111111-1111-4111-8111-111111111111",
}));
const database = vi.hoisted(() => ({
  configured: false,
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => database.configured,
    requireSupabaseAdmin: () => ({ rpc: database.rpc }),
  };
});
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});
vi.mock("@/lib/authServer", () => ({
  callerUserId: async () => auth.status === "verified" ? auth.userId : null,
  verifyCallerAuth: async () => auth.status === "verified"
    ? {
        status: "verified" as const,
        identity: { id: auth.userId, email: "captain@example.com", createdAt: null },
      }
    : { status: auth.status },
}));

import { POST as CREATE } from "@/app/api/plans/route";
import * as sessionRoute from "@/app/api/plans/[id]/session/route";
import {
  __listMemoryPlanMemberUserIds,
  __resetMemoryPlans,
  __setMemoryPlanOwnerUserId,
  memoryPlanStore,
} from "@/lib/planStore";
import { claimPlanMembership, linkPlanMemberUser } from "@/lib/planCrewIdentity";
import type { PlanState } from "@/lib/plan";

const PLAN_URL = "http://localhost/api/plans";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function createGuestPlan() {
  auth.status = "absent";
  const response = await CREATE(new Request(PLAN_URL, {
    method: "POST",
    headers: { "idempotency-key": `guest-claim-${crypto.randomUUID()}` },
    body: JSON.stringify({
      title: "Guest plan to claim",
      startTime: "2026-08-27T19:00:00.000Z",
      creatorName: "Karan",
      stops: [
        { venueId: "venue-xjf3n0" },
        { venueId: "venue-16pnwmm" },
      ],
    }),
  }));
  expect(response.status).toBe(201);
  const body = await response.json() as { plan: PlanState };
  return {
    id: body.plan.plan.id,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}

async function claim(planId: string, cookie: string): Promise<Response> {
  const handler = (sessionRoute as typeof sessionRoute & {
    PUT?: (request: Request, context: ReturnType<typeof ctx>) => Promise<Response>;
  }).PUT;
  if (!handler) {
    return new Response(JSON.stringify({ code: "PLAN_ACCOUNT_CLAIM_MISSING" }), {
      status: 501,
      headers: { "content-type": "application/json" },
    });
  }
  return handler(new Request(`${PLAN_URL}/${planId}/session`, {
    method: "PUT",
    headers: {
      authorization: "Bearer verified-auth-session",
      cookie,
    },
  }), ctx(planId));
}

beforeEach(() => {
  __resetMemoryPlans();
  auth.status = "absent";
  auth.userId = "11111111-1111-4111-8111-111111111111";
  database.configured = false;
  database.rpc.mockReset();
});

describe("guest Plan account claim", () => {
  it("atomically binds the guest host membership and Plan owner to the signed-in account", async () => {
    const guest = await createGuestPlan();
    auth.status = "verified";

    const response = await claim(guest.id, guest.cookie);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claimed: true, role: "host" });
    expect(__listMemoryPlanMemberUserIds(guest.id)).toEqual([
      expect.objectContaining({ userId: auth.userId }),
    ]);
    expect(
      __setMemoryPlanOwnerUserId(
        guest.id,
        "22222222-2222-4222-8222-222222222222",
      ),
    ).toBe(false);
  });

  it("is idempotent for the same signed-in account", async () => {
    const guest = await createGuestPlan();
    auth.status = "verified";

    expect((await claim(guest.id, guest.cookie)).status).toBe(200);
    const replay = await claim(guest.id, guest.cookie);

    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ claimed: false, role: "host" });
    expect(__listMemoryPlanMemberUserIds(guest.id)).toHaveLength(1);
  });

  it("refuses a different account without changing the existing claim", async () => {
    const guest = await createGuestPlan();
    auth.status = "verified";
    expect((await claim(guest.id, guest.cookie)).status).toBe(200);

    auth.userId = "22222222-2222-4222-8222-222222222222";
    const conflict = await claim(guest.id, guest.cookie);

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "PLAN_ACCOUNT_CLAIM_CONFLICT" });
    expect(__listMemoryPlanMemberUserIds(guest.id)).toEqual([
      expect.not.objectContaining({ userId: auth.userId }),
    ]);
  });

  it("requires both a verified account and the existing Plan member session", async () => {
    const guest = await createGuestPlan();

    const signedOut = await claim(guest.id, guest.cookie);
    expect(signedOut.status).toBe(401);

    auth.status = "verified";
    const withoutMemberSession = await claim(guest.id, "");
    expect(withoutMemberSession.status).toBe(403);
    expect(__listMemoryPlanMemberUserIds(guest.id)).toEqual([]);
  });

  it("refuses to link one account to two memberships in the same Plan", async () => {
    const guest = await createGuestPlan();
    auth.status = "verified";
    expect((await claim(guest.id, guest.cookie)).status).toBe(200);

    const joined = await memoryPlanStore.join(guest.id, "Same account", {
      collaborationAuthorized: true,
      idempotencyKey: "same-account-second-membership",
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const secondMember = joined.plan.crew.at(-1);
    expect(secondMember).toBeDefined();

    expect(
      await linkPlanMemberUser(guest.id, secondMember!.id, auth.userId),
    ).toBe(false);
    expect(__listMemoryPlanMemberUserIds(guest.id)).toHaveLength(1);
  });

  it("logs a durable claim failure before returning the retryable outcome", async () => {
    database.configured = true;
    database.rpc.mockResolvedValue({ data: null, error: { message: "claim RPC missing" } });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(claimPlanMembership(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    )).resolves.toBe("error");
    expect(error).toHaveBeenCalledWith(
      "[plans] membership claim failed:",
      "claim RPC missing",
    );
    error.mockRestore();
  });
});
