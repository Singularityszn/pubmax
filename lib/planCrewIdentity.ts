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
