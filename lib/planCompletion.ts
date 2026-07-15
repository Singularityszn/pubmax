import { createHash, randomUUID } from "node:crypto";
import type { CrawlEnding } from "@/lib/plan";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

export type PlanCompletion = {
  id: string;
  planId: string;
  ending: CrawlEnding;
  terminalVenueId: string | null;
  finalPintDropId: string | null;
  actorMemberId: string;
  completedAt: string;
};

const completions = new Map<string, PlanCompletion>();

function actorReference(token: string): string {
  const salt = process.env.PLAN_MEMBER_TOKEN_SALT ?? process.env.ACTOR_HASH_SALT ?? "pubmax-plan-member";
  return createHash("sha256").update(`${salt}:${token}`).digest("hex").slice(0, 24);
}

function fromRow(row: Record<string, unknown>): PlanCompletion {
  return { id: String(row.id), planId: String(row.plan_id), ending: row.ending as CrawlEnding, terminalVenueId: typeof row.terminal_venue_id === "string" ? row.terminal_venue_id : null, finalPintDropId: typeof row.final_pint_drop_id === "string" ? row.final_pint_drop_id : null, actorMemberId: String(row.actor_member_id), completedAt: String(row.completed_at) };
}

export async function getPlanCompletion(planId: string): Promise<PlanCompletion | null> {
  if (!isSupabaseConfigured()) return completions.get(planId) ?? null;
  const { data, error } = await requireSupabaseAdmin().from("plan_completions").select("*").eq("plan_id", planId).maybeSingle();
  return error || !data ? null : fromRow(data as Record<string, unknown>);
}

export async function completePlan(input: { planId: string; ending: CrawlEnding; memberToken: string; terminalVenueId?: string; finalPintDropId?: string }): Promise<PlanCompletion> {
  const existing = await getPlanCompletion(input.planId);
  if (existing) return existing;
  const completion: PlanCompletion = { id: randomUUID(), planId: input.planId, ending: input.ending, terminalVenueId: input.terminalVenueId ?? null, finalPintDropId: input.finalPintDropId ?? null, actorMemberId: actorReference(input.memberToken), completedAt: new Date().toISOString() };
  if (!isSupabaseConfigured()) { completions.set(input.planId, completion); return completion; }
  const { data, error } = await requireSupabaseAdmin().from("plan_completions").upsert({ id: completion.id, plan_id: completion.planId, ending: completion.ending, terminal_venue_id: completion.terminalVenueId, final_pint_drop_id: completion.finalPintDropId, actor_member_id: completion.actorMemberId, completed_at: completion.completedAt }, { onConflict: "plan_id" }).select("*").single();
  if (error || !data) throw new Error("Could not persist Plan completion.");
  return fromRow(data as Record<string, unknown>);
}
