import { encodeMomentPhoto } from "@/lib/momentPhotoEditor";
import type { DecodedMomentPhoto } from "@/lib/momentPhotoFit";
import {
  MOMENT_PICK_MAX_BYTES,
  PHOTO_SNIFF_BYTES,
  momentFitBox,
  momentFitFileName,
  sniffPhotoKind,
} from "@/lib/momentPhotoIntake";
import {
  PROFILE_IMAGE_PICKER_ACCEPT,
  isLikelyHeic,
  unreadableImageMessageFor,
} from "@/lib/profileImagePicker";
import { UPLOAD_PHOTO_MAX_BYTES } from "@/lib/uploadBodyLimit";
import { SOCIAL_GALLERY_MAX_PHOTOS } from "@/lib/socialGallery";

export const SOCIAL_PHOTO_PICKER_ACCEPT = PROFILE_IMAGE_PICKER_ACCEPT;
export { SOCIAL_GALLERY_MAX_PHOTOS } from "@/lib/socialGallery";
export const SOCIAL_PHOTO_OUTPUT_DIMENSION = 1_200;
const JPEG_QUALITIES = [0.9, 0.86, 0.78] as const;

export type SocialPhotoPreparationResult =
  | { outcome: "prepared"; originalFile: File; file: File; width: number; height: number }
  | { outcome: "failed"; originalFile: File; message: string }
  | { outcome: "aborted"; originalFile: File };

export type SocialPhotoPreparationOptions = { signal?: AbortSignal };
export type SocialPhotoPreparationDeps = {
  decode(file: File, signal?: AbortSignal): Promise<DecodedMomentPhoto | null>;
};

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Photo preparation cancelled.", "AbortError");
}

function decodeImage(file: File, signal?: AbortSignal): Promise<HTMLImageElement> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", abort);
      URL.revokeObjectURL(url);
    };
    const abort = () => {
      cleanup();
      image.src = "";
      reject(new DOMException("Photo preparation cancelled.", "AbortError"));
    };
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error("Photo could not be opened.")); };
    signal?.addEventListener("abort", abort, { once: true });
    image.src = url;
  });
}

async function decodeSource(file: File, signal?: AbortSignal): Promise<ImageBitmap | HTMLImageElement> {
  checkAbort(signal);
  if (typeof createImageBitmap === "function") {
    try {
      // Native bitmap decode cannot be cancelled. Close it before returning an abort.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (signal?.aborted) {
        bitmap.close();
        checkAbort(signal);
      }
      return bitmap;
    } catch {
      checkAbort(signal);
    }
  }
  return decodeImage(file, signal);
}

export const browserSocialPhotoPreparationDeps: SocialPhotoPreparationDeps = {
  async decode(file, signal) {
    const source = await decodeSource(file, signal);
    const width = "naturalWidth" in source ? source.naturalWidth : source.width;
    const height = "naturalHeight" in source ? source.naturalHeight : source.height;
    return {
      width,
      height,
      async draw(box, quality) {
        checkAbort(signal);
        const canvas = document.createElement("canvas");
        try {
          canvas.width = box.width;
          canvas.height = box.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Photo could not be prepared.");
          // JPEG has no alpha. Keep transparent PNG/WebP areas white, not black.
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, box.width, box.height);
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(source, 0, 0, box.width, box.height);
          return await encodeMomentPhoto(canvas, "image/jpeg", quality);
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      },
      close() {
        if ("close" in source) source.close();
        else source.src = "";
      },
    };
  },
};

/** Always re-encode pixels: even a small JPEG must lose its original EXIF metadata. */
export async function prepareSocialGalleryPhoto(
  originalFile: File,
  { signal }: SocialPhotoPreparationOptions = {},
  deps: SocialPhotoPreparationDeps = browserSocialPhotoPreparationDeps,
): Promise<SocialPhotoPreparationResult> {
  const failed = (message: string): SocialPhotoPreparationResult => ({ outcome: "failed", originalFile, message });
  let decoded: DecodedMomentPhoto | null = null;
  let likelyHeic = isLikelyHeic(originalFile);
  try {
    checkAbort(signal);
    if (!originalFile.size) return failed("That photo is empty. Choose another photo.");
    if (originalFile.size > MOMENT_PICK_MAX_BYTES) return failed("Choose a photo of 30 MB or less.");
    const bytes = new Uint8Array(await originalFile.slice(0, PHOTO_SNIFF_BYTES).arrayBuffer());
    checkAbort(signal);
    const kind = sniffPhotoKind(bytes);
    if (!kind) return failed("Choose a JPEG, PNG, WebP, HEIC or HEIF photo.");
    likelyHeic = kind === "heic";
    decoded = await deps.decode(originalFile, signal);
    checkAbort(signal);
    if (!decoded || !Number.isFinite(decoded.width) || !Number.isFinite(decoded.height)
      || decoded.width <= 0 || decoded.height <= 0) {
      return failed(unreadableImageMessageFor("photo", likelyHeic));
    }
    const box = momentFitBox(decoded, SOCIAL_PHOTO_OUTPUT_DIMENSION);
    for (const quality of JPEG_QUALITIES) {
      checkAbort(signal);
      const blob = await decoded.draw(box, quality);
      checkAbort(signal);
      if (blob.type !== "image/jpeg" || !blob.size) return failed("Could not prepare that photo. Try again.");
      if (blob.size <= UPLOAD_PHOTO_MAX_BYTES) {
        const file = new File([blob], momentFitFileName(originalFile.name), {
          type: "image/jpeg", lastModified: originalFile.lastModified,
        });
        return { outcome: "prepared", originalFile, file, ...box };
      }
    }
    return failed("This photo is still larger than 4 MB. Choose another photo.");
  } catch {
    if (signal?.aborted) return { outcome: "aborted", originalFile };
    return failed(decoded ? "Could not prepare that photo. Try again." : unreadableImageMessageFor("photo", likelyHeic));
  } finally {
    decoded?.close();
  }
}

/** One decoded image at a time, with a separate upload budget for every photo. */
export async function prepareSocialGalleryPhotos(
  files: readonly File[],
  options: SocialPhotoPreparationOptions = {},
  deps: SocialPhotoPreparationDeps = browserSocialPhotoPreparationDeps,
): Promise<SocialPhotoPreparationResult[]> {
  if (files.length > SOCIAL_GALLERY_MAX_PHOTOS) throw new RangeError("Choose up to 10 photos.");
  const results: SocialPhotoPreparationResult[] = [];
  for (const file of [...files]) results.push(await prepareSocialGalleryPhoto(file, options, deps));
  return results;
}
