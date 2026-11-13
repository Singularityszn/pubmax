import { cleanDrinkMeasure, type DrinkMeasure } from "@/lib/drinkMeasure";
import { CHALLENGE_IDS, type ChallengeId } from "@/lib/challenges";
import { cleanPriceEvidence, type PriceEvidence } from "@/lib/pintDropReceipt";

/** The most rows one read returns. */
export const MATES_ACTIVITY_LIMIT = 20;

/** One mate's one visible Pint Drop. */
export type MatesActivityPint = {
  kind?: "pint";
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

export type MatesActivityChallenge = {
  kind: "challenge_finished";
  id: string;
  handle: string;
  challengeId: ChallengeId;
  loggedAt: string;
};

export type MatesActivityItem = MatesActivityPint | MatesActivityChallenge;
export type MatesActivityAnswer = { items: MatesActivityItem[] };

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
export function parseMatesActivity(body: unknown): MatesActivityItem[] | null {
  if (!isRecord(body) || !Array.isArray(body.items)) return null;
  const items: MatesActivityItem[] = [];
  for (const row of body.items) {
    if (isRecord(row) && row.kind === "challenge_finished") {
      if (typeof row.id !== "string" || typeof row.handle !== "string" || !row.handle ||
        typeof row.loggedAt !== "string" || Number.isNaN(Date.parse(row.loggedAt)) ||
        !CHALLENGE_IDS.includes(row.challengeId as ChallengeId)) return null;
      items.push({ kind: "challenge_finished", id: row.id, handle: row.handle,
        challengeId: row.challengeId as ChallengeId, loggedAt: row.loggedAt });
      continue;
    }
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
