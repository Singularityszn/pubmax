// Map fix outcomes: the reporter hears back when a person accepts what they
// sent. A missing pub they named (lib/venueSubmissions.ts) was accepted, or a
// "That's wrong" note they left on a pub sheet (lib/venueCorrections.ts) was
// fixed.
//
// AN OUTCOME IS READ FROM THE REPORT'S OWN ROW. The moderator's verdict already
// stamps the row with its status and its day, so the reporter's Activity reads
// those stamps back. Nothing new is stored on the server. A declined or
// dismissed report sends nothing.
//
// SEEN IS KEPT ON THE DEVICE. The bell counts an outcome until the reporter
// opens Activity on that device. The in-app notifications table has a closed
// kind CHECK, so a server-side read mark would need a migration.
//
// Browser-safe leaf: the server builds the list and the bell and Activity read
// it, through one shape.

import type { Route } from "next";

import { safeLocalStorage } from "@/lib/safeStorage";

/** An outcome older than this has had its moment. */
const MAP_FIX_OUTCOME_WINDOW_DAYS = 30;
/** The most outcomes one inbox read carries. */
export const MAP_FIX_OUTCOME_MAX = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

type MapFixOutcomeKind = "pub_added" | "fact_fixed";

export type MapFixOutcome = {
  /** Unique across both kinds, because the two tables mint their ids apart. */
  id: string;
  kind: MapFixOutcomeKind;
  /** The pub's name, or "" when no pack names the venue any more. */
  pubName: string;
  /** The pub on the map for a fixed fact. Null for a pub still on its way to the map. */
  venueId: string | null;
  /** When a person accepted it. */
  decidedAt: string;
};

type SubmissionRow = { id: string; name: string; status: string; reviewedAt: string | null };
type CorrectionRow = { id: string; venueId: string; status: string; resolvedAt: string | null };

function withinWindow(iso: string | null, now: number): iso is string {
  if (!iso) return false;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return false;
  return at <= now && now - at <= MAP_FIX_OUTCOME_WINDOW_DAYS * DAY_MS;
}

/**
 * The reporter's accepted reports, newest first and capped. Only an accepted
 * pub and a fixed note count. `venueNames` maps a corrected venue id to its name.
 */
export function mapFixOutcomesFrom(
  submissions: readonly SubmissionRow[],
  corrections: readonly CorrectionRow[],
  venueNames: ReadonlyMap<string, string>,
  now: number = Date.now(),
): MapFixOutcome[] {
  const outcomes: MapFixOutcome[] = [];
  for (const row of submissions) {
    if (row.status !== "accepted" || !withinWindow(row.reviewedAt, now)) continue;
    outcomes.push({
      id: `pub:${row.id}`,
      kind: "pub_added",
      pubName: row.name,
      venueId: null,
      decidedAt: row.reviewedAt,
    });
  }
  for (const row of corrections) {
    if (row.status !== "resolved" || !withinWindow(row.resolvedAt, now)) continue;
    outcomes.push({
      id: `fix:${row.id}`,
      kind: "fact_fixed",
      pubName: venueNames.get(row.venueId) ?? "",
      venueId: row.venueId,
      decidedAt: row.resolvedAt,
    });
  }
  return outcomes
    .sort((left, right) => Date.parse(right.decidedAt) - Date.parse(left.decidedAt))
    .slice(0, MAP_FIX_OUTCOME_MAX);
}

/** What one Activity row says. */
export function mapFixOutcomeLine(outcome: MapFixOutcome): string {
  if (outcome.kind === "pub_added") {
    return `${outcome.pubName} goes on the map at the next update. Thanks for telling us.`;
  }
  const pub = outcome.pubName || "a pub";
  return `We checked your note on ${pub} and fixed it. Thanks for telling us.`;
}

/** Where a row leads: the fixed pub on the map. A pub still on its way has nowhere yet. */
export function mapFixOutcomeHref(outcome: MapFixOutcome): Route | null {
  return outcome.venueId ? (`/map?sel=${encodeURIComponent(outcome.venueId)}` as Route) : null;
}

/** Read a server answer's outcomes, dropping any row that is not the shape. */
export function readMapFixOutcomes(value: unknown): MapFixOutcome[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is MapFixOutcome => {
    if (!row || typeof row !== "object") return false;
    const candidate = row as Record<string, unknown>;
    return (
      typeof candidate.id === "string" &&
      (candidate.kind === "pub_added" || candidate.kind === "fact_fixed") &&
      typeof candidate.pubName === "string" &&
      (candidate.venueId === null || typeof candidate.venueId === "string") &&
      typeof candidate.decidedAt === "string"
    );
  });
}

// ── Seen, per device ─────────────────────────────────────────────────────────

const SEEN_KEY_PREFIX = "pubmax_map_fixes_seen:";

/** When this account last opened Activity on this device, or null. */
export function readMapFixSeenAt(userId: string): number | null {
  try {
    const raw = safeLocalStorage()?.getItem(`${SEEN_KEY_PREFIX}${userId}`);
    const at = raw ? Number(raw) : NaN;
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/** Mark every outcome the reporter has now read. */
export function markMapFixesSeen(userId: string, outcomes: readonly MapFixOutcome[]): void {
  const newest = outcomes.reduce((latest, outcome) => Math.max(latest, Date.parse(outcome.decidedAt) || 0), 0);
  if (newest <= 0) return;
  const seen = readMapFixSeenAt(userId) ?? 0;
  if (newest <= seen) return;
  try {
    safeLocalStorage()?.setItem(`${SEEN_KEY_PREFIX}${userId}`, String(newest));
  } catch {
    // A blocked store costs the read mark, never the page.
  }
}

/** How many outcomes landed after the reporter last looked. */
export function unseenMapFixCount(outcomes: readonly MapFixOutcome[], seenAt: number | null): number {
  return outcomes.filter((outcome) => Date.parse(outcome.decidedAt) > (seenAt ?? 0)).length;
}
