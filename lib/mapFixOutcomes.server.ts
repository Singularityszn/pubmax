import "server-only";

// The reporter's accepted map fixes, read from their own report rows. Both
// stores are fail-soft, and anything else that goes wrong here answers an empty
// list: an outcome is good news, never a reason to fail the inbox.

import { log } from "@/lib/log";
import { mapFixOutcomesFrom, type MapFixOutcome } from "@/lib/mapFixOutcomes";
import { venueNameReader } from "@/lib/regularNightReports.server";
import { venueCorrectionsStore } from "@/lib/venueCorrectionsStore";
import { venueSubmissionStore } from "@/lib/venueSubmissionStore";

/** A reporter leaves a few notes a month; the newest of these hold every outcome in the window. */
const OWNER_CORRECTION_ROWS = 50;

export async function listMapFixOutcomes(accountId: string, now: number = Date.now()): Promise<MapFixOutcome[]> {
  try {
    const [submissions, corrections] = await Promise.all([
      venueSubmissionStore().listForOwner(accountId),
      venueCorrectionsStore().listForOwner(accountId, OWNER_CORRECTION_ROWS),
    ]);
    const unnamed = mapFixOutcomesFrom(submissions.submissions, corrections.corrections, new Map(), now);
    const readName = venueNameReader();
    const names = new Map<string, string>();
    await Promise.all(
      unnamed.map(async (outcome) => {
        if (!outcome.venueId) return;
        const name = await readName(outcome.venueId);
        if (name) names.set(outcome.venueId, name);
      }),
    );
    return unnamed.map((outcome) =>
      outcome.venueId ? { ...outcome, pubName: names.get(outcome.venueId) ?? "" } : outcome,
    );
  } catch (err) {
    log("warn", "map_fix_outcomes.read_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
