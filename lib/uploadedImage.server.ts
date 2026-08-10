// ONE journey from "a person chose a file" to "bytes we are willing to store".
//
// Chain C (the pint-drop `uploadPhoto` order, kept exactly): declared type ->
// size -> magic bytes -> stripImageMetadata -> sharp rotate -> resize inside
// the caller's box -> jpeg -> re-probe. GPS removal is an ASSERTED strip step,
// never an encoder side effect, which is why `stripImageMetadata` runs before
// sharp rather than being assumed out of the re-encode.
//
// It lives here because the owned profile images and the pub photo walls take
// the same journey with different boxes and different nouns. Writing it twice
// is how the two drift, and the thing that would drift is the EXIF strip.
//
// The caller brings its own error class through `fail`, so an existing
// `error instanceof ProfileImageError` check keeps working: the shape of the
// failure is shared, the identity of it is not.

import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  detectImageKind,
  magicBytesOk,
  stripImageMetadata,
} from "@/lib/imageSafety";
import { log } from "@/lib/log";
import { isSupabaseConfigured, requireSupabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";

export const UPLOADED_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOADED_IMAGE_MAX_DIMENSION = 12_000;
export const UPLOADED_IMAGE_MAX_PIXELS = 20_000_000;

/**
 * What the server is willing to decode. Deliberately three types and not the
 * picker's five: a browser converts an iPhone's HEIC to JPEG in the crop step,
 * so widening a picker never widens this.
 */
export const UPLOADED_IMAGE_ALLOWED_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Serving bytes read back out of the private bucket. */
export type DownloadedUploadedImage = {
  bytes: Buffer;
  contentType: "image/jpeg";
};

/** Why bytes we stored could not be read back. Log-only; nothing branches on it. */
type UploadedImageReadFailure = "storage_error" | "magic_bytes_mismatch";

// A null here becomes a reader-facing 404, which is the right answer and a
// terrible finding: a photo its owner uploaded minutes ago and a key that was
// never written read identically. One quiet warn line, naming the object and
// what actually refused, is the difference between a bug report and a
// diagnosis. `warn` rather than `error` for the reason the advisory scan skip
// is: the reader got a defined answer, our storage is what is not well.
function unreadable(
  objectKey: string,
  reason: UploadedImageReadFailure,
  detail: string,
): null {
  log("warn", "uploaded_image.object_unreadable", { objectKey, reason, detail });
  return null;
}

/**
 * Read one stored JPEG back. Shared by every owned-image serve route - the
 * avatar, the cover and a pub wall photo - because the write half is shared and
 * a second copy of "what counts as unreadable" is how the surfaces drift.
 *
 * Absent or unreadable objects return null, and say why once in the log.
 */
export async function downloadUploadedImageObject(
  objectKey: string,
): Promise<DownloadedUploadedImage | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await requireSupabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .download(objectKey);
  if (error || !data) {
    return unreadable(objectKey, "storage_error", error?.message ?? "no object returned");
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  if (!magicBytesOk(bytes, "image/jpeg")) {
    // What we stored is sharp's own JPEG, checked before it left this module,
    // so a mismatch is the object having changed under us rather than a picky
    // reader. Say what actually came back.
    const leading = [...bytes.subarray(0, 4)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" ");
    return unreadable(
      objectKey,
      "magic_bytes_mismatch",
      `${bytes.byteLength} bytes, leading ${leading || "none"}`,
    );
  }
  return { bytes, contentType: "image/jpeg" };
}

export type UploadedImageErrorCode =
  | "INVALID_TYPE"
  | "TOO_LARGE"
  | "INVALID_DIMENSIONS"
  | "PROCESSING_FAILED"
  | "STORAGE_UNAVAILABLE";

export type PreparedImage = {
  bytes: Buffer;
  contentType: "image/jpeg";
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
};

export type ImagePreparationSpec = {
  /** Longest edge the stored JPEG is resized down to. */
  readonly outputWidth: number;
  /** Square/portrait box; null keeps the source aspect at the given width. */
  readonly outputHeight: number | null;
  /** Sentence noun for reader-facing copy ("Cover photo must be…"). */
  readonly noun: string;
  readonly maxBytes?: number;
  /** The caller's own error type, so `instanceof` checks upstream still hold. */
  readonly fail: (code: UploadedImageErrorCode, message: string) => Error;
};

function safeDimension(value: number | undefined): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

export async function prepareUploadedImage(
  file: File,
  spec: ImagePreparationSpec,
): Promise<PreparedImage> {
  const maxBytes = spec.maxBytes ?? UPLOADED_IMAGE_MAX_BYTES;
  // Errors this call worded itself, remembered by identity. The sharp block
  // below has to tell "the box is too big", which is already a sentence a
  // reader can act on, from "sharp threw", which is not - and comparing
  // constructors or messages would guess where this knows.
  const worded = new Set<unknown>();
  const fail = (code: UploadedImageErrorCode, message: string): Error => {
    const error = spec.fail(code, message);
    worded.add(error);
    return error;
  };
  const wrongType = () =>
    fail("INVALID_TYPE", `${spec.noun} must be a JPEG, PNG, or WebP image.`);

  if (!UPLOADED_IMAGE_ALLOWED_TYPES.has(file.type)) throw wrongType();
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > maxBytes) {
    throw fail(
      "TOO_LARGE",
      `${spec.noun} must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller.`,
    );
  }

  const input = Buffer.from(await file.arrayBuffer());
  if (input.byteLength !== file.size || !magicBytesOk(input, file.type)) throw wrongType();

  const kind = detectImageKind(input);
  if (!kind) throw wrongType();

  let stripped: Uint8Array;
  try {
    stripped = stripImageMetadata(input, kind);
  } catch {
    throw fail(
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
      width > UPLOADED_IMAGE_MAX_DIMENSION ||
      height > UPLOADED_IMAGE_MAX_DIMENSION ||
      width * height > UPLOADED_IMAGE_MAX_PIXELS
    ) {
      throw fail("INVALID_DIMENSIONS", `${spec.noun} dimensions are too large.`);
    }

    const bytes = await sharp(Buffer.from(stripped), {
      failOn: "warning",
      limitInputPixels: UPLOADED_IMAGE_MAX_PIXELS,
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
      throw fail("PROCESSING_FAILED", `${spec.noun} could not be processed.`);
    }

    const output = await sharp(bytes).metadata();
    const outputWidth = safeDimension(output.width);
    const outputHeight = safeDimension(output.height);
    if (outputWidth === null || outputHeight === null) {
      throw fail("PROCESSING_FAILED", `${spec.noun} could not be processed.`);
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
    // A failure this call already worded travels unchanged; anything sharp
    // threw becomes one sentence that names the next move.
    if (worded.has(error)) throw error;
    throw fail(
      "PROCESSING_FAILED",
      `${spec.noun} could not be processed. Choose another image.`,
    );
  }
}
