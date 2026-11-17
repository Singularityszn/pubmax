import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  status: "absent" as "absent" | "invalid" | "unavailable" | "verified",
  userId: "",
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
// A durable store whose rows the test sets. Off by default: the memory store runs.
const durable = vi.hoisted(() => {
  const state = {
    configured: false,
    seats: [] as Array<{ id: string; token_hash: string; joined_at: string; can_collaborate: boolean }>,
    hostRead: { data: null, error: null } as { data: unknown; error: unknown },
    seatError: null as unknown,
    planReads: [] as Array<{ data: unknown; error: unknown }>,
  };
  const admin = () => ({
    from: (table: string) => {
      let columns = "";
      const query = {
        select: (selected: string) => { columns = selected; return query; },
        eq: () => query,
        is: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => table === "plans"
          ? state.planReads.shift() ?? { data: { id: "plan" }, error: null }
          : columns === "user_id" ? state.hostRead : { data: null, error: { message: `unexpected read ${columns}` } },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: state.seats, error: state.seatError }),
      };
      return query;
    },
  });
  return { state, admin };
});

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => durable.state.configured,
    requireSupabaseAdmin: () => durable.admin(),
  };
});
vi.mock("@/lib/storeBackend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storeBackend")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/authServer", () => ({
  verifyCallerAuth: async () => auth.status === "verified"
    ? { status: "verified" as const, identity: { id: auth.userId, email: null, createdAt: null } }
    : { status: auth.status },
}));

import { POST as CREATE } from "@/app/api/plans/route";
import { GET } from "@/app/api/plans/[id]/route";
import type { PlanMemberRole, PlanState } from "@/lib/plan";
import { projectNightReceipt } from "@/lib/nightReceipt";
import { claimPlanMembership } from "@/lib/planCrewIdentity";
import { planMemberCookieName } from "@/lib/planMemberCapability";
import { __resetMemoryPlans, hashPlanMemberToken, memoryPlanStore, planMemberIdentity, planStore } from "@/lib/planStore";

const MATE_NAME = "Priya the Pal";
const HOST_NAME = "Sam Host";

function completedState(overrides: Partial<PlanState> = {}): PlanState {
  return {
    plan: {
      id: "plan-receipt-1",
      title: "Borough birthday",
      startTime: "2026-11-14T19:00:00.000Z",
      createdAt: "2026-11-10T12:00:00.000Z",
      status: "completed",
    },
    stops: [
      {
        venueId: "venue-b",
        venueName: "The Second Pub",
        position: 1,
        selectedDrinkPriceEvidence: {
          category: "wine",
          pence: 650,
          serving: null,
          source: "community",
          reportedAt: "2026-11-03T18:00:00.000Z",
        },
      },
      { venueId: "venue-a", venueName: "The First Pub", position: 0 },
    ],
    crew: [
      { id: "m-host", name: HOST_NAME, status: "here", joinedAt: "2026-11-10T12:00:00.000Z", updatedAt: "2026-11-14T19:05:00.000Z" },
      { id: "m-mate", name: MATE_NAME, status: "here", joinedAt: "2026-11-11T12:00:00.000Z", updatedAt: "2026-11-14T19:06:00.000Z" },
    ],
    actions: [
      { id: "a-1", type: "arrived", stopPosition: 0, ending: null, createdAt: "2026-11-14T19:05:00.000Z", venueId: "venue-a" },
      { id: "a-2", type: "arrived", stopPosition: 1, ending: null, createdAt: "2026-11-14T20:15:00.000Z", venueId: "venue-b" },
    ],
    ending: "food",
    ...overrides,
  };
}

function project(state: PlanState | null, role: PlanMemberRole | null = "host") {
  return projectNightReceipt({ state, role });
}

describe("the private Night Receipt projection", () => {
  it("shows nothing to a reader who only has the public preview", () => {
    expect(project(null)).toEqual({ kind: "none" });
  });

  it.each([["guest"], [null]] as const)("shows nothing to a %s reader of a completed Plan", (role) => {
    expect(project(completedState(), role)).toEqual({ kind: "none" });
  });

  it.each(["draft", "ready", "active", "ending", "abandoned"] as const)(
    "shows nothing while the Plan is %s",
    (status) => {
      const state = completedState();
      expect(project({ ...state, plan: { ...state.plan, status } })).toEqual({ kind: "none" });
    },
  );

  it("shows nothing for a legacy Plan with no recorded status", () => {
    const state = completedState();
    const { status: _status, ...plan } = state.plan;
    expect(project({ ...state, plan })).toEqual({ kind: "none" });
  });

  it("lists the owner's completed route in order with its saved price evidence", () => {
    const projection = project(completedState());
    expect(projection.kind).toBe("receipt");
    if (projection.kind !== "receipt") return;
    expect(projection.receipt).toEqual({
      title: "Borough birthday",
      plannedFor: "2026-11-14T19:00:00.000Z",
      stops: [
        { position: 0, venueName: "The First Pub", price: null },
        {
          position: 1,
          venueName: "The Second Pub",
          price: { drink: "Wine", pence: 650, source: "community", reportedAt: "2026-11-03T18:00:00.000Z" },
        },
      ],
      ending: "food",
      paid: "not_recorded",
    });
  });

  it("never names the crew or claims who arrived where", () => {
    const projection = project(completedState());
    const text = JSON.stringify(projection);
    expect(text).not.toContain(MATE_NAME);
    expect(text).not.toContain(HOST_NAME);
    expect(text).not.toMatch(/arriv|attend|visited|checked/i);
  });

  it("keeps what was paid unknown even when every stop has a price on record", () => {
    const state = completedState();
    const priced = {
      ...state,
      stops: state.stops.map((stop) => ({
        ...stop,
        selectedDrinkPriceEvidence: {
          category: "wine" as const,
          pence: 500,
          serving: null,
          source: "community" as const,
          reportedAt: "2026-11-03T18:00:00.000Z",
        },
      })),
    };
    const projection = project(priced);
    if (projection.kind !== "receipt") throw new Error("expected a receipt");
    expect(projection.receipt.paid).toBe("not_recorded");
    expect(projection.receipt).not.toHaveProperty("totalPence");
    expect(projection.receipt).not.toHaveProperty("totalGbp");
  });

  it.each([
    ["a zero figure", { pence: 0 }],
    ["a beer figure with no serving", { category: "beer" }],
    ["an unreadable report date", { reportedAt: "last week" }],
    ["an unknown source", { source: "listing" }],
  ])("marks %s as no price rather than zero", (_label, change) => {
    const state = completedState();
    const broken = {
      ...state,
      stops: [{
        venueId: "venue-b",
        venueName: "The Second Pub",
        position: 0,
        selectedDrinkPriceEvidence: {
          category: "wine",
          pence: 650,
          serving: null,
          source: "community",
          reportedAt: "2026-11-03T18:00:00.000Z",
          ...change,
        },
      }],
    } as unknown as PlanState;
    const projection = project(broken);
    if (projection.kind !== "receipt") throw new Error("expected a receipt");
    expect(projection.receipt.stops).toEqual([{ position: 0, venueName: "The Second Pub", price: null }]);
  });

  it("leaves an unreadable start time and an unrecorded ending unknown", () => {
    const state = completedState();
    const projection = project({ ...state, plan: { ...state.plan, startTime: "soon" }, ending: null });
    if (projection.kind !== "receipt") throw new Error("expected a receipt");
    expect(projection.receipt.plannedFor).toBeNull();
    expect(projection.receipt.ending).toBeNull();
  });
});

const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GUEST_ACCOUNT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function hostedPlan({ completed = true } = {}) {
  const created = await CREATE(new Request("http://localhost/api/plans", {
    method: "POST",
    headers: { "idempotency-key": `night-receipt-${crypto.randomUUID()}` },
    body: JSON.stringify({
      title: "Receipt night",
      startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      creatorName: HOST_NAME,
      stops: [{ venueId: "venue-7tarkc" }, { venueId: "venue-122cuu1" }, { venueId: "venue-s2ppfm" }],
    }),
  }));
  expect(created.status).toBe(201);
  const host = await created.json() as { plan: { plan: { id: string } }; memberToken: string };
  const planId = host.plan.plan.id;
  const joined = await memoryPlanStore.join(planId, MATE_NAME);
  if (!joined.ok) throw new Error("guest join failed");
  if (completed) {
    for (const status of ["ready", "active", "completed"] as const) {
      expect((await planStore().update(planId, host.memberToken, { status })).ok).toBe(true);
    }
  }
  return { planId, hostToken: host.memberToken, guestToken: joined.memberToken };
}

async function bindSeat(planId: string, token: string, userId: string) {
  const seat = await planMemberIdentity(planId, token);
  if (!seat) throw new Error("no seat");
  expect(await claimPlanMembership(planId, seat.memberId, userId)).toBe("claimed");
}

function receiptRead(planId: string, capability: string | null, view = "receipt") {
  return GET(new Request(`http://localhost/api/plans/${planId}?view=${view}`, {
    headers: {
      authorization: "Bearer account-session-jwt",
      ...(capability ? { cookie: `${planMemberCookieName(planId)}=${encodeURIComponent(capability)}` } : {}),
    },
  }), ctx(planId));
}

function signedIn(userId: string) {
  auth.status = "verified";
  auth.userId = userId;
}

describe("the account-bound Night Receipt read", () => {
  beforeEach(() => {
    __resetMemoryPlans();
    auth.status = "absent";
    auth.userId = "";
    durable.state.configured = false;
  });

  it("gives the bound host account its private receipt and nothing about the crew", async () => {
    const { planId, hostToken } = await hostedPlan();
    await bindSeat(planId, hostToken, ACCOUNT_A);
    signedIn(ACCOUNT_A);

    const response = await receiptRead(planId, hostToken);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as { receipt: { title: string; stops: unknown[]; paid: string } };
    expect(Object.keys(body)).toEqual(["receipt"]);
    expect(body.receipt).toMatchObject({ title: "Receipt night", paid: "not_recorded" });
    expect(body.receipt.stops).toHaveLength(3);
    const text = JSON.stringify(body);
    expect(text).not.toContain(MATE_NAME);
    expect(text).not.toContain(HOST_NAME);
    expect(text).not.toMatch(/arriv|attend|crew|total/i);
  });

  it("answers an unfinished Plan's bound host with no receipt", async () => {
    const { planId, hostToken } = await hostedPlan({ completed: false });
    await bindSeat(planId, hostToken, ACCOUNT_A);
    signedIn(ACCOUNT_A);

    const response = await receiptRead(planId, hostToken);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ receipt: null });
  });

  it("refuses every reader who cannot prove the host account, with one neutral answer", async () => {
    const { planId, hostToken, guestToken } = await hostedPlan();
    await bindSeat(planId, hostToken, ACCOUNT_A);
    await bindSeat(planId, guestToken, GUEST_ACCOUNT);

    const refusals: Array<[string, () => Promise<Response>]> = [
      ["account B holding account A's host cookie", async () => { signedIn(ACCOUNT_B); return receiptRead(planId, hostToken); }],
      ["a signed-out reader holding the host cookie", async () => { auth.status = "absent"; return receiptRead(planId, hostToken); }],
      ["an invalid account token with the host cookie", async () => { auth.status = "invalid"; return receiptRead(planId, hostToken); }],
      ["the guest's own account with the guest cookie", async () => { signedIn(GUEST_ACCOUNT); return receiptRead(planId, guestToken); }],
      ["the guest's account holding the host cookie", async () => { signedIn(GUEST_ACCOUNT); return receiptRead(planId, hostToken); }],
      ["the host account with no Plan capability", async () => { signedIn(ACCOUNT_A); return receiptRead(planId, null); }],
      ["the host account on a Plan that does not exist", async () => { signedIn(ACCOUNT_A); return receiptRead(crypto.randomUUID(), hostToken); }],
    ];
    const answers = [];
    for (const [label, read] of refusals) {
      const response = await read();
      expect(response.status, label).toBe(403);
      expect(response.headers.get("cache-control"), label).toBe("no-store");
      answers.push(await response.json());
    }
    expect(answers[0]).not.toHaveProperty("receipt");
    expect(JSON.stringify(answers[0])).not.toContain("Receipt night");
    for (const answer of answers) expect(answer).toEqual(answers[0]);
  });

  it("refuses an unclaimed host, even to a signed-in account holding its cookie", async () => {
    const { planId, hostToken } = await hostedPlan();
    signedIn(ACCOUNT_A);

    const response = await receiptRead(planId, hostToken);
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("receipt");
  });

  it("reads the Plan capability from its cookie only, never from the account bearer", async () => {
    const { planId, hostToken } = await hostedPlan();
    await bindSeat(planId, hostToken, ACCOUNT_A);
    signedIn(ACCOUNT_A);

    const response = await GET(new Request(`http://localhost/api/plans/${planId}?view=receipt`, {
      headers: { authorization: `Bearer ${hostToken}` },
    }), ctx(planId));
    expect(response.status).toBe(403);
  });

  it("fails closed and retryable while account verification is unavailable", async () => {
    const { planId, hostToken } = await hostedPlan();
    await bindSeat(planId, hostToken, ACCOUNT_A);
    auth.status = "unavailable";

    const response = await receiptRead(planId, hostToken);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ retryable: true });
    expect(body).not.toHaveProperty("receipt");
  });

  it("refuses a view the Plan read does not offer", async () => {
    const { planId, hostToken } = await hostedPlan();
    await bindSeat(planId, hostToken, ACCOUNT_A);
    signedIn(ACCOUNT_A);

    const response = await receiptRead(planId, hostToken, "crew");
    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("stops");
  });

  it("leaves the ordinary capability read unchanged", async () => {
    const { planId, hostToken } = await hostedPlan();
    await bindSeat(planId, hostToken, ACCOUNT_A);
    signedIn(ACCOUNT_B);

    const byCookie = await GET(new Request(`http://localhost/api/plans/${planId}`, {
      headers: { cookie: `${planMemberCookieName(planId)}=${encodeURIComponent(hostToken)}` },
    }), ctx(planId));
    const byBearer = await GET(new Request(`http://localhost/api/plans/${planId}`, {
      headers: { authorization: `Bearer ${hostToken}` },
    }), ctx(planId));
    const preview = await GET(new Request(`http://localhost/api/plans/${planId}`), ctx(planId));
    for (const response of [byCookie, byBearer]) {
      expect(response.status).toBe(200);
      const body = await response.json() as PlanState & { inviteToken?: string };
      expect(body.crew.map((member) => member.name)).toContain(MATE_NAME);
      expect(body.inviteToken).toMatch(/^[0-9a-f]{32}$/);
      expect(body).not.toHaveProperty("receipt");
    }
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ visibility: "preview" });
  });

  describe("against the durable Plan store", () => {
    const planId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const hostToken = "durable-host-capability";

    beforeEach(() => {
      durable.state.configured = true;
      durable.state.seatError = null;
      durable.state.planReads = [];
      durable.state.hostRead = { data: { user_id: ACCOUNT_A }, error: null };
      durable.state.seats = [{
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        token_hash: hashPlanMemberToken(hostToken),
        joined_at: "2026-11-10T12:00:00.000Z",
        can_collaborate: true,
      }];
      signedIn(ACCOUNT_A);
    });

    it("fails closed and retryable when the host account cannot be read", async () => {
      durable.state.hostRead = { data: null, error: { message: "canceling statement due to statement timeout" } };

      const response = await receiptRead(planId, hostToken);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json();
      expect(body).toMatchObject({ retryable: true });
      expect(body).not.toHaveProperty("receipt");
    });

    it("answers retryably when the host seat lookup fails", async () => {
      durable.state.seatError = { message: "member lookup unavailable" };
      const response = await receiptRead(planId, hostToken);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json();
      expect(body).toMatchObject({ retryable: true });
      expect(body).not.toHaveProperty("receipt");
    });

    it("answers retryably when the verified owner's Plan cannot be read", async () => {
      durable.state.planReads = [
        { data: { id: planId }, error: null },
        { data: null, error: { message: "plan lookup unavailable" } },
      ];
      const response = await receiptRead(planId, hostToken);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json();
      expect(body).toMatchObject({ retryable: true });
      expect(body).not.toHaveProperty("receipt");
    });

    it("still refuses an unclaimed host or another account's host seat", async () => {
      for (const userId of [null, ACCOUNT_B]) {
        durable.state.hostRead = { data: { user_id: userId }, error: null };
        const response = await receiptRead(planId, hostToken);
        expect(response.status, String(userId)).toBe(403);
        expect(await response.json()).not.toHaveProperty("receipt");
      }
    });
  });
});
