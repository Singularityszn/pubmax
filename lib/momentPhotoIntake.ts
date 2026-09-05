// What the Moment composer does with a file the moment it is chosen, before
// any of it reaches the draft. Pure and browser-safe: no DOM, no canvas, so
// the decisions that shape what leaves a phone are unit-testable on their own.
//
// THREE questions, asked in this order.
//
// 1. May it be opened at all? `MOMENT_PICK_MAX_BYTES` is the ceiling on what
//    the browser will decode. It is deliberately far above the wire limit,
//    because the wire limit is OUR problem to solve: a phone hands over an 8 MB
//    photo as a matter of course, and refusing it would refuse the phone. A
//    file that is none of the four photo types is refused here.
// 2. May it go up as it is? A JPEG, PNG or WebP under `UPLOAD_PHOTO_MAX_BYTES`
//    is kept byte for byte, so the server's EXIF strip still sees the original.
// 3. Otherwise it is FITTED: decoded, drawn down and re-encoded as a JPEG until
//    it lands under the wire limit. `planMomentFitAttempts` is the ladder,
//    largest first, so a photo loses no more than it has to. The DOM half is
//    `lib/momentPhotoFit.ts`. An iPhone's HEIC takes this path whatever it
//    weighs, because the server stores three types and HEIC is not one: the
//    picker names HEIC (`PROFILE_IMAGE_PICKER_ACCEPT`) so the library is on
//    the sheet, and the fit is what makes the library's photos uploadable.

import { MOMENT_PHOTO_TYPES } from "@/lib/momentPhotoEditor";
import { isLikelyHeic } from "@/lib/profileImagePicker";
import { UPLOAD_PHOTO_MAX_BYTES, UPLOAD_PHOTO_MAX_LABEL } from "@/lib/uploadBodyLimit";

/** The most the composer will try to open. Above this a phone is not the source. */
export const MOMENT_PICK_MAX_BYTES = 30 * 1024 * 1024;

export type MomentPhotoIntakeDecision =
  | { outcome: "keep" }
  | { outcome: "fit"; reason: "size" | "heic" }
  | { outcome: "refuse"; message: string };

/** What the picker offers, as words: the four types a phone or a desk holds. */
export const MOMENT_PHOTO_TYPES_LINE = "JPEG, PNG, WebP or HEIC";
export const MOMENT_PHOTO_WRONG_TYPE_LINE = `Choose ${MOMENT_PHOTO_TYPES_LINE} photos.`;

export type MomentPhotoBox = { readonly width: number; readonly height: number };

export type MomentFitAttempt = {
  /** Longest edge of the drawn photo, in pixels. */
  readonly longEdge: number;
  /** JPEG quality handed to the encoder. */
  readonly quality: number;
};

/**
 * Long edges the fit walks down. 2560 keeps a phone photo sharper than any
 * screen it will be read on; 1280 is the floor, and a JPEG at that size lands
 * under a megabyte whatever it shows.
 */
export const MOMENT_FIT_LONG_EDGES: readonly number[] = [2560, 2048, 1600, 1280];

/** Qualities tried at each edge, best first. */
export const MOMENT_FIT_QUALITIES: readonly number[] = [0.86, 0.78, 0.7];

export const MOMENT_FIT_OUTPUT_TYPE = "image/jpeg";

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** What the composer says under the picker, at each width. */
export function momentPickerHint(isPhone: boolean): string {
  return isPhone
    ? `Camera or library. Over ${UPLOAD_PHOTO_MAX_LABEL} is resized.`
    : `${MOMENT_PHOTO_TYPES_LINE}. Over ${UPLOAD_PHOTO_MAX_LABEL} is resized.`;
}

export function momentPhotoTooLargeLine(): string {
  return `That photo is over ${Math.round(MOMENT_PICK_MAX_BYTES / (1024 * 1024))} MB. Choose a smaller one.`;
}

export const MOMENT_PHOTO_FIT_FAILED_LINE =
  `That photo could not be resized under ${UPLOAD_PHOTO_MAX_LABEL}. Choose another one.`;

/** A draft restored from before the wire limit may still hold a heavy blob. */
export function momentPhotoStillTooLargeLine(name: string): string {
  return `${name} is over ${UPLOAD_PHOTO_MAX_LABEL}. Remove it, then add it again.`;
}

export type MomentPhotoCandidate = {
  readonly type: string;
  readonly name: string;
  readonly size: number;
};

export function momentPhotoIntakeDecision(file: MomentPhotoCandidate): MomentPhotoIntakeDecision {
  const heic = isLikelyHeic(file);
  if (!heic && !MOMENT_PHOTO_TYPES.has(file.type.toLowerCase())) {
    return { outcome: "refuse", message: MOMENT_PHOTO_WRONG_TYPE_LINE };
  }
  if (!positive(file.size)) return { outcome: "refuse", message: "That file is empty. Choose another one." };
  if (file.size > MOMENT_PICK_MAX_BYTES) return { outcome: "refuse", message: momentPhotoTooLargeLine() };
  if (heic) return { outcome: "fit", reason: "heic" };
  if (file.size > UPLOAD_PHOTO_MAX_BYTES) return { outcome: "fit", reason: "size" };
  return { outcome: "keep" };
}

/** The box a photo is drawn into for one attempt. Never upscales. */
export function momentFitBox(natural: MomentPhotoBox, longEdge: number): MomentPhotoBox {
  if (!positive(natural.width) || !positive(natural.height)) return { width: 1, height: 1 };
  const naturalLong = Math.max(natural.width, natural.height);
  const scale = Math.min(1, longEdge / naturalLong);
  return {
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  };
}

/**
 * Every attempt the fit may make, in the order it makes them: each edge at
 * each quality, best first. An edge the photo is already smaller than is
 * tried once, at its own size, because drawing it larger buys nothing.
 */
export function planMomentFitAttempts(natural: MomentPhotoBox): MomentFitAttempt[] {
  const naturalLong = Math.max(natural.width, natural.height);
  const edges: number[] = [];
  for (const edge of MOMENT_FIT_LONG_EDGES) {
    const drawn = positive(naturalLong) ? Math.min(edge, Math.round(naturalLong)) : edge;
    if (!edges.includes(drawn)) edges.push(drawn);
  }
  const attempts: MomentFitAttempt[] = [];
  for (const longEdge of edges) {
    for (const quality of MOMENT_FIT_QUALITIES) attempts.push({ longEdge, quality });
  }
  return attempts;
}

/** The name the fitted JPEG carries: the chosen photo's stem, our extension. */
export function momentFitFileName(name: string): string {
  const stem = name.replace(/\.[^/.]+$/, "") || "moment-photo";
  return `${stem}.jpg`;
}
