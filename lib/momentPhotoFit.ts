// The DOM half of the Moment photo intake: decode a chosen photo, draw it down
// and re-encode it as a JPEG until it weighs less than the wire limit. The
// ladder it walks and every number on it are `lib/momentPhotoIntake.ts`; the
// encoder is the Moment editor's own (`encodeMomentPhoto`), so the bytes that
// leave here are the bytes the editor would have written.
//
// Decoding goes through `createImageBitmap` with `imageOrientation:
// "from-image"`, so a phone photo taken sideways is drawn the way the phone
// shows it; a browser without it falls back to an `<img>`, which honours the
// same orientation by default. A browser that can decode neither says so
// through `unreadable`, and the composer words that with the sentence the
// profile picker already owns.
//
// The decoder is injectable, so the ladder is tested against a fake canvas in
// jsdom, which has no real one.

import { encodeMomentPhoto } from "@/lib/momentPhotoEditor";
import {
  MOMENT_FIT_OUTPUT_TYPE,
  momentFitBox,
  momentFitFileName,
  planMomentFitAttempts,
  type MomentFitAttempt,
  type MomentPhotoBox,
} from "@/lib/momentPhotoIntake";
import { UPLOAD_PHOTO_MAX_BYTES } from "@/lib/uploadBodyLimit";

export type DecodedMomentPhoto = MomentPhotoBox & {
  /** Draw the whole photo into a box of the given size, as a JPEG at `quality`. */
  draw(box: MomentPhotoBox, quality: number): Promise<Blob>;
  close(): void;
};

export type MomentPhotoFitDeps = {
  decode(file: File): Promise<DecodedMomentPhoto | null>;
};

export type MomentPhotoFitOutcome =
  | { outcome: "fitted"; file: File; attempt: MomentFitAttempt; attempts: number }
  | { outcome: "unreadable" }
  | { outcome: "too-large" };

type Drawable = CanvasImageSource & MomentPhotoBox & { close?: () => void };

function drawToBlob(source: CanvasImageSource, box: MomentPhotoBox, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = box.width;
  canvas.height = box.height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("Photo could not be saved."));
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, box.width, box.height);
  return encodeMomentPhoto(canvas, MOMENT_FIT_OUTPUT_TYPE, quality);
}

async function decodeWithBitmap(file: File): Promise<Drawable | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
}

function decodeWithImage(file: File): Promise<Drawable | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? Object.assign(image, { width: image.naturalWidth, height: image.naturalHeight })
          : null,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

async function browserDecode(file: File): Promise<DecodedMomentPhoto | null> {
  const source = (await decodeWithBitmap(file)) ?? (await decodeWithImage(file));
  if (!source) return null;
  return {
    width: source.width,
    height: source.height,
    draw: (box, quality) => drawToBlob(source, box, quality),
    close: () => source.close?.(),
  };
}

const browserMomentPhotoFitDeps: MomentPhotoFitDeps = { decode: browserDecode };

/**
 * Walk the ladder until a JPEG lands under `budget`. The first attempt that
 * fits wins, so a photo keeps as much as the wire allows and no more is thrown
 * away than has to be.
 */
export async function fitMomentPhoto(
  file: File,
  budget: number = UPLOAD_PHOTO_MAX_BYTES,
  deps: MomentPhotoFitDeps = browserMomentPhotoFitDeps,
): Promise<MomentPhotoFitOutcome> {
  const decoded = await deps.decode(file).catch(() => null);
  if (!decoded) return { outcome: "unreadable" };
  try {
    const attempts = planMomentFitAttempts(decoded);
    for (const [index, attempt] of attempts.entries()) {
      const box = momentFitBox(decoded, attempt.longEdge);
      let blob: Blob;
      try {
        blob = await decoded.draw(box, attempt.quality);
      } catch {
        continue;
      }
      if (blob.size > 0 && blob.size <= budget) {
        const fitted = new File([blob], momentFitFileName(file.name), {
          type: MOMENT_FIT_OUTPUT_TYPE,
          lastModified: file.lastModified,
        });
        return { outcome: "fitted", file: fitted, attempt, attempts: index + 1 };
      }
    }
    return { outcome: "too-large" };
  } finally {
    decoded.close();
  }
}
