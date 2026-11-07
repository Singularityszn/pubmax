// Launch plan P0 item 7: the night's arrived count.
//
// A successful status write on /plan/[id] hands back one verified
// crew_arrived receipt for every arrival band the plan's guests have reached
// on the plan's night. Every member's write gets them, the host's included,
// because the receipt is only counted from a browser that consented to
// analytics, and the more devices that carry it, the less a night depends on
// one guest's consent choice. The subject is the band, so the ingest route
// counts each band once a night however many devices send it.

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
 * The receipts for every band the night has reached, smallest first. Empty
 * when no guest is "Here" yet, or when the signing key is unavailable: an
 * analytics receipt must never fail the status write it rides on.
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
