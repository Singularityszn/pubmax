import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { followStore } from "@/lib/followStore";
import { profileStore } from "@/lib/profileStore";
import {
  socialPostModerationClaim,
  socialPostDTO,
  type SocialPost,
  type SocialPostDTO,
  type SocialPostFields,
} from "@/lib/socialPosts";
import { requireSupabaseAdmin, requiresSupabaseStore } from "@/lib/supabase";
import { isMissingTableSchema, onMissingDurableWrite, selectStore } from "@/lib/storeBackend";
import { trustedSigningKey } from "@/lib/trustedSigningKey.server";

export type SocialPostActor = {
  accountId: string;
  profileId: string;
  handle: string;
};

export type SocialPostRelationships = {
  followingProfileIds: Set<string>;
  mutualProfileIds: Set<string>;
};

export type SocialPostFeedLane = "discover" | "nearby" | "following";

export type SocialPostFeedInput = {
  lane: SocialPostFeedLane;
  area?: string;
  cursor?: string | null;
  limit?: number;
};

export type SocialPostFeedPage = {
  posts: SocialPostDTO[];
  nextCursor: string | null;
};

export type SocialPostServerProjection = {
  post: SocialPostDTO;
  authorProfileId: string;
};

export type SocialPostModerationAdapter = {
  moderate(input: { postId: string; text: string }): Promise<{
    decision: "approved" | "needs_review";
  }>;
};

export type SocialPostModerationResult = {
  processed: number;
  approved: number;
  needsReview: number;
  retried: number;
  terminalErrors: number;
};

export class SocialPostStoreError extends Error {
  constructor(
    public readonly code:
      | "INVALID_CURSOR"
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "EDIT_CONFLICT"
      | "INVALID_POST",
    message: string,
  ) {
    super(message);
  }
}

type RelationshipResolver = (actor: SocialPostActor) => Promise<SocialPostRelationships>;
type Cursor = {
  v: 1;
  lane: SocialPostFeedLane;
  area: string | null;
  createdAt: string;
  id: string;
};

export type SocialPostStore = {
  create(actor: SocialPostActor, fields: SocialPostFields): Promise<SocialPostDTO>;
  edit(
    id: string,
    actor: SocialPostActor,
    changes: Partial<SocialPostFields>,
    contentChanged: boolean,
  ): Promise<SocialPostDTO>;
  remove(id: string, actor: SocialPostActor): Promise<boolean>;
  read(id: string, viewer: SocialPostActor): Promise<SocialPostDTO | null>;
  readServerProjection(id: string, viewer: SocialPostActor): Promise<SocialPostServerProjection | null>;
  feed(viewer: SocialPostActor, input: SocialPostFeedInput): Promise<SocialPostFeedPage>;
  processModerationQueue(
    adapter: SocialPostModerationAdapter,
    limit?: number,
  ): Promise<SocialPostModerationResult>;
  requeueTerminalModeration(limit?: number): Promise<number>;
  applyFeatureRequestUpdate(
    id: string,
    status: "planned" | "shipped" | "declined",
    staffResponse: string,
  ): Promise<void>;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function rowObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Social post row.");
  }
  return value as Record<string, unknown>;
}

function fromRow(value: unknown): SocialPost {
  const row = rowObject(value);
  return {
    id: String(row.id),
    authorProfileId: String(row.author_profile_id),
    authorHandle: String(row.author_handle),
    kind: row.kind === "feature_request" ? "feature_request" : "standard",
    visibility: row.visibility === "friends" || row.visibility === "private"
      ? row.visibility
      : "public",
    status: row.status === "hidden" || row.status === "removed" ? row.status : "visible",
    body: typeof row.body === "string" ? row.body : "",
    area: typeof row.area_slug === "string" ? row.area_slug as SocialPost["area"] : null,
    venueId: typeof row.venue_id === "string" ? row.venue_id : null,
    hashtags: Array.isArray(row.hashtags) ? row.hashtags.map(String) : [],
    commentPolicy: row.comment_policy === "friends" || row.comment_policy === "locked"
      ? row.comment_policy
      : "open",
    photo: row.photo_media_id && row.photo_alt_text
      ? { mediaId: String(row.photo_media_id), altText: String(row.photo_alt_text) }
      : null,
    moderationState: row.moderation_state === "approved" || row.moderation_state === "needs_review"
      ? row.moderation_state
      : "pending",
    featureRequest: row.kind === "feature_request"
      ? {
          status: row.feature_status === "planned" || row.feature_status === "shipped" || row.feature_status === "declined"
            ? row.feature_status
            : "submitted",
          staffResponse: typeof row.feature_staff_response === "string" ? row.feature_staff_response : null,
        }
      : null,
    revision: Number(row.revision ?? 0),
    mutationVersion: Number(row.mutation_version ?? 0),
    editedAt: typeof row.edited_at === "string" ? row.edited_at : null,
    moderatedAt: typeof row.moderated_at === "string" ? row.moderated_at : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function socialPostServerProjectionFromRow(value: unknown): SocialPostServerProjection {
  const post = fromRow(value);
  return {
    post: socialPostDTO(post),
    authorProfileId: post.authorProfileId,
  };
}

function serverProjection(post: SocialPost): SocialPostServerProjection {
  return {
    post: socialPostDTO(post),
    authorProfileId: post.authorProfileId,
  };
}

function cursorSignature(encoded: string, viewerProfileId: string): Buffer {
  return createHmac("sha256", trustedSigningKey())
    .update(`social-post-cursor:v1:${viewerProfileId}:${encoded}`)
    .digest();
}

function encodeCursor(cursor: Cursor, viewerProfileId: string): string {
  const encoded = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  return `${encoded}.${cursorSignature(encoded, viewerProfileId).toString("base64url")}`;
}

function decodeCursor(
  raw: string | null | undefined,
  viewer: SocialPostActor,
  lane: SocialPostFeedLane,
  area: string | null,
): Cursor | null {
  if (!raw) return null;
  try {
    if (raw.length > 1_000) throw new Error("invalid");
    const parts = raw.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("invalid");
    const [encoded, signatureText] = parts;
    const signature = Buffer.from(signatureText, "base64url");
    const expected = cursorSignature(encoded, viewer.profileId);
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
      throw new Error("invalid");
    }
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<Cursor>;
    if (
      parsed.v !== 1 || parsed.lane !== lane ||
      parsed.area !== area || typeof parsed.createdAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.createdAt)) || typeof parsed.id !== "string" || !parsed.id
    ) throw new Error("invalid");
    return parsed as Cursor;
  } catch {
    throw new SocialPostStoreError("INVALID_CURSOR", "That feed page is not valid.");
  }
}

function resolvedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new SocialPostStoreError("INVALID_CURSOR", "Feed size must be between 1 and 50.");
  }
  return value;
}

function newest(left: SocialPost, right: SocialPost): number {
  const byTime = right.createdAt.localeCompare(left.createdAt);
  return byTime || right.id.localeCompare(left.id);
}

function isBefore(post: SocialPost, cursor: Cursor | null): boolean {
  if (!cursor) return true;
  return post.createdAt < cursor.createdAt ||
    (post.createdAt === cursor.createdAt && post.id < cursor.id);
}

function canRead(
  post: SocialPost,
  viewer: SocialPostActor,
  relationships: SocialPostRelationships,
): boolean {
  if (post.status !== "visible" || post.moderationState !== "approved") return false;
  if (post.authorProfileId === viewer.profileId) return true;
  if (post.visibility === "public") return true;
  if (post.visibility === "friends") return relationships.mutualProfileIds.has(post.authorProfileId);
  return false;
}

async function defaultRelationships(actor: SocialPostActor): Promise<SocialPostRelationships> {
  const graph = followStore();
  const profiles = profileStore();
  const [followingHandles, mutualHandles] = await Promise.all([
    graph.listFollowing(actor.handle),
    graph.listMutuals(actor.handle),
  ]);
  const [following, mutual] = await Promise.all([
    Promise.all(followingHandles.map((handle) => profiles.getByHandle(handle))),
    Promise.all(mutualHandles.map((handle) => profiles.getByHandle(handle))),
  ]);
  return {
    followingProfileIds: new Set(following.flatMap((profile) => profile ? [profile.id] : [])),
    mutualProfileIds: new Set(mutual.flatMap((profile) => profile ? [profile.id] : [])),
  };
}

function feedAllows(
  post: SocialPost,
  viewer: SocialPostActor,
  relationships: SocialPostRelationships,
  lane: SocialPostFeedLane,
  area: string | null,
): boolean {
  if (!canRead(post, viewer, relationships)) return false;
  if (lane === "discover") return post.visibility === "public";
  if (lane === "nearby") return post.visibility === "public" && post.area === area;
  if (!relationships.followingProfileIds.has(post.authorProfileId)) return false;
  return post.visibility === "public" ||
    (post.visibility === "friends" && relationships.mutualProfileIds.has(post.authorProfileId));
}

function contentActuallyChanged(current: SocialPost, next: SocialPostFields): boolean {
  return current.kind !== next.kind ||
    current.body !== next.body ||
    current.hashtags.length !== next.hashtags.length ||
    current.hashtags.some((tag, index) => tag !== next.hashtags[index]) ||
    current.photo?.mediaId !== next.photo?.mediaId ||
    current.photo?.altText !== next.photo?.altText;
}

function makePage(
  rows: SocialPost[],
  viewer: SocialPostActor,
  input: SocialPostFeedInput,
  relationships: SocialPostRelationships,
): SocialPostFeedPage {
  const limit = resolvedLimit(input.limit);
  const area = input.area ?? null;
  if (input.lane === "nearby" && !area) {
    throw new SocialPostStoreError("INVALID_CURSOR", "Choose an area for nearby posts.");
  }
  const cursor = decodeCursor(input.cursor, viewer, input.lane, area);
  const matches = rows
    .filter((post) => feedAllows(post, viewer, relationships, input.lane, area))
    .filter((post) => isBefore(post, cursor))
    .sort(newest);
  const pageRows = matches.slice(0, limit);
  const hasMore = matches.length > limit;
  const last = pageRows.at(-1);
  return {
    posts: pageRows.map(socialPostDTO),
    nextCursor: hasMore && last
      ? encodeCursor({
          v: 1,
          lane: input.lane,
          area,
          createdAt: last.createdAt,
          id: last.id,
        }, viewer.profileId)
      : null,
  };
}

type MemoryJob = { postId: string; revision: number; nextAttemptAt: number; attempts: number };

function moderationFailureIsRetryable(error: unknown): boolean {
  return !error || typeof error !== "object" || !("retryable" in error) ||
    (error as { retryable?: unknown }).retryable !== false;
}

export function createMemorySocialPostStore(options: {
  now?: () => Date;
  relationships?: RelationshipResolver;
} = {}): SocialPostStore {
  const rows = new Map<string, SocialPost>();
  const jobs = new Map<string, MemoryJob>();
  const now = options.now ?? (() => new Date());
  const relationships = options.relationships ?? defaultRelationships;

  return {
    async create(actor, fields) {
      const timestamp = now().toISOString();
      const post: SocialPost = {
        id: randomUUID(),
        authorProfileId: actor.profileId,
        authorHandle: actor.handle,
        ...fields,
        status: "visible",
        moderationState: "pending",
        featureRequest: fields.kind === "feature_request"
          ? { status: "submitted", staffResponse: null }
          : null,
        revision: 0,
        mutationVersion: 0,
        editedAt: null,
        moderatedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      rows.set(post.id, post);
      jobs.set(post.id, { postId: post.id, revision: 0, nextAttemptAt: 0, attempts: 0 });
      return socialPostDTO(post);
    },
    async edit(id, actor, changes, contentChanged) {
      const current = rows.get(id);
      if (!current || current.status !== "visible") throw new SocialPostStoreError("NOT_FOUND", "Post not found.");
      if (current.authorProfileId !== actor.profileId) throw new SocialPostStoreError("FORBIDDEN", "That post is not yours.");
      const mergedFields: SocialPostFields = {
        kind: changes.kind ?? current.kind,
        visibility: changes.visibility ?? current.visibility,
        body: changes.body ?? current.body,
        area: "area" in changes ? changes.area ?? null : current.area,
        venueId: "venueId" in changes ? changes.venueId ?? null : current.venueId,
        hashtags: changes.hashtags ?? current.hashtags,
        commentPolicy: changes.commentPolicy ?? current.commentPolicy,
        photo: "photo" in changes ? changes.photo ?? null : current.photo,
      };
      if (!mergedFields.body && !mergedFields.photo) throw new SocialPostStoreError("INVALID_POST", "Add some words or a photo.");
      if (mergedFields.kind === "feature_request" && !mergedFields.body) throw new SocialPostStoreError("INVALID_POST", "Add words to a feature request.");
      if (mergedFields.visibility === "public" && mergedFields.venueId) throw new SocialPostStoreError("INVALID_POST", "Exact venue posts are for friends or private posts.");
      const actualContentChange = contentChanged && contentActuallyChanged(current, mergedFields);
      const timestamp = now().toISOString();
      const post: SocialPost = {
        ...current,
        ...mergedFields,
        featureRequest: mergedFields.kind === "feature_request"
          ? current.featureRequest ?? { status: "submitted", staffResponse: null }
          : null,
        revision: actualContentChange ? current.revision + 1 : current.revision,
        mutationVersion: current.mutationVersion + 1,
        editedAt: actualContentChange ? timestamp : current.editedAt,
        moderationState: actualContentChange ? "pending" : current.moderationState,
        moderatedAt: actualContentChange ? null : current.moderatedAt,
        updatedAt: timestamp,
      };
      rows.set(id, post);
      if (actualContentChange) {
        jobs.set(id, { postId: id, revision: post.revision, nextAttemptAt: 0, attempts: 0 });
      }
      return socialPostDTO(post);
    },
    async remove(id, actor) {
      const post = rows.get(id);
      if (!post || post.status !== "visible") return false;
      if (post.authorProfileId !== actor.profileId) throw new SocialPostStoreError("FORBIDDEN", "That post is not yours.");
      rows.set(id, { ...post, status: "removed", updatedAt: now().toISOString() });
      return true;
    },
    async read(id, viewer) {
      const post = rows.get(id);
      if (!post) return null;
      const graph = await relationships(viewer);
      return canRead(post, viewer, graph) ? socialPostDTO(post) : null;
    },
    async readServerProjection(id, viewer) {
      const post = rows.get(id);
      if (!post) return null;
      const graph = await relationships(viewer);
      return canRead(post, viewer, graph) ? serverProjection(post) : null;
    },
    async feed(viewer, input) {
      const graph = await relationships(viewer);
      return makePage([...rows.values()], viewer, input, graph);
    },
    async applyFeatureRequestUpdate(id, status, staffResponse) {
      const post = rows.get(id);
      if (!post || post.status !== "visible" || post.kind !== "feature_request") {
        throw new SocialPostStoreError("NOT_FOUND", "Feature request not found.");
      }
      rows.set(id, {
        ...post,
        featureRequest: { status, staffResponse },
        updatedAt: now().toISOString(),
      });
    },
    async processModerationQueue(adapter, limit = 20) {
      const result: SocialPostModerationResult = {
        processed: 0,
        approved: 0,
        needsReview: 0,
        retried: 0,
        terminalErrors: 0,
      };
      const currentTime = now().getTime();
      const pending = [...jobs.values()]
        .filter((job) => job.nextAttemptAt <= currentTime)
        .slice(0, Math.min(Math.max(limit, 1), 50));
      await Promise.all(pending.map(async (job) => {
        const post = rows.get(job.postId);
        if (!post || post.moderationState !== "pending") {
          jobs.delete(job.postId);
          return;
        }
        result.processed += 1;
        try {
          const moderation = await adapter.moderate({
            postId: post.id,
            text: socialPostModerationClaim(post),
          });
          const currentPost = rows.get(post.id);
          const currentJob = jobs.get(post.id);
          if (
            !currentPost || !currentJob || currentPost.revision !== job.revision ||
            currentJob.revision !== job.revision || currentPost.moderationState !== "pending"
          ) return;
          rows.set(post.id, {
            ...currentPost,
            moderationState: moderation.decision,
            moderatedAt: now().toISOString(),
          });
          jobs.delete(post.id);
          if (moderation.decision === "approved") result.approved += 1;
          else result.needsReview += 1;
        } catch (error) {
          const currentJob = jobs.get(post.id);
          if (!currentJob || currentJob.revision !== job.revision) return;
          const attempts = job.attempts + 1;
          const retryable = moderationFailureIsRetryable(error) && attempts < 8;
          jobs.set(post.id, {
            ...currentJob,
            attempts,
            nextAttemptAt: retryable
              ? currentTime + Math.min(60_000 * 2 ** (attempts - 1), 3_600_000)
              : Number.POSITIVE_INFINITY,
          });
          if (retryable) result.retried += 1;
          else result.terminalErrors += 1;
        }
      }));
      return result;
    },
    async requeueTerminalModeration(limit = 20) {
      const boundedLimit = Math.min(Math.max(limit, 1), 50);
      let requeued = 0;
      for (const job of jobs.values()) {
        if (requeued >= boundedLimit) break;
        const post = rows.get(job.postId);
        if (job.nextAttemptAt !== Number.POSITIVE_INFINITY || post?.moderationState !== "pending") continue;
        jobs.set(job.postId, {
          ...job,
          attempts: 0,
          nextAttemptAt: now().getTime(),
        });
        requeued += 1;
      }
      return requeued;
    },
  };
}

export const memorySocialPostStore = createMemorySocialPostStore();

function postWrite(
  fields: SocialPostFields,
  actor?: SocialPostActor,
  featureRequest?: SocialPost["featureRequest"],
) {
  const feature = fields.kind === "feature_request"
    ? featureRequest ?? { status: "submitted" as const, staffResponse: null }
    : null;
  return {
    ...(actor ? { author_profile_id: actor.profileId, author_handle: actor.handle } : {}),
    kind: fields.kind,
    visibility: fields.visibility,
    body: fields.body,
    area_slug: fields.area,
    venue_id: fields.venueId,
    hashtags: fields.hashtags,
    comment_policy: fields.commentPolicy,
    photo_media_id: fields.photo?.mediaId ?? null,
    photo_alt_text: fields.photo?.altText ?? null,
    feature_status: feature?.status ?? null,
    feature_staff_response: feature?.staffResponse ?? null,
  };
}

async function durableOrMemory<T>(operation: () => Promise<T>, fallback: () => Promise<T>, write: boolean): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isMissingTableSchema(error, ["social_posts", "social_post_moderation_jobs"])) throw error;
    if (requiresSupabaseStore()) throw error;
    if (!write) return fallback();
    return onMissingDurableWrite({
      storeTag: "social-posts",
      migrationHint: "apply migration 0072",
      fallback,
    });
  }
}

export const supabaseSocialPostStore: SocialPostStore = {
  async create(actor, fields) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin()
        .from("social_posts")
        .insert(postWrite(fields, actor))
        .select("*")
        .single();
      if (error) throw error;
      return socialPostDTO(fromRow(data));
    }, () => memorySocialPostStore.create(actor, fields), true);
  },
  async edit(id, actor, changes, contentChanged) {
    return durableOrMemory(async () => {
      const { data: currentData, error: currentError } = await requireSupabaseAdmin()
        .from("social_posts")
        .select("*")
        .eq("id", id)
        .eq("author_profile_id", actor.profileId)
        .eq("status", "visible")
        .maybeSingle();
      if (currentError) throw currentError;
      if (!currentData) throw new SocialPostStoreError("NOT_FOUND", "Post not found.");
      const current = fromRow(currentData);
      const merged: SocialPostFields = {
        kind: changes.kind ?? current.kind,
        visibility: changes.visibility ?? current.visibility,
        body: changes.body ?? current.body,
        area: "area" in changes ? changes.area ?? null : current.area,
        venueId: "venueId" in changes ? changes.venueId ?? null : current.venueId,
        hashtags: changes.hashtags ?? current.hashtags,
        commentPolicy: changes.commentPolicy ?? current.commentPolicy,
        photo: "photo" in changes ? changes.photo ?? null : current.photo,
      };
      if (!merged.body && !merged.photo) throw new SocialPostStoreError("INVALID_POST", "Add some words or a photo.");
      if (merged.kind === "feature_request" && !merged.body) throw new SocialPostStoreError("INVALID_POST", "Add words to a feature request.");
      if (merged.visibility === "public" && merged.venueId) throw new SocialPostStoreError("INVALID_POST", "Exact venue posts are for friends or private posts.");
      const actualContentChange = contentChanged && contentActuallyChanged(current, merged);
      const { data, error } = await requireSupabaseAdmin().rpc("edit_social_post", {
        p_post_id: id,
        p_author_profile_id: actor.profileId,
        p_expected_mutation_version: current.mutationVersion,
        p_kind: merged.kind,
        p_visibility: merged.visibility,
        p_body: merged.body,
        p_area_slug: merged.area,
        p_venue_id: merged.venueId,
        p_hashtags: merged.hashtags,
        p_comment_policy: merged.commentPolicy,
        p_photo_media_id: merged.photo?.mediaId ?? null,
        p_photo_alt_text: merged.photo?.altText ?? null,
        p_content_changed: actualContentChange,
      });
      if (error) throw error;
      const updated = (data ?? [])[0];
      if (!updated) {
        throw new SocialPostStoreError(
          "EDIT_CONFLICT",
          "This post changed before your edit was saved. Reload it and try again.",
        );
      }
      return socialPostDTO(fromRow(updated));
    }, () => memorySocialPostStore.edit(id, actor, changes, contentChanged), true);
  },
  async remove(id, actor) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin()
        .from("social_posts")
        .update({ status: "removed", updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("author_profile_id", actor.profileId)
        .eq("status", "visible")
        .select("id");
      if (error) throw error;
      return (data ?? []).length === 1;
    }, () => memorySocialPostStore.remove(id, actor), true);
  },
  async applyFeatureRequestUpdate(id, status, staffResponse) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin()
        .from("social_posts")
        .update({
          feature_status: status,
          feature_staff_response: staffResponse,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("kind", "feature_request")
        .eq("status", "visible")
        .select("id");
      if (error) throw error;
      if ((data ?? []).length !== 1) {
        throw new SocialPostStoreError("NOT_FOUND", "Feature request not found.");
      }
    }, () => memorySocialPostStore.applyFeatureRequestUpdate(id, status, staffResponse), true);
  },
  async read(id, viewer) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_post", {
        p_post_id: id,
        p_viewer_profile_id: viewer.profileId,
      });
      if (error) throw error;
      const row = (data ?? [])[0];
      return row ? socialPostDTO(fromRow(row)) : null;
    }, () => memorySocialPostStore.read(id, viewer), false);
  },
  async readServerProjection(id, viewer) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_post", {
        p_post_id: id,
        p_viewer_profile_id: viewer.profileId,
      });
      if (error) throw error;
      const row = (data ?? [])[0];
      return row ? socialPostServerProjectionFromRow(row) : null;
    }, () => memorySocialPostStore.readServerProjection(id, viewer), false);
  },
  async feed(viewer, input) {
    const limit = resolvedLimit(input.limit);
    const area = input.area ?? null;
    if (input.lane === "nearby" && !area) throw new SocialPostStoreError("INVALID_CURSOR", "Choose an area for nearby posts.");
    const cursor = decodeCursor(input.cursor, viewer, input.lane, area);
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_post_feed", {
        p_viewer_profile_id: viewer.profileId,
        p_lane: input.lane,
        p_area_slug: area,
        p_before_created_at: cursor?.createdAt ?? null,
        p_before_id: cursor?.id ?? null,
        p_limit: limit + 1,
      });
      if (error) throw error;
      const rows = (data ?? []).map(fromRow);
      const pageRows = rows.slice(0, limit);
      const last = pageRows.at(-1);
      return {
        posts: pageRows.map(socialPostDTO),
        nextCursor: rows.length > limit && last
          ? encodeCursor({ v: 1, lane: input.lane, area, createdAt: last.createdAt, id: last.id }, viewer.profileId)
          : null,
      };
    }, () => memorySocialPostStore.feed(viewer, input), false);
  },
  async processModerationQueue(adapter, limit = 20) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("claim_social_post_moderation_jobs", {
        p_limit: Math.min(Math.max(limit, 1), 50),
      });
      if (error) throw error;
      const result: SocialPostModerationResult = {
        processed: 0,
        approved: 0,
        needsReview: 0,
        retried: 0,
        terminalErrors: 0,
      };
      const settlements = await Promise.allSettled((data ?? []).map(async (value: unknown) => {
        const job = rowObject(value);
        const postId = String(job.post_id);
        const revision = Number(job.revision);
        result.processed += 1;
        let moderation: Awaited<ReturnType<SocialPostModerationAdapter["moderate"]>>;
        try {
          moderation = await adapter.moderate({
            postId,
            text: typeof job.moderation_claim === "string" ? job.moderation_claim : "",
          });
        } catch (moderationError) {
          const attempts = Number(job.attempts ?? 1);
          const retryable = moderationFailureIsRetryable(moderationError) && attempts < 8;
          const retryAt = new Date(Date.now() + Math.min(60_000 * 2 ** Math.max(attempts - 1, 0), 3_600_000)).toISOString();
          const completion = await requireSupabaseAdmin().rpc("complete_social_post_moderation_job", {
            p_post_id: postId,
            p_revision: revision,
            p_decision: null,
            p_error_code: moderationError instanceof Error ? moderationError.name.slice(0, 80) : "provider_error",
            p_retry_at: retryable ? retryAt : null,
          });
          if (completion.error) throw completion.error;
          if (completion.data !== true) return;
          if (retryable) result.retried += 1;
          else result.terminalErrors += 1;
          return;
        }
        const completion = await requireSupabaseAdmin().rpc("complete_social_post_moderation_job", {
          p_post_id: postId,
          p_revision: revision,
          p_decision: moderation.decision,
          p_error_code: null,
          p_retry_at: null,
        });
        if (completion.error) throw completion.error;
        if (completion.data !== true) return;
        if (moderation.decision === "approved") result.approved += 1;
        else result.needsReview += 1;
      }));
      const failedItems = settlements.filter((settlement) => settlement.status === "rejected");
      if (failedItems.length > 0) {
        throw new Error(`${failedItems.length} Social post moderation item(s) could not persist.`);
      }
      return result;
    }, () => memorySocialPostStore.processModerationQueue(adapter, limit), true);
  },
  async requeueTerminalModeration(limit = 20) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc(
        "requeue_social_post_moderation_errors",
        { p_limit: Math.min(Math.max(limit, 1), 50) },
      );
      if (error) throw error;
      return Number(data ?? 0);
    }, () => memorySocialPostStore.requeueTerminalModeration(limit), true);
  },
};

export function socialPostStore(): SocialPostStore {
  if (requiresSupabaseStore()) return supabaseSocialPostStore;
  return selectStore(memorySocialPostStore, supabaseSocialPostStore);
}
