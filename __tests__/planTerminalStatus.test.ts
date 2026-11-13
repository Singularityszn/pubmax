import { beforeEach, describe, expect, it, vi } from "vitest";

import { PLANNED_NIGHT_STATUSES, type PlannedNightStatus } from "@/lib/plan";

const override: { status?: PlannedNightStatus } = {};

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

vi.mock("@/lib/planStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/planStore")>();
  return {
    ...actual,
    planStateResult: async (planId: string) => {
      const result = await actual.planStateResult(planId);
      if (!result.ok || !result.plan) return result;
      return { ...result, plan: { ...result.plan, plan: { ...result.plan.plan, status: override.status } } };
    },
  };
});

import { __resetMemoryPlans, memoryPlanStore } from "@/lib/planStore";
import { __resetPlanCollaboration, planCollaborationStore } from "@/lib/planCollaborationStore";
import { planPresentationStore } from "@/lib/planPresentationStore";

const stops = [
  { venueId: "venue-a", venueName: "A", position: 0 },
  { venueId: "venue-b", venueName: "B", position: 1 },
];

async function night() {
  const created = await memoryPlanStore.create({
    title: "Terminal test", creatorName: "Host",
    startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), stops,
  });
  if (!created.ok) throw new Error("plan setup failed");
  const joined = await memoryPlanStore.join(created.plan.plan.id, "Guest", { collaborationAuthorized: true });
  if (!joined.ok) throw new Error("guest setup failed");
  return { id: created.plan.plan.id, host: created.memberToken, guest: joined.memberToken };
}

beforeEach(() => {
  __resetMemoryPlans();
  __resetPlanCollaboration();
  delete override.status;
});

describe("a completed or abandoned Plan is closed to route and presentation edits", () => {
  it.each([...PLANNED_NIGHT_STATUSES, undefined])("status %s", async (status) => {
    const { id, host, guest } = await night();
    override.status = status;
    const terminal = status === "completed" || status === "abandoned";

    const proposal = await planCollaborationStore().createProposal(id, guest, {
      reason: "Same route", expectedRouteRevision: 1, stops, resolvedConstraintIds: [], idempotencyKey: `terminal-${status ?? "none"}`,
    });
    expect(proposal.ok ? "ok" : proposal.error).toBe(terminal ? "invalid" : "ok");

    expect(await planPresentationStore.read(id, host)).toMatchObject({ ok: true, canEdit: !terminal });
  });
});
