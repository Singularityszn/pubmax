import "server-only";

// The reporter's accepted map fixes, read from their own report rows. Both
// stores are fail-soft, and anything else that goes wrong here answers an empty
// list: an outcome is good news, never a reason to fail the inbox.

import { log } from "@/lib/log";
import { MAP_FIX_OUTCOME_PAGE_SIZE, mapFixOutcomesFrom, type MapFixOutcomeRead } from "@/lib/mapFixOutcomes";
import { venueNameReader } from "@/lib/regularNightReports.server";
import { venueCorrectionsStore } from "@/lib/venueCorrectionsStore";
import { venueSubmissionStore } from "@/lib/venueSubmissionStore";

export async function listMapFixOutcomes(accountId: string, now: number = Date.now()): Promise<MapFixOutcomeRead> {
  try {
    const [submissions, corrections] = await Promise.all([
      readPages(async (offset) => {
        const page = await venueSubmissionStore().listAcceptedForOwner(accountId, offset);
        return { status: page.status, rows: page.submissions };
      }),
      readPages(async (offset) => {
        const page = await venueCorrectionsStore().listResolvedForOwner(accountId, offset);
        return { status: page.status, rows: page.corrections };
      }),
    ]);
    const unnamed = mapFixOutcomesFrom(submissions.rows, corrections.rows, new Map(), now);
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
      complete: submissions.complete && corrections.complete,
    };
  } catch (err) {
    log("warn", "map_fix_outcomes.read_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { outcomes: [], complete: false };
  }
}

async function readPages<T>(read: (offset: number) => Promise<{ status: "ready" | "degraded"; rows: T[] }>): Promise<{ rows: T[]; complete: boolean }> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += MAP_FIX_OUTCOME_PAGE_SIZE) {
    const page = await read(offset);
    rows.push(...page.rows);
    if (page.status !== "ready") return { rows, complete: false };
    if (page.rows.length < MAP_FIX_OUTCOME_PAGE_SIZE) return { rows, complete: true };
  }
}
