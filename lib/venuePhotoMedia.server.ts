// The bytes half of a pub photo wall: the same journey an owned profile image
// takes, pointed at a venue-scoped key instead of a profile-scoped one.
//
// staging -> signed URL -> safety scan -> promote on approval only. Nothing
// reaches the serving key until the scan says yes, so an unscanned photo is
// never one request away from being public. The scan adapter is the SAME one
// the owned avatar uses (`lib/profileAvatarModeration.ts`), which fails closed
// with no key configured: a wall that cannot be checked takes no photos.
//
// The preparation itself is `lib/uploadedImage.server.ts`, shared with the
// profile slots, so the EXIF strip cannot drift between the two surfaces.

import {
  prepareUploadedImage,
  UPLOADED_IMAGE_MAX_BYTES,
  type PreparedImage,
} from "@/lib/uploadedImage.server";
import { magicBytesOk } from "@/lib/imageSafety";
import {
  isSupabaseConfigured,
  requireSupabaseAdmin,
  STORAGE_BUCKET,
} from "@/lib/supabase";
import {
  isVenuePhotoServingKey,
  VENUE_PHOTO_NOUN,
  VENUE_PHOTO_OUTPUT_HEIGHT,
  VENUE_PHOTO_OUTPUT_WIDTH,
  VENUE_PHOTO_STORAGE_PREFIX,
  venuePhotoServingKey,
  venuePhotoStagingKey,
} from "@/lib/venuePhotos";

export const VENUE_PHOTO_MAX_BYTES = UPLOADED_IMAGE_MAX_BYTES;
export const VENUE_PHOTO_SIGNED_TTL_SECONDS = 180;

export type PreparedVenuePhoto = PreparedImage;

export type StagedVenuePhoto = PreparedVenuePhoto & {
  venueId: string;
  photoId: string;
  stagingKey: string;
  objectKey: string;
};

export type VenuePhotoStorage = {
  upload(path: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  sign(path: string, ttlSeconds: number): Promise<string | null>;
};

export class VenuePhotoError extends Error {
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

/** The shared journey, in the wall's own portrait box. */
export async function prepareVenuePhoto(file: File): Promise<PreparedVenuePhoto> {
  return prepareUploadedImage(file, {
    outputWidth: VENUE_PHOTO_OUTPUT_WIDTH,
    outputHeight: VENUE_PHOTO_OUTPUT_HEIGHT,
    noun: VENUE_PHOTO_NOUN,
    maxBytes: VENUE_PHOTO_MAX_BYTES,
    fail: (code, message) => new VenuePhotoError(code, message),
  });
}

export const supabaseVenuePhotoStorage: VenuePhotoStorage = {
  async upload(path, bytes, contentType) {
    if (!isSupabaseConfigured()) {
      throw new VenuePhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
    }
    const { error } = await requireSupabaseAdmin()
      .storage.from(STORAGE_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) throw new VenuePhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  },
  async remove(paths) {
    if (paths.length === 0 || !isSupabaseConfigured()) return;
    const { error } = await requireSupabaseAdmin().storage.from(STORAGE_BUCKET).remove(paths);
    if (error) throw new VenuePhotoError("STORAGE_UNAVAILABLE", "Photo cleanup is unavailable.");
  },
  async sign(path, ttlSeconds) {
    if (!isSupabaseConfigured()) return null;
    const { data, error } = await requireSupabaseAdmin()
      .storage.from(STORAGE_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    return error ? null : data.signedUrl;
  },
};

export async function stagePreparedVenuePhoto(
  venueId: string,
  photoId: string,
  prepared: PreparedVenuePhoto,
  storage: VenuePhotoStorage = supabaseVenuePhotoStorage,
): Promise<StagedVenuePhoto> {
  const stagingKey = venuePhotoStagingKey(venueId, photoId);
  const objectKey = venuePhotoServingKey(venueId, photoId);
  // Both keys are rebuilt from the pure builders and checked against the one
  // prefix, so a venue id that somehow escaped validation cannot write outside
  // the wall's own folder.
  if (
    !stagingKey.startsWith(`${VENUE_PHOTO_STORAGE_PREFIX}/${venueId}/`) ||
    !isVenuePhotoServingKey(venueId, photoId, objectKey)
  ) {
    throw new VenuePhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  }
  await storage.upload(stagingKey, prepared.bytes, prepared.contentType);
  return { ...prepared, venueId, photoId, stagingKey, objectKey };
}

export async function promoteStagedVenuePhoto(
  staged: StagedVenuePhoto,
  storage: VenuePhotoStorage = supabaseVenuePhotoStorage,
): Promise<StagedVenuePhoto> {
  if (!isVenuePhotoServingKey(staged.venueId, staged.photoId, staged.objectKey)) {
    throw new VenuePhotoError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  }
  await storage.upload(staged.objectKey, staged.bytes, staged.contentType);
  try {
    await storage.remove([staged.stagingKey]);
  } catch {
    // Serving bytes are already private-owned; staging cleanup is best-effort.
  }
  return staged;
}

export async function discardStagedVenuePhoto(
  staged: Pick<StagedVenuePhoto, "stagingKey">,
  storage: VenuePhotoStorage = supabaseVenuePhotoStorage,
): Promise<void> {
  await storage.remove([staged.stagingKey]);
}

export async function signVenuePhotoObject(
  objectKey: string,
  storage: VenuePhotoStorage = supabaseVenuePhotoStorage,
): Promise<string | null> {
  return storage.sign(objectKey, VENUE_PHOTO_SIGNED_TTL_SECONDS);
}

export type DownloadedVenuePhoto = {
  bytes: Buffer;
  contentType: "image/jpeg";
};

/** Read approved serving bytes out of the private bucket. Absent objects: null. */
export async function downloadVenuePhotoObject(
  objectKey: string,
): Promise<DownloadedVenuePhoto | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await requireSupabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .download(objectKey);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  if (!magicBytesOk(bytes, "image/jpeg")) return null;
  return { bytes, contentType: "image/jpeg" };
}
