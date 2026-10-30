import "server-only";

// The store behind "With" handle tags on a Pint Drop (lib/pintDropWithTags.ts
// is the reading rule; migration 0197 is the table). The rules live in ONE
// place, `createPintDropWithTagsStore`, over a small row seam, so the memory
// backend (keyless dev and tests) and the Supabase backend cannot answer the
// same question two ways.
//
// FOUR RULES, each the photo tags' rule (migration 0074) restated for a drop.
// (1) ONLY THE AUTHOR PROPOSES. The drop's stored handle must be the verified
//     actor's handle, and an anonymous drop takes no tags, because the inbox
//     would name its author to the person tagged.
// (2) A TAG NEEDS A LIVE CLAIMED HANDLE. An unclaimed, tombstoned or withdrawn
//     handle, or the author's own, is skipped.
// (3) A BLOCK REFUSES SILENTLY. If either of the pair has blocked the other,
//     or the relationship cannot be read, nothing is written and the answer is
//     the same as for a tag that was written, so the tagger learns nothing.
// (4) CONSENT DECIDES. The person tagged approves or declines; they may later
//     withdraw an approval; the tagger may cancel. Every one of those is a
//     state on the row rather than a delete, so a declined pair cannot be
//     proposed again. Readers see an approved handle and a count of proposals,
//     never a proposed handle.

import { randomUUID } from "node:crypto";

import { isProfileWithdrawnFromPublic, withdrawnHandles } from "@/lib/accountPublicAccess.server";
import { normalizeHandle } from "@/lib/handleNormalize";
import { filterPubliclyReadableDropIds } from "@/lib/pintDropLookup";
import { findPintDropsByIds } from "@/lib/pintDrops";
import { PINT_DROPS_TABLE } from "@/lib/pintDropTable";
import {
  WITH_TAG_MAX,
  type PintDropWithSummary,
  type WithTagState,
} from "@/lib/pintDropWithTags";
import { isProfileTombstoned, profileStore } from "@/lib/profileStore";
import { socialMemoryBlocked } from "@/lib/socialBlockMemory";
import { socialRelationshipBetweenProfiles } from "@/lib/socialRelationships.server";
import { isSupabaseConfigured, requireDynamicSupabaseAdmin } from "@/lib/supabase";
import { selectStore } from "@/lib/storeBackend";

export const PINT_DROP_WITH_TAGS_TABLE = "pint_drop_with_tags" as const;

export type WithTagActor = { profileId: string; handle: string };

export type WithTagRow = {
  id: string;
  dropId: string;
  taggerProfileId: string;
  taggerHandle: string;
  targetProfileId: string;
  targetHandle: string;
  state: WithTagState;
  createdAt: string;
  decidedAt: string | null;
};

export type WithTagLane = "proposed" | "approved";
export type WithTagAction = "approve" | "decline" | "withdraw" | "cancel";

/** One item in the tagged person's inbox. */
export type WithTagInboxItem = {
  id: string;
  kind: "with";
  dropId: string;
  taggerHandle: string;
  venueId: string | null;
  venueName: string | null;
  state: WithTagLane;
  createdAt: string;
};

export type WithTagInboxPage = { proposals: WithTagInboxItem[]; nextCursor: string | null };

export type WithTagErrorKind = "not_owner" | "not_allowed" | "invalid" | "unavailable";

export class WithTagError extends Error {
  constructor(
    message: string,
    readonly kind: WithTagErrorKind,
  ) {
    super(message);
    this.name = "WithTagError";
  }
}

type Cursor = { createdAt: string; id: string };

/** The persistence seam. Each backend answers these and decides nothing. */
export type WithTagRows = {
  /** False when the pair already has a row in any state. */
  insertIfAbsent(row: WithTagRow): Promise<boolean>;
  get(id: string): Promise<WithTagRow | null>;
  /** Move a row from one of `from` to `to`; false when it was not in `from`. */
  setState(id: string, from: readonly WithTagState[], to: WithTagState, at: string): Promise<boolean>;
  listForTarget(
    targetProfileId: string,
    state: WithTagLane,
    before: Cursor | null,
    limit: number,
  ): Promise<WithTagRow[]>;
  listForDrops(dropIds: readonly string[], states: readonly WithTagState[]): Promise<WithTagRow[]>;
};

export type WithTagDrop = {
  handle: string;
  visibility: string;
  status: string;
  venueId: string;
};

export type WithTagDependencies = {
  rows: WithTagRows;
  drop(dropId: string): Promise<WithTagDrop | null>;
  claimedProfile(handle: string): Promise<{ id: string; handle: string } | null>;
  /** True when either has blocked the other, AND when that cannot be read. */
  blocked(firstProfileId: string, secondProfileId: string): Promise<boolean>;
  /** The ids a stranger may read, or null when that could not be decided. */
  publicDropIds(ids: readonly string[]): Promise<string[] | null>;
  hiddenHandles(handles: readonly string[]): Promise<ReadonlySet<string>>;
  venueName(venueId: string): Promise<string | null>;
  now(): Date;
  newId(): string;
};

export type PintDropWithTagsStore = {
  propose(actor: WithTagActor, dropId: string, handles: readonly string[]): Promise<void>;
  inbox(
    actor: WithTagActor,
    input: { lane: WithTagLane; cursor?: string | null; limit: number },
  ): Promise<WithTagInboxPage>;
  act(actor: WithTagActor, proposalId: string, action: WithTagAction): Promise<void>;
  summaries(
    dropIds: readonly string[],
    viewer?: WithTagActor | null,
  ): Promise<Map<string, PintDropWithSummary>>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_SUMMARY_DROPS = 60;

export function isWithTagId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function encodeCursor(row: WithTagRow): string {
  return Buffer.from(JSON.stringify({ c: row.createdAt, i: row.id }), "utf8").toString("base64url");
}

function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;
  try {
    if (value.length > 200) throw new Error();
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { c?: unknown; i?: unknown };
    if (typeof parsed.c !== "string" || !Number.isFinite(Date.parse(parsed.c)) || !isWithTagId(parsed.i)) {
      throw new Error();
    }
    return { createdAt: parsed.c, id: parsed.i };
  } catch {
    throw new WithTagError("That tag page is not valid.", "invalid");
  }
}

/** The transition table. `null` means the action is not this actor's. */
function nextState(
  row: WithTagRow,
  actor: WithTagActor,
  action: WithTagAction,
): { from: WithTagState[]; to: WithTagState; done: boolean } | null {
  const isTarget = row.targetProfileId === actor.profileId;
  const isTagger = row.taggerProfileId === actor.profileId;
  if (isTarget && action === "approve") {
    return { from: ["proposed"], to: "approved", done: row.state === "approved" };
  }
  if (isTarget && action === "decline") {
    return { from: ["proposed"], to: "declined", done: row.state === "declined" };
  }
  if (isTarget && action === "withdraw") {
    return { from: ["approved"], to: "withdrawn", done: row.state === "withdrawn" };
  }
  if (isTagger && action === "cancel") {
    return { from: ["proposed", "approved"], to: "cancelled", done: row.state === "cancelled" };
  }
  return null;
}

export function createPintDropWithTagsStore(deps: WithTagDependencies): PintDropWithTagsStore {
  return {
    async propose(actor, dropId, handles) {
      if (!isWithTagId(dropId)) throw new WithTagError("That Pint Drop is not valid.", "invalid");
      const drop = await deps.drop(dropId);
      const actorHandle = normalizeHandle(actor.handle);
      if (
        !drop ||
        !actorHandle ||
        normalizeHandle(drop.handle) !== actorHandle ||
        drop.visibility === "anonymous" ||
        drop.status === "hidden"
      ) {
        throw new WithTagError("Only the person who posted it can tag who they were with.", "not_owner");
      }
      const wanted = [...new Set(handles.map(normalizeHandle).filter(Boolean))].slice(0, WITH_TAG_MAX);
      for (const handle of wanted) {
        if (handle === actorHandle) continue;
        const profile = await deps.claimedProfile(handle);
        if (!profile || profile.id === actor.profileId) continue;
        // Rule 3: a block, or a relationship that cannot be read, writes
        // nothing and says nothing.
        if (await deps.blocked(actor.profileId, profile.id)) continue;
        await deps.rows.insertIfAbsent({
          id: deps.newId(),
          dropId,
          taggerProfileId: actor.profileId,
          taggerHandle: actorHandle,
          targetProfileId: profile.id,
          targetHandle: normalizeHandle(profile.handle),
          state: "proposed",
          createdAt: deps.now().toISOString(),
          decidedAt: null,
        });
      }
    },

    async inbox(actor, input) {
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
        throw new WithTagError("That tag page is not valid.", "invalid");
      }
      const cursor = decodeCursor(input.cursor);
      const fetched = await deps.rows.listForTarget(actor.profileId, input.lane, cursor, input.limit + 1);
      const page = fetched.slice(0, input.limit);
      const items: WithTagInboxItem[] = [];
      for (const row of page) {
        // A proposal from somebody the reader has since blocked is not shown.
        if (await deps.blocked(row.taggerProfileId, row.targetProfileId)) continue;
        const drop = await deps.drop(row.dropId);
        if (!drop) continue;
        items.push({
          id: row.id,
          kind: "with",
          dropId: row.dropId,
          taggerHandle: row.taggerHandle,
          venueId: drop.venueId || null,
          venueName: drop.venueId ? await deps.venueName(drop.venueId) : null,
          state: input.lane,
          createdAt: row.createdAt,
        });
      }
      const last = page.at(-1);
      return {
        proposals: items,
        nextCursor: fetched.length > input.limit && last ? encodeCursor(last) : null,
      };
    },

    async act(actor, proposalId, action) {
      if (!isWithTagId(proposalId)) throw new WithTagError("Tag choice was not saved.", "invalid");
      const row = await deps.rows.get(proposalId);
      const step = row ? nextState(row, actor, action) : null;
      // An id that names nothing answers exactly as one somebody else owns.
      if (!row || !step) throw new WithTagError("Tag choice was not saved.", "not_allowed");
      if (step.done) return;
      if (!step.from.includes(row.state)) throw new WithTagError("Tag choice was not saved.", "not_allowed");
      if (action === "approve" && (await deps.blocked(row.taggerProfileId, row.targetProfileId))) {
        throw new WithTagError("Tag choice was not saved.", "not_allowed");
      }
      const moved = await deps.rows.setState(row.id, step.from, step.to, deps.now().toISOString());
      if (!moved) throw new WithTagError("Tag choice was not saved.", "not_allowed");
    },

    async summaries(dropIds, viewer) {
      const ids = [...new Set(dropIds.filter(isWithTagId))].slice(0, MAX_SUMMARY_DROPS);
      const out = new Map<string, PintDropWithSummary>();
      if (ids.length === 0) return out;
      const readable = await deps.publicDropIds(ids);
      if (readable === null) throw new WithTagError("Tags are unavailable right now.", "unavailable");
      const allowed = new Set(readable);
      // The author reads their own drop's tags whatever its lane.
      const viewerHandle = normalizeHandle(viewer?.handle ?? "");
      if (viewerHandle) {
        for (const id of ids) {
          if (allowed.has(id)) continue;
          const drop = await deps.drop(id);
          if (drop && normalizeHandle(drop.handle) === viewerHandle) allowed.add(id);
        }
      }
      if (allowed.size === 0) return out;
      const rows = await deps.rows.listForDrops([...allowed], ["proposed", "approved"]);
      const hidden = await deps.hiddenHandles(
        rows.filter((row) => row.state === "approved").map((row) => row.targetHandle),
      );
      for (const row of rows) {
        const summary = out.get(row.dropId) ?? { approved: [], pending: 0 };
        if (row.state === "proposed") {
          summary.pending += 1;
        } else if (!hidden.has(normalizeHandle(row.targetHandle))) {
          // A reader who has blocked, or been blocked by, the person tagged
          // does not see their name on somebody else's drop.
          const viewerBlocked =
            viewer && viewer.profileId !== row.targetProfileId
              ? await deps.blocked(viewer.profileId, row.targetProfileId)
              : false;
          if (!viewerBlocked) summary.approved.push(normalizeHandle(row.targetHandle));
        }
        out.set(row.dropId, summary);
      }
      return out;
    },
  };
}

// ── Memory rows (keyless dev, tests) ────────────────────────────────────────

const memoryRows = new Map<string, WithTagRow>();

function newestFirst(a: WithTagRow, b: WithTagRow): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export const memoryWithTagRows: WithTagRows = {
  async insertIfAbsent(row) {
    for (const existing of memoryRows.values()) {
      if (existing.dropId === row.dropId && existing.targetProfileId === row.targetProfileId) return false;
    }
    memoryRows.set(row.id, { ...row });
    return true;
  },
  async get(id) {
    const row = memoryRows.get(id);
    return row ? { ...row } : null;
  },
  async setState(id, from, to, at) {
    const row = memoryRows.get(id);
    if (!row || !from.includes(row.state)) return false;
    memoryRows.set(id, { ...row, state: to, decidedAt: at });
    return true;
  },
  async listForTarget(targetProfileId, state, before, limit) {
    return [...memoryRows.values()]
      .filter((row) => row.targetProfileId === targetProfileId && row.state === state)
      .filter((row) =>
        !before ||
        row.createdAt < before.createdAt ||
        (row.createdAt === before.createdAt && row.id < before.id),
      )
      .sort(newestFirst)
      .slice(0, limit)
      .map((row) => ({ ...row }));
  },
  async listForDrops(dropIds, states) {
    const ids = new Set(dropIds);
    return [...memoryRows.values()]
      .filter((row) => ids.has(row.dropId) && states.includes(row.state))
      .sort(newestFirst)
      .map((row) => ({ ...row }));
  },
};

export function __resetMemoryWithTags(): void {
  memoryRows.clear();
}

// ── Supabase rows ───────────────────────────────────────────────────────────

const COLUMNS =
  "id,drop_id,tagger_profile_id,tagger_handle,target_profile_id,target_handle,state,created_at,decided_at";

function rowFrom(value: unknown): WithTagRow {
  const row = value as Record<string, unknown> | null;
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.drop_id !== "string" ||
    typeof row.tagger_profile_id !== "string" ||
    typeof row.tagger_handle !== "string" ||
    typeof row.target_profile_id !== "string" ||
    typeof row.target_handle !== "string" ||
    typeof row.state !== "string" ||
    typeof row.created_at !== "string"
  ) {
    throw new WithTagError("Tags are unavailable right now.", "unavailable");
  }
  return {
    id: row.id,
    dropId: row.drop_id,
    taggerProfileId: row.tagger_profile_id,
    taggerHandle: row.tagger_handle,
    targetProfileId: row.target_profile_id,
    targetHandle: row.target_handle,
    state: row.state as WithTagState,
    createdAt: row.created_at,
    decidedAt: typeof row.decided_at === "string" ? row.decided_at : null,
  };
}

function unavailable(error: { message?: string } | null): never {
  throw new WithTagError(error?.message || "Tags are unavailable right now.", "unavailable");
}

export const supabaseWithTagRows: WithTagRows = {
  async insertIfAbsent(row) {
    const { data, error } = await requireDynamicSupabaseAdmin()
      .from(PINT_DROP_WITH_TAGS_TABLE)
      .upsert(
        {
          id: row.id,
          drop_id: row.dropId,
          tagger_profile_id: row.taggerProfileId,
          tagger_handle: row.taggerHandle,
          target_profile_id: row.targetProfileId,
          target_handle: row.targetHandle,
          state: row.state,
          created_at: row.createdAt,
        },
        { onConflict: "drop_id,target_profile_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) unavailable(error);
    return Array.isArray(data) && data.length > 0;
  },
  async get(id) {
    const { data, error } = await requireDynamicSupabaseAdmin()
      .from(PINT_DROP_WITH_TAGS_TABLE)
      .select(COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) unavailable(error);
    return data ? rowFrom(data) : null;
  },
  async setState(id, from, to, at) {
    const { data, error } = await requireDynamicSupabaseAdmin()
      .from(PINT_DROP_WITH_TAGS_TABLE)
      .update({ state: to, decided_at: at })
      .eq("id", id)
      .in("state", [...from])
      .select("id");
    if (error) unavailable(error);
    return Array.isArray(data) && data.length > 0;
  },
  async listForTarget(targetProfileId, state, before, limit) {
    let query = requireDynamicSupabaseAdmin()
      .from(PINT_DROP_WITH_TAGS_TABLE)
      .select(COLUMNS)
      .eq("target_profile_id", targetProfileId)
      .eq("state", state);
    if (before) {
      // Both values were validated by decodeCursor: an ISO date and a uuid.
      query = query.or(
        `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
      );
    }
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) unavailable(error);
    return (Array.isArray(data) ? data : []).map(rowFrom);
  },
  async listForDrops(dropIds, states) {
    if (dropIds.length === 0) return [];
    const { data, error } = await requireDynamicSupabaseAdmin()
      .from(PINT_DROP_WITH_TAGS_TABLE)
      .select(COLUMNS)
      .in("drop_id", [...dropIds])
      .in("state", [...states])
      .order("created_at", { ascending: false });
    if (error) unavailable(error);
    return (Array.isArray(data) ? data : []).map(rowFrom);
  },
};

// ── Default dependencies ────────────────────────────────────────────────────

async function readDrop(dropId: string): Promise<WithTagDrop | null> {
  if (isSupabaseConfigured()) {
    const { data, error } = await requireDynamicSupabaseAdmin()
      .from(PINT_DROPS_TABLE)
      .select("id,handle,visibility,status,venue_id")
      .eq("id", dropId)
      .maybeSingle();
    if (error) unavailable(error);
    if (data) {
      const row = data as Record<string, unknown>;
      return {
        handle: String(row.handle ?? ""),
        visibility: typeof row.visibility === "string" ? row.visibility : "public",
        status: String(row.status ?? ""),
        venueId: String(row.venue_id ?? ""),
      };
    }
  }
  const hit = findPintDropsByIds([dropId]).get(dropId);
  return hit
    ? {
        handle: hit.handle,
        visibility: hit.visibility ?? "public",
        status: hit.status,
        venueId: hit.venueId,
      }
    : null;
}

async function claimedProfile(handle: string): Promise<{ id: string; handle: string } | null> {
  const profile = await profileStore().getByHandle(handle);
  if (!profile || !profile.userId || isProfileTombstoned(profile)) return null;
  if (normalizeHandle(profile.handle) !== handle) return null;
  if (await isProfileWithdrawnFromPublic(profile)) return null;
  return { id: profile.id, handle: profile.handle };
}

async function blockedPair(first: string, second: string): Promise<boolean> {
  if (socialMemoryBlocked(first, second)) return true;
  if (!isSupabaseConfigured()) return false;
  const relationship = await socialRelationshipBetweenProfiles(first, second);
  return relationship === "blocked" || relationship === "unavailable";
}

async function venueName(venueId: string): Promise<string | null> {
  try {
    const { lookupCanonicalVenue } = await import("@/lib/venueIndex");
    const lookup = await lookupCanonicalVenue(venueId);
    return lookup.status === "found" ? lookup.slimVenue.name : null;
  } catch {
    return null;
  }
}

export function defaultWithTagDependencies(rows: WithTagRows): WithTagDependencies {
  return {
    rows,
    drop: readDrop,
    claimedProfile,
    blocked: blockedPair,
    publicDropIds: filterPubliclyReadableDropIds,
    hiddenHandles: withdrawnHandles,
    venueName,
    now: () => new Date(),
    newId: () => randomUUID(),
  };
}

export function pintDropWithTagsStore(): PintDropWithTagsStore {
  return createPintDropWithTagsStore(
    defaultWithTagDependencies(selectStore(memoryWithTagRows, supabaseWithTagRows)),
  );
}
