import "server-only";

import { randomUUID } from "node:crypto";

import type { PreparedSocialPhoto } from "@/lib/socialPostMedia.server";
import {
  socialExtraPhotoPath,
  type SocialPostExtraPhoto,
  type SocialPostExtraSlot,
} from "@/lib/socialPostPhotos";
import type { SocialPostModerationAdapter } from "@/lib/socialPostStore";
import { isMissingTableSchema, onMissingDurableWrite, selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin, requiresSupabaseStore, STORAGE_BUCKET } from "@/lib/supabase";
import { downloadUploadedImageObject, uploadUploadedImageObject } from "@/lib/uploadedImage.server";

type PhotoActor = { profileId: string };

const SIGNED_MODERATION_URL_TTL_SECONDS = 180;

export class SocialExtraPhotoError extends Error {
  constructor(
    public readonly code: "INVALID_PHOTO" | "PHOTO_NOT_FOUND" | "SLOT_TAKEN" | "PHOTO_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "SocialExtraPhotoError";
  }
}

export type SocialPostExtraPhotoStore = {
  /** Adds a photo at a slot of the actor's own post that already has a first photo. */
  attach(actor: PhotoActor, postId: string, slot: SocialPostExtraSlot, photo: PreparedSocialPhoto, altText: string): Promise<SocialPostExtraPhoto>;
  /** Photos 2 to 4 of posts the viewer may read: approved, or the viewer's own. */
  forPosts(postIds: readonly string[], viewer: PhotoActor): Promise<Map<string, SocialPostExtraPhoto[]>>;
  /** The bytes behind one photo the viewer may see, or null. */
  read(viewer: PhotoActor, mediaId: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  /** One pass of the per-photo model check; answers how many it decided. */
  processModeration(adapter: SocialPostModerationAdapter, limit?: number): Promise<{ processed: number; approved: number; needsReview: number; retried: number }>;
};

function dto(mediaId: string, slot: number, altText: string, moderationState: string): SocialPostExtraPhoto {
  return {
    mediaId,
    slot: slot as SocialPostExtraSlot,
    altText,
    url: socialExtraPhotoPath(mediaId),
    moderationState: moderationState === "approved" || moderationState === "needs_review" ? moderationState : "pending",
  };
}

// ---------------------------------------------------------------------------
// Process memory (keyless development). Memory cannot see who may read a post,
// so it shows an extra photo to its author always and to others once approved,
// leaving the post's own visibility to the feed that asked.

type MemoryPhoto = { mediaId: string; postId: string; owner: string; slot: number; altText: string; bytes: Buffer; state: "pending" | "approved" | "needs_review" };

export function createMemorySocialPostExtraPhotoStore(): SocialPostExtraPhotoStore {
  const photos = new Map<string, MemoryPhoto>();
  const visibleTo = (photo: MemoryPhoto, viewer: PhotoActor) => photo.owner === viewer.profileId || photo.state === "approved";
  return {
    async attach(actor, postId, slot, photo, altText) {
      if ([...photos.values()].some((held) => held.postId === postId && held.slot === slot)) {
        throw new SocialExtraPhotoError("SLOT_TAKEN", "That photo slot is already filled.");
      }
      const owned = [...photos.values()].find((held) => held.postId === postId);
      if (owned && owned.owner !== actor.profileId) throw new SocialExtraPhotoError("PHOTO_NOT_FOUND", "Post not found.");
      const mediaId = randomUUID();
      photos.set(mediaId, { mediaId, postId, owner: actor.profileId, slot, altText, bytes: photo.bytes, state: "pending" });
      return dto(mediaId, slot, altText, "pending");
    },
    async forPosts(postIds, viewer) {
      const found = new Map<string, SocialPostExtraPhoto[]>();
      for (const photo of [...photos.values()].sort((a, b) => a.slot - b.slot)) {
        if (!postIds.includes(photo.postId) || !visibleTo(photo, viewer)) continue;
        found.set(photo.postId, [...(found.get(photo.postId) ?? []), dto(photo.mediaId, photo.slot, photo.altText, photo.state)]);
      }
      return found;
    },
    async read(viewer, mediaId) {
      const photo = photos.get(mediaId);
      return photo && visibleTo(photo, viewer) ? { bytes: photo.bytes, contentType: "image/jpeg" } : null;
    },
    async processModeration(adapter, limit = 20) {
      const result = { processed: 0, approved: 0, needsReview: 0, retried: 0 };
      for (const photo of [...photos.values()].filter((held) => held.state === "pending").slice(0, limit)) {
        try {
          const { decision } = await adapter.moderate({ postId: photo.postId, text: `Photo: ${photo.altText}` });
          photo.state = decision;
          result.processed += 1;
          if (decision === "approved") result.approved += 1;
          else result.needsReview += 1;
        } catch {
          result.retried += 1;
        }
      }
      return result;
    },
  };
}

const memorySocialPostExtraPhotoStore = createMemorySocialPostExtraPhotoStore();

// ---------------------------------------------------------------------------
// Supabase: rows and checks are 0185's functions, bytes live in Storage.

async function durableOrMemory<T>(operation: () => Promise<T>, fallback: () => Promise<T>, write: boolean): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isMissingTableSchema(error, ["social_post_extra_photos"])) throw error;
    if (requiresSupabaseStore()) throw error;
    if (!write) return fallback();
    return onMissingDurableWrite({ storeTag: "social-post-extra-photos", migrationHint: "apply migration 0185", fallback });
  }
}

const supabaseSocialPostExtraPhotoStore: SocialPostExtraPhotoStore = {
  async attach(actor, postId, slot, photo, altText) {
    return durableOrMemory(async () => {
      const admin = requireSupabaseAdmin();
      const mediaId = randomUUID();
      const objectKey = `social-extra/${mediaId}/image.jpg`;
      // Bytes first, row second: a refused row leaves an object we remove
      // here, never a row that points at nothing.
      const uploadError = await uploadUploadedImageObject(objectKey, photo.bytes, photo.contentType);
      if (uploadError) throw new SocialExtraPhotoError("PHOTO_UNAVAILABLE", "Photo storage is unavailable.");
      const { data, error } = await admin.rpc("attach_social_post_extra_photo", {
        p_post_id: postId,
        p_owner_profile_id: actor.profileId,
        p_media_id: mediaId,
        p_position: slot,
        p_sha256: photo.sha256,
        p_width: photo.width,
        p_height: photo.height,
        p_byte_size: photo.byteSize,
        p_alt_text: altText,
      });
      if (error) {
        await admin.storage.from(STORAGE_BUCKET).remove([objectKey]).catch(() => undefined);
        if (/duplicate key/i.test(error.message)) throw new SocialExtraPhotoError("SLOT_TAKEN", "That photo slot is already filled.");
        if (/Social extra photo/i.test(error.message)) throw new SocialExtraPhotoError("PHOTO_NOT_FOUND", "Add the first photo before more.");
        throw error;
      }
      const row = (data ?? [])[0];
      if (!row) throw new SocialExtraPhotoError("PHOTO_UNAVAILABLE", "Photo storage is unavailable.");
      return dto(row.media_id, slot, altText, row.moderation_state);
    }, () => memorySocialPostExtraPhotoStore.attach(actor, postId, slot, photo, altText), true);
  },
  async forPosts(postIds, viewer) {
    if (postIds.length === 0) return new Map();
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_post_extra_photos", {
        p_post_ids: [...postIds],
        p_viewer_profile_id: viewer.profileId,
      });
      if (error) throw error;
      const found = new Map<string, SocialPostExtraPhoto[]>();
      for (const row of data ?? []) {
        found.set(row.post_id, [...(found.get(row.post_id) ?? []), dto(row.media_id, row.slot, row.alt_text, row.moderation_state)]);
      }
      return found;
    }, () => memorySocialPostExtraPhotoStore.forPosts(postIds, viewer), false);
  },
  async read(viewer, mediaId) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_post_extra_photo_object", {
        p_viewer_profile_id: viewer.profileId,
        p_media_id: mediaId,
      });
      if (error) throw error;
      const row = (data ?? [])[0];
      if (!row) return null;
      const image = await downloadUploadedImageObject(row.object_key);
      return image ? { bytes: Buffer.from(image.bytes), contentType: image.contentType } : null;
    }, () => memorySocialPostExtraPhotoStore.read(viewer, mediaId), false);
  },
  async processModeration(adapter, limit = 20) {
    return durableOrMemory(async () => {
      const admin = requireSupabaseAdmin();
      const result = { processed: 0, approved: 0, needsReview: 0, retried: 0 };
      const { data, error } = await admin.rpc("claim_social_extra_photo_moderation", { p_limit: Math.min(Math.max(limit, 1), 50) });
      if (error) throw error;
      for (const job of data ?? []) {
        let decision: "approved" | "needs_review" | null = null;
        try {
          const signed = await admin.storage.from(STORAGE_BUCKET).createSignedUrl(job.object_key, SIGNED_MODERATION_URL_TTL_SECONDS);
          if (signed.error || !signed.data?.signedUrl) throw new Error("unsigned");
          decision = (await adapter.moderate({ postId: job.post_id, text: `Photo: ${job.alt_text}`, imageUrl: signed.data.signedUrl })).decision;
        } catch {
          decision = null;
        }
        const retryAt = decision === null ? new Date(Date.now() + Math.min(2 ** job.attempts, 64) * 60_000).toISOString() : null;
        const { error: completeError } = await admin.rpc("complete_social_extra_photo_moderation", {
          p_media_id: job.media_id,
          p_lease_token: job.lease_token,
          p_decision: decision,
          p_retry_at: retryAt,
        });
        if (completeError) continue;
        if (decision === null) result.retried += 1;
        else {
          result.processed += 1;
          if (decision === "approved") result.approved += 1;
          else result.needsReview += 1;
        }
      }
      return result;
    }, () => memorySocialPostExtraPhotoStore.processModeration(adapter, limit), true);
  },
};

export function socialPostExtraPhotoStore(): SocialPostExtraPhotoStore {
  return selectStore(memorySocialPostExtraPhotoStore, supabaseSocialPostExtraPhotoStore);
}
