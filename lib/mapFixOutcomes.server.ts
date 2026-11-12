import "server-only";

// The reporter's accepted map fixes, read from their own report rows. Both
// stores are fail-soft, and anything else that goes wrong here answers an empty
// list: an outcome is good news, never a reason to fail the inbox.

import { log } from "@/lib/log";
import { mapFixOutcomesFrom, type MapFixOutcomeRead } from "@/lib/mapFixOutcomes";
import { venueNameReader } from "@/lib/regularNightReports.server";
import { venueCorrectionsStore } from "@/lib/venueCorrectionsStore";
import { venueSubmissionStore } from "@/lib/venueSubmissionStore";

export async function listMapFixOutcomes(accountId: string, now: number = Date.now()): Promise<MapFixOutcomeRead> {
  try {
    const [submissions, corrections] = await Promise.all([
      venueSubmissionStore().listAcceptedForOwner(accountId),
      venueCorrectionsStore().listResolvedForOwner(accountId),
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
    return {
      outcomes: unnamed.map((outcome) =>
        outcome.venueId ? { ...outcome, pubName: names.get(outcome.venueId) ?? "" } : outcome,
      ),
      complete: submissions.status === "ready" && corrections.status === "ready",
    };
  } catch (err) {
    log("warn", "map_fix_outcomes.read_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { outcomes: [], complete: false };
  }
}
