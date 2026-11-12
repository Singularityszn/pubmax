// BROWSER-SAFE LEAF. Mates' activity on the Social Following lane: the pints
// the reader's mutual friends logged, newest first, each as that mate logged it.
//
// Only Pint Drops feed it. The "Been here" list stays the owner's own
// (lib/profilePassport.ts), and a Pint Drop carries no star rating, so neither
// appears here. Nothing is added across people (ADR 0017): each row is one
// mate's one drop on one day.

import { cleanDrinkMeasure, type DrinkMeasure } from "@/lib/drinkMeasure";
import { cleanPriceEvidence, type PriceEvidence } from "@/lib/pintDropReceipt";

/** The most rows one read returns. */
export const MATES_ACTIVITY_LIMIT = 20;

/** One mate's one visible Pint Drop. */
export type MatesActivityPint = {
  id: string;
  handle: string;
  venueId: string;
  venueName: string;
  venueMapUrl: string;
  drink: string;
  measure: DrinkMeasure;
  measureLabel?: string;
  /** The price as the mate logged it, or null for a drop with no price. */
  priceGbp: number | null;
  priceEvidence?: PriceEvidence;
  /** When the drop was logged (ISO). */
  loggedAt: string;
};

export type MatesActivityAnswer = { items: MatesActivityPint[] };

const BILL_LINE: Record<PriceEvidence, string> = {
  receipt: "Checked against the bill",
  unchecked: "Not checked yet",
};

/** What the price's own record says about it, or null when it says nothing. */
export function matesActivityBillLine(item: Pick<MatesActivityPint, "priceGbp" | "priceEvidence">): string | null {
  if (item.priceGbp === null || !item.priceEvidence) return null;
  return BILL_LINE[item.priceEvidence];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The answer's rows, or null when the body is not a mates' activity answer. */
export function parseMatesActivity(body: unknown): MatesActivityPint[] | null {
  if (!isRecord(body) || !Array.isArray(body.items)) return null;
  const items: MatesActivityPint[] = [];
  for (const row of body.items) {
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      typeof row.handle !== "string" ||
      !row.handle ||
      typeof row.venueId !== "string" ||
      typeof row.venueName !== "string" ||
      typeof row.venueMapUrl !== "string" ||
      typeof row.drink !== "string" ||
      typeof row.loggedAt !== "string" ||
      Number.isNaN(Date.parse(row.loggedAt)) ||
      (row.priceGbp !== null && (typeof row.priceGbp !== "number" || !Number.isFinite(row.priceGbp) || row.priceGbp <= 0))
    ) {
      return null;
    }
    const priceEvidence = cleanPriceEvidence(row.priceEvidence);
    items.push({
      id: row.id,
      handle: row.handle,
      venueId: row.venueId,
      venueName: row.venueName,
      venueMapUrl: row.venueMapUrl,
      drink: row.drink,
      measure: cleanDrinkMeasure(row.measure),
      ...(typeof row.measureLabel === "string" && row.measureLabel ? { measureLabel: row.measureLabel } : {}),
      priceGbp: row.priceGbp as number | null,
      ...(priceEvidence ? { priceEvidence } : {}),
      loggedAt: row.loggedAt,
    });
  }
  return items.slice(0, MATES_ACTIVITY_LIMIT);
}
