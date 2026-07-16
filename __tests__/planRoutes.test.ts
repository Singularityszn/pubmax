import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { GET, PATCH } from "@/app/api/plans/[id]/route";
import { POST as ACTION } from "@/app/api/plans/[id]/actions/route";
import { POST as JOIN } from "@/app/api/plans/[id]/join/route";
import { POST as PRESENCE } from "@/app/api/plans/[id]/presence/route";
import { GET as SESSION, POST as EXCHANGE_SESSION } from "@/app/api/plans/[id]/session/route";
import { PLAN_HTTP_ONLY_SESSION } from "@/lib/planSessionCapability";
import { __resetMemoryPlans } from "@/lib/planStore";
import type { PlanState } from "@/lib/plan";

const URL = "http://localhost/api/plans";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function createPlan() {
  const response = await CREATE(new Request(URL, {
    method: "POST",
    headers: { "idempotency-key": "plan-routes-create" },
    body: JSON.stringify({
      title: "Friday near Bank",
      startTime: "2026-07-11T17:30:00.000Z",
      creatorName: "Karan",
      stops: [
        { venueId: "venue-xjf3n0", venueName: "Fabricated client name" },
        { venueId: "venue-16pnwmm", venueName: "Another fabricated name" },
      ],
    }),
  }));
  return { response, body: await response.json() as { plan: PlanState; memberToken: string; role: string } };
}

beforeEach(() => __resetMemoryPlans());

describe("Plan public HTTP contract", () => {
  it("creates an ordered Plan with a start time", async () => {
    const { response, body } = await createPlan();
    expect(response.status).toBe(201);
    expect(body.plan.plan.startTime).toBe("2026-07-11T17:30:00.000Z");
    expect(body.plan.stops.map((stop) => stop.position)).toEqual([0, 1]);
    expect(body.plan.stops.map((stop) => stop.venueId)).toEqual([
      "venue-xjf3n0",
      "venue-16pnwmm",
    ]);
    expect(body.plan.stops.map((stop) => stop.venueName)).not.toContain("Fabricated client name");
    expect(body.memberToken).toMatch(/^[a-f0-9]{64}$/);
    expect(body.role).toBe("host");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain(`Path=/api/plans/${body.plan.plan.id}`);
    expect(response.headers.get("set-cookie")).not.toContain("Max-Age");
  });

  it("restores host authority through a path-scoped HttpOnly session", async () => {
    const { response, body } = await createPlan();
    const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    const restored = await SESSION(new Request(`${URL}/${body.plan.plan.id}/session`, {
      headers: { cookie },
    }), ctx(body.plan.plan.id));
    expect(await restored.json()).toEqual({ active: true, role: "host", collaborationAuthorized: true });

    const updated = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${PLAN_HTTP_ONLY_SESSION}`, cookie },
      body: JSON.stringify({ status: "ready" }),
    }), ctx(body.plan.plan.id));
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ plan: { status: "ready" } });
  });

  it("exchanges a verified legacy bearer for the HttpOnly recovery session", async () => {
    const { body } = await createPlan();
    const exchanged = await EXCHANGE_SESSION(new Request(`${URL}/${body.plan.plan.id}/session`, {
      method: "POST",
      headers: { authorization: `Bearer ${body.memberToken}` },
    }), ctx(body.plan.plan.id));
    expect(exchanged.status).toBe(200);
    expect(await exchanged.json()).toEqual({ active: true, role: "host", collaborationAuthorized: true });
    expect(exchanged.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("rejects venue ids that are not in the server-owned Venue Dataset", async () => {
    const response = await CREATE(new Request(URL, {
      method: "POST",
      headers: { "idempotency-key": "plan-routes-invalid-venue" },
      body: JSON.stringify({
        startTime: "2026-07-11T17:30:00.000Z",
        creatorName: "Karan",
        stops: [{ venueId: "invented-pub", venueName: "Definitely Real Arms" }],
      }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose venues from the Venue Dataset.",
      code: "PLAN_VENUES_INVALID",
      retryable: false,
    });
  });

  it("lets anyone holding the unguessable Plan link view it without an account", async () => {
    const { body } = await createPlan();
    const response = await GET(new Request(`${URL}/${body.plan.plan.id}`), ctx(body.plan.plan.id));
    expect(response.status).toBe(200);
    const state = await response.json() as PlanState;
    expect(state.plan.title).toBe("Friday near Bank");
    expect(state.crew.map((member) => member.name)).toEqual(["Karan"]);
  });

  it("joins with only a name and returns a private presence token", async () => {
    const { body } = await createPlan();
    const response = await JOIN(new Request(`${URL}/${body.plan.plan.id}/join`, {
      method: "POST",
      headers: { "idempotency-key": "plan-routes-guest-join" },
      body: JSON.stringify({ name: "Luna" }),
    }), ctx(body.plan.plan.id));
    expect(response.status).toBe(200);
    const joined = await response.json() as { plan: PlanState; memberToken: string; role: string };
    expect(joined.plan.crew.map((member) => member.name)).toEqual(["Karan", "Luna"]);
    expect(joined.memberToken).toMatch(/^[a-f0-9]{64}$/);
    expect(joined.role).toBe("guest");
    expect(JSON.stringify(joined.plan)).not.toContain(joined.memberToken);
  });

  it("allows only the member token to change that member's live presence", async () => {
    const { body } = await createPlan();
    const denied = await PRESENCE(new Request(`${URL}/${body.plan.plan.id}/presence`, {
      method: "POST",
      body: JSON.stringify({ memberToken: "wrong", status: "on_the_way" }),
    }), ctx(body.plan.plan.id));
    expect(denied.status).toBe(403);

    const response = await PRESENCE(new Request(`${URL}/${body.plan.plan.id}/presence`, {
      method: "POST",
      body: JSON.stringify({ memberToken: body.memberToken, status: "here" }),
    }), ctx(body.plan.plan.id));
    expect(response.status).toBe(200);
    const state = await response.json() as PlanState;
    expect(state.crew[0]).toMatchObject({ name: "Karan", status: "here" });
  });

  it("lets the creator update Night Context and advance the Planned Night lifecycle", async () => {
    const { body } = await createPlan();
    const response = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH",
      body: JSON.stringify({ memberToken: body.memberToken, status: "ready", context: { nightArea: "clapham", daypart: "after_work", partyType: "friends", groupSize: 4, budget: "value" } }),
    }), ctx(body.plan.plan.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ plan: { status: "ready" }, context: { nightArea: "clapham", daypart: "after_work", groupSize: 4 } });
  });

  it("replaces a creator-authorized route with exactly three canonical Venue Dataset stops", async () => {
    const { body } = await createPlan();
    const response = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${body.memberToken}` },
      body: JSON.stringify({
        expectedRouteRevision: 1,
        stops: [
          { venueId: "venue-1f5ygjb", venueName: "Client supplied name is ignored" },
          { venueId: "venue-xjf3n0", venueName: "Also ignored" },
          { venueId: "venue-3h52h", venueName: "Ignored too" },
        ],
        context: { nightArea: "clapham", daypart: "evening", partyType: "friends", groupSize: 3, budget: "value" },
      }),
    }), ctx(body.plan.plan.id));

    expect(response.status).toBe(200);
    const state = await response.json() as PlanState;
    expect(state.plan.routeRevision).toBe(2);
    expect(state.stops).toEqual([
      { venueId: "venue-1f5ygjb", venueName: "The Bohemia", position: 0 },
      { venueId: "venue-xjf3n0", venueName: "Arnos Arms", position: 1 },
      { venueId: "venue-3h52h", venueName: "The Elephant Inn", position: 2 },
    ]);
    expect(state.context).toMatchObject({ nightArea: "clapham", daypart: "evening" });
    expect(JSON.stringify(state)).not.toContain(body.memberToken);
  });

  it("rejects unauthorized, stale, duplicate, and unknown canonical route replacements", async () => {
    const { body } = await createPlan();
    const valid = [
      { venueId: "venue-1f5ygjb" },
      { venueId: "venue-xjf3n0" },
      { venueId: "venue-3h52h" },
    ];
    const unauthorized = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH", body: JSON.stringify({ memberToken: "wrong", expectedRouteRevision: 1, stops: valid }),
    }), ctx(body.plan.plan.id));
    expect(unauthorized.status).toBe(403);

    const stale = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH", body: JSON.stringify({ memberToken: body.memberToken, expectedRouteRevision: 2, stops: valid }),
    }), ctx(body.plan.plan.id));
    expect(stale.status).toBe(409);

    const invalid = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH", body: JSON.stringify({ memberToken: body.memberToken, expectedRouteRevision: 1, stops: [valid[0], valid[0], { venueId: "invented-pub" }] }),
    }), ctx(body.plan.plan.id));
    expect(invalid.status).toBe(400);
  });

  it("does not replace a terminal Planned Night route", async () => {
    const { body } = await createPlan();
    const abandoned = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH", body: JSON.stringify({ memberToken: body.memberToken, status: "abandoned" }),
    }), ctx(body.plan.plan.id));
    expect(abandoned.status).toBe(200);

    const replacement = await PATCH(new Request(`${URL}/${body.plan.plan.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        memberToken: body.memberToken,
        expectedRouteRevision: 1,
        stops: [{ venueId: "venue-1f5ygjb" }, { venueId: "venue-xjf3n0" }, { venueId: "venue-3h52h" }],
      }),
    }), ctx(body.plan.plan.id));
    expect(replacement.status).toBe(400);
  });

  it("records explicit stop actions and completion without drink tracking", async () => {
    const { body } = await createPlan();
    const response = await ACTION(new Request(`${URL}/${body.plan.plan.id}/actions`, {
      method: "POST",
      headers: { "idempotency-key": "plan-routes-arrived" },
      body: JSON.stringify({ memberToken: body.memberToken, type: "arrived", stopPosition: 0 }),
    }), ctx(body.plan.plan.id));
    expect(response.status).toBe(201);
    const state = await response.json();
    expect(state.actions).toEqual([expect.objectContaining({ type: "arrived", stopPosition: 0 })]);

    const ending = await ACTION(new Request(`${URL}/${body.plan.plan.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ memberToken: body.memberToken, type: "ending", ending: "get_home" }),
    }), ctx(body.plan.plan.id));
    expect(ending.status).toBe(400);
  });
});
