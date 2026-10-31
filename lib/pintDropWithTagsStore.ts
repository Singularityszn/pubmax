import "server-only";

// The store behind "With" handle tags on a Pint Drop and on a diary entry
// (lib/pintDropWithTags.ts is the reading rule; migration 0204 is the table and
// 0207 lets a row name a diary entry instead of a drop). The rules live in ONE
// place, `createPintDropWithTagsStore`, over a small row seam, so the memory
// backend (keyless dev and tests) and the Supabase backend cannot answer the
// same question two ways.
//
// FOUR RULES, each the photo tags' rule (migration 0074) restated for a drop.
// (1) ONLY THE AUTHOR PROPOSES. The drop's stored handle must be a handle the
//     verified actor's ACCOUNT holds or once held, so a rename keeps the
//     author the author; an anonymous drop takes no tags, because the inbox
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
//
// A HANDLE IS READ, NEVER KEPT. A row keys both people on their profile id.
// The handle columns record what was typed at tag time and are never printed:
// every reader resolves the CURRENT handle through the profile store, so a
// renamed account keeps its tag and an old handle that somebody else claims
// later can never be printed against their profile.
//
// A DIARY ENTRY IS THE OWNER'S ALONE. Its tags follow the same four rules, the
// proposer must be the account that owns the entry, and only that owner reads
// the summary. The person tagged sees the pub in their inbox and nothing else
// of the entry.

import { randomUUID } from "node:crypto";

import { isProfileWithdrawnFromPublic, withdrawnHandles } from "@/lib/accountPublicAccess.server";
import { diaryStore } from "@/lib/diaryStore";
import { normalizeHandle } from "@/lib/handleNormalize";
import { filterPubliclyReadableDropIds } from "@/lib/pintDropLookup";
import { findPintDropsByIds } from "@/lib/pintDrops";
import { PINT_DROPS_TABLE } from "@/lib/pintDropTable";
import {
  WITH_TAG_MAX,
  type DiaryWithTag,
  type PintDropWithSummary,
  type WithTagState,
} from "@/lib/pintDropWithTags";
import { identityHandleStore } from "@/lib/identityHandleStore";
import { isProfileTombstoned, profileStore } from "@/lib/profileStore";
import { socialMemoryBlocked } from "@/lib/socialBlockMemory";
import { socialRelationshipBetweenProfiles } from "@/lib/socialRelationships.server";
import { isSupabaseConfigured, requireDynamicSupabaseAdmin } from "@/lib/supabase";
import { selectStore } from "@/lib/storeBackend";

const PINT_DROP_WITH_TAGS_TABLE = "pint_drop_with_tags" as const;

/**
 * `accountId` is the VERIFIED AUTH USER ID (`profiles.user_id`), the one
 * domain every author check reads: a drop through `ownsHandle`, a diary entry
 * through its `ownerUserId`. An author check never takes a Social actor's
 * `accountId`, which is the private Social account record's own UUID (review
 * P2, PR 2402). The inbox and a choice on a tag read only `profileId`.
 */
export type WithTagActor = { profileId: string; handle: string; accountId?: string };

type WithTagRow = {
  id: string;
  /** Exactly one of dropId and diaryEntryId is set. */
  dropId: string | null;
  diaryEntryId: string | null;
  taggerProfileId: string;
  taggerHandle: string;
  targetProfileId: string;
  targetHandle: string;
  state: WithTagState;
  createdAt: string;
  decidedAt: string | null;
};

type WithTagLane = "proposed" | "approved";
type WithTagAction = "approve" | "decline" | "withdraw" | "cancel";

/** One item in the tagged person's inbox. */
type WithTagInboxItem = {
  id: string;
  kind: "with";
  /** What the tag sits on. A diary entry's id never leaves the owner. */
  subject: "drop" | "diary";
  dropId: string | null;
  taggerHandle: string;
  venueId: string | null;
  venueName: string | null;
  state: WithTagLane;
  createdAt: string;
};

type WithTagInboxPage = { proposals: WithTagInboxItem[]; nextCursor: string | null };

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
  listForDiaryEntries(entryIds: readonly string[], states: readonly WithTagState[]): Promise<WithTagRow[]>;
};

export type WithTagDrop = {
  handle: string;
  visibility: string;
  status: string;
  venueId: string;
};

export type WithTagDiaryEntry = {
  ownerUserId: string;
  venueId: string;
  venueName: string;
};

export type WithTagDependencies = {
  rows: WithTagRows;
  drop(dropId: string): Promise<WithTagDrop | null>;
  diaryEntry(entryId: string): Promise<WithTagDiaryEntry | null>;
  /**
   * The CURRENT handle of each live claimed profile asked about. A profile
   * that is gone, tombstoned or unclaimed is absent, so it prints nothing.
   */
  currentHandles(profileIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  claimedProfile(handle: string): Promise<{ id: string; handle: string } | null>;
  /** True when either has blocked the other, AND when that cannot be read. */
  blocked(firstProfileId: string, secondProfileId: string): Promise<boolean>;
  /** The ids a stranger may read, or null when that could not be decided. */
  publicDropIds(ids: readonly string[]): Promise<string[] | null>;
  hiddenHandles(handles: readonly string[]): Promise<ReadonlySet<string>>;
  venueName(venueId: string): Promise<string | null>;
  /**
   * True when the auth user id holds, or once held, this handle. Authorship of a
   * drop is read through it, because a drop keeps the handle it was posted
   * under and a rename does not rewrite it. Absent in an older fake, where
   * the handle text is compared instead.
   */
  ownsHandle?(accountId: string, handle: string): Promise<boolean>;
  now(): Date;
  newId(): string;
};

export type PintDropWithTagsStore = {
  propose(actor: WithTagActor, dropId: string, handles: readonly string[]): Promise<void>;
  /** The diary twin of `propose`: the actor must own the entry. */
  proposeOnDiary(actor: WithTagActor, entryId: string, handles: readonly string[]): Promise<void>;
  inbox(
    actor: WithTagActor,
    input: { lane: WithTagLane; cursor?: string | null; limit: number },
  ): Promise<WithTagInboxPage>;
  act(actor: WithTagActor, proposalId: string, action: WithTagAction): Promise<void>;
  summaries(
    dropIds: readonly string[],
    viewer?: WithTagActor | null,
  ): Promise<Map<string, PintDropWithSummary>>;
  /**
   * The owner's own diary entries' tags. The caller passes only ids it read
   * from that owner's diary, and each entry is checked against the owner too.
   */
  diarySummaries(ownerUserId: string, entryIds: readonly string[]): Promise<Map<string, PintDropWithSummary>>;
  /**
   * The owner's own tags on their diary entries, one row each, for the edit
   * form. An approved tag names the CURRENT handle; a proposal names the
   * handle the owner typed, which tells them nothing they did not write.
   */
  diaryTagList(ownerUserId: string, entryIds: readonly string[]): Promise<Map<string, DiaryWithTag[]>>;
  /**
   * Change who is tagged on a diary entry after it was saved. A new handle is
   * proposed exactly as at creation (rules 2 to 4); a removed tag is the
   * tagger's own cancel. A pair the owner cancelled may be asked again; a
   * declined one may not.
   */
  editDiaryTags(
    actor: WithTagActor,
    entryId: string,
    change: { add: readonly string[]; remove: readonly string[] },
  ): Promise<void>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_SUMMARY_DROPS = 60;
/** A diary is read whole by its owner, so its cap is higher than one pub's drops. */
const MAX_DIARY_SUMMARY_ENTRIES = 500;

function isWithTagId(value: unknown): value is string {
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
  // Rule 1 for a drop. The account decides, not the handle text: a drop keeps
  // the handle it was posted under, so after a rename the text no longer
  // matches and only the account can say the drop is theirs.
  async function authored(actor: WithTagActor, dropHandle: string): Promise<boolean> {
    const stored = normalizeHandle(dropHandle);
    if (!stored) return false;
    if (actor.accountId && deps.ownsHandle) return deps.ownsHandle(actor.accountId, stored);
    return stored === normalizeHandle(actor.handle);
  }

  // Rules 2 and 3, shared by a drop and a diary entry. Calling it again with
  // the same subject and handle writes nothing: the pair is unique. With
  // `revive`, a pair the tagger cancelled is asked again; a pair the person
  // declined is never asked again.
  async function proposeTo(
    actor: WithTagActor,
    actorHandle: string,
    subject: { dropId: string | null; diaryEntryId: string | null },
    handles: readonly string[],
    revive = false,
  ): Promise<void> {
    const wanted = [...new Set(handles.map(normalizeHandle).filter(Boolean))].slice(0, WITH_TAG_MAX);
    for (const handle of wanted) {
      if (handle === actorHandle) continue;
      const profile = await deps.claimedProfile(handle);
      if (!profile || profile.id === actor.profileId) continue;
      // Rule 3: a block, or a relationship that cannot be read, writes
      // nothing and says nothing.
      if (await deps.blocked(actor.profileId, profile.id)) continue;
      const written = await deps.rows.insertIfAbsent({
        id: deps.newId(),
        ...subject,
        taggerProfileId: actor.profileId,
        taggerHandle: actorHandle,
        targetProfileId: profile.id,
        targetHandle: normalizeHandle(profile.handle),
        state: "proposed",
        createdAt: deps.now().toISOString(),
        decidedAt: null,
      });
      if (written || !revive || !subject.diaryEntryId) continue;
      const [cancelled] = (await deps.rows.listForDiaryEntries([subject.diaryEntryId], ["cancelled"])).filter(
        (row) => row.targetProfileId === profile.id && row.taggerProfileId === actor.profileId,
      );
      if (cancelled) await deps.rows.setState(cancelled.id, ["cancelled"], "proposed", deps.now().toISOString());
    }
  }

  // The diary's owner check, shared by a new tag and an edit of the tags.
  async function ownDiaryEntry(actor: WithTagActor, entryId: string): Promise<string> {
    if (!isWithTagId(entryId)) throw new WithTagError("That diary entry is not valid.", "invalid");
    const entry = await deps.diaryEntry(entryId);
    const actorHandle = normalizeHandle(actor.handle);
    if (!entry || !actorHandle || !actor.accountId || entry.ownerUserId !== actor.accountId) {
      throw new WithTagError("Only the person who logged it can tag who they were with.", "not_owner");
    }
    return actorHandle;
  }

  // Fold rows into one summary per subject. An approved tag prints the
  // person's CURRENT handle, and nothing when it cannot be resolved, is
  // withdrawn from public view, or sits across a block from `readerOf(row)`.
  async function summarise(
    rows: readonly WithTagRow[],
    keyOf: (row: WithTagRow) => string | null,
    readerOf: (row: WithTagRow) => string | null,
  ): Promise<Map<string, PintDropWithSummary>> {
    const out = new Map<string, PintDropWithSummary>();
    const approvedIds = rows.filter((row) => row.state === "approved").map((row) => row.targetProfileId);
    const current = await deps.currentHandles([...new Set(approvedIds)]);
    const hidden = await deps.hiddenHandles([...current.values()]);
    for (const row of rows) {
      const key = keyOf(row);
      if (!key) continue;
      const summary = out.get(key) ?? { approved: [], pending: 0 };
      if (row.state === "proposed") {
        summary.pending += 1;
      } else {
        const handle = normalizeHandle(current.get(row.targetProfileId) ?? "");
        const reader = readerOf(row);
        const readerBlocked =
          handle && reader && reader !== row.targetProfileId
            ? await deps.blocked(reader, row.targetProfileId)
            : false;
        if (handle && !hidden.has(handle) && !readerBlocked) summary.approved.push(handle);
      }
      if (summary.pending > 0 || summary.approved.length > 0) out.set(key, summary);
    }
    return out;
  }

  return {
    async propose(actor, dropId, handles) {
      if (!isWithTagId(dropId)) throw new WithTagError("That Pint Drop is not valid.", "invalid");
      const drop = await deps.drop(dropId);
      const actorHandle = normalizeHandle(actor.handle);
      if (
        !drop ||
        !actorHandle ||
        !(await authored(actor, drop.handle)) ||
        drop.visibility === "anonymous" ||
        drop.status === "hidden"
      ) {
        throw new WithTagError("Only the person who posted it can tag who they were with.", "not_owner");
      }
      await proposeTo(actor, actorHandle, { dropId, diaryEntryId: null }, handles);
    },

    async proposeOnDiary(actor, entryId, handles) {
      const actorHandle = await ownDiaryEntry(actor, entryId);
      await proposeTo(actor, actorHandle, { dropId: null, diaryEntryId: entryId }, handles);
    },

    async editDiaryTags(actor, entryId, change) {
      const actorHandle = await ownDiaryEntry(actor, entryId);
      const removeIds = [...new Set(change.remove)];
      if (removeIds.length > WITH_TAG_MAX || !removeIds.every(isWithTagId)) {
        throw new WithTagError("That tag change is not valid.", "invalid");
      }
      for (const id of removeIds) {
        const row = await deps.rows.get(id);
        // Only this entry's own tags, and only the tagger's cancel. An id that
        // names anything else is passed over as one that names nothing.
        if (!row || row.diaryEntryId !== entryId) continue;
        const step = nextState(row, actor, "cancel");
        if (!step || step.done || !step.from.includes(row.state)) continue;
        await deps.rows.setState(row.id, step.from, step.to, deps.now().toISOString());
      }
      if (change.add.length === 0) return;
      // An entry holds at most WITH_TAG_MAX live tags, however many edits
      // it has seen. A handle already tagged costs nothing.
      const live = await deps.rows.listForDiaryEntries([entryId], ["proposed", "approved"]);
      const liveHandles = new Set(live.map((row) => normalizeHandle(row.targetHandle)));
      const room = Math.max(0, WITH_TAG_MAX - live.length);
      const fresh = [...new Set(change.add.map(normalizeHandle).filter(Boolean))]
        .filter((handle) => !liveHandles.has(handle))
        .slice(0, room);
      if (fresh.length > 0) {
        await proposeTo(actor, actorHandle, { dropId: null, diaryEntryId: entryId }, fresh, true);
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
      const taggers = await deps.currentHandles([...new Set(page.map((row) => row.taggerProfileId))]);
      for (const row of page) {
        // A proposal from somebody the reader has since blocked is not shown.
        if (await deps.blocked(row.taggerProfileId, row.targetProfileId)) continue;
        const taggerHandle = normalizeHandle(taggers.get(row.taggerProfileId) ?? "");
        if (!taggerHandle) continue;
        let venueId: string | null = null;
        let venueName: string | null = null;
        if (row.dropId) {
          const drop = await deps.drop(row.dropId);
          if (!drop) continue;
          venueId = drop.venueId || null;
          venueName = drop.venueId ? await deps.venueName(drop.venueId) : null;
        } else if (row.diaryEntryId) {
          const entry = await deps.diaryEntry(row.diaryEntryId);
          if (!entry) continue;
          venueId = entry.venueId || null;
          venueName = entry.venueName || null;
        } else {
          continue;
        }
        items.push({
          id: row.id,
          kind: "with",
          subject: row.dropId ? "drop" : "diary",
          dropId: row.dropId,
          taggerHandle,
          venueId,
          venueName,
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
          if (drop && viewer && (await authored(viewer, drop.handle))) allowed.add(id);
        }
      }
      if (allowed.size === 0) return out;
      const rows = await deps.rows.listForDrops([...allowed], ["proposed", "approved"]);
      // A reader who has blocked, or been blocked by, the person tagged does
      // not see their name on somebody else's drop.
      return summarise(rows, (row) => row.dropId, () => viewer?.profileId ?? null);
    },

    async diarySummaries(ownerUserId, entryIds) {
      const ids = [...new Set(entryIds.filter(isWithTagId))].slice(0, MAX_DIARY_SUMMARY_ENTRIES);
      if (!ownerUserId || ids.length === 0) return new Map();
      const owned: string[] = [];
      for (const id of ids) {
        const entry = await deps.diaryEntry(id);
        if (entry && entry.ownerUserId === ownerUserId) owned.push(id);
      }
      if (owned.length === 0) return new Map();
      const rows = await deps.rows.listForDiaryEntries(owned, ["proposed", "approved"]);
      // The owner is the tagger, so a block on either side hides the name.
      return summarise(rows, (row) => row.diaryEntryId, (row) => row.taggerProfileId);
    },

    async diaryTagList(ownerUserId, entryIds) {
      const out = new Map<string, DiaryWithTag[]>();
      const ids = [...new Set(entryIds.filter(isWithTagId))].slice(0, MAX_DIARY_SUMMARY_ENTRIES);
      if (!ownerUserId || ids.length === 0) return out;
      const owned: string[] = [];
      for (const id of ids) {
        const entry = await deps.diaryEntry(id);
        if (entry && entry.ownerUserId === ownerUserId) owned.push(id);
      }
      if (owned.length === 0) return out;
      const rows = await deps.rows.listForDiaryEntries(owned, ["proposed", "approved"]);
      const approvedIds = rows.filter((row) => row.state === "approved").map((row) => row.targetProfileId);
      const current = await deps.currentHandles([...new Set(approvedIds)]);
      const hidden = await deps.hiddenHandles([...current.values()]);
      for (const row of rows) {
        if (!row.diaryEntryId) continue;
        // The same block rule as the summary: across a block, no name.
        if (await deps.blocked(row.taggerProfileId, row.targetProfileId)) continue;
        const handle =
          row.state === "approved"
            ? normalizeHandle(current.get(row.targetProfileId) ?? "")
            : normalizeHandle(row.targetHandle);
        if (!handle || (row.state === "approved" && hidden.has(handle))) continue;
        const list = out.get(row.diaryEntryId) ?? [];
        list.push({ id: row.id, handle, state: row.state === "approved" ? "approved" : "proposed" });
        out.set(row.diaryEntryId, list);
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
      if (
        existing.dropId === row.dropId &&
        existing.diaryEntryId === row.diaryEntryId &&
        existing.targetProfileId === row.targetProfileId
      ) {
        return false;
      }
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
      .filter((row) => row.dropId !== null && ids.has(row.dropId) && states.includes(row.state))
      .sort(newestFirst)
      .map((row) => ({ ...row }));
  },
  async listForDiaryEntries(entryIds, states) {
    const ids = new Set(entryIds);
    return [...memoryRows.values()]
      .filter((row) => row.diaryEntryId !== null && ids.has(row.diaryEntryId) && states.includes(row.state))
      .sort(newestFirst)
      .map((row) => ({ ...row }));
  },
};

export function __resetMemoryWithTags(): void {
  memoryRows.clear();
}

// ── Supabase rows ───────────────────────────────────────────────────────────

const LEGACY_COLUMNS =
  "id,drop_id,tagger_profile_id,tagger_handle,target_profile_id,target_handle,state,created_at,decided_at";
const COLUMNS = `${LEGACY_COLUMNS},diary_entry_id`;

/** PostgREST's answer for the 0207 column on a database that has not got it. */
function isMissingDiaryColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (error.code === "42703" || error.code === "PGRST204") && /diary_entry_id/.test(error.message ?? "");
}

/**
 * Run a read with the 0207 column, and again without it on a database that
 * is behind, so a deploy ahead of 0207 keeps every Pint Drop tag working.
 */
async function selectRows<T>(
  run: (columns: string) => PromiseLike<{ data: T; error: { code?: string; message?: string } | null }>,
): Promise<T> {
  let result = await run(COLUMNS);
  if (isMissingDiaryColumn(result.error)) result = await run(LEGACY_COLUMNS);
  if (result.error) unavailable(result.error);
  return result.data;
}

function rowFrom(value: unknown): WithTagRow {
  const row = value as Record<string, unknown> | null;
  const dropId = typeof row?.drop_id === "string" ? row.drop_id : null;
  const diaryEntryId = typeof row?.diary_entry_id === "string" ? row.diary_entry_id : null;
  if (
    !row ||
    typeof row.id !== "string" ||
    (dropId === null) === (diaryEntryId === null) ||
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
    dropId,
    diaryEntryId,
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

const supabaseWithTagRows: WithTagRows = {
  async insertIfAbsent(row) {
    const { data, error } = await requireDynamicSupabaseAdmin()
      .from(PINT_DROP_WITH_TAGS_TABLE)
      .upsert(
        {
          id: row.id,
          // A drop tag never names the 0207 column, so it writes on a
          // database that is behind; a diary tag needs 0207 and says so.
          ...(row.diaryEntryId ? { diary_entry_id: row.diaryEntryId } : { drop_id: row.dropId }),
          tagger_profile_id: row.taggerProfileId,
          tagger_handle: row.taggerHandle,
          target_profile_id: row.targetProfileId,
          target_handle: row.targetHandle,
          state: row.state,
          created_at: row.createdAt,
        },
        {
          onConflict: row.diaryEntryId ? "diary_entry_id,target_profile_id" : "drop_id,target_profile_id",
          ignoreDuplicates: true,
        },
      )
      .select("id");
    if (error) unavailable(error);
    return Array.isArray(data) && data.length > 0;
  },
  async get(id) {
    const data = await selectRows((columns) =>
      requireDynamicSupabaseAdmin().from(PINT_DROP_WITH_TAGS_TABLE).select(columns).eq("id", id).maybeSingle(),
    );
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
    const data = await selectRows((columns) => {
      let query = requireDynamicSupabaseAdmin()
        .from(PINT_DROP_WITH_TAGS_TABLE)
        .select(columns)
        .eq("target_profile_id", targetProfileId)
        .eq("state", state);
      if (before) {
        // Both values were validated by decodeCursor: an ISO date and a uuid.
        query = query.or(
          `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
        );
      }
      return query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
    });
    return (Array.isArray(data) ? data : []).map(rowFrom);
  },
  async listForDrops(dropIds, states) {
    if (dropIds.length === 0) return [];
    const data = await selectRows((columns) =>
      requireDynamicSupabaseAdmin()
        .from(PINT_DROP_WITH_TAGS_TABLE)
        .select(columns)
        .in("drop_id", [...dropIds])
        .in("state", [...states])
        .order("created_at", { ascending: false }),
    );
    return (Array.isArray(data) ? data : []).map(rowFrom);
  },
  async listForDiaryEntries(entryIds, states) {
    if (entryIds.length === 0) return [];
    const { data, error } = await requireDynamicSupabaseAdmin()
      .from(PINT_DROP_WITH_TAGS_TABLE)
      .select(COLUMNS)
      .in("diary_entry_id", [...entryIds])
      .in("state", [...states])
      .order("created_at", { ascending: false });
    // Before 0207 no diary entry can hold a tag, so a behind database has none.
    if (isMissingDiaryColumn(error)) return [];
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

async function readDiaryEntry(entryId: string): Promise<WithTagDiaryEntry | null> {
  const entry = await diaryStore().get(entryId);
  return entry ? { ownerUserId: entry.ownerUserId, venueId: entry.venueId, venueName: entry.venueName } : null;
}

async function currentHandles(profileIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const out = new Map<string, string>();
  const store = profileStore();
  for (const id of new Set(profileIds)) {
    if (!id) continue;
    const profile = await store.getById(id);
    if (!profile || !profile.userId || isProfileTombstoned(profile)) continue;
    const handle = normalizeHandle(profile.handle);
    if (handle) out.set(id, handle);
  }
  return out;
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
    diaryEntry: readDiaryEntry,
    currentHandles,
    claimedProfile,
    blocked: blockedPair,
    publicDropIds: filterPubliclyReadableDropIds,
    hiddenHandles: withdrawnHandles,
    venueName,
    ownsHandle: async (accountId, handle) =>
      (await identityHandleStore().ownedHandle(accountId, [handle])) !== null,
    now: () => new Date(),
    newId: () => randomUUID(),
  };
}

export function pintDropWithTagsStore(): PintDropWithTagsStore {
  return createPintDropWithTagsStore(
    defaultWithTagDependencies(selectStore(memoryWithTagRows, supabaseWithTagRows)),
  );
}
