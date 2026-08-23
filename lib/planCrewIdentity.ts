import "server-only";

// Internal plan-crew ↔ auth user linkage for friend-graph formation (WP7).
//
// plan_crew_members.user_id and plans.owner_user_id already exist (migration
// 0024) but classic join/create never stamped them. Public PlanState still
// never exposes user ids - this module is the only write/read seam for them.

import { isPlanId } from "@/lib/plan";
import {
  __linkMemoryPlanMemberUser,
  __listMemoryPlanMemberUserIds,
  __setMemoryPlanOwnerUserId,
} from "@/lib/planStore";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

const MEMBERS = "plan_crew_members";
const PLANS = "plans";

function cleanUserId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

  if (!isSupabaseConfigured()) {
    return __linkMemoryPlanMemberUser(planId, memberId, uid);
  }
  try {
    const { data, error } = await requireSupabaseAdmin()
      .from(MEMBERS)
      .update({ user_id: uid })
      .eq("plan_id", planId)
      .eq("id", memberId)
      .is("user_id", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return true;
    // Already linked to this user counts as success; a different user is refused.
    const existing = await requireSupabaseAdmin()
      .from(MEMBERS)
      .select("user_id")
      .eq("plan_id", planId)
      .eq("id", memberId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    return existing.data?.user_id === uid;
  } catch {
    return false;
  }
}

/** Stamp the plan owner when the host creates while signed in. */
export async function linkPlanOwnerUser(
  planId: string,
  userId: string,
): Promise<boolean> {
  if (!isPlanId(planId)) return false;
  const uid = cleanUserId(userId);
  if (!uid) return false;

  if (!isSupabaseConfigured()) {
    return __setMemoryPlanOwnerUserId(planId, uid);
  }
  try {
    const { data, error } = await requireSupabaseAdmin()
      .from(PLANS)
      .update({ owner_user_id: uid })
      .eq("id", planId)
      .is("owner_user_id", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return true;
    const existing = await requireSupabaseAdmin()
      .from(PLANS)
      .select("owner_user_id")
      .eq("id", planId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    return existing.data?.owner_user_id === uid;
  } catch {
    return false;
  }
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
