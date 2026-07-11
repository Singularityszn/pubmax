import { createHash, randomBytes, randomUUID } from "node:crypto";

import { cleanCrewName, CREW_MAX_MEMBERS, isCrewPresenceStatus, type CrewMemberDTO, type CrewPresenceStatus } from "@/lib/crew";
import { cleanCreatePlan, isPlanId, type CreatePlanInput, type PlanDTO, type PlanState, type PlanStopDTO } from "@/lib/plan";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

const PLANS = "plans";
const STOPS = "plan_stops";
const MEMBERS = "plan_crew_members";

export type PlanWriteError = "invalid" | "not_found" | "full" | "forbidden" | "error";
export type PlanCreateResult = { ok: true; plan: PlanState; memberToken: string } | { ok: false; error: PlanWriteError };
export type PlanJoinResult = { ok: true; plan: PlanState; memberToken: string } | { ok: false; error: PlanWriteError };
export type PlanPresenceResult = { ok: true; plan: PlanState } | { ok: false; error: PlanWriteError };

export type PlanStore = {
  create(input: CreatePlanInput): Promise<PlanCreateResult>;
  get(id: string): Promise<PlanState | null>;
  join(id: string, name: unknown): Promise<PlanJoinResult>;
  updatePresence(id: string, memberToken: unknown, status: unknown): Promise<PlanPresenceResult>;
};

function mintToken(): string {
  return randomBytes(32).toString("hex");
}

function tokenHash(token: string): string {
  const salt = process.env.PLAN_MEMBER_TOKEN_SALT ?? process.env.ACTOR_HASH_SALT ?? "pubmax-plan-member";
  return createHash("sha256").update(`${salt}:${token}`).digest("hex");
}

function planFromRow(row: Record<string, unknown>): PlanDTO {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    startTime: String(row.start_time),
    createdAt: String(row.created_at),
  };
}

function stopFromRow(row: Record<string, unknown>): PlanStopDTO {
  return { venueId: String(row.venue_id), venueName: String(row.venue_name), position: Number(row.position) };
}

function memberFromRow(row: Record<string, unknown>): CrewMemberDTO {
  return {
    id: String(row.id),
    name: String(row.name),
    status: row.status as CrewPresenceStatus,
    joinedAt: String(row.joined_at),
    updatedAt: String(row.updated_at),
  };
}

export const supabasePlanStore: PlanStore = {
  async create(input) {
    const clean = cleanCreatePlan(input);
    if (!clean) return { ok: false, error: "invalid" };
    const id = randomUUID();
    const memberToken = mintToken();
    const memberId = randomUUID();
    const joinedAt = new Date().toISOString();
    try {
      const { error } = await requireSupabaseAdmin().rpc("create_plan_atomic", {
        p_id: id,
        p_title: clean.title,
        p_start_time: clean.startTime,
        p_stops: clean.stops,
        p_member_id: memberId,
        p_member_name: clean.creatorName,
        p_token_hash: tokenHash(memberToken),
        p_joined_at: joinedAt,
      });
      if (error) throw new Error(error.message);
      const plan = await this.get(id);
      return plan ? { ok: true, plan, memberToken } : { ok: false, error: "error" };
    } catch (error) {
      console.error("[plans] create failed:", error instanceof Error ? error.message : error);
      return { ok: false, error: "error" };
    }
  },

  async get(id) {
    if (!isPlanId(id)) return null;
    try {
      const admin = requireSupabaseAdmin();
      const { data: planRow, error } = await admin.from(PLANS)
        .select("id,title,start_time,created_at").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!planRow) return null;
      const [{ data: stopRows, error: stopsError }, { data: memberRows, error: membersError }] = await Promise.all([
        admin.from(STOPS).select("venue_id,venue_name,position").eq("plan_id", id).order("position"),
        admin.from(MEMBERS).select("id,name,status,joined_at,updated_at").eq("plan_id", id).order("joined_at"),
      ]);
      if (stopsError || membersError) throw new Error(stopsError?.message ?? membersError?.message);
      return {
        plan: planFromRow(planRow as Record<string, unknown>),
        stops: (stopRows ?? []).map((row) => stopFromRow(row as Record<string, unknown>)),
        crew: (memberRows ?? []).map((row) => memberFromRow(row as Record<string, unknown>)),
      };
    } catch (error) {
      console.error("[plans] read failed:", error instanceof Error ? error.message : error);
      return null;
    }
  },

  async join(id, rawName) {
    const name = cleanCrewName(rawName);
    if (!isPlanId(id) || !name) return { ok: false, error: "invalid" };
    const current = await this.get(id);
    if (!current) return { ok: false, error: "not_found" };
    if (current.crew.length >= CREW_MAX_MEMBERS) return { ok: false, error: "full" };
    const memberToken = mintToken();
    const joinedAt = new Date().toISOString();
    try {
      const { data, error } = await requireSupabaseAdmin().rpc("join_plan_atomic", {
        p_plan_id: id,
        p_member_id: randomUUID(),
        p_member_name: name,
        p_token_hash: tokenHash(memberToken),
        p_joined_at: joinedAt,
      });
      if (error) throw new Error(error.message);
      if (data !== true) return { ok: false, error: "full" };
      const plan = await this.get(id);
      return plan ? { ok: true, plan, memberToken } : { ok: false, error: "error" };
    } catch (error) {
      console.error("[plans] join failed:", error instanceof Error ? error.message : error);
      return { ok: false, error: "error" };
    }
  },

  async updatePresence(id, rawToken, rawStatus) {
    if (!isPlanId(id) || typeof rawToken !== "string" || !isCrewPresenceStatus(rawStatus)) {
      return { ok: false, error: "invalid" };
    }
    try {
      const { data, error } = await requireSupabaseAdmin().from(MEMBERS)
        .update({ status: rawStatus, updated_at: new Date().toISOString() })
        .eq("plan_id", id).eq("token_hash", tokenHash(rawToken)).select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { ok: false, error: "forbidden" };
      const plan = await this.get(id);
      return plan ? { ok: true, plan } : { ok: false, error: "not_found" };
    } catch (error) {
      console.error("[plans] presence failed:", error instanceof Error ? error.message : error);
      return { ok: false, error: "error" };
    }
  },
};

type MemoryMember = CrewMemberDTO & { tokenHash: string };
type MemoryPlan = { plan: PlanDTO; stops: PlanStopDTO[]; crew: MemoryMember[] };
const memoryPlans = new Map<string, MemoryPlan>();
let memorySequence = 0;

function publicState(value: MemoryPlan): PlanState {
  return {
    plan: { ...value.plan },
    stops: value.stops.map((stop) => ({ ...stop })).sort((a, b) => a.position - b.position),
    crew: value.crew.map((member) => ({
      id: member.id,
      name: member.name,
      status: member.status,
      joinedAt: member.joinedAt,
      updatedAt: member.updatedAt,
    }))
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
  };
}

function stamp(): string {
  memorySequence += 1;
  return new Date(Date.now() + memorySequence).toISOString();
}

export const memoryPlanStore: PlanStore = {
  async create(input) {
    const clean = cleanCreatePlan(input);
    if (!clean) return { ok: false, error: "invalid" };
    const id = randomUUID();
    const memberToken = mintToken();
    const createdAt = stamp();
    const plan: MemoryPlan = {
      plan: { id, title: clean.title, startTime: clean.startTime, createdAt },
      stops: clean.stops.map((stop, position) => ({ ...stop, position })),
      crew: [{
        id: randomUUID(), name: clean.creatorName, status: "in", joinedAt: createdAt,
        updatedAt: createdAt, tokenHash: tokenHash(memberToken),
      }],
    };
    memoryPlans.set(id, plan);
    return { ok: true, plan: publicState(plan), memberToken };
  },
  async get(id) {
    if (!isPlanId(id)) return null;
    const plan = memoryPlans.get(id);
    return plan ? publicState(plan) : null;
  },
  async join(id, rawName) {
    const name = cleanCrewName(rawName);
    if (!isPlanId(id) || !name) return { ok: false, error: "invalid" };
    const plan = memoryPlans.get(id);
    if (!plan) return { ok: false, error: "not_found" };
    if (plan.crew.length >= CREW_MAX_MEMBERS) return { ok: false, error: "full" };
    const memberToken = mintToken();
    const at = stamp();
    plan.crew.push({ id: randomUUID(), name, status: "in", joinedAt: at, updatedAt: at, tokenHash: tokenHash(memberToken) });
    return { ok: true, plan: publicState(plan), memberToken };
  },
  async updatePresence(id, rawToken, rawStatus) {
    if (!isPlanId(id) || typeof rawToken !== "string" || !isCrewPresenceStatus(rawStatus)) {
      return { ok: false, error: "invalid" };
    }
    const plan = memoryPlans.get(id);
    if (!plan) return { ok: false, error: "not_found" };
    const member = plan.crew.find((candidate) => candidate.tokenHash === tokenHash(rawToken));
    if (!member) return { ok: false, error: "forbidden" };
    member.status = rawStatus;
    member.updatedAt = stamp();
    return { ok: true, plan: publicState(plan) };
  },
};

export function planStore(): PlanStore {
  return isSupabaseConfigured() ? supabasePlanStore : memoryPlanStore;
}

export function __resetMemoryPlans(): void {
  memoryPlans.clear();
  memorySequence = 0;
}
