import { cleanDrinkMeasure } from "@/lib/drinkMeasure";
import { normalizeViewerHandle, type PintDrop } from "@/lib/pintDrops";

/**
 * How long two identical priced drops from one account at one pub are read as
 * ONE tap rather than two reports (battle test D10).
 *
 * Three `el.click()` calls on Log it in one tick sent three POSTs, all 201, and
 * wrote three `pint_drops` rows 21 ms apart; a human double-tap on a slow
 * network does the same, and so does any retry of a request whose response was
 * lost. The client latch is the first line, but a latch lives in one
 * browser tab and cannot speak for a retry, so the write path needs its own
 * answer.
 *
 * It is deliberately NOT the daily cap. `POST /api/price-submit` pairs a drop
 * with each beer pint price and takes several from one account at one pub in
 * one day ON PURPOSE, so a day-wide guard would refuse the second
 * honest correction of an evening. Six seconds refuses a duplicate tap and a
 * lost-response retry, and refuses nothing a drinker meant twice.
 */
export const ONE_TAP_DUPLICATE_WINDOW_MS = 6_000;

/**
 * The row an identical earlier tap already wrote, or null. Pure, so the window
 * rule is testable without a store.
 *
 * Identity is the whole observation: same pub, same account, same figure, same
 * measure. A different figure is a correction and is welcome; a different
 * measure is a different drink. Only an exact repeat inside the window is the
 * same tap arriving twice.
 */
export function duplicateOneTapDrop(
  rows: readonly PintDrop[],
  candidate: Pick<PintDrop, "venueId" | "handle" | "priceGbp" | "measure">,
  now: number,
): PintDrop | null {
  const handle = normalizeViewerHandle(candidate.handle);
  if (!handle || typeof candidate.priceGbp !== "number") return null;
  const measure = cleanDrinkMeasure(candidate.measure);
  let best: PintDrop | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (row.venueId !== candidate.venueId) continue;
    if (normalizeViewerHandle(row.handle) !== handle) continue;
    if (row.priceGbp !== candidate.priceGbp) continue;
    if (cleanDrinkMeasure(row.measure) !== measure) continue;
    const at = Date.parse(row.createdAt);
    if (!Number.isFinite(at)) continue;
    // A row dated ahead of us is a clock we cannot reason about, not a repeat.
    if (at > now || now - at > ONE_TAP_DUPLICATE_WINDOW_MS) continue;
    if (at <= bestAt) continue;
    best = row;
    bestAt = at;
  }
  return best;
}
