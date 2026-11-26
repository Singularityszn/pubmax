import "server-only";

import { planScheduledEndMs } from "@/lib/inviteExpiry";
import { shortlistView, type PlanShortlist, type ShortlistMutation, type ShortlistView } from "@/lib/planShortlist";
import { mutateMemoryPlanShortlist, readMemoryPlanShortlist } from "@/lib/planStore";
import { admin, selectStore } from "@/lib/storeBackend";

const TABLE = "plan_shortlists";

type ShortlistRow = {
  organiser_id: string;
  options: PlanShortlist["options"];
  expires_at: string;
  confirmed: PlanShortlist["confirmed"];
  votes: PlanShortlist["votes"];
};

function fromRow(row: ShortlistRow): PlanShortlist {
  return { options: row.options, expiresAt: row.expires_at, confirmed: row.confirmed, votes: row.votes };
}

type ReadResult =
  | { status: "found"; view: ShortlistView; inviteToken: string; organiserId: string; expired: boolean }
  | { status: "missing" | "unavailable" };

export async function readPlanShortlist(id: string, token?: string, voterHash?: string): Promise<ReadResult> {
  try {
    const backend = selectStore("memory" as const, "supabase" as const);
    if (backend === "memory") {
      const record = readMemoryPlanShortlist(id, token);
      return record
        ? { status: "found", view: shortlistView(record.shortlist, voterHash), inviteToken: record.inviteToken, organiserId: record.organiserId, expired: Date.parse(record.shortlist.expiresAt) <= Date.now() }
        : { status: "missing" };
    }

    const query = admin().from(TABLE).select("organiser_id,options,expires_at,confirmed,votes,plans!inner(invite_token)")
      .eq("plan_id", id).is("plans.social_owner_account_id", null);
    if (token) query.eq("plans.invite_token", token);
    const { data, error } = await query.maybeSingle();
    // Existing Plans can render before the additive migration is applied.
    if (error?.code === "PGRST205" || error?.code === "42P01") return { status: "missing" };
    if (error) return { status: "unavailable" };
    if (!data) return { status: "missing" };
    const row = data as unknown as ShortlistRow & { plans: { invite_token: string } };
    return { status: "found", view: shortlistView(fromRow(row), voterHash), inviteToken: row.plans.invite_token, organiserId: row.organiser_id, expired: Date.parse(row.expires_at) <= Date.now() };
  } catch {
    return { status: "unavailable" };
  }
}

type MutationResult =
  | { status: "saved" | "unchanged"; view: ShortlistView }
  | { status: "invalid" | "closed" | "expired" | "full" | "missing" | "forbidden" | "unavailable" };

export async function mutatePlanShortlist(id: string, mutation: ShortlistMutation): Promise<MutationResult> {
  const voterHash = mutation.kind === "vote" ? mutation.voterHash : undefined;
  try {
    if (selectStore("memory" as const, "supabase" as const) === "memory") {
      const result = mutateMemoryPlanShortlist(id, mutation);
      return "shortlist" in result
        ? { status: result.status, view: shortlistView(result.shortlist, voterHash) }
        : { status: result.status };
    }

    const start = mutation.kind === "confirm" ? mutation.startTime : null;
    const end = start ? planScheduledEndMs(start) : null;
    const { data, error } = await admin().rpc("mutate_plan_shortlist_atomic", {
      p_plan_id: id,
      p_invite_token: mutation.kind === "vote" ? mutation.token : null,
      p_voter_hash: voterHash ?? null,
      p_host_id: mutation.kind === "confirm" ? mutation.hostId : null,
      p_venue_id: mutation.venueId,
      p_start_time: start,
      p_confirmed_expires_at: end === null ? null : new Date(end).toISOString(),
    });
    if (error || !data) return { status: "unavailable" };
    if (data.status === "saved" || data.status === "unchanged") {
      return { status: data.status, view: shortlistView(fromRow(data.shortlist), voterHash) };
    }
    return { status: data.status };
  } catch {
    return { status: "unavailable" };
  }
}
