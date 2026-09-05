import "server-only";

import type { PicksListReadStatus } from "@/lib/dayGreeting";
import { outWindowToApiDay } from "@/lib/outListings";
import { buildOutResponse } from "@/lib/out/loadOut";
import {
  mergeTonightListingRows,
  tonightLaneReports,
  tonightListingsStatus,
  type TonightOutAnswer,
  type TonightWhatsOnStatus,
} from "@/lib/tonightOutListings";
import { tonightPrimaryRows } from "@/lib/tonightPrimary";
import {
  loadWhatsOn,
  type LoadWhatsOnResult,
  type WhatsOnReadStatus,
} from "@/lib/whatsOnStore";

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
  whatsOnRows: readonly import("@/lib/whatsOn").WhatsOnRow[] = [],
): PicksListReadStatus {
  const whatsOnStatus = whatsOnStatusForTonightListings(whatsOnReadStatus, whatsOnRowCount);
  const primaryOut = out.body
    ? {
        ...out,
        body: {
          ...out.body,
          events: tonightPrimaryRows(out.body.events),
        },
      }
    : out;
  const listingsStatus = tonightListingsStatus(
    whatsOnStatus,
    primaryOut,
    now,
    tonightPrimaryRows(whatsOnRows),
    undefined,
    true,
  );
  return listingsStatus === "error" ? "degraded" : "ready";
}

/**
 * The lane note /today owes beside an empty picks card, and whether asking
 * again could change it.
 *
 * Battle test M07: on a preview with no listings keys, /today printed
 * "Nothing on tonight's list yet." while /api/out answered `not-configured`.
 * `todayPicksReadStatus` cannot see that, because a lane nobody ASKED is not a
 * lane that FAILED and `tonightListingsStatus` calls it `empty`. Both are the
 * same thing to a reader though: an absence that is about US. So the lane
 * reports are asked directly, /today words the card from the lane's own line,
 * and a lane nobody switched on is told rather than offered a retry.
 */
export function todayPicksLaneReport(
  whatsOnReadStatus: WhatsOnReadStatus,
  whatsOnRowCount: number,
  out: TonightOutAnswer,
): { reason: string | null; retryable: boolean } {
  const whatsOnStatus = whatsOnStatusForTonightListings(whatsOnReadStatus, whatsOnRowCount);
  const reports = tonightLaneReports(whatsOnStatus, out);
  if (reports.length === 0) return { reason: null, retryable: false };
  return {
    reason: reports.map((report) => report.line).join(" · "),
    retryable: reports.some((report) => report.retryable),
  };
}

/** Bundled plus live What's-On for tonight — same spine as /api/whats-on. */
export async function loadTodayWhatsOnAnswer(now: number): Promise<LoadWhatsOnResult | null> {
  try {
    return await loadWhatsOn({ window: "tonight" }, { now });
  } catch (err) {
    console.warn(
      "[today] whats-on read failed; picks degraded:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/** Out events for tonight, fail-soft like the /api/out route. */
export async function loadTodayOutAnswer(now: number): Promise<TonightOutAnswer> {
  try {
    const body = await buildOutResponse(
      { city: "london", day: outWindowToApiDay("tonight") },
      { now },
    );
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
  whatsOnStatus: TonightWhatsOnStatus = whatsOnRows.length > 0 ? "ready" : "empty",
): import("@/lib/whatsOn").WhatsOnRow[] {
  return mergeTonightListingRows(
    tonightPrimaryRows(whatsOnRows),
    tonightPrimaryRows(out.body?.events ?? []),
    now,
    whatsOnStatus,
    undefined,
    true,
  );
}
