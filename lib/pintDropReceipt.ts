// Browser-safe LEAF. THE BILL THAT COMES WITH A PRICE.
//
// Captain 7 Sept 2026: "whenever a person is submitting a new price, they have
// to take a picture of the bill. Let's keep that as the right way to go about
// it." And at 17:20: "the bill photo should be mandatory, along with the
// picture of the pint or something, just to make it more fun."
//
// So a price and its proof arrive together. Everything that decides WHEN a
// bill is owed, WHAT a photo may be and WHAT WE SAY about both lives here, so
// the two price doors (the one-tap composer and the full Pint Drop composer)
// and the two write routes cannot ask one question four ways.
//
// THREE rules ride with it.
//
// (1) ONLY A PRICE IS OWED A BILL. A Pint Drop can be a note, a bit of lore or
//     a photo of the pub. Those claim nothing a reader has to check, so they
//     are asked for nothing.
// (2) THE PINT PHOTO STAYS OPTIONAL AND STAYS CHEERFUL. It is offered right
//     after the bill, in one line, and it is never a condition of logging a
//     price. A drinker with a bill and no patience for a second photo still
//     gets their price on the map.
// (3) THE ANONYMOUS PATH IS UNTOUCHED (captain's 4 Sep ruling). A receipt is
//     evidence about the PRICE, never a second identity: an anonymous drop
//     carrying one is still one account, and nothing here reads an account.
//
// The photo rules are not new. `UPLOAD_PHOTO_MAX_BYTES` is the wire's own
// figure (lib/uploadBodyLimit.ts) and the server still sniffs the leading
// bytes and strips the metadata on the way to Storage (`uploadPhoto`,
// lib/pintDropsStore.ts). This is the browser's half of the same rule, quoted
// from the same constants rather than typed again beside a picker.

import { UPLOAD_PHOTO_MAX_BYTES, UPLOAD_PHOTO_MAX_LABEL } from "@/lib/uploadBodyLimit";

/** The three the upload path can strip, normalise and serve. */
export const PHOTO_ACCEPT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** The `accept` attribute both composers hand their file input. */
export const PHOTO_ACCEPT = PHOTO_ACCEPT_TYPES.join(",");

/**
 * Is this write a NEW PRICE, and therefore owed a bill?
 *
 * Takes what a form field or a JSON body actually holds, because both doors
 * ask before the price has been parsed into a number.
 */
export function priceNeedsReceipt(priceGbp: unknown): boolean {
  if (typeof priceGbp === "number") return Number.isFinite(priceGbp);
  if (typeof priceGbp !== "string") return false;
  return priceGbp.trim() !== "";
}

/**
 * Why this file cannot go, in the reader's words, or null.
 *
 * The size refusal quotes the wire's own figure rather than a number typed
 * beside a picker, so a file the platform would refuse with a bare 413 is
 * refused here in a sentence instead.
 */
export function photoRefusal(file: File): string | null {
  if (!(PHOTO_ACCEPT_TYPES as readonly string[]).includes(file.type)) {
    return "Photos must be JPEG, PNG, or WebP.";
  }
  if (file.size > UPLOAD_PHOTO_MAX_BYTES) {
    return `Each photo must be under ${UPLOAD_PHOTO_MAX_LABEL}.`;
  }
  return null;
}

/**
 * THE ONE LINE a missing bill is asked for in, on the composer and from the
 * route alike. It says what to do and why in the same breath, because a rule a
 * drinker cannot see the point of is a rule they route around.
 */
export const RECEIPT_REQUIRED_LINE =
  "Add a photo of the bill, so another drinker can check this price.";

/** The button that opens the bill picker, before one has been chosen. */
export const RECEIPT_PHOTO_ACTION = "Photo of the bill";

/** What the drop's own row calls the photo when it prints its thumbnail. */
export const RECEIPT_PHOTO_LABEL = "Receipt";

/** The optional second photo, offered right after the bill. One line, playful. */
export const PINT_PHOTO_FUN_LINE = "Now the pint itself, if you fancy.";

/** The button beside that line. */
export const PINT_PHOTO_ACTION = "Photo of your pint";
