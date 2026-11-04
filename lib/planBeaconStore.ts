import "server-only";

import { isPlanId } from "@/lib/planId";
import { cleanPlanBeacon, planBeaconExpiry, planBeaconLocation, type PlanBeacon, type PlanBeaconInput, type PlanBeaconView } from "@/lib/planBeacon";
import { hashPlanMemberToken, planMemberIdentityResult, planStateResult } from "@/lib/planStore";
import { selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

export type PlanBeaconFailure = "not_found" | "forbidden" | "invalid" | "conflict" | "unavailable";
type Result = { ok: true; view: PlanBeaconView } | { ok: false; error: PlanBeaconFailure };
type Operation = "read" | "set" | "clear";
type StoredBeacon = PlanBeacon & { routeRevision: number; arrivalId: string };
type BeaconBackend = { operate(id: string, token: string, operation: Operation, input: PlanBeaconInput): Promise<Result> };

const memory = new Map<string, StoredBeacon>();

const memoryBackend: BeaconBackend = {
  async operate(id, token, operation, input) {
    const member = await planMemberIdentityResult(id, token);
    if (!member.ok) return { ok: false, error: "unavailable" };
    if (!member.identity?.collaborationAuthorized) return { ok: false, error: "not_found" };
    if (operation !== "read" && member.identity.role !== "host") return { ok: false, error: "forbidden" };
    const result = await planStateResult(id);
    if (!result.ok) return { ok: false, error: "unavailable" };
    if (!result.plan) return { ok: false, error: "not_found" };
    const now = new Date();
    const location = planBeaconLocation(result.plan, now);
    let stored = memory.get(id);
    if (stored && (stored.arrivalId !== location.arrivalId || stored.routeRevision !== location.routeRevision || Date.parse(stored.expiresAt) <= now.getTime())) {
      memory.delete(id);
      stored = undefined;
    }
    if (operation !== "read") {
      if (!location.current || input.expectedArrivalId !== location.arrivalId || input.expectedRouteRevision !== location.routeRevision) {
        return { ok: false, error: "conflict" };
      }
      if (operation === "clear") {
        memory.delete(id);
        stored = undefined;
      } else {
        const clean = cleanPlanBeacon(input);
        const expiresAt = planBeaconExpiry(result.plan.plan.startTime, now);
        if (!clean || !expiresAt) return { ok: false, error: "invalid" };
        if (!stored || stored.symbol !== clean.symbol || stored.note !== clean.note) {
          stored = { ...clean, expiresAt, routeRevision: location.routeRevision, arrivalId: location.arrivalId! };
          memory.set(id, stored);
        }
      }
    }
    return {
      ok: true,
      view: {
        visibility: "member", canEdit: member.identity.role === "host", ...location,
        beacon: stored ? { symbol: stored.symbol, note: stored.note, expiresAt: stored.expiresAt } : null,
      },
    };
  },
};

const databaseBackend: BeaconBackend = {
  async operate(id, token, operation, input) {
    const clean = operation === "set" ? cleanPlanBeacon(input) : null;
    if (operation === "set" && !clean) return { ok: false, error: "invalid" };
    const { data, error } = await requireSupabaseAdmin().rpc("plan_table_beacon", {
      p_plan_id: id,
      p_token_hash: hashPlanMemberToken(token),
      p_operation: operation,
      p_symbol: clean?.symbol ?? null,
      p_note: clean?.note ?? null,
      p_expected_route_revision: typeof input.expectedRouteRevision === "number" ? input.expectedRouteRevision : null,
      p_expected_arrival_id: typeof input.expectedArrivalId === "string" ? input.expectedArrivalId : null,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "unavailable" };
    const result = data as unknown as Result;
    if (result.ok === true && result.view?.visibility === "member") return result;
    if (result.ok === false && ["not_found", "forbidden", "invalid", "conflict"].includes(result.error)) return result;
    return { ok: false, error: "unavailable" };
  },
};

/** Every operation rechecks membership. Missing durable storage never uses memory. */
export async function operatePlanBeacon(id: string, token: unknown, operation: Operation, input: PlanBeaconInput = {}): Promise<Result> {
  if (!isPlanId(id) || typeof token !== "string" || !token.trim()) return { ok: false, error: "not_found" };
  try {
    return await selectStore(memoryBackend, databaseBackend).operate(id, token.trim(), operation, input);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
