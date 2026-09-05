// Session-only dismissal for a price evidence mission. No durable claim
// and no reservation. A refresh in the same tab keeps the skip; a new
// browser session starts clean.

import type { PriceEvidenceMission } from "@/lib/priceEvidenceMissions";
import { priceEvidenceMissionKey } from "@/lib/priceEvidenceMissions";

export const PRICE_EVIDENCE_MISSION_DISMISS_KEY = "pubmaxx:price-mission-dismiss:v1";

export function readDismissedMissions(storage: Pick<Storage, "getItem"> | null): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(PRICE_EVIDENCE_MISSION_DISMISS_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string" && value.length > 0));
  } catch {
    return new Set();
  }
}

/**
 * A mission the drinker COMPLETED. It writes the same session skip a dismissal
 * writes, so the read that follows the log does not offer the pub back inside
 * this tab, and it is a separate name because the two are different events: a
 * skip is "not now", a completion is the ask already answered. Analytics stay
 * with the caller (`mission_submitted` is emitted by the composer), so nothing
 * here reports a dismissal that never happened.
 */
export function completePriceEvidenceMission(
  mission: PriceEvidenceMission,
  storage: Pick<Storage, "getItem" | "setItem"> | null,
): Set<string> {
  return dismissPriceEvidenceMission(mission, storage);
}

export function dismissPriceEvidenceMission(
  mission: PriceEvidenceMission,
  storage: Pick<Storage, "getItem" | "setItem"> | null,
): Set<string> {
  const next = readDismissedMissions(storage);
  next.add(priceEvidenceMissionKey(mission));
  if (!storage) return next;
  try {
    storage.setItem(PRICE_EVIDENCE_MISSION_DISMISS_KEY, JSON.stringify([...next]));
  } catch {
    // Private mode / quota. Keep the in-memory skip for this render tree.
  }
  return next;
}
