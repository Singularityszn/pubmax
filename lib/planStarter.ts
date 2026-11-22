// THE PRICED STARTER: /plan answers before it asks (issue #3035).
//
// The prerendered page carries one generated route for a typical night
// (app/plan/planStarter.server.ts), so a price is in the first paint.
//
// TWO RULES.
// 1. A GENERATION, NEVER A FIXTURE. The route is POST /api/plans/generate's own
//    answer to the words below, sent as the entry form sends them.
// 2. EVERY FIGURE CARRIES ITS RECORD, OR THERE IS NO STARTER. One stop without
//    a listed pint price and its evidence, and the page shows none.
//
// Pure and browser-safe.

import { nightAreaFocusFromQuery, planAreaName } from "@/lib/nightAreaFocus";
import { tryGetNightArea } from "@/lib/nightAreas";
import {
  mergeSubmittedNightContext,
  nightAreaFromPlanQuery,
  syncPlanIntakeAreaFromQuery,
} from "@/lib/planComposerChipFill";
import {
  buildPlanGenerationIntakeBody,
  createPlanIntakeDraft,
  planIntakeNightContextPatch,
  skipRemainingPlanIntake,
  type PlanGenerationIntakeBody,
} from "@/lib/planIntake";
import { cleanPlanPintPrice, type RawPlanPintPriceFields } from "@/lib/planPintPrice";
import { routeSummaryLine, type RouteViewStop } from "@/lib/planRouteView";
import { isPlanStopCount } from "@/lib/planStopCount";

/** A shipped describe chip (lib/describeFirstChips.ts), so its priced route is already promised. */
export const PLAN_STARTER_ASK = "cheap pints tonight in Shoreditch";

export type PlanStarterView = {
  /** The words the route answers. Plan it on an empty field plans them. */
  ask: string;
  /** The page is an hour old at most, so the heading names no day. */
  heading: string;
  /** "3 stops · £12.19 each for pints". */
  summary: string;
  stops: readonly RouteViewStop[];
};

/** The body the entry form sends for these words from a fresh draft. */
export function planStarterRequestBody(ask: string): PlanGenerationIntakeBody {
  const queryArea = nightAreaFromPlanQuery(ask);
  const intake = skipRemainingPlanIntake(syncPlanIntakeAreaFromQuery(createPlanIntakeDraft(), ask));
  const slug = queryArea.kind === "none" || queryArea.kind === "unsupported-patch" ? null : queryArea.slug;
  const context = mergeSubmittedNightContext(
    slug ? { nightArea: slug, areaFocus: nightAreaFocusFromQuery(slug, ask) } : { areaFocus: null },
    planIntakeNightContextPatch(intake),
    queryArea,
  );
  return buildPlanGenerationIntakeBody(intake, ask, null, context);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * What the page prints from a generation: display fields only, so nothing
 * bound to one request (the grounding proof, its operation key) is baked into
 * a document every visitor shares.
 */
export function planStarterView(ask: string, body: unknown, now = Date.now()): PlanStarterView | null {
  const value = record(body);
  if (value?.grounded !== true || !Array.isArray(value.stops)) return null;
  const stops: RouteViewStop[] = [];
  for (const raw of value.stops) {
    const row = record(raw);
    const venueId = typeof row?.venueId === "string" ? row.venueId.trim() : "";
    const venueName = typeof row?.venueName === "string" ? row.venueName.trim() : "";
    if (!row || !venueId || !venueName || row.selectedDrinkPriceEvidence) return null;
    const price = cleanPlanPintPrice(venueId, row as RawPlanPintPriceFields, "generated", now);
    if (price.priceKind !== "listed" || !price.pintPriceEvidence) return null;
    stops.push({ venueId, venueName, ...price });
  }
  const context = record(value.inferredContext);
  const area = tryGetNightArea(typeof context?.nightArea === "string" ? context.nightArea : null);
  if (!area || !isPlanStopCount(stops.length)) return null;
  const focus = nightAreaFocusFromQuery(area.slug, ask);
  return { ask, heading: `Cheap pints in ${planAreaName(area.name, focus)}`, summary: routeSummaryLine(stops), stops };
}
