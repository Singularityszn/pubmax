// Durable handle-free RSVP + reactions on a plan's public invite page. TWO
// tables (plan_invite_rsvps, plan_invite_reactions), each with a
// process-memory and a Supabase implementation, same seam pattern as
// lib/reactionsStore.ts.
//
// A guest is identified only by `submitter_hash` — the salted hash of their
// anonymous device id (lib/anonId.ts + lib/supabase.ts hashActor), never a
// raw id. `unique(plan_id, submitter_hash)` on the RSVP table means a
// resubmit UPDATES the same row (a guest can change Going to Maybe without
// stacking rows); reactions keep the reactionsStore shape of one row per
// (plan, device, reaction) so a device can't double-count one reaction.
//
// Both tables FK-reference plans(id); an invite token that resolved but
// whose plan has since been removed raises a foreign-key violation on write,
// surfaced as UnknownPlanError so the route can 404 rather than 500.
//
// SERVER-ONLY: imports @/lib/supabase (admin client). Do NOT import from a
// "use client" component — import lib/planInvite.ts / lib/reactions.ts
// instead for the browser-safe constants and DTO shapes.

import { admin, isForeignKeyViolation, isUniqueViolation, selectStore } from "@/lib/storeBackend";
import { GUEST_LIST_DISPLAY_CAP, isRsvpStatus, RSVP_PLAN_CEILING, type PlanInviteGuest, type PlanInviteRsvpSummary, type RsvpStatus } from "@/lib/planInvite";
import { isReactionKey, type ReactionKey, type ReactionSummary } from "@/lib/reactions";

/** The plan id backing an invite token no longer exists (or never did). */
export class UnknownPlanError extends Error {
  constructor(planId: string) {
    super(`Unknown plan: ${planId}`);
    this.name = "UnknownPlanError";
  }
}

/** F10: a plan already holds RSVP_PLAN_CEILING guests; a new guest is refused. */
export class RsvpCapExceededError extends Error {
  constructor(planId: string) {
    super(`RSVP cap reached for plan: ${planId}`);
    this.name = "RsvpCapExceededError";
  }
}

const RSVP_TABLE = "plan_invite_rsvps";
const REACTION_TABLE = "plan_invite_reactions";

// ── RSVP ─────────────────────────────────────────────────────────────────

type RsvpRow = { id: string; display_name: string; status: string; created_at: string };

function summarizeRsvpRows(rows: RsvpRow[]): PlanInviteRsvpSummary {
  const guests = rows
    .filter((row): row is RsvpRow & { status: RsvpStatus } => isRsvpStatus(row.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((row): PlanInviteGuest => ({ id: row.id, displayName: row.display_name, status: row.status }));
  // Counts tally every row before the display cap, so "N going" always
  // reflects the true guest list even once the shown names are trimmed.
  const counts = { going: 0, maybe: 0 };
  for (const guest of guests) counts[guest.status] += 1;
  return { counts, guests: guests.slice(0, GUEST_LIST_DISPLAY_CAP) };
}

export type PlanInviteRsvpStore = {
  /** Insert-or-update a guest's RSVP for a plan; returns the plan's fresh summary. */
  upsert(planId: string, submitterHash: string, displayName: string, status: RsvpStatus): Promise<PlanInviteRsvpSummary>;
  /** Current RSVP summary for a plan's invite page. */
  summarize(planId: string): Promise<PlanInviteRsvpSummary>;
  /** Host-only removal of one guest's RSVP row. No-op if already gone. */
  remove(planId: string, rsvpId: string): Promise<void>;
};

export const supabaseRsvpStore: PlanInviteRsvpStore = {
  async upsert(planId, submitterHash, displayName, status) {
    const { data: existing, error: existingError } = await admin()
      .from(RSVP_TABLE)
      .select("id")
      .eq("plan_id", planId)
      .eq("submitter_hash", submitterHash)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    // Only a brand-new guest counts against the ceiling; an existing guest
    // changing Going/Maybe is always allowed, even once a plan is full.
    if (!existing) {
      const { count, error: countError } = await admin()
        .from(RSVP_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("plan_id", planId);
      if (countError) throw new Error(countError.message);
      if ((count ?? 0) >= RSVP_PLAN_CEILING) throw new RsvpCapExceededError(planId);
    }
    const { error } = await admin()
      .from(RSVP_TABLE)
      .upsert(
        { plan_id: planId, submitter_hash: submitterHash, display_name: displayName, status, updated_at: new Date().toISOString() },
        { onConflict: "plan_id,submitter_hash" },
      );
    if (error) {
      if (isForeignKeyViolation(error)) throw new UnknownPlanError(planId);
      throw new Error(error.message);
    }
    return supabaseRsvpStore.summarize(planId);
  },
  async summarize(planId) {
    const { data, error } = await admin()
      .from(RSVP_TABLE)
      .select("id, display_name, status, created_at")
      .eq("plan_id", planId);
    if (error) throw new Error(error.message);
    return summarizeRsvpRows((data ?? []) as RsvpRow[]);
  },
  async remove(planId, rsvpId) {
    const { error } = await admin().from(RSVP_TABLE).delete().eq("plan_id", planId).eq("id", rsvpId);
    if (error) throw new Error(error.message);
  },
};

// globalThis-anchored, same as lib/planStore.ts's __pubmaxPlanMemory: a Next.js
// production build can bundle this module into separate server chunks per
// route/page, each getting its own top-level state unless it is anchored here.
type InviteRsvpMemoryState = {
  rsvps: Map<string, Map<string, { id: string; displayName: string; status: RsvpStatus; createdAt: string }>>;
};
const inviteRsvpMemoryGlobal = globalThis as typeof globalThis & {
  __pubmaxPlanInviteRsvpMemory?: InviteRsvpMemoryState;
};
const inviteRsvpMemory = inviteRsvpMemoryGlobal.__pubmaxPlanInviteRsvpMemory ??= {
  rsvps: new Map(),
};
inviteRsvpMemory.rsvps ??= new Map();
const memoryRsvps = inviteRsvpMemory.rsvps;

export const memoryRsvpStore: PlanInviteRsvpStore = {
  async upsert(planId, submitterHash, displayName, status) {
    const byPlan = memoryRsvps.get(planId) ?? new Map();
    const existing = byPlan.get(submitterHash);
    if (!existing && byPlan.size >= RSVP_PLAN_CEILING) throw new RsvpCapExceededError(planId);
    byPlan.set(submitterHash, {
      id: existing?.id ?? crypto.randomUUID(),
      displayName,
      status,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });
    memoryRsvps.set(planId, byPlan);
    return memoryRsvpStore.summarize(planId);
  },
  async summarize(planId) {
    const byPlan = memoryRsvps.get(planId);
    const rows: RsvpRow[] = byPlan
      ? [...byPlan.values()].map((row) => ({ id: row.id, display_name: row.displayName, status: row.status, created_at: row.createdAt }))
      : [];
    return summarizeRsvpRows(rows);
  },
  async remove(planId, rsvpId) {
    const byPlan = memoryRsvps.get(planId);
    if (!byPlan) return;
    for (const [hash, row] of byPlan) {
      if (row.id === rsvpId) byPlan.delete(hash);
    }
  },
};

export function rsvpStore(): PlanInviteRsvpStore {
  return selectStore(memoryRsvpStore, supabaseRsvpStore);
}

export function __resetMemoryRsvps(): void {
  memoryRsvps.clear();
}

// ── Reactions ────────────────────────────────────────────────────────────
// Reuses the pub-native reaction allowlist (lib/reactions.ts) rather than a
// second closed emoji taxonomy — one canonical set, everywhere it's needed.

type ReactionRow = { reaction: string; submitter_hash: string };

function summarizeReactionRows(rows: ReactionRow[], submitterHash: string): ReactionSummary {
  const counts: Partial<Record<ReactionKey, number>> = {};
  const mine = new Set<ReactionKey>();
  for (const row of rows) {
    if (!isReactionKey(row.reaction)) continue;
    counts[row.reaction] = (counts[row.reaction] ?? 0) + 1;
    if (row.submitter_hash === submitterHash) mine.add(row.reaction);
  }
  return { counts, mine: [...mine] };
}

export type PlanInviteReactionStore = {
  toggle(planId: string, submitterHash: string, reaction: ReactionKey): Promise<ReactionSummary>;
  summarize(planId: string, submitterHash: string): Promise<ReactionSummary>;
};

export const supabaseReactionStore: PlanInviteReactionStore = {
  async toggle(planId, submitterHash, reaction) {
    const { data: existing, error: readError } = await admin()
      .from(REACTION_TABLE)
      .select("id")
      .eq("plan_id", planId)
      .eq("submitter_hash", submitterHash)
      .eq("reaction", reaction)
      .limit(1);
    if (readError) throw new Error(readError.message);

    if ((existing ?? []).length > 0) {
      const { error } = await admin()
        .from(REACTION_TABLE)
        .delete()
        .eq("plan_id", planId)
        .eq("submitter_hash", submitterHash)
        .eq("reaction", reaction);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin()
        .from(REACTION_TABLE)
        .insert({ plan_id: planId, submitter_hash: submitterHash, reaction });
      if (error) {
        if (isForeignKeyViolation(error)) throw new UnknownPlanError(planId);
        if (!isUniqueViolation(error)) throw new Error(error.message);
      }
    }
    return supabaseReactionStore.summarize(planId, submitterHash);
  },
  async summarize(planId, submitterHash) {
    const { data, error } = await admin()
      .from(REACTION_TABLE)
      .select("reaction, submitter_hash")
      .eq("plan_id", planId);
    if (error) throw new Error(error.message);
    return summarizeReactionRows((data ?? []) as ReactionRow[], submitterHash);
  },
};

// Same globalThis anchor as memoryRsvps above, its own key so a plan store
// bug can't silently share (or collide with) this store's memory shape.
type InviteReactionMemoryState = {
  rows: Set<string>;
};
const inviteReactionMemoryGlobal = globalThis as typeof globalThis & {
  __pubmaxPlanInviteReactionMemory?: InviteReactionMemoryState;
};
const inviteReactionMemory = inviteReactionMemoryGlobal.__pubmaxPlanInviteReactionMemory ??= {
  rows: new Set(),
};
inviteReactionMemory.rows ??= new Set();
const memoryReactionRows = inviteReactionMemory.rows;

function reactionRowKey(planId: string, submitterHash: string, reaction: string): string {
  return `${planId}|${submitterHash}|${reaction}`;
}

export const memoryReactionStore: PlanInviteReactionStore = {
  async toggle(planId, submitterHash, reaction) {
    const key = reactionRowKey(planId, submitterHash, reaction);
    if (memoryReactionRows.has(key)) memoryReactionRows.delete(key);
    else memoryReactionRows.add(key);
    return memoryReactionStore.summarize(planId, submitterHash);
  },
  async summarize(planId, submitterHash) {
    const rows: ReactionRow[] = [];
    const prefix = `${planId}|`;
    for (const key of memoryReactionRows) {
      if (!key.startsWith(prefix)) continue;
      const [, hash, reaction] = key.split("|");
      rows.push({ reaction, submitter_hash: hash });
    }
    return summarizeReactionRows(rows, submitterHash);
  },
};

export function reactionStore(): PlanInviteReactionStore {
  return selectStore(memoryReactionStore, supabaseReactionStore);
}

export function __resetMemoryReactions(): void {
  memoryReactionRows.clear();
}
