import "server-only";

import type { PicksListReadStatus } from "@/lib/dayGreeting";
import { buildOutResponse } from "@/lib/out/loadOut";
import {
  mergeTonightListingRows,
  tonightListingsStatus,
  type TonightOutAnswer,
  type TonightWhatsOnStatus,
} from "@/lib/tonightOutListings";
import type { WhatsOnReadStatus } from "@/lib/whatsOnStore";

/** Map the bundled What's-On read into Tonight's spine status vocabulary. */
export function whatsOnStatusForTonightListings(
  readStatus: WhatsOnReadStatus,
  rowCount: number,
): TonightWhatsOnStatus {
  if (readStatus === "degraded") return "error";
  return rowCount > 0 ? "ready" : "empty";
}

/**
 * What the Today picks card may claim after both lanes answer.
 *
 * Tonight merges What's-On and Out before it paints; Today must use the same
 * merged truth so a quiet bundled spine never reads as an empty night while
 * Ticketmaster rows are on /tonight.
 */
export function todayPicksReadStatus(
  whatsOnReadStatus: WhatsOnReadStatus,
  whatsOnRowCount: number,
  out: TonightOutAnswer,
  now: number,
): PicksListReadStatus {
  const listingsStatus = tonightListingsStatus(
    whatsOnStatusForTonightListings(whatsOnReadStatus, whatsOnRowCount),
    out,
    now,
  );
  return listingsStatus === "error" ? "degraded" : "ready";
}

/** Out events for tonight, fail-soft like the /api/out route. */
export async function loadTodayOutAnswer(now: number): Promise<TonightOutAnswer> {
  try {
    const body = await buildOutResponse({ city: "london", day: "tonight" }, { now });
    return { body, failed: false, pending: false };
  } catch (err) {
    console.warn(
      "[today] out read failed; picks degraded:",
      err instanceof Error ? err.message : String(err),
    );
    return { body: null, failed: true, pending: false };
  }
}

/** One merged tonight listing set: What's-On rows plus Out events. */
export function mergeTodayListingRows(
  whatsOnRows: readonly import("@/lib/whatsOn").WhatsOnRow[],
  out: TonightOutAnswer,
  now: number,
): import("@/lib/whatsOn").WhatsOnRow[] {
  return mergeTonightListingRows(whatsOnRows, out.body?.events ?? [], now);
}
