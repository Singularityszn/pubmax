// §4.10: a seat that takes a Plan's roster to the crew-night threshold returns
// a verified crew_committed delivery token, so the client can report the
// north-star Friend proof.
//
// The token rides ONE seat per plan per night: the one that took the roster to
// the crew-night threshold. Every join used to get its own token, so a plan
// that reached four people reported three crew nights, and the biggest crews
// were overcounted the most (issue #1253). A later seat gets no token, so the
// client sends no beacon at all. The plan id and its night stay inside the
// signed subject and never ride on the event, which keeps §7 id hygiene.
//
// Two doors mint a seat through the host's invite link: the join on
// /plan/[id] and a Going RSVP on /invite/[token]. Both spend this one helper,
// and the signed subject is the night, so the ingest route refuses a second
// receipt for the same night whichever door it came through.

import "server-only";

import { joinCommitsCrewNight } from "@/lib/crew";
import { londonDayKey } from "@/lib/pintContributions";
import type { PlanState } from "@/lib/plan";
import { planRouteReady } from "@/lib/planPrivacy";
import { crewCommittedEventToken } from "@/lib/verifiedAnalytics.server";

/**
 * The receipt plus the exact props it signs. The ingest route refuses a beacon
 * whose props differ from the signed ones, so a client that holds no PlanState
 * (the invite page) sends these back unchanged.
 */
export type PlanCrewCommittedReceipt = {
  deliveryToken: string;
  participants: number;
  routeReady: boolean;
};

/** Absent when there is no plan, or when this seat did not cross the threshold. */
export function planCrewCommittedReceipt(plan: PlanState | null): PlanCrewCommittedReceipt | undefined {
  if (!plan || !joinCommitsCrewNight(plan.crew.length)) return undefined;
  const participants = plan.crew.length;
  const routeReady = planRouteReady(plan);
  return {
    deliveryToken: crewCommittedEventToken({
      planId: plan.plan.id,
      nightKey: londonDayKey(plan.plan.startTime) || "unscheduled",
      committedAt: new Date().toISOString(),
      participants,
      routeReady,
    }),
    participants,
    routeReady,
  };
}

/** The join route's shape: the token alone, the client holds the PlanState. */
export function planCrewCommittedToken(plan: PlanState | null): string | undefined {
  return planCrewCommittedReceipt(plan)?.deliveryToken;
}
