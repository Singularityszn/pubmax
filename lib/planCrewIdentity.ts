import "server-only";

// Internal plan-crew ↔ auth user linkage for friend-graph formation (WP7).
//
// plan_crew_members.user_id and plans.owner_user_id already exist (migration
// 0024) but classic join/create never stamped them. Public PlanState still
// never exposes user ids - this module is the only write/read seam for them.

import { isPlanId } from "@/lib/plan";
import {
  __listMemoryPlanMemberUserIds,
  claimMemoryPlanMembership,
  hashPlanMemberToken,
  planMemberIdentityResult,
  recoverMemoryPlanMembership,
  type PlanMemberIdentity,
  type PlanMembershipClaimOutcome,
} from "@/lib/planStore";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

const MEMBERS = "plan_crew_members";

function cleanUserId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type PlanMembershipClaimResult =
  | PlanMembershipClaimOutcome
  | "error";

export type PlanMembershipRecoveryResult =
  | { ok: true; identity: PlanMemberIdentity }
  | { ok: false; error: "not_found" | "conflict" | "error" };

/** Bind an existing Plan member capability to one auth account in one write. */
export async function claimPlanMembership(
  planId: string,
  memberId: string,
  userId: string,
): Promise<PlanMembershipClaimResult> {
  if (!isPlanId(planId) || !isPlanId(memberId)) return "not_found";
  const uid = cleanUserId(userId);
  if (!uid) return "not_found";
  if (!isSupabaseConfigured()) {
    return claimMemoryPlanMembership(planId, memberId, uid);
  }
  try {
    const { data, error } = await requireSupabaseAdmin().rpc(
      "claim_plan_membership",
      {
        p_plan_id: planId,
        p_member_id: memberId,
        p_user_id: uid,
      },
    );
    if (error) throw new Error(error.message);
    return data === "claimed" ||
      data === "already_claimed" ||
      data === "conflict" ||
      data === "not_found"
      ? data
      : "error";
  } catch (error) {
    console.error(
      "[plans] membership claim failed:",
      error instanceof Error ? error.message : error,
    );
    return "error";
  }
}

/** Rotate capability for the signed-in account's existing Plan membership. */
export async function recoverPlanMembership(
  planId: string,
  userId: string,
  memberToken: string,
  recoveredAt: Date = new Date(),
): Promise<PlanMembershipRecoveryResult> {
  if (!isPlanId(planId)) return { ok: false, error: "not_found" };
  const uid = cleanUserId(userId);
  if (!uid || !memberToken) return { ok: false, error: "not_found" };
  if (!isSupabaseConfigured()) {
    const identity = recoverMemoryPlanMembership(planId, uid, memberToken);
    return identity
      ? { ok: true, identity }
      : { ok: false, error: "not_found" };
  }
  try {
    const { data, error } = await requireSupabaseAdmin().rpc(
      "recover_plan_account_membership_atomic",
      {
        p_plan_id: planId,
        p_user_id: uid,
        p_member_token_hash: hashPlanMemberToken(memberToken),
        p_recovered_at: recoveredAt.toISOString(),
      },
    );
    if (error) throw new Error(error.message);
    if (data !== "recovered" && data !== "replayed") {
      return {
        ok: false,
        error: data === "conflict" ? "conflict" : "not_found",
      };
    }
    const result = await planMemberIdentityResult(planId, memberToken);
    return result.ok && result.identity
      ? { ok: true, identity: result.identity }
      : { ok: false, error: result.ok ? "not_found" : "error" };
  } catch (error) {
    console.error(
      "[plans] membership recovery failed:",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, error: "error" };
  }
}

/** Stamp an auth user onto a crew member row. Idempotent for the same user. */
export async function linkPlanMemberUser(
  planId: string,
  memberId: string,
  userId: string,
): Promise<boolean> {
  if (!isPlanId(planId) || !isPlanId(memberId)) return false;
  const uid = cleanUserId(userId);
  if (!uid) return false;

  const outcome = await claimPlanMembership(planId, memberId, uid);
  return outcome === "claimed" || outcome === "already_claimed";
}

/** Claimed-member candidates already stamped on this plan (internal only). */
export async function listPlanMemberUserIds(
  planId: string,
): Promise<Array<{ memberId: string; userId: string }>> {
  if (!isPlanId(planId)) return [];
  if (!isSupabaseConfigured()) {
    return __listMemoryPlanMemberUserIds(planId);
  }
  try {
    const { data, error } = await requireSupabaseAdmin()
      .from(MEMBERS)
      .select("id,user_id")
      .eq("plan_id", planId)
      .not("user_id", "is", null);
    if (error) throw new Error(error.message);
    const out: Array<{ memberId: string; userId: string }> = [];
    for (const row of data ?? []) {
      const memberId = typeof row.id === "string" ? row.id : "";
      const userId = typeof row.user_id === "string" ? row.user_id : "";
      if (memberId && userId) out.push({ memberId, userId });
    }
    return out;
  } catch {
    return [];
  }
}
