import { createHash, randomUUID } from "node:crypto";

import sharp from "sharp";

import { magicBytesOk } from "@/lib/imageSafety";
import {
  isSupabaseConfigured,
  requireSupabaseAdmin,
  STORAGE_BUCKET,
} from "@/lib/supabase";

export const SOCIAL_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const SOCIAL_PHOTO_MAX_DIMENSION = 12_000;
export const SOCIAL_PHOTO_MAX_PIXELS = 20_000_000;
export const SOCIAL_PHOTO_OUTPUT_DIMENSION = 1_200;
export const SOCIAL_MEDIA_SIGNED_TTL_SECONDS = 180;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type PreparedSocialPhoto = {
  bytes: Buffer;
  contentType: "image/jpeg";
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
};

export type UploadedSocialPhoto = PreparedSocialPhoto & {
  mediaId: string;
  objectKey: string;
};

export type SocialPhotoStorage = {
  upload(path: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  sign(path: string, ttlSeconds: number): Promise<string | null>;
};

export class SocialPhotoError extends Error {
  constructor(
    public readonly code:
      | "INVALID_TYPE"
      | "TOO_LARGE"
      | "INVALID_DIMENSIONS"
      | "PROCESSING_FAILED"
      | "STORAGE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

function safeDimension(value: number | undefined): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

export async function prepareSocialPhoto(file: File): Promise<PreparedSocialPhoto> {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new SocialPhotoError("INVALID_TYPE", "Photo must be a JPEG, PNG, or WebP image.");
  }
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > SOCIAL_PHOTO_MAX_BYTES) {
    throw new SocialPhotoError("TOO_LARGE", "Photo must be 10 MB or smaller.");
  }
  const input = Buffer.from(await file.arrayBuffer());
  if (input.byteLength !== file.size || !magicBytesOk(input, file.type)) {
    throw new SocialPhotoError("INVALID_TYPE", "Photo must be a JPEG, PNG, or WebP image.");
  }

  try {
    const metadata = await sharp(input, { failOn: "warning", limitInputPixels: false }).metadata();
    const width = safeDimension(metadata.width);
    const height = safeDimension(metadata.height);
    if (
      width === null || height === null ||
      width > SOCIAL_PHOTO_MAX_DIMENSION || height > SOCIAL_PHOTO_MAX_DIMENSION ||
      width * height > SOCIAL_PHOTO_MAX_PIXELS
    ) {
      throw new SocialPhotoError(
        "INVALID_DIMENSIONS",
        "Photo dimensions are too large.",
      );
    }
    const bytes = await sharp(input, { failOn: "warning", limitInputPixels: SOCIAL_PHOTO_MAX_PIXELS })
      .rotate()
      .resize({
        width: SOCIAL_PHOTO_OUTPUT_DIMENSION,
        height: SOCIAL_PHOTO_OUTPUT_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();
    const output = await sharp(bytes).metadata();
    const outputWidth = safeDimension(output.width);
    const outputHeight = safeDimension(output.height);
    if (outputWidth === null || outputHeight === null) {
      throw new SocialPhotoError("PROCESSING_FAILED", "Photo could not be processed.");
    }
    return {
      bytes,
      contentType: "image/jpeg",
      width: outputWidth,
      height: outputHeight,
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if (error instanceof SocialPhotoError) throw error;
    throw new SocialPhotoError(
      "PROCESSING_FAILED",
      "Photo could not be processed. Choose another image.",
    );
  }
}

export const supabaseSocialPhotoStorage: SocialPhotoStorage = {
  async upload(path, bytes, contentType) {
    if (!isSupabaseConfigured()) {
      throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
    }
    const { error } = await requireSupabaseAdmin()
      .storage.from(STORAGE_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  },
  async remove(paths) {
    if (paths.length === 0 || !isSupabaseConfigured()) return;
    const { error } = await requireSupabaseAdmin().storage.from(STORAGE_BUCKET).remove(paths);
    if (error) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  },
  async sign(path, ttlSeconds) {
    if (!isSupabaseConfigured()) return null;
    const { data, error } = await requireSupabaseAdmin()
      .storage.from(STORAGE_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    return error ? null : data.signedUrl;
  },
};

export async function uploadPreparedSocialPhoto(
  ownerProfileId: string,
  prepared: PreparedSocialPhoto,
  storage: SocialPhotoStorage = supabaseSocialPhotoStorage,
  requestedMediaId?: string,
): Promise<UploadedSocialPhoto> {
  const mediaId = requestedMediaId ?? randomUUID();
  void ownerProfileId;
  const objectKey = `social/${mediaId}/image.jpg`;
  await storage.upload(objectKey, prepared.bytes, prepared.contentType);
  return { ...prepared, mediaId, objectKey };
}

export async function reserveSocialPhotoUpload(
  ownerProfileId: string,
  prepared: PreparedSocialPhoto,
  requestedMediaId?: string,
): Promise<UploadedSocialPhoto> {
  const mediaId = requestedMediaId ?? randomUUID();
  const upload = { ...prepared, mediaId, objectKey: `social/${mediaId}/image.jpg` };
  if (!isSupabaseConfigured()) return upload;
  const payload = {
    media_id: upload.mediaId,
    owner_profile_id: ownerProfileId,
    object_key: upload.objectKey,
    sha256: upload.sha256,
    width: upload.width,
    height: upload.height,
    byte_size: upload.byteSize,
  };
  const admin = requireSupabaseAdmin();
  const { error } = await admin.from("social_post_media_uploads").insert(payload);
  if (error) {
    const { data: existing, error: readError } = await admin.from("social_post_media_uploads")
      .select("owner_profile_id,object_key,sha256,width,height,byte_size,state")
      .eq("media_id", mediaId).maybeSingle();
    if (readError || !existing || existing.state !== "staged" ||
      existing.owner_profile_id !== ownerProfileId || existing.object_key !== upload.objectKey ||
      existing.sha256 !== upload.sha256 || existing.width !== upload.width ||
      existing.height !== upload.height || existing.byte_size !== upload.byteSize) {
      throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
    }
  }
  return upload;
}

export async function reconcileSocialPhotoUpload(
  ownerProfileId: string,
  mediaId: string,
  storage: SocialPhotoStorage = supabaseSocialPhotoStorage,
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const admin = requireSupabaseAdmin();
  const { data: objectKey, error: claimError } = await admin.rpc(
    "claim_social_post_media_upload_cleanup",
    { p_owner_profile_id: ownerProfileId, p_media_id: mediaId },
  );
  if (claimError) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  if (typeof objectKey !== "string" || !objectKey) return false;
  await storage.remove([objectKey]);
  const { error: deleteError } = await admin.from("social_post_media_uploads").delete()
    .eq("media_id", mediaId).eq("state", "cleanup");
  if (deleteError) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  return true;
}

export async function signSocialPhotoObject(
  objectKey: string,
  storage: SocialPhotoStorage = supabaseSocialPhotoStorage,
): Promise<string | null> {
  return storage.sign(objectKey, SOCIAL_MEDIA_SIGNED_TTL_SECONDS);
}

export async function purgeDetachedSocialPhotos(limit = 50): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const admin = requireSupabaseAdmin();
  const { data, error } = await admin.from("social_post_media").select("id,object_key")
    .eq("attachment_state", "detached")
    .lte("retention_expires_at", new Date().toISOString()).limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  const rows = (data ?? []).filter((item): item is { id: string; object_key: string } =>
    typeof item.id === "string" && typeof item.object_key === "string");
  if (rows.length === 0) return 0;
  return purgeDetachedSocialPhotoRows(
    rows,
    async (keys) => {
      const { error: removeError } = await admin.storage.from(STORAGE_BUCKET).remove(keys);
      if (removeError) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
    },
    async (ids) => {
      const { error: deleteError } = await admin.from("social_post_media").delete().in("id", ids);
      if (deleteError) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
    },
  );
}

export async function purgeOrphanedSocialPhotoUploads(limit = 50): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const admin = requireSupabaseAdmin();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const { data, error } = await admin.rpc("claim_social_post_media_upload_cleanup_batch", {
    p_limit: Math.min(Math.max(limit, 1), 100),
    p_staged_before: cutoff,
  });
  if (error) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  const claimed: unknown[] = Array.isArray(data) ? data : [];
  const rows = claimed.filter((item): item is { media_id: string; object_key: string } =>
    Boolean(item) && typeof item === "object" && !Array.isArray(item) &&
    typeof (item as { media_id?: unknown }).media_id === "string" &&
    typeof (item as { object_key?: unknown }).object_key === "string");
  if (rows.length === 0) return 0;
  const { error: removeError } = await admin.storage.from(STORAGE_BUCKET).remove(rows.map((item) => item.object_key));
  if (removeError) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  const { error: deleteError } = await admin.from("social_post_media_uploads").delete()
    .in("media_id", rows.map((item) => item.media_id));
  if (deleteError) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  return rows.length;
}

export async function purgeDetachedSocialPhotoRows(
  rows: Array<{ id: string; object_key: string }>,
  removeObjects: (keys: string[]) => Promise<void>,
  deleteRows: (ids: string[]) => Promise<void>,
): Promise<number> {
  if (rows.length === 0) return 0;
  await removeObjects(rows.map((item) => item.object_key));
  await deleteRows(rows.map((item) => item.id));
  return rows.length;
}
