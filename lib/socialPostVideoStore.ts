import "server-only";

import { randomUUID } from "node:crypto";

import {
  SOCIAL_VIDEO_MAX_BYTES,
  socialVideoPlaybackPath,
  type SocialPostVideo,
  type SocialVideoReviewState,
  type SocialVideoType,
} from "@/lib/socialPostVideos";
import { isMissingTableSchema, onMissingDurableWrite, selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin, requiresSupabaseStore, STORAGE_BUCKET } from "@/lib/supabase";

type VideoActor = { profileId: string };

const UPLOAD_URL_TTL_SECONDS = 2 * 60 * 60;
const PLAYBACK_URL_TTL_SECONDS = 120;
const HEAD_BYTES = 64;

export class SocialPostVideoError extends Error {
  constructor(
    public readonly code: "INVALID_VIDEO" | "TOO_MANY_UPLOADS" | "VIDEO_NOT_FOUND" | "VIDEO_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "SocialPostVideoError";
  }
}

export type SocialVideoUploadTicket = {
  uploadId: string;
  /** PUT the file here with its own Content-Type. */
  uploadUrl: string;
};

/** What Storage actually holds for an intent: its size and first bytes. */
export type SocialVideoObject = { byteSize: number; head: Uint8Array; contentType: SocialVideoType };

export type HeldSocialVideo = { postId: string; authorProfileId: string; contentType: SocialVideoType; byteSize: number; createdAt: string };

export type SocialPostVideoStore = {
  createUpload(actor: VideoActor, contentType: SocialVideoType, declaredBytes: number): Promise<SocialVideoUploadTicket>;
  /** The stored object behind the actor's own open intent, or null when nothing arrived. */
  inspectUpload(actor: VideoActor, uploadId: string): Promise<SocialVideoObject | null>;
  attach(actor: VideoActor, postId: string, uploadId: string, byteSize: number, durationSeconds: number | null): Promise<SocialPostVideo>;
  /** Videos on posts the viewer may already read: approved, or the viewer's own. */
  forPosts(postIds: readonly string[], viewer: VideoActor): Promise<Map<string, SocialPostVideo>>;
  /** Where the bytes of a readable video can be fetched from right now. */
  playback(postId: string, viewer: VideoActor): Promise<{ redirect: string } | { bytes: Uint8Array; contentType: SocialVideoType } | null>;
  heldQueue(limit: number): Promise<HeldSocialVideo[]>;
  review(postId: string, decision: Exclude<SocialVideoReviewState, "held">): Promise<boolean>;
  /** Moderator playback: any state. */
  moderatorPlayback(postId: string): Promise<{ redirect: string } | { bytes: Uint8Array; contentType: SocialVideoType } | null>;
};

function dto(postId: string, contentType: SocialVideoType, durationSeconds: number | null, reviewState: SocialVideoReviewState): SocialPostVideo {
  return { url: socialVideoPlaybackPath(postId), contentType, durationSeconds, reviewState };
}

// ---------------------------------------------------------------------------
// Process memory: keyless development. The browser PUTs to our own route.

type MemoryUpload = { id: string; owner: string; contentType: SocialVideoType; declaredBytes: number; bytes: Uint8Array | null; claimedPostId: string | null; expiresAt: number };
type MemoryVideo = { postId: string; author: string; uploadId: string; contentType: SocialVideoType; byteSize: number; durationSeconds: number | null; reviewState: SocialVideoReviewState; createdAt: string };

export type MemorySocialPostVideoStore = SocialPostVideoStore & {
  /** The keyless stand-in for the Storage PUT. */
  receiveUpload(actor: VideoActor, uploadId: string, bytes: Uint8Array): Promise<boolean>;
};

export function createMemorySocialPostVideoStore(options: { now?: () => Date } = {}): MemorySocialPostVideoStore {
  const uploads = new Map<string, MemoryUpload>();
  const videos = new Map<string, MemoryVideo>();
  const now = options.now ?? (() => new Date());
  const open = (owner: string) => [...uploads.values()].filter((u) => u.owner === owner && !u.claimedPostId && u.expiresAt > now().getTime());
  const play = (video: MemoryVideo | undefined) => {
    const bytes = video ? uploads.get(video.uploadId)?.bytes : null;
    return video && bytes ? { bytes, contentType: video.contentType } : null;
  };
  return {
    async createUpload(actor, contentType, declaredBytes) {
      if (declaredBytes < 1 || declaredBytes > SOCIAL_VIDEO_MAX_BYTES) throw new SocialPostVideoError("INVALID_VIDEO", "That video is too large.");
      if (open(actor.profileId).length >= 5) throw new SocialPostVideoError("TOO_MANY_UPLOADS", "Finish or drop an earlier video first.");
      const id = randomUUID();
      uploads.set(id, { id, owner: actor.profileId, contentType, declaredBytes, bytes: null, claimedPostId: null, expiresAt: now().getTime() + UPLOAD_URL_TTL_SECONDS * 1000 });
      return { uploadId: id, uploadUrl: `/api/social/videos/uploads/${id}` };
    },
    async receiveUpload(actor, uploadId, bytes) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.owner !== actor.profileId || upload.claimedPostId || upload.expiresAt <= now().getTime()) return false;
      if (bytes.byteLength < 1 || bytes.byteLength > upload.declaredBytes) return false;
      upload.bytes = bytes;
      return true;
    },
    async inspectUpload(actor, uploadId) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.owner !== actor.profileId || upload.claimedPostId || !upload.bytes) return null;
      return { byteSize: upload.bytes.byteLength, head: upload.bytes.subarray(0, HEAD_BYTES), contentType: upload.contentType };
    },
    async attach(actor, postId, uploadId, byteSize, durationSeconds) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.owner !== actor.profileId || upload.claimedPostId || upload.expiresAt <= now().getTime()) {
        throw new SocialPostVideoError("VIDEO_NOT_FOUND", "That video upload has expired. Choose it again.");
      }
      if (byteSize > upload.declaredBytes) throw new SocialPostVideoError("INVALID_VIDEO", "That video is too large.");
      upload.claimedPostId = postId;
      const video: MemoryVideo = { postId, author: actor.profileId, uploadId, contentType: upload.contentType, byteSize, durationSeconds, reviewState: "held", createdAt: now().toISOString() };
      videos.set(postId, video);
      return dto(postId, video.contentType, durationSeconds, "held");
    },
    async forPosts(postIds, viewer) {
      const found = new Map<string, SocialPostVideo>();
      for (const id of postIds) {
        const video = videos.get(id);
        if (video && (video.reviewState === "approved" || video.author === viewer.profileId)) {
          found.set(id, dto(id, video.contentType, video.durationSeconds, video.reviewState));
        }
      }
      return found;
    },
    async playback(postId, viewer) {
      const video = videos.get(postId);
      if (!video || (video.reviewState !== "approved" && video.author !== viewer.profileId)) return null;
      return play(video);
    },
    async heldQueue(limit) {
      return [...videos.values()]
        .filter((video) => video.reviewState === "held")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit)
        .map((video) => ({ postId: video.postId, authorProfileId: video.author, contentType: video.contentType, byteSize: video.byteSize, createdAt: video.createdAt }));
    },
    async review(postId, decision) {
      const video = videos.get(postId);
      if (!video) return false;
      video.reviewState = decision;
      return true;
    },
    async moderatorPlayback(postId) {
      return play(videos.get(postId));
    },
  };
}

const memorySocialPostVideoStore = createMemorySocialPostVideoStore();

// ---------------------------------------------------------------------------
// Supabase: the intent and the binding are 0182's functions; the bytes live in
// Storage and are reached through short signed URLs minted per request.

async function durableOrMemory<T>(operation: () => Promise<T>, fallback: () => Promise<T>, write: boolean): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isMissingTableSchema(error, ["social_post_videos", "social_video_uploads"])) throw error;
    if (requiresSupabaseStore()) throw error;
    if (!write) return fallback();
    return onMissingDurableWrite({ storeTag: "social-post-videos", migrationHint: "apply migration 0182", fallback });
  }
}

function mapError(error: { message: string }): never {
  if (/too many open Social video uploads/i.test(error.message)) throw new SocialPostVideoError("TOO_MANY_UPLOADS", "Finish or drop an earlier video first.");
  if (/invalid Social video/i.test(error.message)) throw new SocialPostVideoError("INVALID_VIDEO", "That video could not be used.");
  if (/Social video (upload|post) not found/i.test(error.message)) throw new SocialPostVideoError("VIDEO_NOT_FOUND", "That video upload has expired. Choose it again.");
  throw error;
}

async function signedPlayback(objectKey: string): Promise<{ redirect: string } | null> {
  const { data, error } = await requireSupabaseAdmin().storage.from(STORAGE_BUCKET).createSignedUrl(objectKey, PLAYBACK_URL_TTL_SECONDS);
  return error || !data?.signedUrl ? null : { redirect: data.signedUrl };
}

export const supabaseSocialPostVideoStore: SocialPostVideoStore = {
  async createUpload(actor, contentType, declaredBytes) {
    return durableOrMemory(async () => {
      const admin = requireSupabaseAdmin();
      const { data, error } = await admin.rpc("create_social_video_upload", {
        p_owner_profile_id: actor.profileId,
        p_content_type: contentType,
        p_declared_bytes: declaredBytes,
      });
      if (error) mapError(error);
      const row = (data ?? [])[0];
      if (!row) throw new SocialPostVideoError("VIDEO_UNAVAILABLE", "Video upload is unavailable right now.");
      const signed = await admin.storage.from(STORAGE_BUCKET).createSignedUploadUrl(row.object_key);
      if (signed.error || !signed.data?.signedUrl) throw new SocialPostVideoError("VIDEO_UNAVAILABLE", "Video upload is unavailable right now.");
      return { uploadId: row.upload_id, uploadUrl: signed.data.signedUrl };
    }, () => memorySocialPostVideoStore.createUpload(actor, contentType, declaredBytes), true);
  },
  async inspectUpload(actor, uploadId) {
    return durableOrMemory(async () => {
      const admin = requireSupabaseAdmin();
      const { data, error } = await admin
        .from("social_video_uploads")
        .select("object_key, content_type, claimed_post_id, expires_at")
        .eq("id", uploadId)
        .eq("owner_profile_id", actor.profileId)
        .maybeSingle();
      if (error) throw error;
      if (!data || data.claimed_post_id || Date.parse(data.expires_at) <= Date.now()) return null;
      const signed = await signedPlayback(data.object_key);
      if (!signed) return null;
      // One ranged read: the total size from Content-Range and the leading
      // bytes for the container check, without pulling the whole file here.
      const response = await fetch(signed.redirect, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
      if (response.status !== 206 && response.status !== 200) return null;
      const total = Number(/\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1] ?? response.headers.get("content-length"));
      const head = new Uint8Array(await response.arrayBuffer()).subarray(0, HEAD_BYTES);
      if (!Number.isFinite(total) || total < 1) return null;
      return { byteSize: total, head, contentType: data.content_type as SocialVideoType };
    }, () => memorySocialPostVideoStore.inspectUpload(actor, uploadId), false);
  },
  async attach(actor, postId, uploadId, byteSize, durationSeconds) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("attach_social_post_video", {
        p_post_id: postId,
        p_owner_profile_id: actor.profileId,
        p_upload_id: uploadId,
        p_byte_size: byteSize,
        p_duration_seconds: durationSeconds,
      });
      if (error) mapError(error);
      if (!(data ?? [])[0]) throw new SocialPostVideoError("VIDEO_UNAVAILABLE", "Video upload is unavailable right now.");
      const found = await supabaseSocialPostVideoStore.forPosts([postId], actor);
      const video = found.get(postId);
      if (!video) throw new SocialPostVideoError("VIDEO_UNAVAILABLE", "Video upload is unavailable right now.");
      return video;
    }, () => memorySocialPostVideoStore.attach(actor, postId, uploadId, byteSize, durationSeconds), true);
  },
  async forPosts(postIds, viewer) {
    if (postIds.length === 0) return new Map();
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_post_videos", {
        p_post_ids: [...postIds],
        p_viewer_profile_id: viewer.profileId,
      });
      if (error) throw error;
      return new Map((data ?? []).map((row) => [
        row.post_id,
        dto(row.post_id, row.content_type as SocialVideoType, row.duration_seconds === null ? null : Number(row.duration_seconds), row.review_state as SocialVideoReviewState),
      ]));
    }, () => memorySocialPostVideoStore.forPosts(postIds, viewer), false);
  },
  async playback(postId, viewer) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_post_videos", {
        p_post_ids: [postId],
        p_viewer_profile_id: viewer.profileId,
      });
      if (error) throw error;
      const row = (data ?? [])[0];
      return row ? signedPlayback(row.object_key) : null;
    }, () => memorySocialPostVideoStore.playback(postId, viewer), false);
  },
  async heldQueue(limit) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_held_social_post_videos", { p_limit: limit });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        postId: row.post_id,
        authorProfileId: row.author_profile_id,
        contentType: row.content_type as SocialVideoType,
        byteSize: Number(row.byte_size),
        createdAt: row.created_at,
      }));
    }, () => memorySocialPostVideoStore.heldQueue(limit), false);
  },
  async review(postId, decision) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("review_social_post_video", { p_post_id: postId, p_decision: decision });
      if (error) mapError(error);
      return data === true;
    }, () => memorySocialPostVideoStore.review(postId, decision), true);
  },
  async moderatorPlayback(postId) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin()
        .from("social_post_videos")
        .select("object_key")
        .eq("post_id", postId)
        .maybeSingle();
      if (error) throw error;
      return data ? signedPlayback(data.object_key) : null;
    }, () => memorySocialPostVideoStore.moderatorPlayback(postId), false);
  },
};

export function socialPostVideoStore(): SocialPostVideoStore {
  return selectStore(memorySocialPostVideoStore, supabaseSocialPostVideoStore);
}

/** The keyless upload door, or null when Storage takes the PUT directly. */
export function memoryVideoUploadReceiver(): MemorySocialPostVideoStore | null {
  return socialPostVideoStore() === memorySocialPostVideoStore ? memorySocialPostVideoStore : null;
}
