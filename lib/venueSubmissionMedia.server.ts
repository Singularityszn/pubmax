import "server-only";

// Menu files on a venue submission: the bytes half of the 0189 lane.
//
// A PHOTO takes the shared owned-image journey (`prepareUploadedImage`): type,
// size, magic bytes, metadata strip, rotate, resize inside a box big enough to
// keep a menu's small print legible, then JPEG. A PDF is stored as sent, so its
// whole check is the declared type, the size and the "%PDF-" lead bytes. It is
// never rendered by the app: only a moderator opens it, through a short-lived
// signed URL, and the offline harvest reads its text layer.
//
// No safety scan. The scan exists for photos strangers see on a wall; these
// files are seen by moderators alone and never published, so the paid call
// would buy nothing.

import { createHash } from "node:crypto";

import { log } from "@/lib/log";
import { isSupabaseConfigured, requireSupabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";
import { prepareUploadedImage, uploadUploadedImageObject } from "@/lib/uploadedImage.server";
import {
  looksLikePdf,
  VENUE_SUBMISSION_FILE_MAX_BYTES,
  venueSubmissionFileKind,
  type VenueSubmissionFileKind,
} from "@/lib/venueSubmissions";

/** Longest edge a stored menu photo keeps. Wide enough to read a price list. */
const MENU_PHOTO_BOX = 2800;
const MENU_PHOTO_QUALITY = 85;
const MENU_FILE_SIGNED_TTL_SECONDS = 300;

export class VenueSubmissionFileError extends Error {
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

export type PreparedMenuFile = {
  kind: VenueSubmissionFileKind;
  contentType: "image/jpeg" | "application/pdf";
  bytes: Buffer;
  byteSize: number;
  sha256: string;
};

const WRONG_TYPE = "A menu must be a photo (JPEG, PNG or WebP) or a PDF.";
const TOO_LARGE = `A menu file must be ${Math.round(VENUE_SUBMISSION_FILE_MAX_BYTES / (1024 * 1024))} MB or smaller.`;

export async function prepareMenuFile(file: File): Promise<PreparedMenuFile> {
  const kind = venueSubmissionFileKind(file.type);
  if (!kind) throw new VenueSubmissionFileError("INVALID_TYPE", WRONG_TYPE);
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > VENUE_SUBMISSION_FILE_MAX_BYTES) {
    throw new VenueSubmissionFileError("TOO_LARGE", TOO_LARGE);
  }

  if (kind === "pdf") {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.byteLength !== file.size || !looksLikePdf(bytes)) {
      throw new VenueSubmissionFileError("INVALID_TYPE", WRONG_TYPE);
    }
    return {
      kind,
      contentType: "application/pdf",
      bytes,
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  const prepared = await prepareUploadedImage(file, {
    outputWidth: MENU_PHOTO_BOX,
    outputHeight: MENU_PHOTO_BOX,
    noun: "Menu photo",
    maxBytes: VENUE_SUBMISSION_FILE_MAX_BYTES,
    jpegQuality: MENU_PHOTO_QUALITY,
    fail: (code, message) => new VenueSubmissionFileError(code, message),
  });
  // The re-encode can, rarely, come out heavier than the original; the row's
  // byte CHECK would refuse it after the bytes had landed.
  if (prepared.byteSize > VENUE_SUBMISSION_FILE_MAX_BYTES) {
    throw new VenueSubmissionFileError("TOO_LARGE", TOO_LARGE);
  }
  return {
    kind,
    contentType: "image/jpeg",
    bytes: prepared.bytes,
    byteSize: prepared.byteSize,
    sha256: prepared.sha256,
  };
}

export type MenuFileStorage = {
  upload(objectKey: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(objectKeys: string[]): Promise<void>;
  sign(objectKey: string): Promise<string | null>;
};

export const supabaseMenuFileStorage: MenuFileStorage = {
  async upload(objectKey, bytes, contentType) {
    if (!isSupabaseConfigured()) {
      throw new VenueSubmissionFileError("STORAGE_UNAVAILABLE", "Menu storage is unavailable.");
    }
    // The shared writer, for its Blob wrap: a raw Buffer body is string-decoded on the way out.
    const error = await uploadUploadedImageObject(objectKey, bytes, contentType);
    if (error) throw new VenueSubmissionFileError("STORAGE_UNAVAILABLE", "Menu storage is unavailable.");
  },
  async remove(objectKeys) {
    if (objectKeys.length === 0 || !isSupabaseConfigured()) return;
    const { error } = await requireSupabaseAdmin().storage.from(STORAGE_BUCKET).remove(objectKeys);
    if (error) log("warn", "venue_submission.file_cleanup_failed", { count: objectKeys.length, detail: error.message });
  },
  async sign(objectKey) {
    if (!isSupabaseConfigured()) return null;
    const { data, error } = await requireSupabaseAdmin()
      .storage.from(STORAGE_BUCKET)
      .createSignedUrl(objectKey, MENU_FILE_SIGNED_TTL_SECONDS);
    return error ? null : data.signedUrl;
  },
};
