import "server-only";

import { randomUUID } from "node:crypto";

import type { CrawlEnding, EndingSelection, PlanCompletionDTO } from "@/lib/plan";
import { completionFromRow } from "@/lib/planStore";
import { SocialCrewStoreError } from "@/lib/socialCrewStore";
import { requireSupabaseAdmin } from "@/lib/supabase";
import type { Database } from "@/types/database";

type CompletionInput = {
  actorAccountId: string;
  crewId: string;
  planId: string;
  expectedRouteRevision: number;
  arrivedStopPosition: number;
  ending: CrawlEnding;
  terminalVenueId: string | null;
  endingSelection: EndingSelection;
};

type CompletionResult = { completion: PlanCompletionDTO; created: boolean };
type CompletionRpcArgs = Database["public"]["Functions"]["complete_social_crew_plan_atomic"]["Args"];

type Dependencies = {
  rpc(input: CompletionRpcArgs): Promise<string>;
  completion(planId: string): Promise<PlanCompletionDTO | null>;
};

const defaultDependencies: Dependencies = {
  async rpc(input) {
    const { data, error } = await requireSupabaseAdmin().rpc("complete_social_crew_plan_atomic", input);
    if (error) throw new Error(error.message);
    return data as string;
  },
  async completion(planId) {
    const { data, error } = await requireSupabaseAdmin().from("plan_completions")
      .select("id,plan_id,ending,terminal_venue_id,ending_selection,final_pint_drop_id,route_revision,route_snapshot,qualifying_arrival_action_id,qualifying_arrival_stop_position,qualifying_arrival_at,completed_at")
      .eq("plan_id", planId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? completionFromRow(data as Record<string, unknown>) : null;
  },
};

export async function completeSocialCrewPlan(
  input: CompletionInput,
  dependencies: Dependencies = defaultDependencies,
): Promise<CompletionResult> {
  try {
    const code = await dependencies.rpc({
      p_actor_account_id: input.actorAccountId,
      p_crew_id: input.crewId,
      p_expected_route_revision: input.expectedRouteRevision,
      p_completion_id: randomUUID(),
      p_action_id: randomUUID(),
      p_arrival_action_id: randomUUID(),
      p_arrived_stop_position: input.arrivedStopPosition,
      p_ending: input.ending,
      p_terminal_venue_id: input.terminalVenueId,
      p_ending_selection: input.endingSelection,
      p_completed_at: new Date().toISOString(),
    });
    if (code === "not_found") {
      throw new SocialCrewStoreError("NOT_FOUND", 404, "Social Crew not found.");
    }
    if (code === "conflict") {
      throw new SocialCrewStoreError("CONFLICT", 409, "Social Crew changed before this request.");
    }
    if (code === "invalid") {
      throw new SocialCrewStoreError("INVALID", 422, "Social Crew completion is not valid.");
    }
    if (code !== "completed" && code !== "already_completed") throw new Error("Unknown completion result");
    const completion = await dependencies.completion(input.planId);
    if (!completion || completion.planId !== input.planId) throw new Error("Missing completion record");
    return { completion, created: code === "completed" };
  } catch (error) {
    if (error instanceof SocialCrewStoreError) throw error;
    throw new SocialCrewStoreError("UNAVAILABLE", 503, "Social Crew is unavailable right now.");
  }
}
