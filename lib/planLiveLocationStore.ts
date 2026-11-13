import "server-only";

import { isPlanId } from "@/lib/planId";
import { clearMemoryPlanLiveLocation, memoryPlanLiveLocations, memoryPlanLiveLocationStops, purgeExpiredMemoryPlanLiveLocations, type StoredFix, type StoredStop } from "@/lib/planLiveLocationMemory";
import {
  cleanLiveLocationFix,
  isPlanLiveLocationOpen,
  planLiveLocationEndsAtMs,
  type PlanLiveLocationFix,
  type PlanLiveLocationPerson,
  type PlanLiveLocationView,
} from "@/lib/planLiveLocation";
import { hashPlanMemberToken, planMemberIdentityResult, planStateResult } from "@/lib/planStore";
import { selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

export type PlanLiveLocationFailure = "not_found" | "invalid" | "ended" | "stopped" | "unavailable";
export type PlanLiveLocationOperation = "read" | "share" | "stop";
export type PlanLiveLocationResult = { ok: true; view: PlanLiveLocationView } | { ok: false; error: PlanLiveLocationFailure };
/** A classic Plan seat proves itself with its capability. An Open Crew seat proves itself with its verified account. */
export type PlanLiveLocationAuthority = { kind: "plan"; token: string } | { kind: "crew"; accountId: string };

type Backend = {
  operate(id: string, authority: PlanLiveLocationAuthority, operation: PlanLiveLocationOperation, fix: PlanLiveLocationFix | null, startAt: number | null): Promise<PlanLiveLocationResult>;
};
const memoryBackend: Backend = {
  async operate(id, authority, operation, fix, startAt) {
    purgeExpiredMemoryPlanLiveLocations(Date.now());
    // The keyless store has no Open Crews.
    if (authority.kind !== "plan") return { ok: false, error: "not_found" };
    const member = await planMemberIdentityResult(id, authority.token);
    if (!member.ok) return { ok: false, error: "unavailable" };
    if (!member.identity || (operation !== "stop" && !member.identity.collaborationAuthorized)) return { ok: false, error: "not_found" };
    const state = await planStateResult(id);
    if (!state.ok) return { ok: false, error: "unavailable" };
    if (!state.plan) return { ok: false, error: "not_found" };
    const now = Date.now();
    const live = isPlanLiveLocationOpen(state.plan.plan.startTime, state.plan.plan.status, now);
    const endsAt = planLiveLocationEndsAtMs(state.plan.plan.startTime);
    const crew = new Map(state.plan.crew.map((seat) => [seat.id, seat.name]));
    if (!live) clearMemoryPlanLiveLocation(id);
    const rows = memoryPlanLiveLocations.get(id) ?? new Map<string, StoredFix>();
    const stops = memoryPlanLiveLocationStops.get(id) ?? new Map<string, StoredStop>();
    for (const memberId of rows.keys()) {
      if (!crew.has(memberId)) rows.delete(memberId);
    }
    const self = member.identity.memberId;
    if (operation === "share") {
      if (!live || endsAt === null) return { ok: false, error: "ended" };
      const stop = stops.get(self);
      if (stop && (startAt === null || startAt <= stop.stoppedAt)) return { ok: false, error: "stopped" };
      if (startAt !== null) stops.delete(self);
      rows.set(self, { ...fix!, memberId: self, updatedAt: new Date(now).toISOString(), expiresAt: endsAt });
    } else if (operation === "stop") {
      if (live && endsAt !== null) stops.set(self, { stoppedAt: now, expiresAt: endsAt });
      rows.delete(self);
    }
    if (rows.size) memoryPlanLiveLocations.set(id, rows);
    else memoryPlanLiveLocations.delete(id);
    if (stops.size) memoryPlanLiveLocationStops.set(id, stops);
    else memoryPlanLiveLocationStops.delete(id);
    const people: PlanLiveLocationPerson[] = live && operation !== "stop" ? [...rows.values()]
      .filter((row) => row.memberId !== self)
      .map((row) => ({ memberId: row.memberId, name: crew.get(row.memberId)!, latitude: row.latitude, longitude: row.longitude, accuracyM: row.accuracyM, updatedAt: row.updatedAt }))
      : [];
    return {
      ok: true,
      view: { visibility: "member", live, endsAt: live && endsAt !== null ? new Date(endsAt).toISOString() : null, sharing: rows.has(self), people },
    };
  },
};

const databaseBackend: Backend = {
  async operate(id, authority, operation, fix, startAt) {
    const { data, error } = await requireSupabaseAdmin().rpc("plan_live_location", {
      p_plan_id: id,
      p_token_hash: authority.kind === "plan" ? hashPlanMemberToken(authority.token) : null,
      p_social_account_id: authority.kind === "crew" ? authority.accountId : null,
      p_operation: operation,
      p_latitude: fix?.latitude ?? null,
      p_longitude: fix?.longitude ?? null,
      p_accuracy_m: fix?.accuracyM ?? null,
      p_start_at: startAt === null ? null : new Date(startAt).toISOString(),
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "unavailable" };
    const result = data as unknown as PlanLiveLocationResult;
    if (result.ok === true && result.view?.visibility === "member") return result;
    if (result.ok === false && ["not_found", "invalid", "ended", "stopped"].includes(result.error)) return result;
    return { ok: false, error: "unavailable" };
  },
};

/** Every operation rechecks the seat. Missing durable storage never uses memory. */
export async function operatePlanLiveLocation(
  id: string,
  authority: PlanLiveLocationAuthority | null,
  operation: PlanLiveLocationOperation,
  input: { latitude?: unknown; longitude?: unknown; accuracyM?: unknown; startAt?: unknown } = {},
): Promise<PlanLiveLocationResult> {
  if (!isPlanId(id) || !authority) return { ok: false, error: "not_found" };
  if (authority.kind === "plan" && !authority.token.trim()) return { ok: false, error: "not_found" };
  const fix = operation === "share" ? cleanLiveLocationFix(input) : null;
  if (operation === "share" && !fix) return { ok: false, error: "invalid" };
  if (operation === "share" && input.startAt !== undefined
    && (typeof input.startAt !== "number" || !Number.isSafeInteger(input.startAt) || input.startAt <= 0 || input.startAt > Date.now())) return { ok: false, error: "invalid" };
  try {
    const clean: PlanLiveLocationAuthority = authority.kind === "plan" ? { kind: "plan", token: authority.token.trim() } : authority;
    return await selectStore(memoryBackend, databaseBackend).operate(id, clean, operation, fix, typeof input.startAt === "number" ? input.startAt : null);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
