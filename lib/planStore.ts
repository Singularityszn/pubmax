import { createHash, randomBytes, randomUUID } from "node:crypto";

import { cleanCrewName, CREW_MAX_MEMBERS, isCrewPresenceStatus, type CrewMemberDTO, type CrewPresenceStatus } from "@/lib/crew";
import { canTransitionPlannedNight, cleanCreatePlan, isPlanId, PLANNED_NIGHT_STATUSES, type CrawlEnding, type CreatePlanInput, type PlanActionDTO, type PlanDTO, type PlannedNightStatus, type PlanState, type PlanStopDTO } from "@/lib/plan";
import type { NightContext } from "@/lib/nightPlanning";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

const PLANS = "plans";
const STOPS = "plan_stops";
const MEMBERS = "plan_crew_members";
const ACTIONS = "plan_actions";

export type PlanWriteError = "invalid" | "not_found" | "full" | "forbidden" | "error";
export type PlanCreateResult = { ok: true; plan: PlanState; memberToken: string } | { ok: false; error: PlanWriteError };
export type PlanJoinResult = { ok: true; plan: PlanState; memberToken: string } | { ok: false; error: PlanWriteError };
export type PlanPresenceResult = { ok: true; plan: PlanState } | { ok: false; error: PlanWriteError };
export type PlanUpdateResult = PlanPresenceResult;

export type PlanStore = {
  create(input: CreatePlanInput): Promise<PlanCreateResult>;
  get(id: string): Promise<PlanState | null>;
  join(id: string, name: unknown): Promise<PlanJoinResult>;
  updatePresence(id: string, memberToken: unknown, status: unknown): Promise<PlanPresenceResult>;
  update(id: string, memberToken: unknown, update: { status?: PlannedNightStatus; context?: NightContext }): Promise<PlanUpdateResult>;
  addAction(id: string, memberToken: unknown, action: { type: PlanActionDTO["type"]; stopPosition?: number; ending?: CrawlEnding }): Promise<PlanUpdateResult>;
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
    status: (row.status as PlannedNightStatus) ?? "draft",
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
        .select("id,title,start_time,created_at,status,night_context,ending").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!planRow) return null;
      const [{ data: stopRows, error: stopsError }, { data: memberRows, error: membersError }, { data: actionRows, error: actionsError }] = await Promise.all([
        admin.from(STOPS).select("venue_id,venue_name,position").eq("plan_id", id).order("position"),
        admin.from(MEMBERS).select("id,name,status,joined_at,updated_at").eq("plan_id", id).order("joined_at"),
        admin.from(ACTIONS).select("id,type,stop_position,ending,created_at").eq("plan_id", id).order("created_at"),
      ]);
      if (stopsError || membersError || actionsError) throw new Error(stopsError?.message ?? membersError?.message ?? actionsError?.message);
      return {
        plan: planFromRow(planRow as Record<string, unknown>),
        stops: (stopRows ?? []).map((row) => stopFromRow(row as Record<string, unknown>)),
        crew: (memberRows ?? []).map((row) => memberFromRow(row as Record<string, unknown>)),
        context: (planRow as Record<string, unknown>).night_context as NightContext | null ?? null,
        actions: (actionRows ?? []).map((row) => ({ id: String(row.id), type: row.type as PlanActionDTO["type"], stopPosition: row.stop_position as number | null, ending: row.ending as CrawlEnding | null, createdAt: String(row.created_at) })),
        ending: (planRow as Record<string, unknown>).ending as CrawlEnding | null ?? null,
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
  async update(id, rawToken, update) {
    if (!isPlanId(id) || typeof rawToken !== "string") return { ok: false, error: "invalid" };
    const admin = requireSupabaseAdmin();
    const [{ data: creator }, current] = await Promise.all([
      admin.from(MEMBERS).select("id,token_hash").eq("plan_id", id).order("joined_at").limit(1).maybeSingle(),
      this.get(id),
    ]);
    if (!creator || creator.token_hash !== tokenHash(rawToken)) return { ok: false, error: "forbidden" };
    if (!current) return { ok: false, error: "not_found" };
    if (update.status && !canTransitionPlannedNight(current.plan.status ?? "draft", update.status)) return { ok: false, error: "invalid" };
    const values: Record<string, unknown> = {};
    if (update.status && PLANNED_NIGHT_STATUSES.includes(update.status)) values.status = update.status;
    if (update.context) values.night_context = update.context;
    const { error } = await admin.from(PLANS).update(values).eq("id", id);
    if (error) return { ok: false, error: "error" };
    const plan = await this.get(id);
    return plan ? { ok: true, plan } : { ok: false, error: "not_found" };
  },
  async addAction(id, rawToken, action) {
    if (!isPlanId(id) || typeof rawToken !== "string") return { ok: false, error: "invalid" };
    const admin = requireSupabaseAdmin();
    const { data: member } = await admin.from(MEMBERS).select("id").eq("plan_id", id).eq("token_hash", tokenHash(rawToken)).maybeSingle();
    if (!member) return { ok: false, error: "forbidden" };
    const createdAt = new Date().toISOString();
    const { error } = await admin.from(ACTIONS).insert({ id: randomUUID(), plan_id: id, actor_member_id: member.id, type: action.type, stop_position: action.stopPosition ?? null, ending: action.ending ?? null, created_at: createdAt });
    if (error) return { ok: false, error: "error" };
    if (action.type === "ending") await admin.from(PLANS).update({ status: "completed", ending: action.ending }).eq("id", id);
    else await admin.from(PLANS).update({ status: "active" }).eq("id", id).in("status", ["draft", "ready"]);
    const plan = await this.get(id);
    return plan ? { ok: true, plan } : { ok: false, error: "not_found" };
  },
};

type MemoryMember = CrewMemberDTO & { tokenHash: string };
type MemoryPlan = { plan: PlanDTO; stops: PlanStopDTO[]; crew: MemoryMember[]; context: NightContext | null; actions: PlanActionDTO[]; ending: CrawlEnding | null };
type PlanMemoryState = { plans: Map<string, MemoryPlan>; sequence: number };
const planMemoryGlobal = globalThis as typeof globalThis & {
  __pubmaxPlanMemory?: PlanMemoryState;
};
const planMemory = planMemoryGlobal.__pubmaxPlanMemory ??= {
  plans: new Map<string, MemoryPlan>(),
  sequence: 0,
};
const memoryPlans = planMemory.plans;

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
    context: value.context ? structuredClone(value.context) : null,
    actions: value.actions.map((action) => ({ ...action })),
    ending: value.ending,
  };
}

function stamp(): string {
  planMemory.sequence += 1;
  return new Date(Date.now() + planMemory.sequence).toISOString();
}

export const memoryPlanStore: PlanStore = {
  async create(input) {
    const clean = cleanCreatePlan(input);
    if (!clean) return { ok: false, error: "invalid" };
    const id = randomUUID();
    const memberToken = mintToken();
    const createdAt = stamp();
    const plan: MemoryPlan = {
      plan: { id, title: clean.title, startTime: clean.startTime, createdAt, status: "draft" },
      stops: clean.stops.map((stop, position) => ({ ...stop, position })),
      crew: [{
        id: randomUUID(), name: clean.creatorName, status: "in", joinedAt: createdAt,
        updatedAt: createdAt, tokenHash: tokenHash(memberToken),
      }],
      context: null,
      actions: [],
      ending: null,
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
  async update(id, rawToken, update) {
    if (!isPlanId(id) || typeof rawToken !== "string") return { ok: false, error: "invalid" };
    const plan = memoryPlans.get(id);
    if (!plan) return { ok: false, error: "not_found" };
    if (plan.crew[0]?.tokenHash !== tokenHash(rawToken)) return { ok: false, error: "forbidden" };
    if (update.status && !canTransitionPlannedNight(plan.plan.status ?? "draft", update.status)) return { ok: false, error: "invalid" };
    if (update.status) plan.plan.status = update.status;
    if (update.context) plan.context = structuredClone(update.context);
    return { ok: true, plan: publicState(plan) };
  },
  async addAction(id, rawToken, action) {
    if (!isPlanId(id) || typeof rawToken !== "string") return { ok: false, error: "invalid" };
    const plan = memoryPlans.get(id);
    if (!plan) return { ok: false, error: "not_found" };
    if (!plan.crew.some((candidate) => candidate.tokenHash === tokenHash(rawToken))) return { ok: false, error: "forbidden" };
    plan.actions.push({ id: randomUUID(), type: action.type, stopPosition: action.stopPosition ?? null, ending: action.ending ?? null, createdAt: stamp() });
    if (action.type === "ending") { plan.plan.status = "completed"; plan.ending = action.ending ?? null; }
    else if (plan.plan.status === "draft" || plan.plan.status === "ready") plan.plan.status = "active";
    return { ok: true, plan: publicState(plan) };
  },
};

export function planStore(): PlanStore {
  return isSupabaseConfigured() ? supabasePlanStore : memoryPlanStore;
}

export function __resetMemoryPlans(): void {
  memoryPlans.clear();
  planMemory.sequence = 0;
}
