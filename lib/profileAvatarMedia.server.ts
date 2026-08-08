import { createHash, randomUUID } from "node:crypto";

import sharp from "sharp";

import {
  detectImageKind,
  magicBytesOk,
  stripImageMetadata,
} from "@/lib/imageSafety";
import {
  isSupabaseConfigured,
  requireSupabaseAdmin,
  STORAGE_BUCKET,
} from "@/lib/supabase";

export const PROFILE_AVATAR_MAX_BYTES = 10 * 1024 * 1024;
export const PROFILE_AVATAR_MAX_DIMENSION = 12_000;
export const PROFILE_AVATAR_MAX_PIXELS = 20_000_000;
export const PROFILE_AVATAR_OUTPUT_DIMENSION = 512;
export const PROFILE_AVATAR_SIGNED_TTL_SECONDS = 180;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type PreparedProfileAvatar = {
  bytes: Buffer;
  contentType: "image/jpeg";
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
};

export type UploadedProfileAvatar = PreparedProfileAvatar & {
  profileId: string;
  generation: string;
  stagingKey: string;
  objectKey: string;
};

export type ProfileAvatarStorage = {
  upload(path: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  sign(path: string, ttlSeconds: number): Promise<string | null>;
  listAvatarKeys?(profileId: string): Promise<string[]>;
};

export class ProfileAvatarError extends Error {
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

export function profileAvatarStagingKey(profileId: string, generation: string): string {
  return `avatars/${profileId}/${generation}/staging.jpg`;
}

export function profileAvatarServingKey(profileId: string, generation: string): string {
  return `avatars/${profileId}/${generation}/image.jpg`;
}

export function isProfileAvatarServingKey(
  profileId: string,
  generation: string,
  objectKey: string,
): boolean {
  return objectKey === profileAvatarServingKey(profileId, generation);
}

/**
 * Chain C (pint-drop uploadPhoto order): magic bytes → stripImageMetadata →
 * sharp rotate → resize 512 inside → jpeg → re-probe. GPS removal is an
 * asserted strip step, not an encoder side effect.
 */
export async function prepareProfileAvatar(file: File): Promise<PreparedProfileAvatar> {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new ProfileAvatarError("INVALID_TYPE", "Photo must be a JPEG, PNG, or WebP image.");
  }
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > PROFILE_AVATAR_MAX_BYTES) {
    throw new ProfileAvatarError("TOO_LARGE", "Photo must be 10 MB or smaller.");
  }
  const input = Buffer.from(await file.arrayBuffer());
  if (input.byteLength !== file.size || !magicBytesOk(input, file.type)) {
    throw new ProfileAvatarError("INVALID_TYPE", "Photo must be a JPEG, PNG, or WebP image.");
  }

  const kind = detectImageKind(input);
  if (!kind) {
    throw new ProfileAvatarError("INVALID_TYPE", "Photo must be a JPEG, PNG, or WebP image.");
  }

  let stripped: Uint8Array;
  try {
    stripped = stripImageMetadata(input, kind);
  } catch {
    throw new ProfileAvatarError(
      "PROCESSING_FAILED",
      "Photo must be a valid, uncorrupted image.",
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
      width > PROFILE_AVATAR_MAX_DIMENSION ||
      height > PROFILE_AVATAR_MAX_DIMENSION ||
      width * height > PROFILE_AVATAR_MAX_PIXELS
    ) {
      throw new ProfileAvatarError(
        "INVALID_DIMENSIONS",
        "Photo dimensions are too large.",
      );
    }

    const bytes = await sharp(Buffer.from(stripped), {
      failOn: "warning",
      limitInputPixels: PROFILE_AVATAR_MAX_PIXELS,
    })
      .rotate()
      .resize({
        width: PROFILE_AVATAR_OUTPUT_DIMENSION,
        height: PROFILE_AVATAR_OUTPUT_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();

    if (!magicBytesOk(bytes, "image/jpeg")) {
      throw new ProfileAvatarError("PROCESSING_FAILED", "Photo could not be processed.");
    }

    const output = await sharp(bytes).metadata();
    const outputWidth = safeDimension(output.width);
    const outputHeight = safeDimension(output.height);
    if (outputWidth === null || outputHeight === null) {
      throw new ProfileAvatarError("PROCESSING_FAILED", "Photo could not be processed.");
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
    if (error instanceof ProfileAvatarError) throw error;
    throw new ProfileAvatarError(
      "PROCESSING_FAILED",
      "Photo could not be processed. Choose another image.",
    );
  }
}

export const supabaseProfileAvatarStorage: ProfileAvatarStorage = {
  async upload(path, bytes, contentType) {
    if (!isSupabaseConfigured()) {
      throw new ProfileAvatarError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
    }
    const { error } = await requireSupabaseAdmin()
      .storage.from(STORAGE_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) throw new ProfileAvatarError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  },
  async remove(paths) {
    if (paths.length === 0 || !isSupabaseConfigured()) return;
    const { error } = await requireSupabaseAdmin().storage.from(STORAGE_BUCKET).remove(paths);
    if (error) throw new ProfileAvatarError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  },
  async sign(path, ttlSeconds) {
    if (!isSupabaseConfigured()) return null;
    const { data, error } = await requireSupabaseAdmin()
      .storage.from(STORAGE_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    return error ? null : data.signedUrl;
  },
  async listAvatarKeys(profileId) {
    if (!isSupabaseConfigured()) return [];
    const prefix = `avatars/${profileId}`;
    const admin = requireSupabaseAdmin();
    const { data: generations, error } = await admin.storage.from(STORAGE_BUCKET).list(prefix);
    if (error || !generations) {
      throw new ProfileAvatarError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
    }
    const keys: string[] = [];
    for (const entry of generations) {
      if (!entry?.name) continue;
      // Folder listing returns generation ids; also tolerate flat file names.
      if (entry.name === "image.jpg" || entry.name === "staging.jpg") {
        keys.push(`${prefix}/${entry.name}`);
        continue;
      }
      keys.push(profileAvatarServingKey(profileId, entry.name));
      keys.push(profileAvatarStagingKey(profileId, entry.name));
    }
    return keys;
  },
};

export async function stagePreparedProfileAvatar(
  profileId: string,
  prepared: PreparedProfileAvatar,
  storage: ProfileAvatarStorage = supabaseProfileAvatarStorage,
  requestedGeneration?: string,
): Promise<UploadedProfileAvatar> {
  const generation = requestedGeneration ?? randomUUID();
  const stagingKey = profileAvatarStagingKey(profileId, generation);
  const objectKey = profileAvatarServingKey(profileId, generation);
  if (
    stagingKey !== `avatars/${profileId}/${generation}/staging.jpg` ||
    objectKey !== `avatars/${profileId}/${generation}/image.jpg`
  ) {
    throw new ProfileAvatarError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  }
  await storage.upload(stagingKey, prepared.bytes, prepared.contentType);
  return { ...prepared, profileId, generation, stagingKey, objectKey };
}

export async function promoteStagedProfileAvatar(
  staged: UploadedProfileAvatar,
  storage: ProfileAvatarStorage = supabaseProfileAvatarStorage,
): Promise<UploadedProfileAvatar> {
  if (!isProfileAvatarServingKey(staged.profileId, staged.generation, staged.objectKey)) {
    throw new ProfileAvatarError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  }
  await storage.upload(staged.objectKey, staged.bytes, staged.contentType);
  try {
    await storage.remove([staged.stagingKey]);
  } catch {
    // Serving bytes are already private-owned; staging cleanup is best-effort.
  }
  return staged;
}

export async function discardStagedProfileAvatar(
  staged: Pick<UploadedProfileAvatar, "stagingKey">,
  storage: ProfileAvatarStorage = supabaseProfileAvatarStorage,
): Promise<void> {
  await storage.remove([staged.stagingKey]);
}

export async function signProfileAvatarObject(
  objectKey: string,
  storage: ProfileAvatarStorage = supabaseProfileAvatarStorage,
): Promise<string | null> {
  return storage.sign(objectKey, PROFILE_AVATAR_SIGNED_TTL_SECONDS);
}

export type DownloadedProfileAvatar = {
  bytes: Buffer;
  contentType: "image/jpeg";
};

/** Read approved serving bytes from the private bucket. Absent objects return null. */
export async function downloadProfileAvatarObject(
  objectKey: string,
  storage: ProfileAvatarStorage = supabaseProfileAvatarStorage,
): Promise<DownloadedProfileAvatar | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await requireSupabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .download(objectKey);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  if (!magicBytesOk(bytes, "image/jpeg")) return null;
  return { bytes, contentType: "image/jpeg" };
}

/** Delete every avatar object under a profile (all generations). */
export async function purgeProfileAvatarObjects(
  profileId: string,
  storage: ProfileAvatarStorage = supabaseProfileAvatarStorage,
  knownKeys: string[] = [],
): Promise<string[]> {
  const listed = storage.listAvatarKeys
    ? await storage.listAvatarKeys(profileId)
    : [];
  const keys = Array.from(new Set([...knownKeys, ...listed].filter(Boolean)));
  if (keys.length === 0) return [];
  await storage.remove(keys);
  return keys;
}
