import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import { cleanCrewName, CREW_MAX_MEMBERS, isCrewPresenceStatus, type CrewMemberDTO, type CrewPresenceStatus } from "@/lib/crew";
import { canTransitionPlannedNight, cleanCreatePlan, isPlanId, PLANNED_NIGHT_STATUSES, type CrawlEnding, type CreatePlanInput, type PlanActionDTO, type PlanCompletionDTO, type PlanDTO, type PlanMemberRole, type PlannedNightStatus, type PlanState, type PlanStopDTO } from "@/lib/plan";
import type { NightContext } from "@/lib/nightPlanning";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

const PLANS = "plans";
const STOPS = "plan_stops";
const MEMBERS = "plan_crew_members";
const ACTIONS = "plan_actions";
const COMPLETIONS = "plan_completions";

export type PlanWriteError = "invalid" | "not_found" | "full" | "forbidden" | "conflict" | "error";
export type PlanCreateResult = { ok: true; plan: PlanState; memberToken: string; role: "host" } | { ok: false; error: PlanWriteError };
export type PlanJoinResult = { ok: true; plan: PlanState; memberToken: string; role: "guest"; collaborationAuthorized: boolean } | { ok: false; error: PlanWriteError };
export type PlanPresenceResult = { ok: true; plan: PlanState } | { ok: false; error: PlanWriteError };
export type PlanUpdateResult = PlanPresenceResult;
export type PlanCompletionResult =
  | { ok: true; plan: PlanState; completion: PlanCompletionDTO; created: boolean }
  | { ok: false; error: PlanWriteError };

export type PlanStore = {
  create(input: CreatePlanInput, options?: { idempotencyKey?: string }): Promise<PlanCreateResult>;
  get(id: string): Promise<PlanState | null>;
  join(id: string, name: unknown, options?: { collaborationAuthorized?: boolean; idempotencyKey?: string }): Promise<PlanJoinResult>;
  updatePresence(id: string, memberToken: unknown, status: unknown): Promise<PlanPresenceResult>;
  update(id: string, memberToken: unknown, update: { status?: PlannedNightStatus; context?: NightContext; stops?: PlanStopDTO[]; expectedRouteRevision?: number }): Promise<PlanUpdateResult>;
  addAction(id: string, memberToken: unknown, action: { type: PlanActionDTO["type"]; stopPosition?: number; ending?: CrawlEnding; idempotencyKey?: string }): Promise<PlanUpdateResult>;
  getCompletion(id: string): Promise<PlanCompletionDTO | null>;
  complete(id: string, memberToken: unknown, input: { expectedRouteRevision: number; ending: CrawlEnding; terminalVenueId?: string }): Promise<PlanCompletionResult>;
};

export function mintPlanMemberToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashPlanMemberToken(token: string): string {
  const salt = process.env.PLAN_MEMBER_TOKEN_SALT ?? process.env.ACTOR_HASH_SALT ?? "pubmax-plan-member";
  return createHash("sha256").update(`${salt}:${token}`).digest("hex");
}

export function isPlanIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 8 && value.trim().length <= 120;
}

export function planIdempotencyDigest(scope: string, key: string): string {
  const salt = process.env.PLAN_IDEMPOTENCY_SECRET ?? process.env.RATE_LIMIT_SALT ?? process.env.PLAN_MEMBER_TOKEN_SALT ?? "pubmax-plan-idempotency";
  return createHmac("sha256", salt).update(`${scope}:${key.trim()}`).digest("hex");
}

export function planIdempotentUuid(scope: string, key: string): string {
  const value = planIdempotencyDigest(scope, key).slice(0, 32).split("");
  value[12] = "4";
  value[16] = ((Number.parseInt(value[16]!, 16) & 0x3) | 0x8).toString(16);
  const hex = value.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function planRequestDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function planFromRow(row: Record<string, unknown>): PlanDTO {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    startTime: String(row.start_time),
    createdAt: String(row.created_at),
    routeRevision: Number(row.route_revision ?? 1),
    status: (row.status as PlannedNightStatus) ?? "draft",
  };
}

function completionFromRow(row: Record<string, unknown>): PlanCompletionDTO {
  const snapshot = Array.isArray(row.route_snapshot) ? row.route_snapshot : [];
  return {
    id: String(row.id),
    planId: String(row.plan_id),
    ending: row.ending as CrawlEnding,
    terminalVenueId: typeof row.terminal_venue_id === "string" ? row.terminal_venue_id : null,
    finalPintDropId: typeof row.final_pint_drop_id === "string" ? row.final_pint_drop_id : null,
    routeRevision: Number(row.route_revision ?? 1),
    routeSnapshot: snapshot.map((stop) => stopFromRow({
      venue_id: (stop as Record<string, unknown>).venueId,
      venue_name: (stop as Record<string, unknown>).venueName,
      position: (stop as Record<string, unknown>).position,
    })).sort((a, b) => a.position - b.position),
    completedAt: String(row.completed_at),
  };
}

function cleanReplacementStops(stops: PlanStopDTO[] | undefined): PlanStopDTO[] | null {
  if (!stops || stops.length !== 3) return null;
  if (new Set(stops.map((stop) => stop.venueId)).size !== stops.length) return null;
  if (stops.some((stop, position) => !stop.venueId || !stop.venueName || stop.position !== position)) return null;
  return stops.map((stop) => ({ ...stop }));
}

function routeRevisionOf(plan: PlanDTO): number {
  return typeof plan.routeRevision === "number" && Number.isInteger(plan.routeRevision) && plan.routeRevision >= 1
    ? plan.routeRevision
    : 1;
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
  async create(input, options = {}) {
    const clean = cleanCreatePlan(input);
    if (!clean) return { ok: false, error: "invalid" };
    const key = isPlanIdempotencyKey(options.idempotencyKey) ? options.idempotencyKey.trim() : randomUUID();
    const keyHash = planIdempotencyDigest("plan-create-key", key);
    const requestHash = planRequestDigest(clean);
    const id = planIdempotentUuid("plan-create-id", key);
    const memberToken = planIdempotencyDigest("plan-create-token", key);
    const memberId = planIdempotentUuid("plan-create-member", key);
    const joinedAt = new Date().toISOString();
    try {
      const { data, error } = await requireSupabaseAdmin().rpc("create_plan_idempotent_atomic", {
        p_id: id,
        p_title: clean.title,
        p_start_time: clean.startTime,
        p_stops: clean.stops,
        p_member_id: memberId,
        p_member_name: clean.creatorName,
        p_token_hash: hashPlanMemberToken(memberToken),
        p_joined_at: joinedAt,
        p_idempotency_key_hash: keyHash,
        p_request_hash: requestHash,
      });
      if (error) throw new Error(error.message);
      if (data === "conflict") return { ok: false, error: "conflict" };
      if (data !== "created" && data !== "replayed") return { ok: false, error: "error" };
      const plan = await this.get(id);
      return plan ? { ok: true, plan, memberToken, role: "host" } : { ok: false, error: "error" };
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
        .select("id,title,start_time,created_at,status,route_revision,night_context,ending").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!planRow) return null;
      const [{ data: stopRows, error: stopsError }, { data: memberRows, error: membersError }, { data: actionRows, error: actionsError }] = await Promise.all([
        admin.from(STOPS).select("venue_id,venue_name,position").eq("plan_id", id).order("position"),
        admin.from(MEMBERS).select("id,name,status,joined_at,updated_at").eq("plan_id", id).order("joined_at").order("id"),
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

  async join(id, rawName, options = {}) {
    const name = cleanCrewName(rawName);
    if (!isPlanId(id) || !name) return { ok: false, error: "invalid" };
    const lookup = await planStateResult(id);
    if (!lookup.ok) return { ok: false, error: "error" };
    const current = lookup.plan;
    if (!current) return { ok: false, error: "not_found" };
    const key = isPlanIdempotencyKey(options.idempotencyKey) ? options.idempotencyKey.trim() : randomUUID();
    const keyHash = planIdempotencyDigest(`plan-join-key:${id}`, key);
    const requestHash = planRequestDigest({ name, collaborationAuthorized: options.collaborationAuthorized === true });
    const memberToken = planIdempotencyDigest(`plan-join-token:${id}`, key);
    const memberId = planIdempotentUuid(`plan-join-member:${id}`, key);
    const joinedAt = new Date().toISOString();
    try {
      const { data, error } = await requireSupabaseAdmin().rpc("join_plan_idempotent_atomic", {
        p_plan_id: id,
        p_member_id: memberId,
        p_member_name: name,
        p_token_hash: hashPlanMemberToken(memberToken),
        p_joined_at: joinedAt,
        p_can_collaborate: options.collaborationAuthorized === true,
        p_idempotency_key_hash: keyHash,
        p_request_hash: requestHash,
      });
      if (error) throw new Error(error.message);
      if (data === "full") return { ok: false, error: "full" };
      if (data === "conflict") return { ok: false, error: "conflict" };
      if (data === "not_found") return { ok: false, error: "not_found" };
      if (data !== "joined" && data !== "replayed") return { ok: false, error: "error" };
      const plan = await this.get(id);
      return plan ? { ok: true, plan, memberToken, role: "guest", collaborationAuthorized: options.collaborationAuthorized === true } : { ok: false, error: "error" };
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
        .eq("plan_id", id).eq("token_hash", hashPlanMemberToken(rawToken)).select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { ok: false, error: "forbidden" };
      const plan = await this.get(id);
      return plan ? { ok: true, plan } : { ok: false, error: "error" };
    } catch (error) {
      console.error("[plans] presence failed:", error instanceof Error ? error.message : error);
      return { ok: false, error: "error" };
    }
  },
  async update(id, rawToken, update) {
    if (!isPlanId(id) || typeof rawToken !== "string") return { ok: false, error: "invalid" };
    const admin = requireSupabaseAdmin();
    if (update.stops) {
      const stops = cleanReplacementStops(update.stops);
      if (!stops || !Number.isInteger(update.expectedRouteRevision) || update.expectedRouteRevision! < 1 || update.status) return { ok: false, error: "invalid" };
      try {
        const { data, error } = await admin.rpc("replace_plan_route_atomic", {
          p_plan_id: id,
          p_token_hash: hashPlanMemberToken(rawToken),
          p_expected_route_revision: update.expectedRouteRevision,
          p_stops: stops.map(({ venueId, venueName }) => ({ venueId, venueName })),
          p_context: update.context ?? null,
        });
        if (error) throw new Error(error.message);
        if (data !== "ok") return { ok: false, error: data === "forbidden" ? "forbidden" : data === "conflict" ? "conflict" : "invalid" };
        const plan = await this.get(id);
        return plan ? { ok: true, plan } : { ok: false, error: "error" };
      } catch (error) {
        console.error("[plans] route replacement failed:", error instanceof Error ? error.message : error);
        return { ok: false, error: "error" };
      }
    }
    const [creatorResult, currentResult] = await Promise.all([
      admin.from(MEMBERS).select("id,token_hash").eq("plan_id", id).order("joined_at").order("id").limit(1).maybeSingle(),
      planStateResult(id),
    ]);
    if (creatorResult.error || !currentResult.ok) return { ok: false, error: "error" };
    const creator = creatorResult.data;
    const current = currentResult.plan;
    if (!creator || creator.token_hash !== hashPlanMemberToken(rawToken)) return { ok: false, error: "forbidden" };
    if (!current) return { ok: false, error: "not_found" };
    if (update.status && !canTransitionPlannedNight(current.plan.status ?? "draft", update.status)) return { ok: false, error: "invalid" };
    const values: Record<string, unknown> = {};
    if (update.status && PLANNED_NIGHT_STATUSES.includes(update.status)) values.status = update.status;
    if (update.context) values.night_context = update.context;
    const { error } = await admin.from(PLANS).update(values).eq("id", id);
    if (error) return { ok: false, error: "error" };
    const plan = await this.get(id);
    return plan ? { ok: true, plan } : { ok: false, error: "error" };
  },
  async addAction(id, rawToken, action) {
    if (!isPlanId(id) || typeof rawToken !== "string" || !isPlanIdempotencyKey(action.idempotencyKey)) return { ok: false, error: "invalid" };
    // Completion is intentionally not an ordinary action write: it must insert
    // the ending action, completion record, and terminal status atomically.
    if (action.type === "ending") return { ok: false, error: "invalid" };
    const identityResult = await planMemberIdentityResult(id, rawToken);
    if (!identityResult.ok) return { ok: false, error: "error" };
    const identity = identityResult.identity;
    if (!identity?.collaborationAuthorized || (action.type === "swapped" && identity.role !== "host")) return { ok: false, error: "forbidden" };
    const key = action.idempotencyKey.trim();
    const requestHash = planRequestDigest({ type: action.type, stopPosition: action.stopPosition ?? null });
    const createdAt = new Date().toISOString();
    const { data, error } = await requireSupabaseAdmin().rpc("add_plan_action_idempotent_atomic", {
      p_plan_id: id,
      p_token_hash: hashPlanMemberToken(rawToken),
      p_action_id: planIdempotentUuid(`plan-action:${id}:${identity.memberId}`, key),
      p_type: action.type,
      p_stop_position: action.stopPosition ?? null,
      p_idempotency_key_hash: planIdempotencyDigest(`plan-action-key:${id}`, key),
      p_request_hash: requestHash,
      p_created_at: createdAt,
    });
    if (error) return { ok: false, error: "error" };
    if (data === "forbidden") return { ok: false, error: "forbidden" };
    if (data === "not_found") return { ok: false, error: "not_found" };
    if (data === "conflict") return { ok: false, error: "conflict" };
    if (data !== "applied" && data !== "replayed") return { ok: false, error: "error" };
    const plan = await this.get(id);
    return plan ? { ok: true, plan } : { ok: false, error: "error" };
  },
  async getCompletion(id) {
    if (!isPlanId(id)) return null;
    try {
      const { data, error } = await requireSupabaseAdmin().from(COMPLETIONS)
        .select("id,plan_id,ending,terminal_venue_id,final_pint_drop_id,route_revision,route_snapshot,completed_at")
        .eq("plan_id", id).maybeSingle();
      return error || !data ? null : completionFromRow(data as Record<string, unknown>);
    } catch {
      return null;
    }
  },
  async complete(id, rawToken, input) {
    if (!isPlanId(id) || typeof rawToken !== "string" || !Number.isInteger(input.expectedRouteRevision) || input.expectedRouteRevision < 1) return { ok: false, error: "invalid" };
    const identityResult = await planMemberIdentityResult(id, rawToken);
    if (!identityResult.ok) return { ok: false, error: "error" };
    if (identityResult.identity?.role !== "host") return { ok: false, error: "forbidden" };
    try {
      const { data, error } = await requireSupabaseAdmin().rpc("complete_plan_atomic", {
        p_plan_id: id,
        p_token_hash: hashPlanMemberToken(rawToken),
        p_expected_route_revision: input.expectedRouteRevision,
        p_completion_id: randomUUID(),
        p_action_id: randomUUID(),
        p_ending: input.ending,
        p_terminal_venue_id: input.terminalVenueId ?? null,
        p_completed_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      if (data !== "completed" && data !== "already_completed") return { ok: false, error: data === "forbidden" ? "forbidden" : data === "conflict" ? "conflict" : data === "not_found" ? "not_found" : "invalid" };
      const [plan, completion] = await Promise.all([this.get(id), this.getCompletion(id)]);
      return plan && completion ? { ok: true, plan, completion, created: data === "completed" } : { ok: false, error: "error" };
    } catch (error) {
      console.error("[plans] completion failed:", error instanceof Error ? error.message : error);
      return { ok: false, error: "error" };
    }
  },
};

type MemoryMember = CrewMemberDTO & { tokenHash: string; collaborationAuthorized: boolean };
type StoredCompletion = PlanCompletionDTO & { actorMemberId: string };
function publicCompletion(completion: StoredCompletion): PlanCompletionDTO {
  return {
    id: completion.id,
    planId: completion.planId,
    ending: completion.ending,
    terminalVenueId: completion.terminalVenueId,
    finalPintDropId: completion.finalPintDropId,
    routeRevision: completion.routeRevision,
    routeSnapshot: completion.routeSnapshot.map((stop) => ({ ...stop })),
    completedAt: completion.completedAt,
  };
}
type MemoryPlan = { plan: PlanDTO; stops: PlanStopDTO[]; crew: MemoryMember[]; context: NightContext | null; actions: PlanActionDTO[]; ending: CrawlEnding | null; completion: StoredCompletion | null };
type PlanMemoryState = {
  plans: Map<string, MemoryPlan>;
  sequence: number;
  createRequests: Map<string, { requestHash: string; planId: string }>;
  joinRequests: Map<string, { requestHash: string; memberId: string }>;
  actionRequests: Map<string, { requestHash: string; actionId: string }>;
};
const planMemoryGlobal = globalThis as typeof globalThis & {
  __pubmaxPlanMemory?: PlanMemoryState;
};
const planMemory = planMemoryGlobal.__pubmaxPlanMemory ??= {
  plans: new Map<string, MemoryPlan>(),
  sequence: 0,
  createRequests: new Map(),
  joinRequests: new Map(),
  actionRequests: new Map(),
};
planMemory.createRequests ??= new Map();
planMemory.joinRequests ??= new Map();
planMemory.actionRequests ??= new Map();
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
  async create(input, options = {}) {
    const clean = cleanCreatePlan(input);
    if (!clean) return { ok: false, error: "invalid" };
    const key = isPlanIdempotencyKey(options.idempotencyKey) ? options.idempotencyKey.trim() : randomUUID();
    const keyHash = planIdempotencyDigest("plan-create-key", key);
    const requestHash = planRequestDigest(clean);
    const replay = planMemory.createRequests.get(keyHash);
    if (replay) {
      if (replay.requestHash !== requestHash) return { ok: false, error: "conflict" };
      const existing = memoryPlans.get(replay.planId);
      return existing
        ? { ok: true, plan: publicState(existing), memberToken: planIdempotencyDigest("plan-create-token", key), role: "host" }
        : { ok: false, error: "error" };
    }
    const id = planIdempotentUuid("plan-create-id", key);
    const memberToken = planIdempotencyDigest("plan-create-token", key);
    const createdAt = stamp();
    const plan: MemoryPlan = {
      plan: { id, title: clean.title, startTime: clean.startTime, createdAt, routeRevision: 1, status: "draft" },
      stops: clean.stops.map((stop, position) => ({ ...stop, position })),
      crew: [{
        id: planIdempotentUuid("plan-create-member", key), name: clean.creatorName, status: "in", joinedAt: createdAt,
        updatedAt: createdAt, tokenHash: hashPlanMemberToken(memberToken), collaborationAuthorized: true,
      }],
      context: null,
      actions: [],
      ending: null,
      completion: null,
    };
    memoryPlans.set(id, plan);
    planMemory.createRequests.set(keyHash, { requestHash, planId: id });
    return { ok: true, plan: publicState(plan), memberToken, role: "host" };
  },
  async get(id) {
    if (!isPlanId(id)) return null;
    const plan = memoryPlans.get(id);
    return plan ? publicState(plan) : null;
  },
  async join(id, rawName, options = {}) {
    const name = cleanCrewName(rawName);
    if (!isPlanId(id) || !name) return { ok: false, error: "invalid" };
    const plan = memoryPlans.get(id);
    if (!plan) return { ok: false, error: "not_found" };
    const key = isPlanIdempotencyKey(options.idempotencyKey) ? options.idempotencyKey.trim() : randomUUID();
    const keyHash = planIdempotencyDigest(`plan-join-key:${id}`, key);
    const requestHash = planRequestDigest({ name, collaborationAuthorized: options.collaborationAuthorized === true });
    const replay = planMemory.joinRequests.get(`${id}:${keyHash}`);
    if (replay) {
      if (replay.requestHash !== requestHash) return { ok: false, error: "conflict" };
      if (!plan.crew.some((member) => member.id === replay.memberId)) return { ok: false, error: "error" };
      return {
        ok: true, plan: publicState(plan), memberToken: planIdempotencyDigest(`plan-join-token:${id}`, key),
        role: "guest", collaborationAuthorized: options.collaborationAuthorized === true,
      };
    }
    if (plan.crew.length >= CREW_MAX_MEMBERS) return { ok: false, error: "full" };
    const memberToken = planIdempotencyDigest(`plan-join-token:${id}`, key);
    const at = stamp();
    const collaborationAuthorized = options.collaborationAuthorized === true;
    const memberId = planIdempotentUuid(`plan-join-member:${id}`, key);
    plan.crew.push({ id: memberId, name, status: "in", joinedAt: at, updatedAt: at, tokenHash: hashPlanMemberToken(memberToken), collaborationAuthorized });
    planMemory.joinRequests.set(`${id}:${keyHash}`, { requestHash, memberId });
    return { ok: true, plan: publicState(plan), memberToken, role: "guest", collaborationAuthorized };
  },
  async updatePresence(id, rawToken, rawStatus) {
    if (!isPlanId(id) || typeof rawToken !== "string" || !isCrewPresenceStatus(rawStatus)) {
      return { ok: false, error: "invalid" };
    }
    const plan = memoryPlans.get(id);
    if (!plan) return { ok: false, error: "not_found" };
    const member = plan.crew.find((candidate) => candidate.tokenHash === hashPlanMemberToken(rawToken));
    if (!member) return { ok: false, error: "forbidden" };
    member.status = rawStatus;
    member.updatedAt = stamp();
    return { ok: true, plan: publicState(plan) };
  },
  async update(id, rawToken, update) {
    if (!isPlanId(id) || typeof rawToken !== "string") return { ok: false, error: "invalid" };
    const plan = memoryPlans.get(id);
    if (!plan) return { ok: false, error: "not_found" };
    if (plan.crew[0]?.tokenHash !== hashPlanMemberToken(rawToken)) return { ok: false, error: "forbidden" };
    if (update.stops) {
      const stops = cleanReplacementStops(update.stops);
      if (!stops || !Number.isInteger(update.expectedRouteRevision) || update.expectedRouteRevision! < 1 || update.status) return { ok: false, error: "invalid" };
      if (routeRevisionOf(plan.plan) !== update.expectedRouteRevision) return { ok: false, error: "conflict" };
      if (plan.plan.status === "completed" || plan.plan.status === "abandoned") return { ok: false, error: "invalid" };
      // One synchronous mutation keeps the demo store's route + revision
      // semantics equivalent to the production RPC transaction.
      plan.stops = stops;
      plan.plan.routeRevision = routeRevisionOf(plan.plan) + 1;
      if (update.context) plan.context = structuredClone(update.context);
      return { ok: true, plan: publicState(plan) };
    }
    if (update.status && !canTransitionPlannedNight(plan.plan.status ?? "draft", update.status)) return { ok: false, error: "invalid" };
    if (update.status) plan.plan.status = update.status;
    if (update.context) plan.context = structuredClone(update.context);
    return { ok: true, plan: publicState(plan) };
  },
  async addAction(id, rawToken, action) {
    if (!isPlanId(id) || typeof rawToken !== "string" || !isPlanIdempotencyKey(action.idempotencyKey)) return { ok: false, error: "invalid" };
    if (action.type === "ending") return { ok: false, error: "invalid" };
    const plan = memoryPlans.get(id);
    if (!plan) return { ok: false, error: "not_found" };
    const actorIndex = plan.crew.findIndex((candidate) => candidate.tokenHash === hashPlanMemberToken(rawToken));
    if (actorIndex < 0 || !plan.crew[actorIndex]?.collaborationAuthorized || (action.type === "swapped" && actorIndex !== 0)) return { ok: false, error: "forbidden" };
    const key = action.idempotencyKey.trim();
    const keyHash = planIdempotencyDigest(`plan-action-key:${id}`, key);
    const requestHash = planRequestDigest({ type: action.type, stopPosition: action.stopPosition ?? null });
    const requestId = `${id}:${plan.crew[actorIndex]!.id}:${keyHash}`;
    const replay = planMemory.actionRequests.get(requestId);
    if (replay) {
      return replay.requestHash === requestHash ? { ok: true, plan: publicState(plan) } : { ok: false, error: "conflict" };
    }
    const actionId = planIdempotentUuid(`plan-action:${id}:${plan.crew[actorIndex]!.id}`, key);
    plan.actions.push({ id: actionId, type: action.type, stopPosition: action.stopPosition ?? null, ending: action.ending ?? null, createdAt: stamp() });
    planMemory.actionRequests.set(requestId, { requestHash, actionId });
    if (plan.plan.status === "draft" || plan.plan.status === "ready") plan.plan.status = "active";
    return { ok: true, plan: publicState(plan) };
  },
  async getCompletion(id) {
    if (!isPlanId(id)) return null;
    const completion = memoryPlans.get(id)?.completion;
    if (!completion) return null;
    return publicCompletion(completion);
  },
  async complete(id, rawToken, input) {
    if (!isPlanId(id) || typeof rawToken !== "string" || !Number.isInteger(input.expectedRouteRevision) || input.expectedRouteRevision < 1) return { ok: false, error: "invalid" };
    const plan = memoryPlans.get(id);
    if (!plan) return { ok: false, error: "not_found" };
    const actor = plan.crew.find((candidate) => candidate.tokenHash === hashPlanMemberToken(rawToken));
    if (!actor) return { ok: false, error: "forbidden" };
    if (plan.crew[0]?.id !== actor.id) return { ok: false, error: "forbidden" };
    if (routeRevisionOf(plan.plan) !== input.expectedRouteRevision) return { ok: false, error: "conflict" };
    if (plan.completion) {
      return { ok: true, plan: publicState(plan), completion: publicCompletion(plan.completion), created: false };
    }
    if (input.ending === "food" && !input.terminalVenueId) return { ok: false, error: "invalid" };
    if (input.terminalVenueId && !plan.stops.some((stop) => stop.venueId === input.terminalVenueId)) return { ok: false, error: "invalid" };
    const completedAt = stamp();
    const completion: StoredCompletion = {
      id: randomUUID(),
      planId: id,
      ending: input.ending,
      terminalVenueId: input.terminalVenueId ?? null,
      finalPintDropId: null,
      routeRevision: routeRevisionOf(plan.plan),
      routeSnapshot: plan.stops.map((stop) => ({ ...stop })),
      actorMemberId: actor.id,
      completedAt,
    };
    // No await follows validation: ending action, terminal plan state, and
    // completion record become visible together or not at all.
    plan.actions.push({ id: randomUUID(), type: "ending", stopPosition: null, ending: input.ending, createdAt: completedAt });
    plan.plan.status = "completed";
    plan.ending = input.ending;
    plan.completion = completion;
    return { ok: true, plan: publicState(plan), completion: publicCompletion(completion), created: true };
  },
};

export type PlanMemberIdentity = { memberId: string; role: PlanMemberRole; collaborationAuthorized: boolean };
export type PlanMemberIdentityResult = { ok: true; identity: PlanMemberIdentity | null } | { ok: false; error: "error" };
export type PlanCompletionLookupResult = { ok: true; completion: PlanCompletionDTO | null } | { ok: false; error: "error" };
export type PlanStateLookupResult = { ok: true; plan: PlanState | null } | { ok: false; error: "error" };

export function grantMemoryPlanCollaboration(id: string, rawToken: unknown): boolean {
  if (isSupabaseConfigured() || !isPlanId(id) || typeof rawToken !== "string") return false;
  const member = memoryPlans.get(id)?.crew.find((candidate) => candidate.tokenHash === hashPlanMemberToken(rawToken));
  if (!member) return false;
  member.collaborationAuthorized = true;
  return true;
}

/** Resolves a private member capability to its canonical role without exposing the stored hash. */
export async function planMemberIdentity(id: string, rawToken: unknown): Promise<PlanMemberIdentity | null> {
  if (!isPlanId(id) || typeof rawToken !== "string" || !rawToken.trim()) return null;
  const hash = hashPlanMemberToken(rawToken.trim());
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await requireSupabaseAdmin().from(MEMBERS)
        .select("id,token_hash,joined_at,can_collaborate")
        .eq("plan_id", id)
        .order("joined_at").order("id");
      if (error || !data) return null;
      const index = data.findIndex((member) => member.token_hash === hash);
      return index < 0 ? null : { memberId: String(data[index].id), role: index === 0 ? "host" : "guest", collaborationAuthorized: index === 0 || data[index].can_collaborate === true };
    } catch {
      return null;
    }
  }
  const plan = memoryPlans.get(id);
  if (!plan) return null;
  const index = plan.crew.findIndex((member) => member.tokenHash === hash);
  return index < 0 ? null : { memberId: plan.crew[index].id, role: index === 0 ? "host" : "guest", collaborationAuthorized: index === 0 || plan.crew[index].collaborationAuthorized };
}

export async function planMemberIdentityResult(id: string, rawToken: unknown): Promise<PlanMemberIdentityResult> {
  if (!isPlanId(id) || typeof rawToken !== "string" || !rawToken.trim()) return { ok: true, identity: null };
  if (!isSupabaseConfigured()) return { ok: true, identity: await planMemberIdentity(id, rawToken) };
  try {
    const { data, error } = await requireSupabaseAdmin().from(MEMBERS)
      .select("id,token_hash,joined_at,can_collaborate")
      .eq("plan_id", id)
      .order("joined_at").order("id");
    if (error) return { ok: false, error: "error" };
    const index = (data ?? []).findIndex((member) => member.token_hash === hashPlanMemberToken(rawToken.trim()));
    return { ok: true, identity: index < 0 ? null : { memberId: String(data![index].id), role: index === 0 ? "host" : "guest", collaborationAuthorized: index === 0 || data![index].can_collaborate === true } };
  } catch {
    return { ok: false, error: "error" };
  }
}

/** Distinguishes a genuinely missing public Plan from a configured-store outage. */
export async function planStateResult(id: string): Promise<PlanStateLookupResult> {
  if (!isPlanId(id)) return { ok: true, plan: null };
  if (!isSupabaseConfigured()) return { ok: true, plan: await memoryPlanStore.get(id) };
  try {
    const { data, error } = await requireSupabaseAdmin().from(PLANS).select("id").eq("id", id).maybeSingle();
    if (error) return { ok: false, error: "error" };
    if (!data) return { ok: true, plan: null };
    const plan = await supabasePlanStore.get(id);
    return plan ? { ok: true, plan } : { ok: false, error: "error" };
  } catch {
    return { ok: false, error: "error" };
  }
}

/** Distinguishes a genuinely absent completion from a configured-store outage. */
export async function planCompletionResult(id: string): Promise<PlanCompletionLookupResult> {
  if (!isPlanId(id)) return { ok: true, completion: null };
  if (!isSupabaseConfigured()) return { ok: true, completion: await memoryPlanStore.getCompletion(id) };
  try {
    const { data, error } = await requireSupabaseAdmin().from(COMPLETIONS)
      .select("id,plan_id,ending,terminal_venue_id,final_pint_drop_id,route_revision,route_snapshot,completed_at")
      .eq("plan_id", id)
      .maybeSingle();
    if (error) return { ok: false, error: "error" };
    return { ok: true, completion: data ? completionFromRow(data as Record<string, unknown>) : null };
  } catch {
    return { ok: false, error: "error" };
  }
}

export function planStore(): PlanStore {
  return isSupabaseConfigured() ? supabasePlanStore : memoryPlanStore;
}

export function __resetMemoryPlans(): void {
  memoryPlans.clear();
  planMemory.createRequests.clear();
  planMemory.joinRequests.clear();
  planMemory.actionRequests.clear();
  planMemory.sequence = 0;
}
