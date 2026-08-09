import { createHash, randomUUID } from "node:crypto";

import sharp from "sharp";

import {
  detectImageKind,
  magicBytesOk,
  stripImageMetadata,
} from "@/lib/imageSafety";
import {
  isProfileImageServingKey,
  profileImageServingKey,
  profileImageSlotSpec,
  profileImageStagingKey,
  type ProfileImageSlot,
} from "@/lib/profileImageSlots";
import {
  isSupabaseConfigured,
  requireSupabaseAdmin,
  STORAGE_BUCKET,
} from "@/lib/supabase";

export const PROFILE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PROFILE_IMAGE_MAX_DIMENSION = 12_000;
export const PROFILE_IMAGE_MAX_PIXELS = 20_000_000;
export const PROFILE_IMAGE_SIGNED_TTL_SECONDS = 180;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type PreparedProfileImage = {
  bytes: Buffer;
  contentType: "image/jpeg";
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
};

export type UploadedProfileImage = PreparedProfileImage & {
  slot: ProfileImageSlot;
  profileId: string;
  generation: string;
  stagingKey: string;
  objectKey: string;
};

export type ProfileImageStorage = {
  upload(path: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  sign(path: string, ttlSeconds: number): Promise<string | null>;
  listImageKeys?(slot: ProfileImageSlot, profileId: string): Promise<string[]>;
};

export class ProfileImageError extends Error {
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

/**
 * Chain C (pint-drop uploadPhoto order): magic bytes → stripImageMetadata →
 * sharp rotate → resize inside the slot's box → jpeg → re-probe. GPS removal is
 * an asserted strip step, not an encoder side effect. A cover keeps its own
 * aspect (height stays null) so a wide backdrop is never squared off.
 */
export async function prepareProfileImage(
  file: File,
  slot: ProfileImageSlot,
): Promise<PreparedProfileImage> {
  const spec = profileImageSlotSpec(slot);
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new ProfileImageError(
      "INVALID_TYPE",
      `${spec.noun} must be a JPEG, PNG, or WebP image.`,
    );
  }
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > PROFILE_IMAGE_MAX_BYTES) {
    throw new ProfileImageError("TOO_LARGE", `${spec.noun} must be 10 MB or smaller.`);
  }
  const input = Buffer.from(await file.arrayBuffer());
  if (input.byteLength !== file.size || !magicBytesOk(input, file.type)) {
    throw new ProfileImageError(
      "INVALID_TYPE",
      `${spec.noun} must be a JPEG, PNG, or WebP image.`,
    );
  }

  const kind = detectImageKind(input);
  if (!kind) {
    throw new ProfileImageError(
      "INVALID_TYPE",
      `${spec.noun} must be a JPEG, PNG, or WebP image.`,
    );
  }

  let stripped: Uint8Array;
  try {
    stripped = stripImageMetadata(input, kind);
  } catch {
    throw new ProfileImageError(
      "PROCESSING_FAILED",
      `${spec.noun} must be a valid, uncorrupted image.`,
    );
  }

  try {
    const metadata = await sharp(Buffer.from(stripped), {
      failOn: "warning",
      limitInputPixels: false,
    }).metadata();
    const width = safeDimension(metadata.width);
    const height = safeDimension(metadata.height);
    if (
      width === null ||
      height === null ||
      width > PROFILE_IMAGE_MAX_DIMENSION ||
      height > PROFILE_IMAGE_MAX_DIMENSION ||
      width * height > PROFILE_IMAGE_MAX_PIXELS
    ) {
      throw new ProfileImageError(
        "INVALID_DIMENSIONS",
        `${spec.noun} dimensions are too large.`,
      );
    }

    const bytes = await sharp(Buffer.from(stripped), {
      failOn: "warning",
      limitInputPixels: PROFILE_IMAGE_MAX_PIXELS,
    })
      .rotate()
      .resize({
        width: spec.outputWidth,
        ...(spec.outputHeight === null ? {} : { height: spec.outputHeight }),
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();

    if (!magicBytesOk(bytes, "image/jpeg")) {
      throw new ProfileImageError(
        "PROCESSING_FAILED",
        `${spec.noun} could not be processed.`,
      );
    }

    const output = await sharp(bytes).metadata();
    const outputWidth = safeDimension(output.width);
    const outputHeight = safeDimension(output.height);
    if (outputWidth === null || outputHeight === null) {
      throw new ProfileImageError(
        "PROCESSING_FAILED",
        `${spec.noun} could not be processed.`,
      );
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
    if (error instanceof ProfileImageError) throw error;
    throw new ProfileImageError(
      "PROCESSING_FAILED",
      `${spec.noun} could not be processed. Choose another image.`,
    );
  }
}

export const supabaseProfileImageStorage: ProfileImageStorage = {
  async upload(path, bytes, contentType) {
    if (!isSupabaseConfigured()) {
      throw new ProfileImageError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
    }
    const { error } = await requireSupabaseAdmin()
      .storage.from(STORAGE_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) throw new ProfileImageError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  },
  async remove(paths) {
    if (paths.length === 0 || !isSupabaseConfigured()) return;
    const { error } = await requireSupabaseAdmin().storage.from(STORAGE_BUCKET).remove(paths);
    if (error) throw new ProfileImageError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  },
  async sign(path, ttlSeconds) {
    if (!isSupabaseConfigured()) return null;
    const { data, error } = await requireSupabaseAdmin()
      .storage.from(STORAGE_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    return error ? null : data.signedUrl;
  },
  async listImageKeys(slot, profileId) {
    if (!isSupabaseConfigured()) return [];
    const spec = profileImageSlotSpec(slot);
    const prefix = `${spec.prefix}/${profileId}`;
    const admin = requireSupabaseAdmin();
    const { data: generations, error } = await admin.storage.from(STORAGE_BUCKET).list(prefix);
    if (error || !generations) {
      throw new ProfileImageError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
    }
    const keys: string[] = [];
    for (const entry of generations) {
      if (!entry?.name) continue;
      // Folder listing returns generation ids; also tolerate flat file names.
      if (entry.name === spec.servingFile || entry.name === "staging.jpg") {
        keys.push(`${prefix}/${entry.name}`);
        continue;
      }
      keys.push(profileImageServingKey(slot, profileId, entry.name));
      keys.push(profileImageStagingKey(slot, profileId, entry.name));
    }
    return keys;
  },
};

export async function stagePreparedProfileImage(
  slot: ProfileImageSlot,
  profileId: string,
  prepared: PreparedProfileImage,
  storage: ProfileImageStorage = supabaseProfileImageStorage,
  requestedGeneration?: string,
): Promise<UploadedProfileImage> {
  const generation = requestedGeneration ?? randomUUID();
  const stagingKey = profileImageStagingKey(slot, profileId, generation);
  const objectKey = profileImageServingKey(slot, profileId, generation);
  const spec = profileImageSlotSpec(slot);
  if (
    stagingKey !== `${spec.prefix}/${profileId}/${generation}/staging.jpg` ||
    objectKey !== `${spec.prefix}/${profileId}/${generation}/${spec.servingFile}`
  ) {
    throw new ProfileImageError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  }
  await storage.upload(stagingKey, prepared.bytes, prepared.contentType);
  return { ...prepared, slot, profileId, generation, stagingKey, objectKey };
}

export async function promoteStagedProfileImage(
  staged: UploadedProfileImage,
  storage: ProfileImageStorage = supabaseProfileImageStorage,
): Promise<UploadedProfileImage> {
  if (
    !isProfileImageServingKey(staged.slot, staged.profileId, staged.generation, staged.objectKey)
  ) {
    throw new ProfileImageError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  }
  await storage.upload(staged.objectKey, staged.bytes, staged.contentType);
  try {
    await storage.remove([staged.stagingKey]);
  } catch {
    // Serving bytes are already private-owned; staging cleanup is best-effort.
  }
  return staged;
}

export async function discardStagedProfileImage(
  staged: Pick<UploadedProfileImage, "stagingKey">,
  storage: ProfileImageStorage = supabaseProfileImageStorage,
): Promise<void> {
  await storage.remove([staged.stagingKey]);
}

export async function signProfileImageObject(
  objectKey: string,
  storage: ProfileImageStorage = supabaseProfileImageStorage,
): Promise<string | null> {
  return storage.sign(objectKey, PROFILE_IMAGE_SIGNED_TTL_SECONDS);
}

export type DownloadedProfileImage = {
  bytes: Buffer;
  contentType: "image/jpeg";
};

/** Read approved serving bytes from the private bucket. Absent objects return null. */
export async function downloadProfileImageObject(
  objectKey: string,
): Promise<DownloadedProfileImage | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await requireSupabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .download(objectKey);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  if (!magicBytesOk(bytes, "image/jpeg")) return null;
  return { bytes, contentType: "image/jpeg" };
}

/** Delete every object in one slot under a profile (all generations). */
export async function purgeProfileImageObjects(
  slot: ProfileImageSlot,
  profileId: string,
  storage: ProfileImageStorage = supabaseProfileImageStorage,
  knownKeys: string[] = [],
): Promise<string[]> {
  const listed = storage.listImageKeys ? await storage.listImageKeys(slot, profileId) : [];
  const keys = Array.from(new Set([...knownKeys, ...listed].filter(Boolean)));
  if (keys.length === 0) return [];
  await storage.remove(keys);
  return keys;
}
