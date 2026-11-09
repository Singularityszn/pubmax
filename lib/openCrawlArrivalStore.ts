import "server-only";

import { type CrewMemberDTO, isCrewPresenceStatus } from "@/lib/crew";
import { londonDayKey } from "@/lib/pintContributions";
import { londonMsSinceMidnight } from "@/lib/londonHour";
import { OPEN_CRAWL_ARRIVAL_CLOSE_MS } from "@/lib/nightWindows";
import { planCrewArrivedReceipts } from "@/lib/planCrewArrived.server";
import { projectSocialCrewRead, type RawSocialCrew } from "@/lib/socialCrewProjection.server";
import type { SocialCrewStoreDependencies } from "@/lib/socialCrewStore";
import { SocialCrewStoreError } from "@/lib/socialCrewStoreError";
import type { SocialPostActor } from "@/lib/socialPostStore";
import { requireDynamicSupabaseAdmin } from "@/lib/supabase";

export type OpenCrawlPlanSeats = {
  read(planId: string): Promise<CrewMemberDTO[]>;
  markHere(planId: string, seatId: string, accountId: string): Promise<boolean>;
};

export const openCrawlPlanSeats: OpenCrawlPlanSeats = {
  async read(planId) {
    const { data, error } = await requireDynamicSupabaseAdmin().from("plan_crew_members")
      .select("id,name,status,joined_at,updated_at").eq("plan_id", planId)
      .order("joined_at").order("id");
    if (error || !data || data.some((seat) => !isCrewPresenceStatus(seat.status))) throw new Error("Arrival unavailable.");
    return data.map((seat) => ({
      id: seat.id, name: seat.name, status: seat.status as CrewMemberDTO["status"],
      joinedAt: seat.joined_at, updatedAt: seat.updated_at,
    }));
  },
  async markHere(planId, seatId, accountId) {
    const { data, error } = await requireDynamicSupabaseAdmin().from("plan_crew_members")
      .update({ status: "here", updated_at: new Date().toISOString() })
      .eq("plan_id", planId).eq("id", seatId).eq("social_account_id", accountId)
      .select("id");
    if (error) throw new Error("Arrival unavailable.");
    return data?.length === 1;
  },
};

function notFound(): never {
  throw new SocialCrewStoreError("NOT_FOUND", 404, "Social Crew not found.");
}

function arrivalContext(snapshot: unknown, crewId: string, actor: SocialPostActor) {
  if (!snapshot || typeof snapshot !== "object" || !("crew" in snapshot)) return notFound();
  const source = snapshot.crew;
  if (!source || typeof source !== "object" || !("visibility" in source) || source.visibility !== "open"
    || !("members" in source) || !Array.isArray(source.members)
    || !source.members.some((member) => member?.accountId === actor.accountId
      && member?.profileId === actor.profileId && member?.state === "active")) return notFound();
  const projected = projectSocialCrewRead(snapshot, actor);
  if (projected?.kind !== "member" || projected.crewId !== crewId || projected.visibility !== "open") return notFound();
  // The projection validates the raw membership before its private provenance is used.
  const raw = snapshot.crew as RawSocialCrew;
  const member = raw.members.find((member) => member.memberId === projected.viewer.memberId);
  if (!member || member.state !== "active") return notFound();
  return { projected, raw, member };
}

function openCrawlArrivalWindow(startTime: string, now = new Date()) {
  const start = Date.parse(startTime);
  if (!Number.isFinite(start)) return { open: false, refreshAt: null };
  const midnight = new Date(`${londonDayKey(startTime)}T00:00:00Z`);
  const opensAt = midnight.getTime() - londonMsSinceMidnight(midnight);
  const closesAt = start + OPEN_CRAWL_ARRIVAL_CLOSE_MS;
  return {
    open: now.getTime() >= opensAt && now.getTime() < closesAt,
    refreshAt: now.getTime() < opensAt ? opensAt : now.getTime() < closesAt ? closesAt : null,
  };
}

export async function readOpenCrawlArrival(
  snapshot: unknown, crewId: string, actor: SocialPostActor, seats: OpenCrawlPlanSeats,
) {
  const { projected, member } = arrivalContext(snapshot, crewId, actor);
  const roster = await seats.read(projected.plan.plan.id);
  const seat = roster.find((seat) => seat.id === member.planMemberId);
  if (!seat) return notFound();
  return { ...openCrawlArrivalWindow(projected.startsAt), here: seat.status === "here" };
}

export async function markOpenCrawlArrival(
  dependencies: SocialCrewStoreDependencies, actor: SocialPostActor, input: { crewId: string; here: true },
) {
  try {
    if (input.here !== true) throw new SocialCrewStoreError("INVALID", 400, "Arrival is not valid.");
    const snapshot = () => dependencies.snapshot("read_social_crew_snapshot", {
      p_viewer_account_id: actor.accountId, p_viewer_profile_id: actor.profileId, p_crew_id: input.crewId,
    });
    const { projected, member } = arrivalContext(await snapshot(), input.crewId, actor);
    if (!openCrawlArrivalWindow(projected.startsAt).open) {
      throw new SocialCrewStoreError("CONFLICT", 409, "Arrival is closed.");
    }
    const seats = dependencies.planSeats;
    if (!seats) throw new Error("Arrival unavailable.");
    if (!await seats.markHere(projected.plan.plan.id, member.planMemberId, actor.accountId)) return notFound();
    const current = arrivalContext(await snapshot(), input.crewId, actor);
    const roster = await seats.read(projected.plan.plan.id);
    const active = new Set(current.raw.members.filter((member) => member.state === "active").map((member) => member.planMemberId));
    // Keep the original first seat as host, including after an ownership transfer.
    const crew = roster.filter((seat, index) => index === 0 || active.has(seat.id));
    return { here: true as const, crewArrived: planCrewArrivedReceipts({ ...projected.plan, crew }) };
  } catch (error) {
    if (error instanceof SocialCrewStoreError) throw error;
    throw new SocialCrewStoreError("UNAVAILABLE", 503, "Social Crew is unavailable right now.");
  }
}
