import "server-only";

import { dutyCensusShownCount, dutyCensusView, type DutyCensusView } from "@/lib/dutyCensus";
import { log } from "@/lib/log";
import { dutyCensusStore } from "@/lib/dutyCensusStore.server";

/**
 * The census figure a surface may print, or null. A store that cannot be read
 * prints no figure, so a failed read is never told as a small one.
 */
export async function loadDutyCensusCount(): Promise<number | null> {
  try {
    return dutyCensusShownCount(await dutyCensusStore().count());
  } catch (err) {
    log("warn", "duty_census.count_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** The census card for a document read now and held for `holdMs`, or null once it has closed. */
export async function loadDutyCensusView(holdMs: number): Promise<DutyCensusView | null> {
  const count = await loadDutyCensusCount();
  return dutyCensusView(Date.now(), count, holdMs);
}
