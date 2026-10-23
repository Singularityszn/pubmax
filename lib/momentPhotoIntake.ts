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
//
// The FIRST question is answered by the bytes, never by the name. A browser
// types a file off its extension, so a text file called night.jpg arrived as
// image/jpeg, passed the composer, and was refused by the server's own sniff
// after a Memory row had already been minted for it (battle test D05).
// `sniffPhotoKind` reads the same signatures the server reads
// (`lib/imageSafety.ts`) plus the ISO container an iPhone writes, and a file
// whose leading bytes match none of them is refused before it touches the
// draft.

import { detectImageKind } from "@/lib/imageSafety";
import { MOMENT_PHOTO_TYPES } from "@/lib/momentPhotoEditor";
import { isLikelyHeic } from "@/lib/profileImagePicker";
import { UPLOAD_PHOTO_MAX_BYTES, UPLOAD_PHOTO_MAX_LABEL, uploadPhotoSizeLabel } from "@/lib/uploadBodyLimit";

/** The most the composer will try to open. Above this a phone is not the source. */
export const MOMENT_PICK_MAX_BYTES = 30 * 1024 * 1024;

export type MomentPhotoIntakeDecision =
  /** `type` is what the bytes are, which is what the request declares. */
  | { outcome: "keep"; type: string }
  | { outcome: "fit"; reason: "size" | "heic" }
  | { outcome: "refuse"; message: string };

export type MomentPhotoKind = "jpeg" | "png" | "webp" | "heic";

/** Enough leading bytes to name any of the four containers. */
export const PHOTO_SNIFF_BYTES = 16;

export const MOMENT_PHOTO_NOT_A_PHOTO_LINE = "That file is not a photo. Choose a JPEG, PNG, WebP or HEIC.";

const MIME_BY_KIND: Record<MomentPhotoKind, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

/**
 * ISO base media brands an iPhone writes. The box is `ftyp` at byte 4, then
 * the major brand; `mif1` and `msf1` are the still and sequence brands HEIF
 * files name themselves by when no codec brand comes first.
 */
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let index = start; index < start + length; index += 1) {
    const value = bytes[index];
    if (value === undefined) return "";
    out += String.fromCharCode(value);
  }
  return out;
}

/** What the leading bytes say the file is, or null when they say nothing we take. */
export function sniffPhotoKind(bytes: Uint8Array): MomentPhotoKind | null {
  const kind = detectImageKind(bytes);
  if (kind) return kind;
  if (ascii(bytes, 4, 4) === "ftyp" && HEIC_BRANDS.has(ascii(bytes, 8, 4).toLowerCase())) return "heic";
  return null;
}

/** What the picker offers, as words: the four types a phone or a desk holds. */
const MOMENT_PHOTO_TYPES_LINE = "JPEG, PNG, WebP or HEIC";
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

/** The one line that says what leaves the phone, and the real number in it. */
const MOMENT_PICKER_RESIZE_LINE = `Photos over ${UPLOAD_PHOTO_MAX_LABEL} are resized.`;

/**
 * What the composer says under the picker, at each width: one sentence per
 * line, so the last line is never an orphaned clause. The size label keeps
 * its figure on its unit at a wrap. The phone names the sheet; the desk names
 * the types and the other way in.
 */
export function momentPickerHint(isPhone: boolean): readonly string[] {
  return isPhone
    ? ["Camera or library.", MOMENT_PICKER_RESIZE_LINE]
    : [`${MOMENT_PHOTO_TYPES_LINE}.`, MOMENT_PICKER_RESIZE_LINE, "Drag and drop or browse."];
}

export function momentPhotoTooLargeLine(): string {
  return `That photo is over ${uploadPhotoSizeLabel(MOMENT_PICK_MAX_BYTES)}. Choose a smaller one.`;
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
  /** What `sniffPhotoKind` read off the leading bytes; null when nothing matched. */
  readonly kind: MomentPhotoKind | null;
};

export function momentPhotoIntakeDecision(file: MomentPhotoCandidate): MomentPhotoIntakeDecision {
  const declaredHeic = isLikelyHeic(file);
  if (!declaredHeic && !MOMENT_PHOTO_TYPES.has(file.type.toLowerCase())) {
    return { outcome: "refuse", message: MOMENT_PHOTO_WRONG_TYPE_LINE };
  }
  if (!positive(file.size)) return { outcome: "refuse", message: "That file is empty. Choose another one." };
  if (!file.kind) return { outcome: "refuse", message: MOMENT_PHOTO_NOT_A_PHOTO_LINE };
  if (file.size > MOMENT_PICK_MAX_BYTES) return { outcome: "refuse", message: momentPhotoTooLargeLine() };
  if (file.kind === "heic") return { outcome: "fit", reason: "heic" };
  if (file.size > UPLOAD_PHOTO_MAX_BYTES) return { outcome: "fit", reason: "size" };
  return { outcome: "keep", type: MIME_BY_KIND[file.kind] };
}

/**
 * Whether a refused Moment write leaves the Memory it was written into worth
 * keeping. A refusal ABOUT THE PHOTO (bad bytes, too heavy, a storage fault)
 * says nothing about the Memory, so the next save goes back into it rather
 * than minting a second one; only a refusal about the MEMORY, or a Memory
 * that is not there, drops the id. Every 400 used to drop it, and a corrupt
 * JPEG then left one empty Memory in the studio per attempt (battle test D05).
 */
export const NIGHT_MEMORY_REFUSED_CODE = "NIGHT_MEMORY_REFUSED";

export function keepServerMemoryAfterRefusal(
  status: number | null | undefined,
  code: string | null | undefined,
): boolean {
  if (status === 404) return false;
  if (code === NIGHT_MEMORY_REFUSED_CODE) return false;
  return true;
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
