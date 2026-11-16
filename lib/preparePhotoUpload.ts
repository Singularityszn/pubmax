import { fitMomentPhoto } from "@/lib/momentPhotoFit";
import {
  MOMENT_PHOTO_FIT_FAILED_LINE,
  MOMENT_PICK_MAX_BYTES,
  PHOTO_SNIFF_BYTES,
  momentPhotoIntakeDecision,
  momentPhotoTooLargeLine,
  sniffPhotoKind,
} from "@/lib/momentPhotoIntake";
import { isLikelyHeic, unreadableImageMessageFor } from "@/lib/profileImagePicker";

export type PreparedPhotoUpload = { file: File; width: number; height: number };

export async function preparePhotoUpload(file: File): Promise<PreparedPhotoUpload> {
  if (file.size > MOMENT_PICK_MAX_BYTES) throw new Error(momentPhotoTooLargeLine());
  const bytes = new Uint8Array(await file.slice(0, PHOTO_SNIFF_BYTES).arrayBuffer());
  const decision = momentPhotoIntakeDecision({ ...file, name: file.name, type: file.type, size: file.size, kind: sniffPhotoKind(bytes) });
  if (decision.outcome === "refuse") throw new Error(decision.message);
  // Decode and redraw even small files so EXIF orientation and metadata cannot
  // change the frame between the local preview and the server's JPEG.
  const fitted = await fitMomentPhoto(file);
  if (fitted.outcome === "unreadable") throw new Error(unreadableImageMessageFor("photo", isLikelyHeic(file)));
  if (fitted.outcome === "too-large") throw new Error(MOMENT_PHOTO_FIT_FAILED_LINE);
  return { file: fitted.file, width: fitted.width, height: fitted.height };
}
