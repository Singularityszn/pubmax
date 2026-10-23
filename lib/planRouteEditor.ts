/**
 * The Plan route editor's draft policy, kept pure so the rule can be pinned
 * without a browser.
 *
 * THE RULE (core-loop battle test D02, 5 Sep 2026): the editor opens on the
 * STORED route, in its stored order, and a private draft may stand in for it
 * only while the draft was built over the revision the store still holds.
 * Before this module, "Edit route" regenerated a fresh route from the Plan's
 * context and showed THAT as the draft. The generator is deterministic, so it
 * reproduced the pre-edit route, and the next save wrote it back over the
 * stops a host had already saved: Lotus Bar was gone and nothing said so.
 *
 * A stale draft is one whose `expectedRouteRevision` is not the stored
 * `routeRevision`. It cannot be saved (the server answers 409 on it) and it
 * may not be shown, because a route on screen that cannot be saved reads as
 * the route that will be.
 */

import type { SelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";

export type RouteRevision = string | number;

export type RouteAlternative = { venueId: string; venueName: string; selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence };

export type EditableStop = {
  venueId: string;
  venueName: string;
  position: number;
  selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence;
  alternatives?: RouteAlternative[];
};

export type PendingRoute = {
  stops: EditableStop[];
  expectedRouteRevision: RouteRevision | null;
  groundingProof: string | null;
  operationKey: string | null;
};

/** Two revisions name one stored route when they print the same. The store
 * answers a number; a draft that went through JSON keeps a number; a
 * hand-typed or legacy value may be a string. */
export function routeRevisionsMatch(a: RouteRevision | null, b: RouteRevision | null): boolean {
  if (a === null || b === null) return false;
  return String(a) === String(b);
}

/**
 * The draft the editor may open on, or null when the stored draft is older
 * than the stored route (or was never dated), in which case the caller
 * clears it. A draft with no revision cannot prove it is current, so it is
 * stale by construction.
 */
export function livePendingRoute<T extends { expectedRouteRevision: RouteRevision | null }>(
  pending: T | null,
  storedRevision: RouteRevision | null,
): T | null {
  if (!pending) return null;
  return routeRevisionsMatch(pending.expectedRouteRevision, storedRevision) ? pending : null;
}

/** Stops in their stored order, positions renumbered to match. */
export function orderedRouteStops<T extends { position: number }>(stops: ReadonlyArray<T>): T[] {
  return stops
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((stop, index) => ({ ...stop, position: index }));
}

type GeneratedStop = { venueId: string; venueName: string; selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence; alternatives?: ReadonlyArray<RouteAlternative> };

/**
 * Seed the editor: the STORED stops, in stored order, each carrying the
 * backups a fresh generation offered. The generated route itself is never the
 * draft. Its stops and their alternatives are a pool of swap candidates: a
 * stop takes the candidates generated for its own position first, then the
 * rest of the pool, never a venue already in the stored route, never the same
 * venue twice.
 */
export function seedRouteDraft(
  canonical: ReadonlyArray<EditableStop>,
  generated: ReadonlyArray<GeneratedStop>,
): EditableStop[] {
  const stored = orderedRouteStops(canonical);
  const inRoute = new Set(stored.map((stop) => stop.venueId));
  const candidatesAt = (index: number): RouteAlternative[] => {
    const row = generated[index];
    if (!row) return [];
    return [{ venueId: row.venueId, venueName: row.venueName, ...(row.selectedDrinkPriceEvidence
      ? { selectedDrinkPriceEvidence: row.selectedDrinkPriceEvidence } : {}) }, ...(row.alternatives ?? [])];
  };
  const pool = generated.flatMap((_, index) => candidatesAt(index));
  return stored.map((stop, index) => {
    const seen = new Set<string>();
    const alternatives: RouteAlternative[] = [];
    for (const candidate of [...candidatesAt(index), ...pool]) {
      if (!candidate.venueId || !candidate.venueName) continue;
      if (inRoute.has(candidate.venueId) || seen.has(candidate.venueId)) continue;
      seen.add(candidate.venueId);
      alternatives.push({ ...candidate });
    }
    return { ...stop, alternatives };
  });
}

/**
 * One line at a time. A save ends in exactly one sentence: the status line
 * when it landed, the error line when it did not. Before this, a 409 that
 * arrived beside a 200 left "Route saved" and "Nothing was saved" on screen
 * together (M03).
 */
export type RouteEditorNotice = { tone: "status" | "error"; text: string } | null;

export const ROUTE_SAVED_LINE = "Route saved. The new order is the plan's route now.";
export const ROUTE_CONFLICT_RESEEDED_LINE = "This route changed in another tab. Nothing was saved. The latest route is shown below.";
export const ROUTE_CONFLICT_UNREAD_LINE = "This route changed in another tab. Nothing was saved. Refresh the plan before trying again.";

/** What a save answered, read off the response status alone. */
export type RouteSaveOutcome = "saved" | "conflict" | "refused";

export function routeSaveOutcome(status: number, ok: boolean): RouteSaveOutcome {
  if (ok) return "saved";
  return status === 409 || status === 412 ? "conflict" : "refused";
}
