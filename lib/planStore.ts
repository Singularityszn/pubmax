import "server-only";

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import { cleanCrewName, CREW_MAX_MEMBERS, isCrewPresenceStatus, type CrewMemberDTO, type CrewPresenceStatus } from "@/lib/crew";
import { canTransitionPlannedNight, cleanCreatePlan, cleanEndingSelection, isPlanId, planRouteReady, type CleanPlanInput, type CrawlEnding, type CreatePlanInput, type EndingSelection, type PlanActionDTO, type PlanAnchorMetadata, type PlanCompletionDTO, type PlanDTO, type PlanMemberRole, type PlannedNightStatus, type PlanState, type PlanStopDTO } from "@/lib/plan";
import { CLASSIC_PLAN_INVITE_TOKEN_PATTERN } from "@/lib/planCrewInviteUrl";
import type { NightContext } from "@/lib/nightPlanning";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";
import { isPlanStopCount } from "@/lib/planStopCount";

const PLANS = "plans";
const STOPS = "plan_stops";
const MEMBERS = "plan_crew_members";
const ACTIONS = "plan_actions";
const COMPLETIONS = "plan_completions";
const PLAN_COMPLETION_SELECT = "id,plan_id,ending,terminal_venue_id,ending_selection,final_pint_drop_id,route_revision,route_snapshot,qualifying_arrival_action_id,qualifying_arrival_stop_position,qualifying_arrival_at,completed_at";

/**
 * Does this failure mean the database has no such function? PostgREST answers
 * PGRST202 when a function is missing from its schema cache and PostgreSQL
 * answers 42883 when the call itself finds no candidate. Either says the
 * migration behind the call has not been applied on this database yet.
 */
export function isMissingDatabaseFunction(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "PGRST202" || code === "42883") return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /could not find the function/i.test(message);
}

export type PlanWriteError = "invalid" | "arrival_required" | "not_found" | "full" | "forbidden" | "conflict" | "error";
export type PlanCreateResult = { ok: true; plan: PlanState; memberToken: string; role: "host"; created: boolean } | { ok: false; error: PlanWriteError };
export type PlanCrewCommitment = { committedAt: string; routeReady: boolean };
export type PlanJoinResult = {
  ok: true;
  plan: PlanState;
  memberToken: string;
  role: "guest";
  collaborationAuthorized: boolean;
  crewCommitment: PlanCrewCommitment | null;
} | { ok: false; error: PlanWriteError };
export type PlanPresenceResult = { ok: true; plan: PlanState } | { ok: false; error: PlanWriteError };
export type PlanUpdateResult = PlanPresenceResult;
export type PlanCompletionResult =
  | { ok: true; plan: PlanState; completion: PlanCompletionDTO; created: boolean }
  | { ok: false; error: PlanWriteError };

export type PlanCreateOptions = {
  idempotencyKey?: string;
  groundingProofDigest?: string;
  /** Grounded anchor metadata (§3.3). Present only for anchored generation. */
  anchor?: PlanAnchorMetadata;
};

export type PlanStore = {
  create(input: CreatePlanInput, options?: PlanCreateOptions): Promise<PlanCreateResult>;
  get(id: string): Promise<PlanState | null>;
  join(id: string, name: unknown, options?: { collaborationAuthorized?: boolean; idempotencyKey?: string }): Promise<PlanJoinResult>;
  updatePresence(id: string, memberToken: unknown, status: unknown): Promise<PlanPresenceResult>;
  update(id: string, memberToken: unknown, update: { status?: PlannedNightStatus; context?: NightContext; stops?: PlanStopDTO[]; expectedRouteRevision?: number; groundedUpgrade?: boolean }): Promise<PlanUpdateResult>;
  addAction(id: string, memberToken: unknown, action: { type: PlanActionDTO["type"]; stopPosition?: number; ending?: CrawlEnding; idempotencyKey?: string }): Promise<PlanUpdateResult>;
  getCompletion(id: string): Promise<PlanCompletionDTO | null>;
  complete(id: string, memberToken: unknown, input: { expectedRouteRevision: number; ending: CrawlEnding; terminalVenueId?: string; endingSelection: EndingSelection }): Promise<PlanCompletionResult>;
};

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

export function planJoinCommitmentResult(data: unknown): {
  status: string;
  crewCommitment: PlanCrewCommitment | null;
} | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.status !== "string") return null;
  if (row.crewCommittedAt === null && row.crewCommittedRouteReady === null) {
    return { status: row.status, crewCommitment: null };
  }
  if (typeof row.crewCommittedAt !== "string"
    || !Number.isFinite(Date.parse(row.crewCommittedAt))
    || typeof row.crewCommittedRouteReady !== "boolean") return null;
  return {
    status: row.status,
    crewCommitment: {
      committedAt: row.crewCommittedAt,
      routeReady: row.crewCommittedRouteReady,
    },
  };
}

/**
 * Confirm anchor metadata is consistent with the submitted Stops: an anchor-only
 * outcome is exactly one Stop, a route outcome is three to six, and either way
 * the accepted anchor Venue is Stop 1.
 */
function validatedCreateAnchor(
  clean: CleanPlanInput,
  anchor: PlanAnchorMetadata | undefined,
): PlanAnchorMetadata | undefined | "invalid" {
  if (!anchor) return undefined;
  const expectedStops = anchor.outcome === "route" ? clean.stops.length : 1;
  if (anchor.outcome === "route" && !isPlanStopCount(expectedStops)) return "invalid";
  if (clean.stops.length !== expectedStops) return "invalid";
  if (clean.stops[0]?.venueId !== anchor.venueId) return "invalid";
  return anchor;
}

/**
 * Fold the grounding proof and anchor into the idempotency request hash so a
 * replay with a different proof or anchor is a conflict, while a plain create
 * (no proof, no anchor) keeps its historical hash exactly.
 */
function createRequestHash(clean: CleanPlanInput, options: PlanCreateOptions): string {
  const plan = clean.context
    ? clean
    : {
        title: clean.title,
        startTime: clean.startTime,
        creatorName: clean.creatorName,
        stops: clean.stops,
      };
  if (!options.groundingProofDigest && !options.anchor) return planRequestDigest(plan);
  return planRequestDigest({
    plan,
    ...(options.groundingProofDigest ? { groundingProofDigest: options.groundingProofDigest } : {}),
    ...(options.anchor ? { anchor: options.anchor } : {}),
  });
}

function planFromRow(row: Record<string, unknown>): PlanDTO {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    startTime: String(row.start_time),
    createdAt: String(row.created_at),
    routeRevision: Number(row.route_revision ?? 1),
    status: (row.status as PlannedNightStatus) ?? "draft",
    anchorVenueId: typeof row.anchor_venue_id === "string" ? row.anchor_venue_id : null,
    anchorSource: typeof row.anchor_source === "string" ? row.anchor_source as PlanDTO["anchorSource"] : null,
    outcome: typeof row.plan_outcome === "string" ? row.plan_outcome as PlanDTO["outcome"] : null,
    routeReadyAt: typeof row.route_ready_at === "string" ? row.route_ready_at : null,
  };
}

function completionFromRow(row: Record<string, unknown>): PlanCompletionDTO {
  const snapshot = Array.isArray(row.route_snapshot) ? row.route_snapshot : [];
  return {
    id: String(row.id),
    planId: String(row.plan_id),
    ending: row.ending as CrawlEnding,
    terminalVenueId: typeof row.terminal_venue_id === "string" ? row.terminal_venue_id : null,
    endingSelection: cleanEndingSelection(row.ending_selection, row.ending as CrawlEnding),
    finalPintDropId: typeof row.final_pint_drop_id === "string" ? row.final_pint_drop_id : null,
    routeRevision: Number(row.route_revision ?? 1),
    routeSnapshot: snapshot.map((stop) => stopFromRow({
      venue_id: (stop as Record<string, unknown>).venueId,
      venue_name: (stop as Record<string, unknown>).venueName,
      position: (stop as Record<string, unknown>).position,
    })).sort((a, b) => a.position - b.position),
    qualifyingArrival:
      typeof row.qualifying_arrival_action_id === "string"
      && typeof row.qualifying_arrival_stop_position === "number"
      && typeof row.qualifying_arrival_at === "string"
        ? {
            actionId: row.qualifying_arrival_action_id,
            stopPosition: row.qualifying_arrival_stop_position,
            arrivedAt: row.qualifying_arrival_at,
          }
        : null,
    completedAt: String(row.completed_at),
  };
}

function cleanReplacementStops(stops: PlanStopDTO[] | undefined): PlanStopDTO[] | null {
  if (!stops || !isPlanStopCount(stops.length)) return null;
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

async function readSupabasePlanState(
  id: string,
  socialOwnerAccountId: string | null,
): Promise<PlanState | null> {
  const admin = requireSupabaseAdmin();
  let planQuery = admin.from(PLANS)
    .select("id,title,start_time,created_at,status,route_revision,night_context,ending,anchor_venue_id,anchor_source,plan_outcome,route_ready_at,social_owner_account_id")
    .eq("id", id);
  planQuery = socialOwnerAccountId === null
    ? planQuery.is("social_owner_account_id", null)
    : planQuery.eq("social_owner_account_id", socialOwnerAccountId);
  const { data: planRow, error } = await planQuery.maybeSingle();
  if (error) throw new Error(error.message);
  if (!planRow) return null;
  const [
    { data: stopRows, error: stopsError },
    { data: memberRows, error: membersError },
    { data: actionRows, error: actionsError },
  ] = await Promise.all([
    admin.from(STOPS).select("venue_id,venue_name,position").eq("plan_id", id).order("position"),
    admin.from(MEMBERS).select("id,name,status,joined_at,updated_at").eq("plan_id", id).order("joined_at").order("id"),
    admin.from(ACTIONS).select("id,type,stop_position,ending,created_at").eq("plan_id", id).order("created_at"),
  ]);
  if (stopsError || membersError || actionsError) {
    throw new Error(stopsError?.message ?? membersError?.message ?? actionsError?.message);
  }
  return {
    plan: planFromRow(planRow as Record<string, unknown>),
    stops: (stopRows ?? []).map((row) => stopFromRow(row as Record<string, unknown>)),
    crew: socialOwnerAccountId === null
      ? (memberRows ?? []).map((row) => memberFromRow(row as Record<string, unknown>))
      : [],
    context: (planRow as Record<string, unknown>).night_context as NightContext | null ?? null,
    actions: (actionRows ?? []).map((row) => ({
      id: String(row.id),
      type: row.type as PlanActionDTO["type"],
      stopPosition: row.stop_position as number | null,
      ending: row.ending as CrawlEnding | null,
      createdAt: String(row.created_at),
    })),
    ending: (planRow as Record<string, unknown>).ending as CrawlEnding | null ?? null,
  };
}

export const supabasePlanStore: PlanStore = {
  async create(input, options = {}) {
    const clean = cleanCreatePlan(input);
    if (!clean) return { ok: false, error: "invalid" };
    const anchor = validatedCreateAnchor(clean, options.anchor);
    if (anchor === "invalid") return { ok: false, error: "invalid" };
    const key = isPlanIdempotencyKey(options.idempotencyKey) ? options.idempotencyKey.trim() : randomUUID();
    const keyHash = planIdempotencyDigest("plan-create-key", key);
    const requestHash = createRequestHash(clean, options);
    const id = planIdempotentUuid("plan-create-id", key);
    const memberToken = planIdempotencyDigest("plan-create-token", key);
    const memberId = planIdempotentUuid("plan-create-member", key);
    const joinedAt = new Date().toISOString();
    try {
      const admin = requireSupabaseAdmin();
      const createArgs = {
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
        // Anchor metadata is additive; the RPC stamps route_ready_at = created_at
        // for a grounded three-Stop route and leaves it null for anchor-only.
        p_anchor_venue_id: anchor?.venueId ?? null,
        p_anchor_source: anchor?.source ?? null,
        p_outcome: anchor?.outcome ?? null,
      };
      let { data, error } = await admin.rpc("create_plan_with_context_idempotent_atomic", {
        ...createArgs,
        p_context: clean.context,
      });
      if (error && isMissingDatabaseFunction(error)) {
        // Migration 0106 has not been applied yet. Creating the Plan without
        // its Night Context beats refusing every Plan creation on the site,
        // and the composer writes the context it holds straight afterwards
        // through PATCH /api/plans/[id] once it sees the created Plan came
        // back without one. Only a missing FUNCTION may take this path: a
        // genuine write failure must stay a refusal.
        console.warn("[plans] create context RPC missing; creating without night context");
        ({ data, error } = await admin.rpc("create_plan_idempotent_atomic", createArgs));
      }
      if (error) throw new Error(error.message);
      if (data === "conflict") return { ok: false, error: "conflict" };
      if (data !== "created" && data !== "replayed") return { ok: false, error: "error" };
      const plan = await this.get(id);
      return plan ? { ok: true, plan, memberToken, role: "host", created: data === "created" } : { ok: false, error: "error" };
    } catch (error) {
      console.error("[plans] create failed:", error instanceof Error ? error.message : error);
      return { ok: false, error: "error" };
    }
  },

  async get(id) {
    if (!isPlanId(id)) return null;
    try {
      return await readSupabasePlanState(id, null);
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
      const { data, error } = await requireSupabaseAdmin().rpc("join_plan_idempotent_atomic_with_commitment", {
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
      const atomic = planJoinCommitmentResult(data);
      if (!atomic) return { ok: false, error: "error" };
      if (atomic.status === "full") return { ok: false, error: "full" };
      if (atomic.status === "conflict") return { ok: false, error: "conflict" };
      if (atomic.status === "not_found") return { ok: false, error: "not_found" };
      if (atomic.status !== "joined" && atomic.status !== "replayed") return { ok: false, error: "error" };
      const plan = await this.get(id);
      return plan ? {
        ok: true,
        plan,
        memberToken,
        role: "guest",
        collaborationAuthorized: options.collaborationAuthorized === true,
        crewCommitment: atomic.crewCommitment,
      } : { ok: false, error: "error" };
    } catch (error) {
      console.error("[plans] join failed:", error instanceof Error ? error.message : error);
      return { ok: false, error: "error" };
    }
  },

  async updatePresence(id, rawToken, rawStatus) {
    if (!isPlanId(id) || typeof rawToken !== "string" || !isCrewPresenceStatus(rawStatus)) {
      return { ok: false, error: "invalid" };
    }
    const lookup = await planStateResult(id);
    if (!lookup.ok) return { ok: false, error: "error" };
    if (!lookup.plan) return { ok: false, error: "not_found" };
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
          // Anchored Plans upgrade to a grounded route only after proof verification.
          p_grounded_upgrade: update.groundedUpgrade === true,
        });
        if (error) throw new Error(error.message);
        if (data !== "ok") return { ok: false, error: data === "not_found" ? "not_found" : data === "forbidden" ? "forbidden" : data === "conflict" ? "conflict" : "invalid" };
        const plan = await this.get(id);
        return plan ? { ok: true, plan } : { ok: false, error: "error" };
      } catch (error) {
        console.error("[plans] route replacement failed:", error instanceof Error ? error.message : error);
        return { ok: false, error: "error" };
      }
    }
    try {
      const { data, error } = await admin.rpc("update_legacy_plan_status_context_atomic", {
        p_plan_id: id,
        p_token_hash: hashPlanMemberToken(rawToken),
        p_status: update.status ?? null,
        p_context: update.context ?? null,
      });
      if (error) throw new Error(error.message);
      if (data !== "ok") {
        return { ok: false, error: data === "not_found" ? "not_found" : data === "forbidden" ? "forbidden" : data === "invalid" ? "invalid" : "error" };
      }
      const plan = await this.get(id);
      return plan ? { ok: true, plan } : { ok: false, error: "error" };
    } catch (error) {
      console.error("[plans] metadata update failed:", error instanceof Error ? error.message : error);
      return { ok: false, error: "error" };
    }
  },
  async addAction(id, rawToken, action) {
    if (!isPlanId(id) || typeof rawToken !== "string" || !isPlanIdempotencyKey(action.idempotencyKey)) return { ok: false, error: "invalid" };
    // Completion is intentionally not an ordinary action write: it must insert
    // the ending action, completion record, and terminal status atomically.
    if (action.type === "ending") return { ok: false, error: "invalid" };
    const currentResult = await planStateResult(id);
    if (!currentResult.ok) return { ok: false, error: "error" };
    const current = currentResult.plan;
    if (!current) return { ok: false, error: "not_found" };
    const identityResult = await planMemberIdentityResult(id, rawToken);
    if (!identityResult.ok) return { ok: false, error: "error" };
    const identity = identityResult.identity;
    if (!identity?.collaborationAuthorized || (action.type === "swapped" && identity.role !== "host")) return { ok: false, error: "forbidden" };
    if (!Number.isInteger(action.stopPosition)
      || !current.stops.some((stop) => stop.position === action.stopPosition)) {
      return { ok: false, error: "invalid" };
    }
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
        .select(PLAN_COMPLETION_SELECT)
        .eq("plan_id", id).maybeSingle();
      return error || !data ? null : completionFromRow(data as Record<string, unknown>);
    } catch {
      return null;
    }
  },
  async complete(id, rawToken, input) {
    if (!isPlanId(id) || typeof rawToken !== "string" || !Number.isInteger(input.expectedRouteRevision) ||
        input.expectedRouteRevision < 1 || !cleanEndingSelection(input.endingSelection, input.ending)) {
      return { ok: false, error: "invalid" };
    }
    const legacyLookup = await planStateResult(id);
    if (!legacyLookup.ok) return { ok: false, error: "error" };
    if (!legacyLookup.plan) return { ok: false, error: "not_found" };
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
        p_ending_selection: input.endingSelection,
        p_completed_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      if (data !== "completed" && data !== "already_completed") return { ok: false, error: data === "forbidden" ? "forbidden" : data === "conflict" ? "conflict" : data === "not_found" ? "not_found" : data === "arrival_required" ? "arrival_required" : "invalid" };
      const [plan, completion] = await Promise.all([this.get(id), this.getCompletion(id)]);
      return plan && completion ? { ok: true, plan, completion, created: data === "completed" } : { ok: false, error: "error" };
    } catch (error) {
      console.error("[plans] completion failed:", error instanceof Error ? error.message : error);
      return { ok: false, error: "error" };
    }
  },
};

type MemoryMember = CrewMemberDTO & {
  tokenHash: string;
  collaborationAuthorized: boolean;
  crewCommitment?: PlanCrewCommitment | null;
  /** Auth user stamped when a signed-in claimed account creates/joins (WP7). */
  userId?: string;
};
type StoredCompletion = PlanCompletionDTO & { actorMemberId: string };
function publicCompletion(completion: StoredCompletion): PlanCompletionDTO {
  return {
    id: completion.id,
    planId: completion.planId,
    ending: completion.ending,
    terminalVenueId: completion.terminalVenueId,
    endingSelection: completion.endingSelection ? structuredClone(completion.endingSelection) : null,
    finalPintDropId: completion.finalPintDropId,
    routeRevision: completion.routeRevision,
    routeSnapshot: completion.routeSnapshot.map((stop) => ({ ...stop })),
    qualifyingArrival: completion.qualifyingArrival ? { ...completion.qualifyingArrival } : null,
    completedAt: completion.completedAt,
  };
}
type MemoryPlan = {
  plan: PlanDTO;
  stops: PlanStopDTO[];
  crew: MemoryMember[];
  context: NightContext | null;
  actions: PlanActionDTO[];
  ending: CrawlEnding | null;
  completion: StoredCompletion | null;
  inviteToken: string;
  /** Host auth user when create stamped a signed-in account (WP7). */
  ownerUserId?: string;
};
type PlanMemoryState = {
  plans: Map<string, MemoryPlan>;
  sequence: number;
  createRequests: Map<string, { requestHash: string; planId: string }>;
  joinRequests: Map<string, { requestHash: string; memberId: string }>;
  actionRequests: Map<string, { requestHash: string; actionId: string }>;
  /** invite_token -> plan id, the memory-store mirror of plans.invite_token. */
  inviteTokens: Map<string, string>;
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
  inviteTokens: new Map(),
};
planMemory.createRequests ??= new Map();
planMemory.joinRequests ??= new Map();
planMemory.actionRequests ??= new Map();
planMemory.inviteTokens ??= new Map();
const memoryPlans = planMemory.plans;

/** Mirrors the DB column default (encode(gen_random_bytes(16), 'hex')) for the memory store. */
function mintInviteToken(): string {
  return randomBytes(16).toString("hex");
}

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
    const anchor = validatedCreateAnchor(clean, options.anchor);
    if (anchor === "invalid") return { ok: false, error: "invalid" };
    const key = isPlanIdempotencyKey(options.idempotencyKey) ? options.idempotencyKey.trim() : randomUUID();
    const keyHash = planIdempotencyDigest("plan-create-key", key);
    const requestHash = createRequestHash(clean, options);
    const replay = planMemory.createRequests.get(keyHash);
    if (replay) {
      if (replay.requestHash !== requestHash) return { ok: false, error: "conflict" };
      const existing = memoryPlans.get(replay.planId);
      return existing
        ? { ok: true, plan: publicState(existing), memberToken: planIdempotencyDigest("plan-create-token", key), role: "host", created: false }
        : { ok: false, error: "error" };
    }
    const id = planIdempotentUuid("plan-create-id", key);
    const memberToken = planIdempotencyDigest("plan-create-token", key);
    const createdAt = stamp();
    const plan: MemoryPlan = {
      plan: {
        id, title: clean.title, startTime: clean.startTime, createdAt, routeRevision: 1, status: "draft",
        anchorVenueId: anchor?.venueId ?? null,
        anchorSource: anchor?.source ?? null,
        outcome: anchor?.outcome ?? null,
        // A grounded three-Stop route is route-ready at creation; a one-Stop
        // anchor-only draft stays not-ready until it is upgraded.
        routeReadyAt: anchor?.outcome === "route" ? createdAt : null,
      },
      stops: clean.stops.map((stop, position) => ({ ...stop, position })),
      crew: [{
        id: planIdempotentUuid("plan-create-member", key), name: clean.creatorName, status: "in", joinedAt: createdAt,
        updatedAt: createdAt, tokenHash: hashPlanMemberToken(memberToken), collaborationAuthorized: true,
      }],
      context: clean.context ? structuredClone(clean.context) : null,
      actions: [],
      ending: null,
      completion: null,
      inviteToken: mintInviteToken(),
    };
    memoryPlans.set(id, plan);
    planMemory.inviteTokens.set(plan.inviteToken, id);
    planMemory.createRequests.set(keyHash, { requestHash, planId: id });
    return { ok: true, plan: publicState(plan), memberToken, role: "host", created: true };
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
        crewCommitment: plan.crew.find((member) => member.id === replay.memberId)?.crewCommitment ?? null,
      };
    }
    if (plan.crew.length >= CREW_MAX_MEMBERS) return { ok: false, error: "full" };
    const memberToken = planIdempotencyDigest(`plan-join-token:${id}`, key);
    const at = stamp();
    const collaborationAuthorized = options.collaborationAuthorized === true;
    const memberId = planIdempotentUuid(`plan-join-member:${id}`, key);
    const crewCommitment = plan.crew.length === 1
      ? { committedAt: at, routeReady: planRouteReady(plan.plan, plan.stops.length) }
      : null;
    plan.crew.push({
      id: memberId,
      name,
      status: "in",
      joinedAt: at,
      updatedAt: at,
      tokenHash: hashPlanMemberToken(memberToken),
      collaborationAuthorized,
      crewCommitment,
    });
    planMemory.joinRequests.set(`${id}:${keyHash}`, { requestHash, memberId });
    return {
      ok: true,
      plan: publicState(plan),
      memberToken,
      role: "guest",
      collaborationAuthorized,
      crewCommitment,
    };
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
      // An anchored Plan keeps its accepted Venue as Stop 1 — the anchor never
      // moves or gains an ordinary Swap. Replacing a one-Stop anchor-only draft
      // with three Stops is the atomic upgrade to a grounded route, and it is
      // only allowed once the caller has verified the grounding proof.
      if (plan.plan.anchorVenueId && (!update.groundedUpgrade || stops[0].venueId !== plan.plan.anchorVenueId)) {
        return { ok: false, error: "forbidden" };
      }
      // One synchronous mutation keeps the demo store's route + revision
      // semantics equivalent to the production RPC transaction.
      plan.stops = stops;
      plan.plan.routeRevision = routeRevisionOf(plan.plan) + 1;
      if (plan.plan.anchorVenueId) {
        plan.plan.outcome = "route";
        // routeReadyAt is stamped once and then immutable across later edits.
        plan.plan.routeReadyAt ??= stamp();
      }
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
    if (!Number.isInteger(action.stopPosition)
      || !plan.stops.some((stop) => stop.position === action.stopPosition)) {
      return { ok: false, error: "invalid" };
    }
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
    if (!isPlanId(id) || typeof rawToken !== "string" || !Number.isInteger(input.expectedRouteRevision) ||
        input.expectedRouteRevision < 1 || !cleanEndingSelection(input.endingSelection, input.ending)) {
      return { ok: false, error: "invalid" };
    }
    const plan = memoryPlans.get(id);
    if (!plan) return { ok: false, error: "not_found" };
    const actor = plan.crew.find((candidate) => candidate.tokenHash === hashPlanMemberToken(rawToken));
    if (!actor) return { ok: false, error: "forbidden" };
    if (plan.crew[0]?.id !== actor.id) return { ok: false, error: "forbidden" };
    if (routeRevisionOf(plan.plan) !== input.expectedRouteRevision) return { ok: false, error: "conflict" };
    if (plan.completion) {
      return { ok: true, plan: publicState(plan), completion: publicCompletion(plan.completion), created: false };
    }
    const qualifyingArrival = plan.actions.find((action) => (
      action.type === "arrived"
      && action.stopPosition !== null
      && plan.stops.some((stop) => stop.position === action.stopPosition)
    ));
    if (!qualifyingArrival || qualifyingArrival.stopPosition === null) return { ok: false, error: "arrival_required" };
    if (input.ending === "food" && !input.terminalVenueId) return { ok: false, error: "invalid" };
    if (input.terminalVenueId && !plan.stops.some((stop) => stop.venueId === input.terminalVenueId)) return { ok: false, error: "invalid" };
    const completedAt = stamp();
    const completion: StoredCompletion = {
      id: randomUUID(),
      planId: id,
      ending: input.ending,
      terminalVenueId: input.terminalVenueId ?? null,
      endingSelection: structuredClone(input.endingSelection),
      finalPintDropId: null,
      routeRevision: routeRevisionOf(plan.plan),
      routeSnapshot: plan.stops.map((stop) => ({ ...stop })),
      qualifyingArrival: {
        actionId: qualifyingArrival.id,
        stopPosition: qualifyingArrival.stopPosition,
        arrivedAt: qualifyingArrival.createdAt,
      },
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
export type LegacyPlanMemberIdentityResult = PlanMemberIdentityResult | { ok: false; error: "not_found" };
export type PlanCompletionLookupResult = { ok: true; completion: PlanCompletionDTO | null } | { ok: false; error: "error" };
export type PlanStateLookupResult = { ok: true; plan: PlanState | null } | { ok: false; error: "error" };

async function supabaseLegacyPlanExists(id: string): Promise<{ ok: true; exists: boolean } | { ok: false; error: "error" }> {
  try {
    const { data, error } = await requireSupabaseAdmin().from(PLANS).select("id")
      .eq("id", id)
      .is("social_owner_account_id", null)
      .maybeSingle();
    return error ? { ok: false, error: "error" } : { ok: true, exists: Boolean(data) };
  } catch {
    return { ok: false, error: "error" };
  }
}

async function supabaseLegacyPlanMemberIdentityResult(id: string, rawToken: string): Promise<LegacyPlanMemberIdentityResult> {
  try {
    const boundary = await supabaseLegacyPlanExists(id);
    if (!boundary.ok) return boundary;
    if (!boundary.exists) return { ok: false, error: "not_found" };
    const { data, error } = await requireSupabaseAdmin().from(MEMBERS)
      .select("id,token_hash,joined_at,can_collaborate")
      .eq("plan_id", id)
      .order("joined_at").order("id");
    if (error) return { ok: false, error: "error" };
    const index = (data ?? []).findIndex((member) => member.token_hash === hashPlanMemberToken(rawToken.trim()));
    return {
      ok: true,
      identity: index < 0 ? null : {
        memberId: String(data![index].id),
        role: index === 0 ? "host" : "guest",
        collaborationAuthorized: index === 0 || data![index].can_collaborate === true,
      },
    };
  } catch {
    return { ok: false, error: "error" };
  }
}

async function supabasePlanMemberIdentityResult(id: string, rawToken: string): Promise<PlanMemberIdentityResult> {
  const result = await supabaseLegacyPlanMemberIdentityResult(id, rawToken);
  return !result.ok && result.error === "not_found"
    ? { ok: true, identity: null }
    : result;
}

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
  if (isSupabaseConfigured()) {
    const result = await supabasePlanMemberIdentityResult(id, rawToken);
    return result.ok ? result.identity : null;
  }
  const hash = hashPlanMemberToken(rawToken.trim());
  const plan = memoryPlans.get(id);
  if (!plan) return null;
  const index = plan.crew.findIndex((member) => member.tokenHash === hash);
  return index < 0 ? null : { memberId: plan.crew[index].id, role: index === 0 ? "host" : "guest", collaborationAuthorized: index === 0 || plan.crew[index].collaborationAuthorized };
}

export async function planMemberIdentityResult(id: string, rawToken: unknown): Promise<PlanMemberIdentityResult> {
  if (!isPlanId(id) || typeof rawToken !== "string" || !rawToken.trim()) return { ok: true, identity: null };
  if (!isSupabaseConfigured()) return { ok: true, identity: await planMemberIdentity(id, rawToken) };
  return supabasePlanMemberIdentityResult(id, rawToken);
}

/** Resolves legacy member authority while preserving a missing or Crew-bound Plan as not found. */
export async function legacyPlanMemberIdentityResult(id: string, rawToken: unknown): Promise<LegacyPlanMemberIdentityResult> {
  if (!isPlanId(id)) return { ok: false, error: "not_found" };
  if (typeof rawToken !== "string" || !rawToken.trim()) return { ok: true, identity: null };
  if (isSupabaseConfigured()) return supabaseLegacyPlanMemberIdentityResult(id, rawToken);
  if (!memoryPlans.has(id)) return { ok: false, error: "not_found" };
  return { ok: true, identity: await planMemberIdentity(id, rawToken) };
}

/** Distinguishes a genuinely missing public Plan from a configured-store outage. */
export async function planStateResult(id: string): Promise<PlanStateLookupResult> {
  if (!isPlanId(id)) return { ok: true, plan: null };
  if (!isSupabaseConfigured()) return { ok: true, plan: await memoryPlanStore.get(id) };
  try {
    const { data, error } = await requireSupabaseAdmin().from(PLANS).select("id")
      .eq("id", id)
      .is("social_owner_account_id", null)
      .maybeSingle();
    if (error) return { ok: false, error: "error" };
    if (!data) return { ok: true, plan: null };
    const plan = await supabasePlanStore.get(id);
    return plan ? { ok: true, plan } : { ok: false, error: "error" };
  } catch {
    return { ok: false, error: "error" };
  }
}

/** Reads a Crew-bound Plan only after Social authority supplied its stable owner account. */
export async function socialBoundPlanStateResult(
  id: string,
  expectedOwnerAccountId: string,
): Promise<PlanStateLookupResult> {
  if (!isPlanId(id) || !isPlanId(expectedOwnerAccountId)) {
    return { ok: true, plan: null };
  }
  if (!isSupabaseConfigured()) return { ok: false, error: "error" };
  try {
    return {
      ok: true,
      plan: await readSupabasePlanState(id, expectedOwnerAccountId),
    };
  } catch {
    return { ok: false, error: "error" };
  }
}

/** Distinguishes a genuinely absent completion from a configured-store outage. */
export async function planCompletionResult(id: string): Promise<PlanCompletionLookupResult> {
  if (!isPlanId(id)) return { ok: true, completion: null };
  if (!isSupabaseConfigured()) return { ok: true, completion: await memoryPlanStore.getCompletion(id) };
  try {
    const boundary = await supabaseLegacyPlanExists(id);
    if (!boundary.ok) return boundary;
    if (!boundary.exists) return { ok: true, completion: null };
    const { data, error } = await requireSupabaseAdmin().from(COMPLETIONS)
      .select(PLAN_COMPLETION_SELECT)
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
  planMemory.inviteTokens.clear();
  planMemory.sequence = 0;
}

/** Test/dev seam: stamp a crew member's auth user (mirrors plan_crew_members.user_id). */
export function __linkMemoryPlanMemberUser(
  planId: string,
  memberId: string,
  userId: string,
): boolean {
  const plan = memoryPlans.get(planId);
  if (!plan) return false;
  const member = plan.crew.find((row) => row.id === memberId);
  if (!member) return false;
  if (member.userId && member.userId !== userId) return false;
  member.userId = userId;
  return true;
}

/** Test/dev seam: stamp the plan owner (mirrors plans.owner_user_id). */
export function __setMemoryPlanOwnerUserId(planId: string, userId: string): boolean {
  const plan = memoryPlans.get(planId);
  if (!plan) return false;
  if (plan.ownerUserId && plan.ownerUserId !== userId) return false;
  plan.ownerUserId = userId;
  const host = plan.crew[0];
  if (host && !host.userId) host.userId = userId;
  return true;
}

/** Test/dev seam: list stamped member user ids for friend-edge formation. */
export function __listMemoryPlanMemberUserIds(
  planId: string,
): Array<{ memberId: string; userId: string }> {
  const plan = memoryPlans.get(planId);
  if (!plan) return [];
  return plan.crew
    .filter((member): member is MemoryMember & { userId: string } => Boolean(member.userId))
    .map((member) => ({ memberId: member.id, userId: member.userId }));
}

export type PlanInviteTokenLookupResult = { ok: true; planId: string | null } | { ok: false; error: "error" };

/**
 * Resolves the public invite token in an app/invite/[token] URL to its plan
 * id. The token is a bearer-capability slug, not a secret validated against a
 * hash — matches plans.invite_token, which is stored in clear text so the
 * host can keep reading the same link back (see migration 0081). Distinguishes
 * a genuinely unknown token from a store outage, matching planStateResult.
 */
export async function resolvePlanIdByInviteToken(rawToken: unknown): Promise<PlanInviteTokenLookupResult> {
  if (typeof rawToken !== "string") return { ok: true, planId: null };
  const token = rawToken.trim().toLowerCase();
  if (!CLASSIC_PLAN_INVITE_TOKEN_PATTERN.test(token)) return { ok: true, planId: null };
  if (!isSupabaseConfigured()) return { ok: true, planId: planMemory.inviteTokens.get(token) ?? null };
  try {
    const { data, error } = await requireSupabaseAdmin().from(PLANS).select("id")
      .eq("invite_token", token)
      .maybeSingle();
    if (error) return { ok: false, error: "error" };
    return { ok: true, planId: data ? String(data.id) : null };
  } catch {
    return { ok: false, error: "error" };
  }
}

export type PlanInviteTokenResult = { ok: true; inviteToken: string | null } | { ok: false; error: "error" };

/** The host-facing lookup: a plan's own invite token, to build its share URL. */
export async function planInviteToken(id: string): Promise<PlanInviteTokenResult> {
  if (!isPlanId(id)) return { ok: true, inviteToken: null };
  if (!isSupabaseConfigured()) return { ok: true, inviteToken: memoryPlans.get(id)?.inviteToken ?? null };
  try {
    const { data, error } = await requireSupabaseAdmin().from(PLANS).select("invite_token")
      .eq("id", id)
      .maybeSingle();
    if (error) return { ok: false, error: "error" };
    return { ok: true, inviteToken: data && typeof data.invite_token === "string" ? data.invite_token : null };
  } catch {
    return { ok: false, error: "error" };
  }
}

/**
 * Host-only rotation: mints a fresh invite token for the plan, invalidating
 * the old /invite/[token] link immediately. Same format as the DB column
 * default (migration 0081, encode(gen_random_bytes(16), 'hex')) — mirrors
 * mintInviteToken() rather than calling a SQL function, since a JS-minted
 * hex value satisfies the same unique + format constraint either way.
 */
export async function rotateInviteToken(id: string): Promise<PlanInviteTokenResult> {
  if (!isPlanId(id)) return { ok: true, inviteToken: null };
  const token = mintInviteToken();
  if (!isSupabaseConfigured()) {
    const plan = memoryPlans.get(id);
    if (!plan) return { ok: true, inviteToken: null };
    planMemory.inviteTokens.delete(plan.inviteToken);
    plan.inviteToken = token;
    planMemory.inviteTokens.set(token, id);
    return { ok: true, inviteToken: token };
  }
  try {
    const { data, error } = await requireSupabaseAdmin().from(PLANS).update({ invite_token: token })
      .eq("id", id)
      .select("invite_token")
      .maybeSingle();
    if (error) return { ok: false, error: "error" };
    return { ok: true, inviteToken: data && typeof data.invite_token === "string" ? data.invite_token : null };
  } catch {
    return { ok: false, error: "error" };
  }
}
