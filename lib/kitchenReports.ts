// "Is the kitchen still open?" (launch review idea A1). A drinker at the pub
// taps "Still serving" or "Kitchen closed" on the food row.
//
// A REPORT IS NEVER A VENUE FACT AND NEVER HOURS. It is what one signed-in
// drinker said at one minute, so every read prints whose word it is and how
// long ago: "Kitchen open, said @handle 20 min ago". Nothing reads these rows
// to change a pack, a pin, opening hours or a kitchen time.
//
// IT GOES QUIET AFTER 90 MINUTES, the same window a crowd reading has
// (`OCCUPANCY_FRESH_WINDOW_MS`, lib/occupancy.ts). Past it the row stays for
// its owner's export and the read prints nothing at all.
//
// ONE CONFIRMER, NO THIRD, the same shape as a pint confirmation. A different
// account's matching tap inside the window confirms the newest report. The
// reporter cannot confirm their own, and once one other account has confirmed
// it a further matching tap changes nothing. A tap with the other word starts
// a new report, and the newest report is the one the read prints.
//
// Browser-safe leaf: the closed vocabulary, the tap rule and every word the
// read prints live here, mirrored by the CHECKs in migration 0209.

import {
  OCCUPANCY_FRESH_WINDOW_MS,
  occupancyAgeLabel,
  occupancyAgeMinutes,
} from "@/lib/occupancy";

/** The two words a drinker may say. Nothing else is a kitchen report. */
export const KITCHEN_STATES = ["open", "closed"] as const;
export type KitchenState = (typeof KITCHEN_STATES)[number];

/** The crowd reading's window, spent again rather than restated. */
export const KITCHEN_FRESH_WINDOW_MS = OCCUPANCY_FRESH_WINDOW_MS;

/** The two buttons, in the order they sit on the food row. */
export const KITCHEN_TAP_LABELS: Record<KitchenState, string> = {
  open: "Still serving",
  closed: "Kitchen closed",
};

/** The question over the two buttons. */
export const KITCHEN_TAP_PROMPT = "Here now? Say if the kitchen is serving.";

/** The receipt after a first report. */
export const KITCHEN_REPORTED_LINE = "Thanks. It shows with your handle for 90 minutes.";

/** The receipt after a confirmation. */
export const KITCHEN_CONFIRMED_LINE = "Thanks. That confirms it.";

const KITCHEN_READ_LEAD: Record<KitchenState, string> = {
  open: "Kitchen open",
  closed: "Kitchen closed",
};

export type KitchenReport = {
  id: string;
  venueId: string;
  state: KitchenState;
  reporterUserId: string;
  reportedAt: string;
  /** The one other account that confirmed it, or null. Never printed. Cleared if that account leaves. */
  confirmedBy: string | null;
  confirmedAt: string | null;
};

/** What the public read hands a surface: no account id on it. */
export type PublicKitchenReport = {
  id: string;
  venueId: string;
  state: KitchenState;
  reportedAt: string;
  /** The reporter's CURRENT handle, read at answer time, never stored. */
  handle: string;
  confirmed: boolean;
};

/** What the account export carries for a report the account made. */
export type KitchenReportOwnerFields = Pick<KitchenReport, "id" | "venueId" | "state" | "reportedAt"> & {
  confirmed: boolean;
};

export function kitchenReportOwnerFields(row: KitchenReport): KitchenReportOwnerFields {
  return {
    id: row.id,
    venueId: row.venueId,
    state: row.state,
    reportedAt: row.reportedAt,
    confirmed: row.confirmedAt !== null,
  };
}

/** Exactly one of the two words. A near miss is refused, never guessed. */
export function parseKitchenState(value: unknown): KitchenState | null {
  return typeof value === "string" && (KITCHEN_STATES as readonly string[]).includes(value)
    ? (value as KitchenState)
    : null;
}

/** Whether a report may still be read: inside the 90 minute window, and not from the future. */
export function isFreshKitchenReport(reportedAt: string, now: number): boolean {
  const at = Date.parse(reportedAt);
  if (!Number.isFinite(at)) return false;
  const age = now - at;
  return age >= 0 && age <= KITCHEN_FRESH_WINDOW_MS;
}

/** The newest report still inside the window, or null. On a tie the later row in the list wins, so two taps in one millisecond read as the second. */
export function latestFreshKitchenReport<T extends { reportedAt: string }>(
  rows: readonly T[],
  now: number,
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (!isFreshKitchenReport(row.reportedAt, now)) continue;
    if (!best || Date.parse(row.reportedAt) >= Date.parse(best.reportedAt)) best = row;
  }
  return best;
}

export type KitchenTapPlan =
  | { kind: "report" }
  | { kind: "confirm"; id: string }
  | { kind: "own" }
  | { kind: "already" };

/**
 * What one tap does, given the newest fresh report at the pub. The one rule,
 * for both backends: a different word, or no fresh report, starts a report; a
 * matching word from the reporter is refused; a matching word on a report one
 * other account has already confirmed changes nothing; otherwise it confirms.
 */
export function planKitchenTap(
  latest: Pick<KitchenReport, "id" | "state" | "reporterUserId" | "confirmedAt"> | null,
  state: KitchenState,
  userId: string,
): KitchenTapPlan {
  if (!latest || latest.state !== state) return { kind: "report" };
  if (latest.reporterUserId === userId) return { kind: "own" };
  // The confirmation time, not the confirmer: a confirmer who later deletes
  // their account leaves the stamp, and the report stays confirmed once.
  if (latest.confirmedAt !== null) return { kind: "already" };
  return { kind: "confirm", id: latest.id };
}

/**
 * "Kitchen open, said @handle 20 min ago", with ", confirmed by one other"
 * when a second account matched it. Null once the window has passed, so a
 * held answer goes quiet rather than printing an age that stopped being true.
 */
export function kitchenReadingLine(
  report: Pick<PublicKitchenReport, "state" | "handle" | "reportedAt" | "confirmed">,
  now: number,
): string | null {
  if (!report.handle || !isFreshKitchenReport(report.reportedAt, now)) return null;
  const age = occupancyAgeLabel(occupancyAgeMinutes(Date.parse(report.reportedAt), now));
  const base = `${KITCHEN_READ_LEAD[report.state]}, said @${report.handle} ${age}`;
  return report.confirmed ? `${base}, confirmed by one other` : base;
}

/** The read a surface holds, checked again here: a stale or malformed row is no reading. */
export function parseKitchenReading(payload: unknown, now: number): PublicKitchenReport | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as { report?: unknown }).report;
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const state = parseKitchenState(row.state);
  const id = typeof row.id === "string" ? row.id : "";
  const venueId = typeof row.venueId === "string" ? row.venueId : "";
  const handle = typeof row.handle === "string" ? row.handle : "";
  const reportedAt = typeof row.reportedAt === "string" ? row.reportedAt : "";
  if (!state || !id || !venueId || !handle || !isFreshKitchenReport(reportedAt, now)) return null;
  return { id, venueId, state, reportedAt, handle, confirmed: row.confirmed === true };
}
