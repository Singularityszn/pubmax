// Browser-safe LEAF. THE BILL THAT COMES WITH A PRICE, AND WHAT A PRICE
// WITHOUT ONE IS.
//
// Captain 7 Sept 2026: "whenever a person is submitting a new price, they have
// to take a picture of the bill." And at 17:20: "the bill photo should be
// mandatory, along with the picture of the pint or something, just to make it
// more fun."
//
// Captain decision 9, 1 Nov 2026 (docs/plans/LAUNCH_PLAN_2026-11-01.md): a
// typed price WITHOUT a bill is accepted at the Pint Drop door. It saves, it
// shows on the pub's own sheet as "Logged by @handle, not checked" with its
// date, and it does not colour the pin until a second, independent drinker
// agrees with it. ADR 0010 carries the dated amendment.
//
// So at that door the bill is no longer the price of entry. It is EVIDENCE,
// and this module owns what the evidence is called (`PRICE_EVIDENCE`, the
// closed set migration 0218 mirrors in a CHECK), how a write earns it
// (`priceEvidenceFor`, asked by the store's create path over what actually
// arrived, so a client can never claim a bill it did not send) and what we
// say about both.
//
// FOUR rules ride with it.
//
// (1) ONLY A PRICE IS OFFERED A BILL. A Pint Drop can be a note, a bit of lore
//     or a photo of the pub. Those claim nothing a reader has to check, so
//     they are asked for nothing and carry no evidence at all.
// (2) AT THE PINT DROP DOOR A PRICE WITHOUT ONE IS UNCHECKED, NEVER REFUSED.
//     It is still a verified account's price (the route's verified-actor gate,
//     daily cap and rate limits are unchanged), so it still carries an
//     authority key and a second drinker can still agree with it. What it may
//     not do ALONE is mark the pin, paint a band, enter a cheapest claim or
//     the Pint Index (lib/venues.ts asks `isUncheckedPrice`). The one-tap
//     community price door and the Round diary still refuse a price without
//     the bill (`priceNeedsReceipt`), because the community price row they
//     write has no evidence column to say "unchecked" with.
// (3) THE PINT PHOTO STAYS OPTIONAL AND STAYS CHEERFUL. It is offered right
//     after the bill, in one line, and it is never a condition of anything.
// (4) THE ANONYMOUS PATH IS UNTOUCHED (captain's 4 Sep ruling). A receipt is
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
const PHOTO_ACCEPT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** The `accept` attribute both composers hand their file input. */
export const PHOTO_ACCEPT = PHOTO_ACCEPT_TYPES.join(",");

/**
 * Is this write a NEW PRICE, and therefore offered a bill?
 *
 * Takes what a form field or a JSON body actually holds, because every door
 * asks before the price has been parsed into a number.
 */
export function isPricedWrite(priceGbp: unknown): boolean {
  if (typeof priceGbp === "number") return Number.isFinite(priceGbp);
  if (typeof priceGbp !== "string") return false;
  return priceGbp.trim() !== "";
}

/**
 * Is this write a new price at a door that still REFUSES one without a bill?
 *
 * The one-tap community price door (`POST /api/price-submit`) and the Round
 * diary (`POST /api/rounds/<code>`) write a community price row, and that row
 * has no evidence column, so they keep the bill rule of 7 Sept 2026. The Pint
 * Drop door does not ask this (decision 9): it asks `priceEvidenceFor`.
 */
export function priceNeedsReceipt(priceGbp: unknown): boolean {
  return isPricedWrite(priceGbp);
}

/**
 * WHAT STANDS BEHIND A PRICED DROP'S FIGURE. CLOSED, and mirrored by the
 * CHECK `pint_drops_price_evidence_known` (migration 0218).
 *
 *   receipt    the write came with a photo of the bill.
 *   unchecked  a typed price with no bill (captain decision 9, 1 Nov 2026).
 *              Shown on the pub's sheet, dated and named. ALONE it never
 *              marks the pin, paints a band, enters a cheapest claim or the
 *              Pint Index, and it never counts as a receipt.
 *
 * Absent on a drop that carries no price, and on every row written before
 * 0218. Those read exactly as they always have, because every priced row on
 * file then was written under the bill rule.
 */
export const PRICE_EVIDENCE = ["receipt", "unchecked"] as const;
export type PriceEvidence = (typeof PRICE_EVIDENCE)[number];

const PRICE_EVIDENCE_SET: ReadonlySet<string> = new Set(PRICE_EVIDENCE);

/** A stored or untrusted value narrowed to the closed set, or undefined. */
export function cleanPriceEvidence(value: unknown): PriceEvidence | undefined {
  return typeof value === "string" && PRICE_EVIDENCE_SET.has(value)
    ? (value as PriceEvidence)
    : undefined;
}

/**
 * THE ONE PLACE A WRITE EARNS ITS EVIDENCE, asked by the store's create path
 * over what actually arrived with the request. Never read off a client field:
 * a body saying "receipt" with no photo behind it is a bill nobody sent.
 */
export function priceEvidenceFor(
  priceGbp: number | null | undefined,
  hasReceipt: boolean,
): PriceEvidence | undefined {
  if (typeof priceGbp !== "number" || !Number.isFinite(priceGbp)) return undefined;
  return hasReceipt ? "receipt" : "unchecked";
}

/**
 * Is this drop's figure UNCHECKED? The one question every trust lane asks. A
 * row with no evidence recorded is not unchecked: it was written when the bill
 * was the price of entry.
 */
export function isUncheckedPrice(
  drop: { priceEvidence?: PriceEvidence | null } | null | undefined,
): boolean {
  return drop?.priceEvidence === "unchecked";
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
 * THE ONE LINE a missing bill is asked for in, at a door that still refuses a
 * price without one (`priceNeedsReceipt`). It says what to do and why in the
 * same breath, because a rule a drinker cannot see the point of is a rule they
 * route around.
 */
export const RECEIPT_REQUIRED_LINE =
  "Add a photo of the bill, so another drinker can check this price.";

/**
 * The ONE LINE the Pint Drop composer offers the bill in, now that it is
 * optional there (captain decision 9). It says what the bill buys, once, and
 * asks for nothing: with it the pin marks the report straight away, without it
 * the map waits for a second drinker. Copy may claim the mark and never the
 * colour (`CommunityPriceMapReach`, lib/communityPrice.ts).
 */
export const RECEIPT_OPTIONAL_LINE =
  "Optional. With the bill, the map marks your price straight away.";

/**
 * What the composer's receipt adds after an UNCHECKED price lands, when the
 * second-reporter pass has nothing stronger to say. It sets the drinker's
 * expectation once, so a pin that does not change is not read as a fault.
 */
export const UNCHECKED_RECEIPT_LINE =
  "Not checked yet, so it counts on the map once a second drinker agrees.";

/** The button that opens the bill picker, before one has been chosen. */
export const RECEIPT_PHOTO_ACTION = "Photo of the bill";

/** What the drop's own row calls the photo when it prints its thumbnail. */
export const RECEIPT_PHOTO_LABEL = "Receipt";

/** The optional second photo, offered right after the bill. One line, playful. */
export const PINT_PHOTO_FUN_LINE = "Now the pint itself, if you fancy.";

/** The button beside that line. */
export const PINT_PHOTO_ACTION = "Photo of your pint";
