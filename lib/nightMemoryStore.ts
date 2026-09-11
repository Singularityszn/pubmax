import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import {
  altTextGapLabel,
  canEditNightStory,
  cleanNightMomentDraft,
  hasConfirmedAltText,
  hasPublicationConsent,
  momentNeedsAltTextConfirmation,
  NIGHT_MOMENT_ALT_TEXT_MAX,
  type MomentConsent,
  type MomentConsentStatus,
  type NightMemory,
  type NightMoment,
  type NightStory,
  type NightStoryPublicationProposal,
  type PublicNightStory,
  type StoryContributor,
  type StoryContributorRole,
} from "@/lib/nightMemory";
import { selectStore } from "@/lib/storeBackend";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";
import { profileStore } from "@/lib/profileStore";
import type { PendingPlanRecap } from "@/lib/planRecap";
import { redactPublicStoryFields, redactStoryView, type DepartedContributor } from "@/lib/storyRedaction";
import { cleanText } from "@/lib/textClean";

type PublishVisibility = "public" | "unlisted";
type ProposalWithToken = {
  proposal: NightStoryPublicationProposal;
  confirmationToken: string;
};

const memories = new Map<string, NightMemory>();
const moments = new Map<string, NightMoment>();
const stories = new Map<string, NightStory>();
const contributors = new Map<string, StoryContributor[]>();
const consents = new Map<string, MomentConsent[]>();
const proposals = new Map<string, NightStoryPublicationProposal & { tokenHash: string }>();

export function __resetNightMemoryStore(): void {
  memories.clear();
  moments.clear();
  stories.clear();
  contributors.clear();
  consents.clear();
  proposals.clear();
}

function now(): string {
  return new Date().toISOString();
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function memoryFromRow(row: Record<string, unknown>): NightMemory {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    title: String(row.title),
    planCompletionId: typeof row.plan_completion_id === "string" ? row.plan_completion_id : null,
    visibility: "private",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function momentFromRow(row: Record<string, unknown>): NightMoment {
  return {
    id: String(row.id),
    memoryId: String(row.memory_id),
    ownerId: String(row.owner_id),
    kind: row.kind as NightMoment["kind"],
    caption: String(row.caption ?? ""),
    pintDropId: typeof row.pint_drop_id === "string" ? row.pint_drop_id : null,
    venueId: typeof row.venue_id === "string" ? row.venue_id : null,
    mediaObjectKey: typeof row.media_object_key === "string" ? row.media_object_key : null,
    occurredAt: typeof row.occurred_at === "string" ? row.occurred_at : null,
    visibility: "private",
    // Additive alt-text columns (migration 0047). Reads tolerate their absence —
    // a pre-migration row simply reports null, so the store degrades to "no
    // author-confirmed description yet" rather than throwing.
    altText: typeof row.alt_text === "string" ? row.alt_text : null,
    altTextConfirmedAt: typeof row.alt_text_confirmed_at === "string" ? row.alt_text_confirmed_at : null,
    createdAt: String(row.created_at),
  };
}

function storyFromRow(row: Record<string, unknown>, publishedMomentIds: string[] = []): NightStory {
  return {
    id: String(row.id),
    memoryId: String(row.memory_id),
    hostEditorId: String(row.host_editor_id),
    title: String(row.title),
    summary: String(row.summary ?? ""),
    status: row.status as NightStory["status"],
    visibility: row.visibility as NightStory["visibility"],
    legacyCrawlStoryId: typeof row.legacy_crawl_story_id === "string" ? row.legacy_crawl_story_id : null,
    publishedMomentIds,
    publishedAt: typeof row.published_at === "string" ? row.published_at : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function contributorFromRow(row: Record<string, unknown>): StoryContributor {
  return {
    storyId: String(row.story_id),
    profileId: String(row.profile_id),
    role: row.role as StoryContributor["role"],
    status: row.status as StoryContributor["status"],
    joinedAt: typeof row.joined_at === "string" ? row.joined_at : null,
  };
}

function consentFromRow(row: Record<string, unknown>): MomentConsent {
  return {
    storyId: String(row.story_id),
    momentId: String(row.moment_id),
    ownerId: String(row.owner_id),
    status: row.status as MomentConsentStatus,
    decidedAt: typeof row.decided_at === "string" ? row.decided_at : null,
  };
}

export async function createNightMemory(
  ownerId: string,
  raw: unknown,
): Promise<NightMemory | null> {
  if (!ownerId || !raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const title = cleanText(input.title, 120);
  const planCompletionId = cleanText(input.planCompletionId, 80) || null;
  // Plans are capability-based and do not carry an authenticated owner yet.
  // Accepting a client-supplied completion id would let any signed-in account
  // attach somebody else's private Night Memory to a guessed/shared Plan.
  if (!title || planCompletionId) return null;
  const timestamp = now();
  const memory: NightMemory = {
    id: randomUUID(),
    ownerId,
    title,
    planCompletionId,
    visibility: "private",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (!isSupabaseConfigured()) {
    memories.set(memory.id, memory);
    return memory;
  }
  const { data, error } = await requireSupabaseAdmin()
    .from("night_memories")
    .insert({
      id: memory.id,
      owner_id: ownerId,
      title,
      plan_completion_id: planCompletionId,
      visibility: "private",
      created_at: timestamp,
      updated_at: timestamp,
    })
    .select("*")
    .single();
  return error || !data ? null : memoryFromRow(data as Record<string, unknown>);
}

function deterministicRecapMomentId(memoryId: string, position: number): string {
  const hex = createHash("sha256").update(`${memoryId}:plan-stop:${position}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Trusted server-only promotion of a validated, capability-bound Plan recap.
 * Generic Memory creation deliberately cannot set planCompletionId; callers
 * must pass through the Plan recap route which verifies both auth and member
 * capability against the canonical completion first.
 */
export async function createNightMemoryFromPlanRecap(
  ownerId: string,
  recap: PendingPlanRecap,
): Promise<{ memory: NightMemory; moments: NightMoment[] } | null> {
  const title = cleanText(recap.title, 120);
  if (!ownerId || !title || !recap.completionId || recap.stops.length < 1) return null;
  const timestamp = now();
  let memory: NightMemory | null = null;

  if (!isSupabaseConfigured()) {
    memory = [...memories.values()].find(
      (item) => item.ownerId === ownerId && item.planCompletionId === recap.completionId,
    ) ?? null;
    if (memory) {
      memory = { ...memory, title, updatedAt: timestamp };
    } else {
      memory = {
        id: randomUUID(),
        ownerId,
        title,
        planCompletionId: recap.completionId,
        visibility: "private",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    }
    memories.set(memory.id, memory);
    const seeded = recap.stops.map((stop) => {
      const id = deterministicRecapMomentId(memory!.id, stop.position);
      const moment: NightMoment = {
        id,
        memoryId: memory!.id,
        ownerId,
        kind: "venue",
        caption: cleanText(stop.caption, 500),
        pintDropId: null,
        venueId: stop.venueId,
        mediaObjectKey: null,
        occurredAt: recap.completedAt,
        visibility: "private",
        // Plan-recap stops carry no photo, so they never need alt text.
        altText: null,
        altTextConfirmedAt: null,
        createdAt: moments.get(id)?.createdAt ?? timestamp,
      };
      moments.set(id, moment);
      return moment;
    });
    return { memory, moments: seeded };
  }

  const admin = requireSupabaseAdmin();
  const promoted = await admin.rpc("create_plan_recap_atomic", {
    p_owner_id: ownerId,
    p_completion_id: recap.completionId,
    p_title: title,
    p_completed_at: recap.completedAt,
    p_stops: recap.stops.map((stop) => ({
      position: stop.position,
      venueId: stop.venueId,
      caption: cleanText(stop.caption, 500),
    })),
  });
  if (promoted.error || typeof promoted.data !== "string") return null;
  const memoryRead = await admin.from("night_memories")
    .select("*")
    .eq("id", promoted.data)
    .single();
  const momentsRead = await admin.from("night_moments")
    .select("*")
    .eq("memory_id", promoted.data)
    .order("created_at");
  if (memoryRead.error || !memoryRead.data || momentsRead.error || !momentsRead.data) return null;
  memory = memoryFromRow(memoryRead.data as Record<string, unknown>);
  return {
    memory,
    moments: momentsRead.data.map((row) => momentFromRow(row as Record<string, unknown>)),
  };
}

export async function listNightMemories(ownerId: string): Promise<NightMemory[]> {
  if (!isSupabaseConfigured()) {
    return [...memories.values()]
      .filter((memory) => memory.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  const { data, error } = await requireSupabaseAdmin()
    .from("night_memories")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  return error ? [] : (data ?? []).map((row) => memoryFromRow(row as Record<string, unknown>));
}

async function getMemory(memoryId: string): Promise<NightMemory | null> {
  if (!isSupabaseConfigured()) return memories.get(memoryId) ?? null;
  const { data, error } = await requireSupabaseAdmin()
    .from("night_memories")
    .select("*")
    .eq("id", memoryId)
    .maybeSingle();
  return error || !data ? null : memoryFromRow(data as Record<string, unknown>);
}

export async function addNightMoment(
  ownerId: string,
  memoryId: string,
  raw: unknown,
  options: { allowContributor?: boolean } = {},
): Promise<NightMoment | null> {
  const memory = await getMemory(memoryId);
  const draft = cleanNightMomentDraft(raw);
  if (!memory || !draft || (!options.allowContributor && memory.ownerId !== ownerId)) return null;
  const createdAt = now();
  // Author-confirmed at creation: alt text supplied here came straight from the
  // author's keyboard on the capture surface (no AI provider is wired in v1), so
  // saving IS the confirmation. When a suggestion provider is added later it must
  // NOT flow through this path pre-confirmed — route the suggestion to the UI and
  // let the author save it (setMomentAltText), never auto-stamp a machine guess.
  const altTextConfirmedAt = draft.altText ? createdAt : null;
  const moment: NightMoment = {
    id: randomUUID(),
    memoryId,
    ownerId,
    ...draft,
    altTextConfirmedAt,
    createdAt,
  };
  if (!isSupabaseConfigured()) {
    moments.set(moment.id, moment);
    return moment;
  }
  const { data, error } = await requireSupabaseAdmin()
    .from("night_moments")
    .insert({
      id: moment.id,
      memory_id: memoryId,
      owner_id: ownerId,
      kind: moment.kind,
      caption: moment.caption,
      pint_drop_id: moment.pintDropId,
      venue_id: moment.venueId,
      media_object_key: moment.mediaObjectKey,
      occurred_at: moment.occurredAt,
      visibility: "private",
      created_at: moment.createdAt,
      // Only reference the additive alt-text columns when there is alt text to
      // write, so a Moment saved WITHOUT a description keeps working even before
      // migration 0047 is applied (fail-soft). A photo WITH a description needs
      // the columns present — the owner applies 0047 with this release.
      ...(moment.altText
        ? { alt_text: moment.altText, alt_text_confirmed_at: moment.altTextConfirmedAt }
        : {}),
    })
    .select("*")
    .single();
  return error || !data ? null : momentFromRow(data as Record<string, unknown>);
}

export async function listNightMoments(
  ownerId: string,
  memoryId: string,
): Promise<NightMoment[]> {
  const memory = await getMemory(memoryId);
  if (!memory || memory.ownerId !== ownerId) return [];
  if (!isSupabaseConfigured()) {
    return [...moments.values()]
      .filter((moment) => moment.memoryId === memoryId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const { data, error } = await requireSupabaseAdmin()
    .from("night_moments")
    .select("*")
    .eq("memory_id", memoryId)
    .order("created_at", { ascending: false });
  return error ? [] : (data ?? []).map((row) => momentFromRow(row as Record<string, unknown>));
}

/**
 * Why a removal was refused. A Memory or Moment that is not the caller's reads
 * as `not_found`, the same answer an unknown id gets, so a stranger learns
 * nothing about what somebody else keeps.
 */
export type NightRemovalRefusal = "not_found" | "published" | "shared" | "error";

/**
 * The outcome of removing a Memory or a Moment. A success carries the storage
 * keys the caller must now delete: the store owns rows, the route owns bytes,
 * exactly as the write path does (the Moment POST uploads in the route).
 */
export type NightRemovalResult =
  | { ok: true; mediaObjectKeys: string[] }
  | { ok: false; reason: NightRemovalRefusal };

function refusal(reason: NightRemovalRefusal): NightRemovalResult {
  return { ok: false, reason };
}

/**
 * Remove one private Moment the caller owns.
 *
 * Ownership is checked AT THE TABLE: the delete statement carries the owner id,
 * so a row that is not the caller's is never matched however the id was found.
 * A Moment already inside a published Story keeps the publication path it has:
 * withdrawing consent takes it out of the Story first (setMomentPublicationConsent).
 */
export async function removeNightMoment(
  ownerId: string,
  momentId: string,
): Promise<NightRemovalResult> {
  if (!ownerId || !momentId) return refusal("not_found");
  // The backend is chosen through the ONE seam (lib/storeBackend.ts) rather
  // than a twenty-fifth hand-rolled branch in this module: the inventory row
  // for this store (`__tests__/storeInventory.test.ts`) may only ever shrink.
  return selectStore(removeMomentFromMemory, removeMomentFromDatabase)(ownerId, momentId);
}

async function removeMomentFromMemory(
  ownerId: string,
  momentId: string,
): Promise<NightRemovalResult> {
  {
    const moment = moments.get(momentId);
    if (!moment || moment.ownerId !== ownerId) return refusal("not_found");
    const published = [...stories.values()].some(
      (story) => story.status === "published" && story.publishedMomentIds.includes(momentId),
    );
    if (published) return refusal("published");
    moments.delete(momentId);
    for (const [storyId, rows] of consents) {
      consents.set(storyId, rows.filter((row) => row.momentId !== momentId));
    }
    return { ok: true, mediaObjectKeys: moment.mediaObjectKey ? [moment.mediaObjectKey] : [] };
  }
}

async function removeMomentFromDatabase(
  ownerId: string,
  momentId: string,
): Promise<NightRemovalResult> {
  const admin = requireSupabaseAdmin();
  const read = await admin
    .from("night_moments")
    .select("id, owner_id, media_object_key")
    .eq("id", momentId)
    .maybeSingle();
  if (read.error) return refusal("error");
  const row = read.data as Record<string, unknown> | null;
  if (!row || String(row.owner_id) !== ownerId) return refusal("not_found");
  const published = await publishedStoryHoldsMoment(momentId);
  if (published === "error") return refusal("error");
  if (published) return refusal("published");
  const deleted = await admin
    .from("night_moments")
    .delete()
    .eq("id", momentId)
    .eq("owner_id", ownerId)
    .select("id");
  if (deleted.error) return refusal("error");
  if (!deleted.data || deleted.data.length === 0) return refusal("not_found");
  const key = typeof row.media_object_key === "string" ? row.media_object_key : null;
  return { ok: true, mediaObjectKeys: key ? [key] : [] };
}

/** Whether a published Story carries this Moment. `error` means we could not look. */
async function publishedStoryHoldsMoment(momentId: string): Promise<boolean | "error"> {
  const admin = requireSupabaseAdmin();
  const joins = await admin
    .from("night_story_moments")
    .select("story_id")
    .eq("moment_id", momentId);
  if (joins.error) return "error";
  const storyIds = (joins.data ?? []).map((join) => String((join as Record<string, unknown>).story_id));
  if (storyIds.length === 0) return false;
  const published = await admin
    .from("night_stories")
    .select("id")
    .in("id", storyIds)
    .eq("status", "published");
  if (published.error) return "error";
  return (published.data ?? []).length > 0;
}

/**
 * Remove one private Memory the caller owns, with the Moments inside it.
 *
 * Two refusals keep somebody else's work out of this delete. A Memory behind a
 * published Story keeps the publication path it has, and a Memory holding a
 * contributor's Moment is theirs as well, so the row cascade may not take it.
 */
export async function removeNightMemory(
  ownerId: string,
  memoryId: string,
): Promise<NightRemovalResult> {
  if (!ownerId || !memoryId) return refusal("not_found");
  return selectStore(removeMemoryFromMemory, removeMemoryFromDatabase)(ownerId, memoryId);
}

async function removeMemoryFromMemory(
  ownerId: string,
  memoryId: string,
): Promise<NightRemovalResult> {
  {
    const memory = memories.get(memoryId);
    if (!memory || memory.ownerId !== ownerId) return refusal("not_found");
    const memoryStories = [...stories.values()].filter((story) => story.memoryId === memoryId);
    if (memoryStories.some((story) => story.status === "published")) return refusal("published");
    const memoryMoments = [...moments.values()].filter((moment) => moment.memoryId === memoryId);
    if (memoryMoments.some((moment) => moment.ownerId !== ownerId)) return refusal("shared");
    for (const moment of memoryMoments) moments.delete(moment.id);
    for (const story of memoryStories) {
      stories.delete(story.id);
      contributors.delete(story.id);
      consents.delete(story.id);
    }
    memories.delete(memoryId);
    return {
      ok: true,
      mediaObjectKeys: memoryMoments
        .map((moment) => moment.mediaObjectKey)
        .filter((key): key is string => Boolean(key)),
    };
  }
}

async function removeMemoryFromDatabase(
  ownerId: string,
  memoryId: string,
): Promise<NightRemovalResult> {
  const admin = requireSupabaseAdmin();
  const storyRead = await admin
    .from("night_stories")
    .select("id, status")
    .eq("memory_id", memoryId);
  if (storyRead.error) return refusal("error");
  const published = (storyRead.data ?? []).some(
    (story) => String((story as Record<string, unknown>).status) === "published",
  );
  if (published) return refusal("published");
  const momentRead = await admin
    .from("night_moments")
    .select("id, owner_id, media_object_key")
    .eq("memory_id", memoryId);
  if (momentRead.error) return refusal("error");
  const rows = (momentRead.data ?? []) as Record<string, unknown>[];
  if (rows.some((row) => String(row.owner_id) !== ownerId)) return refusal("shared");
  const deleted = await admin
    .from("night_memories")
    .delete()
    .eq("id", memoryId)
    .eq("owner_id", ownerId)
    .select("id");
  if (deleted.error) return refusal("error");
  if (!deleted.data || deleted.data.length === 0) return refusal("not_found");
  return {
    ok: true,
    mediaObjectKeys: rows
      .map((row) => (typeof row.media_object_key === "string" ? row.media_object_key : null))
      .filter((key): key is string => Boolean(key)),
  };
}

async function getMoment(momentId: string): Promise<NightMoment | null> {
  if (!isSupabaseConfigured()) return moments.get(momentId) ?? null;
  const { data, error } = await requireSupabaseAdmin()
    .from("night_moments")
    .select("*")
    .eq("id", momentId)
    .maybeSingle();
  return error || !data ? null : momentFromRow(data as Record<string, unknown>);
}

export async function createNightStory(ownerId: string, raw: unknown): Promise<NightStory | null> {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const memoryId = cleanText(input.memoryId, 80);
  const memory = await getMemory(memoryId);
  const title = cleanText(input.title, 120);
  if (!memory || memory.ownerId !== ownerId || !title) return null;
  const timestamp = now();
  const story: NightStory = {
    id: randomUUID(),
    memoryId,
    hostEditorId: ownerId,
    title,
    summary: cleanText(input.summary, 500),
    status: "draft",
    visibility: "private",
    legacyCrawlStoryId: cleanText(input.legacyCrawlStoryId, 80) || null,
    publishedMomentIds: [],
    publishedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const host: StoryContributor = {
    storyId: story.id,
    profileId: ownerId,
    role: "host",
    status: "accepted",
    joinedAt: timestamp,
  };
  if (!isSupabaseConfigured()) {
    stories.set(story.id, story);
    contributors.set(story.id, [host]);
    return story;
  }
  const admin = requireSupabaseAdmin();
  const { error } = await admin.from("night_stories").insert({
    id: story.id,
    memory_id: memoryId,
    host_editor_id: ownerId,
    title: story.title,
    summary: story.summary,
    status: "draft",
    visibility: "private",
    legacy_crawl_story_id: story.legacyCrawlStoryId,
    created_at: timestamp,
    updated_at: timestamp,
  });
  if (error) return null;
  const { error: hostError } = await admin.from("night_story_contributors").insert({
    story_id: story.id,
    profile_id: ownerId,
    role: "host",
    status: "accepted",
    joined_at: timestamp,
  });
  if (hostError) {
    await admin.from("night_stories").delete().eq("id", story.id);
    return null;
  }
  return story;
}

export type NightStoryInboxItem = NightStoryWorkspace["story"] & {
  membership: Pick<StoryContributor, "role" | "status" | "joinedAt">;
};

export async function listNightStoryInbox(actorId: string): Promise<NightStoryStoreResult<NightStoryInboxItem[]>> {
  try {
    let rows: Array<{ story: NightStory; membership: StoryContributor }> = [];
    if (!isSupabaseConfigured()) {
      for (const story of stories.values()) {
        const member = (contributors.get(story.id) ?? []).find((item) => item.profileId === actorId && item.status !== "removed");
        if (member) rows.push({ story, membership: member });
      }
    } else {
      const admin = requireSupabaseAdmin();
      const membershipRead = await admin.from("night_story_contributors")
        .select("*")
        .eq("profile_id", actorId)
        .neq("status", "removed");
      if (membershipRead.error) return { ok: false, error: "error" };
      const memberships = (membershipRead.data ?? []).map((row) => contributorFromRow(row as Record<string, unknown>));
      if (memberships.length > 0) {
        const storyRead = await admin.from("night_stories")
          .select("*")
          .in("id", memberships.map((member) => member.storyId));
        if (storyRead.error) return { ok: false, error: "error" };
        const storyById = new Map((storyRead.data ?? []).map((row) => {
          const story = storyFromRow(row as Record<string, unknown>);
          return [story.id, story] as const;
        }));
        rows = memberships.flatMap((membership) => {
          const story = storyById.get(membership.storyId);
          return story ? [{ story, membership }] : [];
        });
      }
    }
    return { ok: true, value: rows
      .sort((left, right) => {
        if (left.membership.status === "invited" && right.membership.status !== "invited") return -1;
        if (right.membership.status === "invited" && left.membership.status !== "invited") return 1;
        return right.story.updatedAt.localeCompare(left.story.updatedAt);
      })
      .map(({ story, membership }) => ({
        ...safeNightStory(story),
        membership: { role: membership.role, status: membership.status, joinedAt: membership.joinedAt },
      })) };
  } catch {
    return { ok: false, error: "error" };
  }
}

type RowsReadResult<T> = { status: "found"; rows: T[] } | { status: "unavailable" };

/**
 * The contributor rows, two ways. A read we could not RUN is not an empty
 * crew: the publish gate redacts by who has withdrawn, so an error read as
 * "nobody" would emit a departed person's content. `getContributors` below is
 * the fail-soft reading for callers that only ever narrow on the list.
 */
async function readContributors(storyId: string): Promise<RowsReadResult<StoryContributor>> {
  if (!isSupabaseConfigured()) return { status: "found", rows: contributors.get(storyId) ?? [] };
  const { data, error } = await requireSupabaseAdmin()
    .from("night_story_contributors")
    .select("*")
    .eq("story_id", storyId);
  if (error) return { status: "unavailable" };
  return {
    status: "found",
    rows: (data ?? []).map((row) => contributorFromRow(row as Record<string, unknown>)),
  };
}

async function getContributors(storyId: string): Promise<StoryContributor[]> {
  const read = await readContributors(storyId);
  return read.status === "found" ? read.rows : [];
}

async function readConsents(storyId: string): Promise<RowsReadResult<MomentConsent>> {
  if (!isSupabaseConfigured()) return { status: "found", rows: consents.get(storyId) ?? [] };
  const { data, error } = await requireSupabaseAdmin()
    .from("night_moment_consents")
    .select("*")
    .eq("story_id", storyId);
  if (error) return { status: "unavailable" };
  return {
    status: "found",
    rows: (data ?? []).map((row) => consentFromRow(row as Record<string, unknown>)),
  };
}

async function getConsents(storyId: string): Promise<MomentConsent[]> {
  const read = await readConsents(storyId);
  return read.status === "found" ? read.rows : [];
}

/**
 * The departed contributors of a Story (Wayfinder 5.5) — everyone whose content
 * and identity the publish gate must redact. Two independent, additive triggers,
 * unioned here so redaction has ONE input regardless of how someone left:
 *   • CONSENT WITHDRAWN — a contributor withdrew publication consent (the
 *     existing per-owner consents API writes status "withdrawn").
 *   • ACCOUNT DELETED — the profile-delete hook marked their contributor rows
 *     "withdrawn" across every Story (markContributorsDepartedByProfileId).
 * Each departed id is resolved to its handle + display name. A profile row that
 * is genuinely MISSING stays fail-soft: that id keeps a null handle, so its
 * owned Moments are still dropped and only free-text mentions go unscrubbed. A
 * profile read we could not RUN is a different fact, so it is `unavailable` and
 * fails closed - scoped to a Story that actually has a departed contributor,
 * because a Story with nobody to protect returns before any profile is read.
 */
type DepartedReadResult =
  | { status: "found"; departed: DepartedContributor[] }
  | { status: "unavailable" };

async function resolveDepartedContributors(
  contributorsList: StoryContributor[],
  consentsList: MomentConsent[],
): Promise<DepartedReadResult> {
  const departedIds = new Set<string>();
  for (const contributor of contributorsList) {
    if (contributor.status === "withdrawn") departedIds.add(contributor.profileId);
  }
  for (const consent of consentsList) {
    if (consent.status === "withdrawn") departedIds.add(consent.ownerId);
  }
  if (departedIds.size === 0) return { status: "found", departed: [] };
  const store = profileStore();
  try {
    const departed = await Promise.all(
      [...departedIds].sort().map(async (profileId) => {
        const profile = await store.getByUserId(profileId);
        return { profileId, handle: profile?.handle ?? null, displayName: profile?.displayName ?? null };
      }),
    );
    return { status: "found", departed };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Mark a departing account's Story contributions as "withdrawn" everywhere at
 * once — the account-deletion half of the redaction trigger (Wayfinder 5.5).
 * Additive and idempotent: only accepted rows flip, so re-running is a no-op, and
 * it never frees the host slot or touches Moments (redaction is emission-time).
 * Returns the number of contributions marked so the caller can log loudly.
 */
export async function markContributorsDepartedByProfileId(profileId: string): Promise<number> {
  const id = typeof profileId === "string" ? profileId.trim() : "";
  if (!id) return 0;
  if (!isSupabaseConfigured()) {
    let count = 0;
    for (const [storyId, list] of contributors.entries()) {
      let changed = false;
      const next = list.map((contributor) => {
        if (contributor.profileId === id && contributor.status === "accepted") {
          changed = true;
          count += 1;
          return { ...contributor, status: "withdrawn" as const };
        }
        return contributor;
      });
      if (changed) contributors.set(storyId, next);
    }
    return count;
  }
  const { data, error } = await requireSupabaseAdmin()
    .from("night_story_contributors")
    .update({ status: "withdrawn" })
    .eq("profile_id", id)
    .eq("status", "accepted")
    .select("story_id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

type StoryReadResult =
  | { status: "found"; story: NightStory }
  | { status: "absent" }
  | { status: "unavailable" };

/**
 * The Story row, three ways. A read we could not RUN is a fact about us and
 * never a fact about the Story, so it is its own answer here; `getStoryRaw`
 * below is the two-way reading for callers that already treat both absences
 * alike.
 */
async function readStoryRaw(storyId: string): Promise<StoryReadResult> {
  if (!isSupabaseConfigured()) {
    const story = stories.get(storyId);
    return story ? { status: "found", story } : { status: "absent" };
  }
  const admin = requireSupabaseAdmin();
  const [{ data, error }, { data: links, error: linksError }] = await Promise.all([
    admin.from("night_stories").select("*").eq("id", storyId).maybeSingle(),
    admin.from("night_story_moments").select("moment_id").eq("story_id", storyId),
  ]);
  if (error || linksError) return { status: "unavailable" };
  if (!data) return { status: "absent" };
  return {
    status: "found",
    story: storyFromRow(
      data as Record<string, unknown>,
      (links ?? []).map((row) => String(row.moment_id)),
    ),
  };
}

async function getStoryRaw(storyId: string): Promise<NightStory | null> {
  const read = await readStoryRaw(storyId);
  return read.status === "found" ? read.story : null;
}

export type NightStoryReadResult =
  | { status: "found"; story: NightStory | PublicNightStory }
  | { status: "absent" }
  | { status: "unavailable" };

async function readPublicProjection(
  story: NightStory,
  contributorsList: StoryContributor[],
): Promise<NightStoryReadResult> {
  const consentsRead = await readConsents(story.id);
  if (consentsRead.status !== "found") return { status: "unavailable" };
  const departedRead = await resolveDepartedContributors(contributorsList, consentsRead.rows);
  if (departedRead.status !== "found") return { status: "unavailable" };
  return {
    status: "found",
    story: redactPublicStoryFields(safeNightStory(story), departedRead.departed),
  };
}

/**
 * A Story as one caller may see it, three ways. A member gets the unredacted
 * Story (their own workspace projection); anyone else gets the public
 * projection, redacted at the same choke so the OG card and any public API
 * read never carries a departed person's identity (5.5). A read we could not
 * run is `unavailable`, never `absent`, so no surface turns an outage into a
 * 404 or a day-long not-shared card. `getNightStory` is the two-way reading.
 *
 * A null actor is the public branch: it takes the public projection below, and
 * that is what a surface with no reader passes. DO NOT READ THE RETURN TYPE AS
 * THE GUARANTEE. `NightStory | PublicNightStory` cannot keep a full Story off a
 * public surface; the `safeNightStory` projection inside `readPublicProjection`
 * is what does, by building a fresh literal of exactly the public fields.
 */
export async function readNightStory(storyId: string, actorId: string | null): Promise<NightStoryReadResult> {
  const storyRead = await readStoryRaw(storyId);
  if (storyRead.status !== "found") return storyRead;
  const { story } = storyRead;
  const shared = story.status === "published" && story.visibility !== "private";
  if (!actorId && !shared) return { status: "absent" };
  const contributorsRead = await readContributors(storyId);
  if (contributorsRead.status !== "found") return { status: "unavailable" };
  const membership = actorId
    ? contributorsRead.rows.some((item) => item.profileId === actorId && item.status === "accepted")
    : false;
  if (membership) return { status: "found", story };
  if (!shared) return { status: "absent" };
  return readPublicProjection(story, contributorsRead.rows);
}

export async function getNightStory(
  storyId: string,
  actorId: string | null,
): Promise<NightStory | PublicNightStory | null> {
  const read = await readNightStory(storyId, actorId);
  return read.status === "found" ? read.story : null;
}

export type PublishedRecapSource = { story: PublicNightStory; moments: NightMoment[] };

/**
 * What a public recap read really answered (astra-review P1-1).
 *
 * `getPublishedRecapSource` collapses three outcomes into `null`, and the page
 * above it turns a null into `notFound()`, so a PostgREST error from
 * `night_stories` or `night_moments` told a crew standing on a published Story
 * that it does not exist. A read we could not RUN is a fact about us, never a
 * fact about the Story, so it is its own answer and the surface words it as
 * one. The twin is `PlanReadResult` in `lib/planStore.ts`.
 */
export type PublishedRecapReadResult =
  | { status: "found"; source: PublishedRecapSource }
  | { status: "absent" }
  | { status: "unavailable" };

/**
 * Read-only public recap source, three ways. `found` carries the story plus
 * ONLY the moments that cleared the full consent gate: the story is published
 * and non-private, and each moment is in `publishedMomentIds` (which the
 * publish flow only ever fills from owner-approved consents, and a later
 * withdrawal empties). No auth account or memory identifiers are exposed;
 * nothing pending, withdrawn, or unlisted-off leaks. Anything short of the gate
 * is `absent`; a read the store could not run is `unavailable`, and nothing is
 * read past the gate, so a refusal costs no Moment query.
 */
export async function readPublishedRecapSource(storyId: string): Promise<PublishedRecapReadResult> {
  const storyRead = await readStoryRaw(storyId);
  if (storyRead.status !== "found") return storyRead;
  const { story } = storyRead;
  if (story.status !== "published" || story.visibility === "private") return { status: "absent" };

  // The one-choke redaction (Wayfinder 5.5): a departing person's content and
  // identity are erased here, at the single public-emission gate, so every
  // downstream surface (recap page, recap OG, feed) inherits the erase with no
  // second gate. Redaction is emission-time — the private source Moments below
  // are never mutated; only this projected copy is.
  // The departed set is read three ways too: a contributors, consents or
  // profile read that failed is not "nobody has withdrawn", so it is
  // unavailable, and it is answered before a single Moment is read.
  const [contributorsRead, consentsRead] = await Promise.all([
    readContributors(storyId),
    readConsents(storyId),
  ]);
  if (contributorsRead.status !== "found" || consentsRead.status !== "found") {
    return { status: "unavailable" };
  }
  const departedRead = await resolveDepartedContributors(contributorsRead.rows, consentsRead.rows);
  if (departedRead.status !== "found") return { status: "unavailable" };
  const { departed } = departedRead;

  const allow = new Set(story.publishedMomentIds);
  if (allow.size === 0) {
    return {
      status: "found",
      source: redactStoryView({ story: safeNightStory(story), moments: [], departed }),
    };
  }
  let storyMoments: NightMoment[];
  if (!isSupabaseConfigured()) {
    storyMoments = [...moments.values()].filter((moment) => moment.memoryId === story.memoryId);
  } else {
    const { data, error } = await requireSupabaseAdmin()
      .from("night_moments")
      .select("*")
      .eq("memory_id", story.memoryId)
      .order("occurred_at", { ascending: true });
    // A Moment read that failed is not a Story with no Moments, and it is not
    // a Story that has gone. It is unavailable, and the page says so.
    if (error) return { status: "unavailable" };
    storyMoments = (data ?? []).map((row) => momentFromRow(row as Record<string, unknown>));
  }
  // Two emission belts, composed in order — never one overwriting the other.
  // FIRST the one-choke redaction (Wayfinder 5.5): every Moment owned by a
  // departed contributor is dropped (their media gone) and their name scrubbed
  // from the survivors and the Story text. THEN, on the SURVIVING media, the
  // alt-text belt (Wayfinder 5.6): the public recap must never present an
  // UNCONFIRMED description as if the author stood behind it (a future AI
  // suggestion, or a pre-gate value) — we null the string but NEVER drop the
  // photo, so grandfathered published photos keep showing. Redaction can only
  // remove media the alt-text belt would have sanitised; running it first means
  // the belt only touches media that actually survives to the public.
  const redacted = redactStoryView({
    story: safeNightStory(story),
    moments: storyMoments.filter((moment) => allow.has(moment.id)),
    departed,
  });
  return {
    status: "found",
    source: {
      story: redacted.story,
      moments: redacted.moments.map((moment) =>
        hasConfirmedAltText(moment) ? moment : { ...moment, altText: null },
      ),
    },
  };
}

/**
 * Found or not, for callers that already treat both absences alike (the recap
 * card and its stats, which draw nothing either way). A surface that WORDS an
 * absence to a reader asks `readPublishedRecapSource` instead.
 */
export async function getPublishedRecapSource(storyId: string): Promise<PublishedRecapSource | null> {
  const read = await readPublishedRecapSource(storyId);
  return read.status === "found" ? read.source : null;
}

export type NightStoryWorkspace = {
  story: Omit<NightStory, "memoryId" | "hostEditorId">;
  moments: Array<Pick<NightMoment, "id" | "kind" | "caption" | "venueId" | "occurredAt"> & {
    ownedByCaller: boolean;
    consent: MomentConsentStatus | "pending";
    // Alt-text authoring at review time. `hasPhoto` gates the field's presence;
    // `altText` is disclosed only to the photo's OWNER (their own words to edit);
    // `altTextConfirmed` is a plain boolean anyone in the workspace can see so a
    // host knows whether a contributor's photo is publication-ready.
    hasPhoto: boolean;
    altText: string | null;
    altTextConfirmed: boolean;
  }>;
  contributors: Array<Pick<StoryContributor, "role" | "status" | "joinedAt"> & { handle: string | null }>;
  caller: { role: StoryContributorRole; canEdit: boolean };
};

export type NightStoryStoreError = "invalid" | "not_found" | "forbidden" | "error";
export type NightStoryStoreResult<T> = { ok: true; value: T } | { ok: false; error: NightStoryStoreError };

export function safeNightStory(story: NightStory): NightStoryWorkspace["story"] {
  return {
    id: story.id,
    title: story.title,
    summary: story.summary,
    status: story.status,
    visibility: story.visibility,
    legacyCrawlStoryId: story.legacyCrawlStoryId,
    publishedMomentIds: story.publishedMomentIds,
    publishedAt: story.publishedAt,
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
  };
}

export async function getNightStoryWorkspaceResult(actorId: string, storyId: string): Promise<NightStoryStoreResult<NightStoryWorkspace>> {
  try {
    let story: NightStory | null;
    let members: StoryContributor[];
    let storyConsents: MomentConsent[];
    let storyMoments: NightMoment[];
    if (!isSupabaseConfigured()) {
      story = stories.get(storyId) ?? null;
      members = contributors.get(storyId) ?? [];
      storyConsents = consents.get(storyId) ?? [];
      storyMoments = story ? [...moments.values()].filter((moment) => moment.memoryId === story!.memoryId) : [];
    } else {
      const admin = requireSupabaseAdmin();
      const [storyRead, memberRead, consentRead, linkRead] = await Promise.all([
        admin.from("night_stories").select("*").eq("id", storyId).maybeSingle(),
        admin.from("night_story_contributors").select("*").eq("story_id", storyId),
        admin.from("night_moment_consents").select("*").eq("story_id", storyId),
        admin.from("night_story_moments").select("moment_id").eq("story_id", storyId),
      ]);
      if (storyRead.error || memberRead.error || consentRead.error || linkRead.error) return { ok: false, error: "error" };
      story = storyRead.data
        ? storyFromRow(storyRead.data as Record<string, unknown>, (linkRead.data ?? []).map((row) => String(row.moment_id)))
        : null;
      members = (memberRead.data ?? []).map((row) => contributorFromRow(row as Record<string, unknown>));
      storyConsents = (consentRead.data ?? []).map((row) => consentFromRow(row as Record<string, unknown>));
      if (!story) storyMoments = [];
      else {
        const momentRead = await admin.from("night_moments").select("*").eq("memory_id", story.memoryId).order("created_at");
        if (momentRead.error) return { ok: false, error: "error" };
        storyMoments = (momentRead.data ?? []).map((row) => momentFromRow(row as Record<string, unknown>));
      }
    }
    if (!story) return { ok: false, error: "not_found" };
    const caller = members.find((member) => member.profileId === actorId && member.status === "accepted");
    if (!caller) return { ok: false, error: "forbidden" };
    const memberProfiles = await Promise.all(members.map(async (member) => ({
      member,
      profile: await profileStore().getByUserId(member.profileId),
    })));
    const visibleMoments = storyMoments.flatMap((moment) => {
      const ownedByCaller = moment.ownerId === actorId;
      const consent = storyConsents.find((item) => item.momentId === moment.id)?.status ?? "pending";
      const disclosed = ownedByCaller || (
        consent === "approved"
        && (story.status === "draft" || story.publishedMomentIds.includes(moment.id))
      );
      return disclosed ? [{
        id: moment.id,
        kind: moment.kind,
        caption: moment.caption,
        venueId: moment.venueId,
        occurredAt: moment.occurredAt,
        ownedByCaller,
        consent,
        hasPhoto: Boolean(moment.mediaObjectKey),
        altText: ownedByCaller ? moment.altText : null,
        altTextConfirmed: hasConfirmedAltText(moment),
      }] : [];
    });
    return { ok: true, value: {
      story: safeNightStory(story),
      moments: visibleMoments,
      contributors: memberProfiles.map(({ member, profile }) => ({
        role: member.role,
        status: member.status,
        joinedAt: member.joinedAt,
        handle: profile?.handle ?? null,
      })),
      caller: { role: caller.role, canEdit: caller.role === "host" || caller.role === "editor" },
    } };
  } catch {
    return { ok: false, error: "error" };
  }
}

export async function getNightStoryWorkspace(actorId: string, storyId: string): Promise<NightStoryWorkspace | null> {
  const result = await getNightStoryWorkspaceResult(actorId, storyId);
  return result.ok ? result.value : null;
}

export async function updateNightStoryDraftResult(
  actorId: string,
  storyId: string,
  raw: unknown,
): Promise<NightStoryStoreResult<NightStory>> {
  if (!raw || typeof raw !== "object") return { ok: false, error: "invalid" };
  const input = raw as Record<string, unknown>;
  const title = cleanText(input.title, 120);
  const summary = cleanText(input.summary, 500);
  if (!title) return { ok: false, error: "invalid" };
  const updatedAt = now();
  if (!isSupabaseConfigured()) {
    const story = stories.get(storyId) ?? null;
    if (!story) return { ok: false, error: "not_found" };
    const members = contributors.get(storyId) ?? [];
    if (!canEditNightStory(actorId, members)) return { ok: false, error: "forbidden" };
    if (story.status !== "draft") return { ok: false, error: "invalid" };
    const updated = { ...story, title, summary, updatedAt };
    stories.set(storyId, updated);
    return { ok: true, value: updated };
  }
  try {
    const admin = requireSupabaseAdmin();
    const { data, error } = await admin.rpc("update_night_story_draft_atomic", {
      p_story_id: storyId,
      p_actor_id: actorId,
      p_title: title,
      p_summary: summary,
      p_updated_at: updatedAt,
    });
    if (error) return { ok: false, error: "error" };
    if (data !== true) {
      const exists = await admin.from("night_stories").select("id,status").eq("id", storyId).maybeSingle();
      if (exists.error) return { ok: false, error: "error" };
      if (!exists.data) return { ok: false, error: "not_found" };
      return { ok: false, error: exists.data.status === "draft" ? "forbidden" : "invalid" };
    }
    const refreshed = await getStoryRaw(storyId);
    return refreshed ? { ok: true, value: refreshed } : { ok: false, error: "error" };
  } catch {
    return { ok: false, error: "error" };
  }
}

export async function upsertStoryContributor(
  actorId: string,
  storyId: string,
  raw: unknown,
): Promise<StoryContributor | null> {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const handle = cleanText(input.handle, 30).toLocaleLowerCase();
  const invitedProfile = handle ? await profileStore().getByHandle(handle) : null;
  const profileId = invitedProfile?.userId ?? "";
  const allowedRoles: StoryContributorRole[] = ["editor", "contributor"];
  const role = allowedRoles.includes(input.role as StoryContributorRole)
    ? (input.role as StoryContributorRole)
    : "contributor";
  const current = await getContributors(storyId);
  if (!profileId || !canEditNightStory(actorId, current)) return null;
  const contributor: StoryContributor = {
    storyId,
    profileId,
    role,
    status: "invited",
    joinedAt: null,
  };
  if (!isSupabaseConfigured()) {
    contributors.set(storyId, [...current.filter((item) => item.profileId !== profileId), contributor]);
    return contributor;
  }
  const { error } = await requireSupabaseAdmin().from("night_story_contributors").upsert({
    story_id: storyId,
    profile_id: profileId,
    role,
    status: "invited",
    joined_at: null,
  }, { onConflict: "story_id,profile_id" });
  return error ? null : contributor;
}

export async function acceptStoryContributionResult(actorId: string, storyId: string): Promise<NightStoryStoreResult<StoryContributor>> {
  const joinedAt = now();
  if (!isSupabaseConfigured()) {
    const current = contributors.get(storyId) ?? [];
    const invitation = current.find((item) => item.profileId === actorId && item.status === "invited");
    if (!invitation) return { ok: false, error: "not_found" };
    const accepted: StoryContributor = { ...invitation, status: "accepted", joinedAt };
    contributors.set(storyId, current.map((item) => item.profileId === actorId ? accepted : item));
    return { ok: true, value: accepted };
  }
  try {
    const { data, error } = await requireSupabaseAdmin().from("night_story_contributors")
      .update({ status: "accepted", joined_at: joinedAt })
      .eq("story_id", storyId)
      .eq("profile_id", actorId)
      .eq("status", "invited")
      .select("*")
      .maybeSingle();
    if (error) return { ok: false, error: "error" };
    return data
      ? { ok: true, value: contributorFromRow(data as Record<string, unknown>) }
      : { ok: false, error: "not_found" };
  } catch {
    return { ok: false, error: "error" };
  }
}

export async function acceptStoryContribution(actorId: string, storyId: string): Promise<StoryContributor | null> {
  const result = await acceptStoryContributionResult(actorId, storyId);
  return result.ok ? result.value : null;
}

export async function declineStoryContributionResult(actorId: string, storyId: string): Promise<NightStoryStoreResult<true>> {
  if (!isSupabaseConfigured()) {
    const current = contributors.get(storyId) ?? [];
    const invitation = current.find((item) => item.profileId === actorId && item.status === "invited");
    if (!invitation) return { ok: false, error: "not_found" };
    contributors.set(storyId, current.map((item) => item.profileId === actorId ? { ...item, status: "removed", joinedAt: null } : item));
    return { ok: true, value: true };
  }
  try {
    const { data, error } = await requireSupabaseAdmin().from("night_story_contributors")
      .update({ status: "removed", joined_at: null })
      .eq("story_id", storyId)
      .eq("profile_id", actorId)
      .eq("status", "invited")
      .select("story_id")
      .maybeSingle();
    if (error) return { ok: false, error: "error" };
    return data ? { ok: true, value: true } : { ok: false, error: "not_found" };
  } catch {
    return { ok: false, error: "error" };
  }
}

/** Add a private Moment through an accepted Story collaboration. */
export async function addStoryMoment(
  actorId: string,
  storyId: string,
  raw: unknown,
): Promise<NightMoment | null> {
  const [story, members] = await Promise.all([getStoryRaw(storyId), getContributors(storyId)]);
  const accepted = members.some(
    (member) => member.profileId === actorId && member.status === "accepted",
  );
  if (!story || !accepted) return null;
  return addNightMoment(actorId, story.memoryId, raw, { allowContributor: true });
}

export async function setMomentPublicationConsent(
  actorId: string,
  storyId: string,
  momentId: string,
  status: MomentConsentStatus,
): Promise<MomentConsent | null> {
  if (!(["approved", "withdrawn"] as MomentConsentStatus[]).includes(status)) return null;
  const [story, moment] = await Promise.all([getStoryRaw(storyId), getMoment(momentId)]);
  if (!story || !moment || moment.memoryId !== story.memoryId || moment.ownerId !== actorId) return null;
  const consent: MomentConsent = { storyId, momentId, ownerId: actorId, status, decidedAt: now() };
  if (!isSupabaseConfigured()) {
    const current = consents.get(storyId) ?? [];
    consents.set(storyId, [...current.filter((item) => item.momentId !== momentId), consent]);
    if (status === "withdrawn") {
      stories.set(storyId, { ...story, publishedMomentIds: story.publishedMomentIds.filter((id) => id !== momentId), updatedAt: now() });
    }
    return consent;
  }
  const admin = requireSupabaseAdmin();
  const { error } = await admin.from("night_moment_consents").upsert({
    story_id: storyId,
    moment_id: momentId,
    owner_id: actorId,
    status,
    decided_at: consent.decidedAt,
  }, { onConflict: "story_id,moment_id" });
  if (error) return null;
  if (status === "withdrawn") {
    await admin.from("night_story_moments").delete().eq("story_id", storyId).eq("moment_id", momentId);
  }
  return consent;
}

export async function proposeNightStoryPublication(
  actorId: string,
  storyId: string,
  raw: unknown,
): Promise<ProposalWithToken | null> {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const visibility: PublishVisibility | null = input.visibility === "public" || input.visibility === "unlisted"
    ? input.visibility
    : null;
  const momentIds = Array.isArray(input.momentIds)
    ? [...new Set(input.momentIds.filter((value): value is string => typeof value === "string" && value.length > 0))].slice(0, 100)
    : [];
  const [story, members, storyConsents] = await Promise.all([
    getStoryRaw(storyId),
    getContributors(storyId),
    getConsents(storyId),
  ]);
  if (!story || !visibility || momentIds.length === 0 || !canEditNightStory(actorId, members)) return null;
  const selected = await Promise.all(momentIds.map(getMoment));
  if (selected.some((moment) => !moment || moment.memoryId !== story.memoryId)) return null;
  const canPublishAll = selected.every((moment) =>
    moment && (moment.ownerId === actorId || hasPublicationConsent(moment.ownerId, moment.id, storyConsents)),
  );
  if (!canPublishAll) return null;
  // Accessibility gate (5.6): a photo Moment cannot be published until its author
  // has confirmed alt text. Blocks here at the single publish choke; the route
  // surfaces WHICH photo via findPublishAltTextGap. Private saves never reach this.
  if (selected.some((moment) => moment && momentNeedsAltTextConfirmation(moment))) return null;
  const confirmationToken = randomBytes(32).toString("hex");
  const proposal: NightStoryPublicationProposal = {
    id: randomUUID(),
    storyId,
    requestedBy: actorId,
    momentIds,
    visibility,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    confirmedAt: null,
  };
  const tokenHash = hashToken(confirmationToken);
  if (!isSupabaseConfigured()) {
    proposals.set(proposal.id, { ...proposal, tokenHash });
    return { proposal, confirmationToken };
  }
  const { error } = await requireSupabaseAdmin().from("night_story_publish_proposals").insert({
    id: proposal.id,
    story_id: storyId,
    requested_by: actorId,
    moment_ids: momentIds,
    visibility,
    token_hash: tokenHash,
    expires_at: proposal.expiresAt,
  });
  return error ? null : { proposal, confirmationToken };
}

export async function confirmNightStoryPublication(
  actorId: string,
  storyId: string,
  raw: unknown,
): Promise<NightStory | null> {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const proposalId = cleanText(input.proposalId, 80);
  const confirmationToken = cleanText(input.confirmationToken, 128);
  if (!proposalId || !confirmationToken) return null;
  let proposal: (NightStoryPublicationProposal & { tokenHash: string }) | null = null;
  if (!isSupabaseConfigured()) {
    proposal = proposals.get(proposalId) ?? null;
  } else {
    const { data, error } = await requireSupabaseAdmin().from("night_story_publish_proposals")
      .select("*").eq("id", proposalId).maybeSingle();
    if (!error && data) {
      proposal = {
        id: String(data.id),
        storyId: String(data.story_id),
        requestedBy: String(data.requested_by),
        momentIds: Array.isArray(data.moment_ids) ? data.moment_ids.map(String) : [],
        visibility: data.visibility as PublishVisibility,
        expiresAt: String(data.expires_at),
        confirmedAt: typeof data.confirmed_at === "string" ? data.confirmed_at : null,
        tokenHash: String(data.token_hash),
      };
    }
  }
  if (
    !proposal || proposal.storyId !== storyId || proposal.requestedBy !== actorId ||
    proposal.confirmedAt || Date.parse(proposal.expiresAt) <= Date.now() ||
    !tokenMatches(confirmationToken, proposal.tokenHash)
  ) return null;

  // Re-evaluate consent at confirmation time so a withdrawal after proposal wins.
  const refreshed = await proposeEligibility(actorId, storyId, proposal.momentIds);
  if (!refreshed) return null;
  const publishedAt = now();
  if (!isSupabaseConfigured()) {
    const story = stories.get(storyId);
    if (!story) return null;
    const published: NightStory = {
      ...story,
      status: "published",
      visibility: proposal.visibility,
      publishedMomentIds: proposal.momentIds,
      publishedAt,
      updatedAt: publishedAt,
    };
    stories.set(storyId, published);
    proposals.set(proposal.id, { ...proposal, confirmedAt: publishedAt });
    return published;
  }
  const { data, error } = await requireSupabaseAdmin().rpc("confirm_night_story_publication", {
    p_proposal_id: proposal.id,
    p_story_id: storyId,
    p_requested_by: actorId,
    p_token_hash: proposal.tokenHash,
  });
  if (error || data !== true) return null;
  return getStoryRaw(storyId);
}

async function proposeEligibility(actorId: string, storyId: string, momentIds: string[]): Promise<boolean> {
  const [story, members, storyConsents] = await Promise.all([
    getStoryRaw(storyId),
    getContributors(storyId),
    getConsents(storyId),
  ]);
  if (!story || !canEditNightStory(actorId, members)) return false;
  const selected = await Promise.all(momentIds.map(getMoment));
  // Re-check consent AND the alt-text gate at confirmation time — a description
  // cleared or a consent withdrawn between proposal and confirm must lose.
  return selected.every((moment) =>
    Boolean(moment && moment.memoryId === story.memoryId &&
      (moment.ownerId === actorId || hasPublicationConsent(moment.ownerId, moment.id, storyConsents)) &&
      !momentNeedsAltTextConfirmation(moment)),
  );
}

/**
 * Read-only diagnostic for the publish routes: given the moments a caller tried
 * to publish, name the FIRST photo still missing author-confirmed alt text (or
 * null if none). Lets the 409 response be value-first and specific rather than
 * generic. Does not mutate; the propose/confirm paths remain the enforcing gate.
 */
export async function findPublishAltTextGap(
  actorId: string,
  storyId: string,
  rawMomentIds: unknown,
): Promise<{ momentId: string; label: string } | null> {
  const momentIds = Array.isArray(rawMomentIds)
    ? rawMomentIds.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  if (momentIds.length === 0) return null;
  const story = await getStoryRaw(storyId);
  if (!story) return null;
  const selected = await Promise.all(momentIds.map(getMoment));
  for (const moment of selected) {
    if (moment && moment.memoryId === story.memoryId && momentNeedsAltTextConfirmation(moment)) {
      return { momentId: moment.id, label: altTextGapLabel(moment) };
    }
  }
  return null;
}

/**
 * Author-confirm (or clear) the alt text on the caller's OWN photo Moment. The
 * act of saving is the confirmation — a non-empty description gains a fresh
 * confirmedAt stamp; clearing it drops the stamp (and re-blocks publication).
 * Only the owner of a Moment that actually carries media may write here.
 *
 * AI-suggestion seam: v1 has no suggestion provider. When one is added, pass the
 * *suggested* string to the authoring UI as a prefill the author can edit and
 * then save through THIS function — never call this with machine text on the
 * author's behalf, or the confirmation stops meaning "a human stood behind it".
 */
export async function setMomentAltText(
  actorId: string,
  momentId: string,
  rawAltText: unknown,
): Promise<NightMoment | null> {
  const moment = await getMoment(momentId);
  if (!moment || moment.ownerId !== actorId || !moment.mediaObjectKey) return null;
  const altText = cleanText(rawAltText, NIGHT_MOMENT_ALT_TEXT_MAX) || null;
  const altTextConfirmedAt = altText ? now() : null;
  const updated: NightMoment = { ...moment, altText, altTextConfirmedAt };
  if (!isSupabaseConfigured()) {
    moments.set(momentId, updated);
    return updated;
  }
  const { error } = await requireSupabaseAdmin()
    .from("night_moments")
    .update({ alt_text: altText, alt_text_confirmed_at: altTextConfirmedAt })
    .eq("id", momentId)
    .eq("owner_id", actorId);
  return error ? null : updated;
}
