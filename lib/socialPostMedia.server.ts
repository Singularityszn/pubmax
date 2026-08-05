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
      .upload(path, bytes, { contentType, upsert: false });
    if (error) throw new SocialPhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  },
  async remove(paths) {
    if (paths.length === 0 || !isSupabaseConfigured()) return;
    await requireSupabaseAdmin().storage.from(STORAGE_BUCKET).remove(paths);
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
): Promise<UploadedSocialPhoto> {
  const mediaId = randomUUID();
  const objectKey = `social/${ownerProfileId}/${mediaId}/image.jpg`;
  await storage.upload(objectKey, prepared.bytes, prepared.contentType);
  return { ...prepared, mediaId, objectKey };
}

export async function removeSocialPhotoObject(
  objectKey: string,
  storage: SocialPhotoStorage = supabaseSocialPhotoStorage,
): Promise<void> {
  try {
    await storage.remove([objectKey]);
  } catch {
    // Database result remains authoritative. Orphan cleanup is best effort.
  }
}

export async function signSocialPhotoObject(
  objectKey: string,
  storage: SocialPhotoStorage = supabaseSocialPhotoStorage,
): Promise<string | null> {
  return storage.sign(objectKey, SOCIAL_MEDIA_SIGNED_TTL_SECONDS);
}
