import "server-only";

import { createHash } from "node:crypto";
import { galleryPhotosFromRow, SOCIAL_GALLERY_UPLOAD_LIFETIME_MS } from "@/lib/socialGallery";
import type { SocialGalleryCreate, SocialGalleryEdit } from "@/lib/socialGallerySubmission";
import { socialPhotoMediaId } from "@/lib/socialPostIdempotency.server";
import { prepareSocialPhoto, reconcileSocialPhotoUpload, reserveSocialPhotoUpload, uploadPreparedSocialPhoto,
  SocialPhotoError } from "@/lib/socialPostMedia.server";
import { memorySocialPostStore, socialPostFromRow, SocialPostStoreError,
  type SocialPostActor, type SocialPostStore, type SocialPostWriteMedia } from "@/lib/socialPostStore";
import { socialPostDTO, type SocialPostDTO } from "@/lib/socialPosts";
import { selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

export type SocialGalleryStore = {
  upload(actor: SocialPostActor, file: File, key: string): Promise<{ mediaId: string }>;
  create(actor: SocialPostActor, payload: SocialGalleryCreate, key: string): Promise<SocialPostDTO>;
  edit(postId: string, actor: SocialPostActor, payload: SocialGalleryEdit, key: string): Promise<SocialPostDTO>;
};

function unavailable(): never {
  throw new SocialPostStoreError("GALLERY_UPLOAD_UNAVAILABLE", "A photo is no longer available. Upload it again.");
}

export function socialGalleryRequestDigest(payload: SocialGalleryCreate | SocialGalleryEdit, postId?: string): string {
  const fields = Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify({ postId: postId ?? null, fields })).digest("hex");
}

function galleryStoreError(error: { message: string }): never {
  if (/idempotency conflict/i.test(error.message)) throw new SocialPostStoreError("IDEMPOTENCY_CONFLICT", "That request key was already used for different content.");
  if (/edit conflict/i.test(error.message)) throw new SocialPostStoreError("EDIT_CONFLICT", "This post changed. Reload it and try again.");
  if (/gallery reservation|media already attached/i.test(error.message)) unavailable();
  if (/invalid Social|gallery edit contract/i.test(error.message)) throw new SocialPostStoreError("INVALID_POST", "The post is not valid. Check its photos and words.");
  throw error;
}

async function writeGallery(actor: SocialPostActor, payload: SocialGalleryCreate | SocialGalleryEdit, key: string, postId?: string): Promise<SocialPostDTO> {
  const { data, error } = await requireSupabaseAdmin().rpc(postId ? "edit_social_post_gallery_idempotent" : "create_social_post_gallery_idempotent", {
    p_actor: actor.profileId, p_payload: { ...payload, ...(postId ? { postId } : {}) },
    p_idempotency_key: key, p_request_digest: socialGalleryRequestDigest(payload, postId),
  });
  if (error) galleryStoreError(error);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new Error("Social gallery was not saved.");
  return socialPostDTO(socialPostFromRow(row), { exactVenue: true, viewerProfileId: actor.profileId });
}

const durableSocialGalleryStore: SocialGalleryStore = {
  async upload(actor, file, key) {
    const prepared = await prepareSocialPhoto(file);
    const mediaId = socialPhotoMediaId(actor.profileId, key, prepared.sha256);
    const admin = requireSupabaseAdmin();
    const existing = await admin.rpc("read_social_gallery_uploads", { p_owner_profile_id: actor.profileId, p_media_ids: [mediaId] });
    if (existing.error) throw existing.error;
    if (Array.isArray(existing.data) && existing.data.some(row => row.media_id === mediaId)) return { mediaId };
    const reserved = await reserveSocialPhotoUpload(actor.profileId, prepared, mediaId).catch(error => {
      if (error instanceof SocialPhotoError && error.code === "UPLOAD_UNAVAILABLE") unavailable();
      throw error;
    });
    try {
      await uploadPreparedSocialPhoto(actor.profileId, prepared, undefined, reserved.mediaId, reserved.objectKey, reserved.generation);
      const ready = await admin.rpc("mark_social_gallery_upload_ready", {
        p_owner_profile_id: actor.profileId, p_media_id: mediaId, p_generation: reserved.generation,
      });
      if (ready.error) throw ready.error;
      if (ready.data !== true) unavailable();
      return { mediaId };
    } catch (error) {
      await reconcileSocialPhotoUpload(actor.profileId, mediaId, reserved.generation).catch(() => false);
      throw error;
    }
  },
  create: (actor, payload, key) => writeGallery(actor, payload, key),
  edit: (postId, actor, payload, key) => writeGallery(actor, payload, key, postId),
};

type ReadyPhoto = { owner: string; createdAt: number; attached: boolean; media: SocialPostWriteMedia & { generation: string } };

export function createMemorySocialGalleryStore(posts: SocialPostStore = memorySocialPostStore, now = Date.now): SocialGalleryStore {
  const ready = new Map<string, ReadyPhoto>();
  const uploading = new Map<string, Promise<{ mediaId: string }>>();
  const requests = new Map<string, { digest: string; postId: string }>();
  function pending(actor: SocialPostActor, mediaId: string): ReadyPhoto {
    const item = ready.get(mediaId);
    if (!item || item.owner !== actor.profileId || item.attached || now() - item.createdAt >= SOCIAL_GALLERY_UPLOAD_LIFETIME_MS) unavailable();
    return item;
  }
  async function replay(actor: SocialPostActor, key: string, digest: string, operation: "create" | "edit") {
    const prior = requests.get(`${operation}:${actor.profileId}:${key}`);
    if (!prior) return null;
    if (prior.digest !== digest) throw new SocialPostStoreError("IDEMPOTENCY_CONFLICT", "That request key was already used for different content.");
    const post = await posts.readOwned(prior.postId, actor);
    if (!post) throw new SocialPostStoreError("NOT_FOUND", "Post not found.");
    return post;
  }
  function record(actor: SocialPostActor, key: string, digest: string, post: SocialPostDTO, mediaIds: string[], operation: "create" | "edit") {
    requests.set(`${operation}:${actor.profileId}:${key}`, { digest, postId: post.id });
    for (const mediaId of mediaIds) {
      const item = ready.get(mediaId);
      if (item) item.attached = true;
    }
  }
  return {
    async upload(actor, file, key) {
      const prepared = await prepareSocialPhoto(file);
      const mediaId = socialPhotoMediaId(actor.profileId, key, prepared.sha256);
      const existing = ready.get(mediaId);
      if (existing) { pending(actor, mediaId); return { mediaId }; }
      const inFlight = uploading.get(mediaId);
      if (inFlight) return inFlight;
      const operation = (async () => {
        for (const [id, item] of ready) {
          if (!item.attached && now() - item.createdAt >= SOCIAL_GALLERY_UPLOAD_LIFETIME_MS) {
            await reconcileSocialPhotoUpload(item.owner, id, item.media.generation);
            ready.delete(id);
          }
        }
        if (ready.size >= 2_048) throw new Error("Demo gallery storage is full.");
        const createdAt = now();
        const uploaded = await uploadPreparedSocialPhoto(actor.profileId, prepared, undefined, mediaId);
        const { objectKey, generation, sha256, width, height, byteSize } = uploaded;
        const media = { mediaId, objectKey, generation, sha256, width, height, byteSize };
        ready.set(mediaId, { owner: actor.profileId, createdAt, attached: false, media });
        return { mediaId };
      })();
      uploading.set(mediaId, operation);
      try { return await operation; } finally { uploading.delete(mediaId); }
    },
    async create(actor, payload, key) {
      const digest = socialGalleryRequestDigest(payload);
      const prior = await replay(actor, key, digest, "create");
      if (prior) return prior;
      const { gallery, ...fields } = payload;
      const photos = galleryPhotosFromRow(gallery)!;
      const media = gallery.map(photo => pending(actor, photo.mediaId).media);
      const post = await posts.create(actor, { ...fields, photos, photo: photos[0] ?? null }, {
        galleryMedia: media, media: media[0], idempotencyKey: key, requestDigest: digest,
      });
      record(actor, key, digest, post, gallery.map(photo => photo.mediaId), "create");
      return post;
    },
    async edit(postId, actor, payload, key) {
      const digest = socialGalleryRequestDigest(payload, postId);
      const prior = await replay(actor, key, digest, "edit");
      if (prior) return prior;
      const current = await posts.readOwned(postId, actor);
      if (!current) throw new SocialPostStoreError("NOT_FOUND", "Post not found.");
      const { gallery, expectedMutationVersion, ...changes } = payload;
      const retained = new Set((current.photos ?? (current.photo ? [current.photo] : []))
        .filter(photo => photo.kind !== "video").map(photo => photo.mediaId));
      const media = gallery.filter(photo => !retained.has(photo.mediaId)).map(photo => pending(actor, photo.mediaId).media);
      const photos = galleryPhotosFromRow(gallery)!;
      const post = await posts.edit(postId, actor, expectedMutationVersion, { ...changes, photos, photo: photos[0] ?? null }, true, {
        galleryMedia: media, idempotencyKey: key, requestDigest: digest,
      });
      record(actor, key, digest, post, gallery.map(photo => photo.mediaId), "edit");
      return post;
    },
  };
}

const memorySocialGalleryStore = createMemorySocialGalleryStore();
export function socialGalleryStore(): SocialGalleryStore {
  return selectStore(memorySocialGalleryStore, durableSocialGalleryStore);
}
