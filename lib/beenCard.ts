// The Been card: the share an owner earns once their Been list holds a few
// pubs. Two facts and nothing else: how many pubs they have been to, and the
// cheapest pint they logged themselves, as its own receipt.
//
// A PURE LEAF. The mint (lib/beenCardMint.server.ts), the signed link
// (lib/beenCardShare.server.ts), the profile button and the card read one set
// of rules here.
//
// THE FENCES.
//   - The count is the server's own Been count (lib/profilePassport.server.ts)
//     at the moment the owner taps, signed with that day. The card prints the
//     day beside it, so an old link never claims to be today's count.
//   - The card names no pub from the Been list. The undated Been here list is
//     the owner's alone (lib/profilePassport.ts); only the count travels.
//   - The pint is one of the owner's own public Pint Drops, measured as a
//     pint, with a price. It travels as a drop id and the card reads the drop
//     again, so a drop later hidden, deleted or made private leaves the card.
//   - No score, no rank, no streak, no comparison (ADR 0017).

import { measureIsPint, type DrinkMeasure } from "@/lib/drinkMeasure";
import { normalizeHandle } from "@/lib/handleNormalize";

/** Pubs on the Been list before the card can be shared. */
export const BEEN_CARD_UNLOCK = 5;

export const BEEN_CARD_COPY = {
  kicker: "Been card",
  share: "Share your Been card",
  ready: "Link copied.",
  failed: "That link did not make it. Try again shortly.",
  cheapestLabel: "Cheapest pint logged",
  openReceipt: "Open the receipt",
} as const;

export function beenCardUnlocked(count: number): boolean {
  return Number.isSafeInteger(count) && count >= BEEN_CARD_UNLOCK;
}

/** "3 more pubs and you can share your Been card." Null once it is unlocked. */
export function beenCardLockedLine(count: number): string | null {
  if (beenCardUnlocked(count)) return null;
  const left = BEEN_CARD_UNLOCK - Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  return `${left} more ${left === 1 ? "pub" : "pubs"} and you can share your Been card.`;
}

/** "12 pubs". */
export function beenCardCountLine(count: number): string {
  return `${count} ${count === 1 ? "pub" : "pubs"}`;
}

/** "@sam has been to 12 pubs". */
export function beenCardTitle(handle: string, count: number): string {
  return `@${handle} has been to ${beenCardCountLine(count)}`;
}

/** "I've been to 12 pubs. My Been card on PUBMAXX." The words that travel with the link. */
export function beenCardShareText(count: number): string {
  return `I've been to ${beenCardCountLine(count)}. My Been card on PUBMAXX.`;
}

/** "Counted from their Been list on 12 Nov 2026." The day the count was signed, in London. */
export function beenCardCountedLine(issuedAt: number): string {
  return `Counted from their Been list on ${beenCardDay(issuedAt)}.`;
}

/** "12 Nov 2026" in London. */
export function beenCardDay(issuedAt: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(issuedAt));
}

export type BeenCardDrop = {
  id: string;
  handle: string;
  priceGbp: number | null;
  measure?: DrinkMeasure;
  visibility?: string;
  status?: string;
  createdAt: string;
};

/**
 * Whether a drop may stand on this handle's card: their own, public, visible,
 * a pint, and priced. An anonymous or friends-only drop is never put next to a
 * handle, and a half is not a pint.
 */
export function beenCardDropQualifies(drop: BeenCardDrop, handle: string): boolean {
  const owner = normalizeHandle(handle);
  if (!owner || normalizeHandle(drop.handle ?? "") !== owner) return false;
  if (drop.visibility !== "public") return false;
  if (drop.status !== undefined && drop.status !== "visible") return false;
  if (!measureIsPint(drop.measure)) return false;
  const price = drop.priceGbp;
  return typeof price === "number" && Number.isFinite(price) && price > 0;
}

/** The cheapest qualifying drop, the newest one on a tie, or null. */
export function cheapestBeenCardDrop<T extends BeenCardDrop>(drops: readonly T[], handle: string): T | null {
  let best: T | null = null;
  for (const drop of drops) {
    if (!beenCardDropQualifies(drop, handle)) continue;
    if (
      !best ||
      drop.priceGbp! < best.priceGbp! ||
      (drop.priceGbp === best.priceGbp && drop.createdAt > best.createdAt)
    ) {
      best = drop;
    }
  }
  return best;
}
