// Launch plan P0 item 7: the night's arrived count.
//
// docs/analytics/METRICS.md section 3.3 owns the counting rules and limits.
// Every member's write can carry receipts because analytics needs browser consent.
// Another member's device can recover a failed delivery.

import "server-only";

import { crewArrivedBandsReached, type CrewArrivedBand } from "@/lib/crew";
import { londonDayKey } from "@/lib/pintContributions";
import type { PlanState } from "@/lib/plan";
import { crewArrivedEventToken } from "@/lib/verifiedAnalytics.server";

/** One band's receipt plus the exact prop it signs, sent back unchanged. */
export type PlanCrewArrivedReceipt = {
  deliveryToken: string;
  guestsArrived: CrewArrivedBand;
};

/**
 * The receipts for the current arrival bands, smallest first. Empty when
 * no guest is "Here" or a valid receipt cannot be minted. An analytics
 * receipt must never fail a status write, including outside its delivery window.
 */
export function planCrewArrivedReceipts(plan: PlanState | null, now = new Date()): PlanCrewArrivedReceipt[] {
  if (!plan) return [];
  const bands = crewArrivedBandsReached(plan.crew);
  if (bands.length === 0) return [];
  const nightKey = londonDayKey(plan.plan.startTime);
  try {
    return bands.map((band) => ({
      deliveryToken: crewArrivedEventToken({
        planId: plan.plan.id,
        nightKey,
        band,
      }, now.getTime()),
      guestsArrived: band,
    }));
  } catch {
    return [];
  }
}
