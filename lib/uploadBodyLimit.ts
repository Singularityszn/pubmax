// What ONE photo may weigh on the wire, and why.
//
// Every upload route here is a Vercel Node function, and the platform refuses
// a request body over 4.5 MB with a plain-text 413 FUNCTION_PAYLOAD_TOO_LARGE
// BEFORE any handler runs. So a server allow-list that says "10 MB" is a
// promise nothing can keep: a phone photo between 4.5 MB and 10 MB passed
// every check the browser made, reached no code of ours, and came back as a
// refusal the composer could only word as "Some photos could not be saved".
// Measured 5 Sep 2026 on the contribution battle test (D02): an 8,060,438
// byte JPEG answered 413 in 19.4 s on the Moment route and the wall route
// alike.
//
// This module is a pure leaf so the browser and the server read ONE number.
// The browser resizes anything over it before the request is built
// (`lib/momentPhotoFit.ts`), the crop step already lands every wall, profile
// and message photo well under it, and each server allow-list reads it here
// rather than restating a figure the platform will never let through.

/**
 * The platform's own request-body ceiling for a serverless function, in the
 * decimal megabytes Vercel documents it in. Nothing of ours runs past it.
 */
export const FUNCTION_REQUEST_BODY_LIMIT_BYTES = 4_500_000;

/**
 * Room left for the other multipart fields (caption, venue id, time, alt text,
 * boundaries) beside the photo. Generous: the largest field is a 500 character
 * caption.
 */
export const UPLOAD_FIELDS_ALLOWANCE_BYTES = 64 * 1024;

/** The most one photo may weigh in an upload body. */
export const UPLOAD_PHOTO_MAX_BYTES = 4 * 1024 * 1024;

/**
 * A byte figure as a reader sees it, and the ONE spelling of it. A caller may
 * pass its own ceiling (the upload path takes an override), so the words come
 * from the number rather than from a second constant beside each one. A
 * no-break space joins the figure to its unit, so no wrap can part them.
 */
export function uploadPhotoSizeLabel(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)}\u00a0MB`;
}

/** The number as a reader sees it, on the picker hint and in every refusal. */
export const UPLOAD_PHOTO_MAX_LABEL = uploadPhotoSizeLabel(UPLOAD_PHOTO_MAX_BYTES);

export function photoFitsUploadBody(size: number): boolean {
  return Number.isFinite(size) && size > 0 && size <= UPLOAD_PHOTO_MAX_BYTES;
}
