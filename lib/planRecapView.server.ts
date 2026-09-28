import "server-only";

// Server assembly for a completed Plan's recap (DAG L10, §4.10). One place that
// turns a completion record into the full RecapView — route venue names, the
// final logged pint, ending/guardian — so both the recap page's member client
// upgrade and the capability-gated GET draw the exact same detail. A viewer
// WITHOUT a valid member capability never reaches this: the route only returns
// it behind resolvePlanProjection, and the page renders a preview shell.

import { formatGbp } from "@/lib/formatGbp";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { planCompletionResult, planStore } from "@/lib/planStore";
import type { LastPintDecisionKind } from "@/lib/tfl";
import {
  buildRecapShareText,
  composeRecapFromCompletion,
  type RecapPint,
  type RecapView,
} from "@/lib/recapView";

type RecapLastTrain = {
  dropCreatedAt?: string | null;
  leaveByIso?: string | null;
  decision?: LastPintDecisionKind | null;
};

/**
 * The ONE night-scoped pint we can honestly show on a private recap: the final
 * logged drop the completion points at. Never dredges up other nights' drops.
 */
async function resolveFinalPint(
  finalPintDropId: string | null,
  terminalVenueId: string | null,
  fallbackVenueId: string | null,
  venueNames: Map<string, string>,
): Promise<{ pints: RecapPint[]; lastTrain: RecapLastTrain | null }> {
  if (!finalPintDropId) return { pints: [], lastTrain: null };
  const venueId = terminalVenueId ?? fallbackVenueId;
  if (!venueId) return { pints: [], lastTrain: null };
  try {
    const drops = await pintDropsStore().listVisible(venueId);
    const drop = drops.find((item) => item.id === finalPintDropId);
    if (!drop) return { pints: [], lastTrain: null };
    const price = typeof drop.priceGbp === "number" ? drop.priceGbp : null;
    const note = typeof drop.passedDownNote === "string" && drop.passedDownNote.trim() ? drop.passedDownNote.trim() : null;
    const pint: RecapPint = {
      venueId: drop.venueId,
      venueName: venueNames.get(drop.venueId) ?? null,
      drink: typeof drop.drink === "string" && drop.drink.trim() ? drop.drink.trim() : null,
      priceGbp: price,
      priceLabel: price === null ? null : formatGbp(price),
      note,
    };
    return {
      pints: [pint],
      lastTrain: { dropCreatedAt: drop.createdAt, leaveByIso: drop.leaveByIso ?? null, decision: drop.lastTrainDecision ?? null },
    };
  } catch {
    // A pint-store outage never blocks the memory — the section simply omits.
    return { pints: [], lastTrain: null };
  }
}

type RecapAssembly =
  | { completed: false; stopCount: number }
  | { completed: true; stopCount: number; view: RecapView; shareText: string };

/**
 * Three-way, for the same reason `planStore.read` is: a read we could not RUN
 * is a fact about us, never a fact about the plan. `get` collapsed an absent
 * plan and an unreachable store into one null and the route answered
 * PLAN_NOT_FOUND to both, so one PostgREST blip told a crew their night had
 * gone. `absent` keeps the 404; `unavailable` is a retryable 503.
 */
export type RecapAssemblyResult =
  | { status: "ready"; assembly: RecapAssembly }
  | { status: "absent" }
  | { status: "unavailable" };

/**
 * Assemble the full member recap. `completed: false` carries only the safe stop
 * count for the "not finished yet" shell; `completed: true` carries the full
 * RecapView (venue names, pints) — return it ONLY to a confirmed member.
 */
export async function assembleMemberRecap(id: string): Promise<RecapAssemblyResult> {
  const read = await planStore().read(id);
  if (read.status !== "found") return { status: read.status };
  const state = read.state;

  const completionLookup = await planCompletionResult(id);
  const completion = completionLookup.ok ? completionLookup.completion : null;
  if (!completion) {
    return { status: "ready", assembly: { completed: false, stopCount: state.stops.length } };
  }

  const canonicalStops = completion.routeSnapshot.slice().sort((left, right) => left.position - right.position);
  const venueNames = new Map(canonicalStops.map((stop) => [stop.venueId, stop.venueName] as const));
  const fallbackVenueId = canonicalStops.at(-1)?.venueId ?? null;
  const { pints, lastTrain } = await resolveFinalPint(
    completion.finalPintDropId,
    completion.terminalVenueId,
    fallbackVenueId,
    venueNames,
  );

  const view = composeRecapFromCompletion({
    title: state.plan.title,
    completedAt: completion.completedAt,
    ending: completion.ending,
    endingSelection: completion.endingSelection ?? null,
    stops: canonicalStops,
    pints,
    lastTrain,
  });

  const shareText = buildRecapShareText({
    title: view.title,
    stopCount: view.stats.stopCount,
    totalGbp: view.stats.totalGbp,
  });

  return {
    status: "ready",
    assembly: { completed: true, stopCount: canonicalStops.length, view, shareText },
  };
}
