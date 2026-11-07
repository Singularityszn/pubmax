import "server-only";

// THE OLD INVITE LINK FOLLOWS THE PLAN (launch plan P0 #5). "Open it up" turns a
// plan into an Open Crew (migration 0208), and from then on the plan is
// Crew-bound, so the invite page reads it as gone. A host who already posted
// that invite (on WhatsApp, X or Luma) would lose every click. The invite page
// asks this module for the open crew that now carries the plan and sends the
// reader there.
//
// Only an OPEN crew is answered. A private crew's page is for its members, so
// a plan that became one keeps reading as "not valid" and never says the crew
// exists. One plan carries at most one crew (social_crews.plan_id is unique).

import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

export type OpenCrawlForPlanResult = { ok: true; crewId: string | null } | { ok: false };

export type OpenCrawlInviteDependencies = {
  /** The open crew row for the plan, or null when there is none. Throws on a failed read. */
  readOpenCrewId(planId: string): Promise<string | null>;
};

const defaultDependencies: OpenCrawlInviteDependencies = {
  async readOpenCrewId(planId) {
    const { data, error } = await requireSupabaseAdmin()
      .from("social_crews")
      .select("id")
      .eq("plan_id", planId)
      .eq("visibility", "open")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? String(data.id) : null;
  },
};

/**
 * The open crew that carries this plan, if any. Keyless dev holds no crews, so
 * it answers none. A failed read is `{ ok: false }`, never a guess.
 */
export async function openCrawlCrewIdForPlan(
  planId: string,
  dependencies?: OpenCrawlInviteDependencies,
): Promise<OpenCrawlForPlanResult> {
  if (!dependencies && !isSupabaseConfigured()) return { ok: true, crewId: null };
  try {
    return { ok: true, crewId: await (dependencies ?? defaultDependencies).readOpenCrewId(planId) };
  } catch {
    return { ok: false };
  }
}
