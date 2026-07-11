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
import { GET } from "@/app/api/plans/[id]/route";
import { POST as JOIN } from "@/app/api/plans/[id]/join/route";
import { POST as PRESENCE } from "@/app/api/plans/[id]/presence/route";
import { __resetMemoryPlans } from "@/lib/planStore";
import type { PlanState } from "@/lib/plan";

const URL = "http://localhost/api/plans";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function createPlan() {
  const response = await CREATE(new Request(URL, {
    method: "POST",
    body: JSON.stringify({
      title: "Friday near Bank",
      startTime: "2026-07-11T17:30:00.000Z",
      creatorName: "Karan",
      stops: [
        { venueId: "ship-1", venueName: "The Ship" },
        { venueId: "swan-2", venueName: "The Swan" },
      ],
    }),
  }));
  return { response, body: await response.json() as { plan: PlanState; memberToken: string } };
}

beforeEach(() => __resetMemoryPlans());

describe("Plan public HTTP contract", () => {
  it("creates an ordered Plan with a start time", async () => {
    const { response, body } = await createPlan();
    expect(response.status).toBe(201);
    expect(body.plan.plan.startTime).toBe("2026-07-11T17:30:00.000Z");
    expect(body.plan.stops.map((stop) => [stop.position, stop.venueName])).toEqual([
      [0, "The Ship"],
      [1, "The Swan"],
    ]);
    expect(body.memberToken).toMatch(/^[a-f0-9]{64}$/);
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
      body: JSON.stringify({ name: "Luna" }),
    }), ctx(body.plan.plan.id));
    expect(response.status).toBe(200);
    const joined = await response.json() as { plan: PlanState; memberToken: string };
    expect(joined.plan.crew.map((member) => member.name)).toEqual(["Karan", "Luna"]);
    expect(joined.memberToken).toMatch(/^[a-f0-9]{64}$/);
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
});
