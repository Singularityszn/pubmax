import "server-only";

import { isPlanId } from "@/lib/plan";
import { hashPlanMemberToken, planMemberIdentityResult, planStateResult } from "@/lib/planStore";
import { isPlanPresentation, type PlanPresentationResult } from "@/lib/planPresentation";
import { selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

type Change = { mysteryEnabled: boolean; expectedRouteRevision: number };
type Store = {
  read(planId: string, token: unknown): Promise<PlanPresentationResult>;
  set(planId: string, token: unknown, change: Change): Promise<PlanPresentationResult>;
};

const globalSettings = globalThis as typeof globalThis & { __pubmaxPlanPresentation?: Map<string, boolean> };
const settings = globalSettings.__pubmaxPlanPresentation ??= new Map<string, boolean>();

async function memoryOperation(planId: string, token: unknown, change?: Change): Promise<PlanPresentationResult> {
  const identity = await planMemberIdentityResult(planId, token);
  if (!identity.ok) return { ok: false, error: "error" };
  if (!identity.identity?.collaborationAuthorized) return { ok: false, error: "forbidden" };
  const read = await planStateResult(planId);
  if (!read.ok) return { ok: false, error: "error" };
  if (!read.plan) return { ok: false, error: "forbidden" };
  const revision = Number(read.plan.plan.routeRevision ?? 1);
  const canEdit = identity.identity.role === "host" && !["completed", "abandoned"].includes(read.plan.plan.status ?? "draft");
  if (change) {
    if (!canEdit) return { ok: false, error: "forbidden" };
    if (change.expectedRouteRevision !== revision) return { ok: false, error: "conflict" };
    settings.set(planId, change.mysteryEnabled);
  }
  return { ok: true, memberId: identity.identity.memberId, canEdit, mysteryEnabled: settings.get(planId) ?? false, routeRevision: revision };
}

async function databaseOperation(planId: string, token: unknown, change?: Change): Promise<PlanPresentationResult> {
  if (typeof token !== "string" || !token.trim()) return { ok: false, error: "forbidden" };
  const { data, error } = await requireSupabaseAdmin().rpc("plan_presentation", {
    p_plan_id: planId, p_token_hash: hashPlanMemberToken(token.trim()),
    p_mystery_enabled: change?.mysteryEnabled ?? null,
    p_expected_route_revision: change?.expectedRouteRevision ?? null,
  });
  if (error) return { ok: false, error: "error" };
  if (isPlanPresentation(data)) return { ok: true, ...data };
  const code = data && typeof data === "object" && !Array.isArray(data) ? data.error : null;
  return { ok: false, error: code === "forbidden" || code === "conflict" || code === "invalid" ? code : "error" };
}

const memory: Store = { read: (id, token) => memoryOperation(id, token), set: memoryOperation };
const database: Store = { read: (id, token) => databaseOperation(id, token), set: databaseOperation };

async function run(planId: string, token: unknown, change?: Change): Promise<PlanPresentationResult> {
  if (!isPlanId(planId)) return { ok: false, error: "invalid" };
  if (change && (typeof change.mysteryEnabled !== "boolean" || !Number.isInteger(change.expectedRouteRevision) || change.expectedRouteRevision < 1)) {
    return { ok: false, error: "invalid" };
  }
  try {
    const store = selectStore(memory, database);
    return change ? await store.set(planId, token, change) : await store.read(planId, token);
  } catch {
    return { ok: false, error: "error" };
  }
}

export const planPresentationStore: Store = { read: (id, token) => run(id, token), set: run };
