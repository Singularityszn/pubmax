import type { MomentMediaDraft } from "@/lib/momentDraft";

export const MOMENT_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// Matches the private Moment upload boundary.
export const MOMENT_MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export type EditedMomentPhotoResult = {
  blob: Blob;
};

type MomentPhotoEditResult = {
  media: MomentMediaDraft;
  error: string | null;
};

function editedExtension(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function editedName(name: string, mimeType: string): string {
  const stem = name.replace(/\.[^/.]+$/, "") || "moment-photo";
  return `${stem}-edited.${editedExtension(mimeType)}`;
}

export function replaceMomentMediaWithEditedBlob(
  current: MomentMediaDraft,
  result: EditedMomentPhotoResult,
): MomentPhotoEditResult {
  const mimeType = result.blob.type.toLowerCase();
  if (!MOMENT_PHOTO_TYPES.has(mimeType)) {
    return { media: current, error: "Edited photo must be JPEG, PNG, or WebP." };
  }
  if (result.blob.size > MOMENT_MAX_PHOTO_BYTES) {
    return { media: current, error: "Edited photo must be 10MB or smaller." };
  }

  const file = new File([result.blob], editedName(current.name, mimeType), {
    type: mimeType,
    lastModified: Date.now(),
  });
  return {
    media: {
      ...current,
      name: file.name,
      mimeType,
      size: file.size,
      blob: file,
      objectUrl: URL.createObjectURL(file),
      width: null,
      height: null,
      focalX: 0.5,
      focalY: 0.5,
    },
    error: null,
  };
}
