import "server-only";

// The board or poster photo behind a drinker's regular night: the bytes half of
// the 0206 lane.
//
// The photo takes the shared owned-image journey (`prepareUploadedImage`, the
// one venue photos and menu photos use): type, size cap, magic bytes, metadata
// and EXIF strip, rotate, resize, then JPEG. It is stored under the reporter's
// own folder, so account deletion walks it (`lib/accountOwnedObjects.ts`).
//
// Only a moderator opens it, through a short-lived signed URL, and no public
// read names its key. No safety scan, for the reason menu photos take none:
// strangers never see these bytes, so the paid call would buy nothing.

import { log } from "@/lib/log";
import { regularNightBoardKey } from "@/lib/regularNightReports";
import { isSupabaseConfigured, requireSupabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";
import {
  prepareUploadedImage,
  UPLOADED_IMAGE_MAX_BYTES,
  uploadUploadedImageObject,
} from "@/lib/uploadedImage.server";

/** Longest edge a stored board photo keeps. Wide enough to read a chalkboard. */
const BOARD_PHOTO_BOX = 2000;
const BOARD_PHOTO_SIGNED_TTL_SECONDS = 300;

export const REGULAR_NIGHT_BOARD_MAX_BYTES = UPLOADED_IMAGE_MAX_BYTES;

export class RegularNightBoardError extends Error {
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

/** Prepare and store one board photo. Returns its key. THROWS RegularNightBoardError. */
export async function storeRegularNightBoard(
  file: File,
  reporterUserId: string,
  reportId: string,
): Promise<string> {
  const prepared = await prepareUploadedImage(file, {
    outputWidth: BOARD_PHOTO_BOX,
    outputHeight: BOARD_PHOTO_BOX,
    noun: "The photo",
    maxBytes: REGULAR_NIGHT_BOARD_MAX_BYTES,
    fail: (code, message) => new RegularNightBoardError(code, message),
  });
  if (!isSupabaseConfigured()) {
    throw new RegularNightBoardError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  }
  const key = regularNightBoardKey(reporterUserId, reportId);
  // The shared writer, for its Blob wrap: a raw Buffer body is string-decoded on the way out.
  const error = await uploadUploadedImageObject(key, prepared.bytes, prepared.contentType);
  if (error) throw new RegularNightBoardError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.");
  return key;
}

/** Best-effort removal of a board photo whose row was never written. */
export async function removeRegularNightBoard(key: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await requireSupabaseAdmin().storage.from(STORAGE_BUCKET).remove([key]);
  if (error) log("warn", "regular_night_report.board_cleanup_failed", { detail: error.message });
}

/** A short-lived signed URL for a moderator, or null when storage could not sign one. */
export async function signRegularNightBoard(key: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await requireSupabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .createSignedUrl(key, BOARD_PHOTO_SIGNED_TTL_SECONDS);
  return error ? null : data.signedUrl;
}
