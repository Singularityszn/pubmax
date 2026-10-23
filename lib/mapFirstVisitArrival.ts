// First-visit map arrival policy. See the quiet window and storage
// compatibility rules below.
// Pure policy: eligibility, planner-param suppression, dismiss storage, and
// the consent gate the analytics prompt must wait behind.

import {
  PLAN_DESCRIBE_PARAM,
  PLAN_OCCASION_PARAM,
  PLAN_QUERY_PARAM,
} from "@/lib/planOccasion";
import { searchHasExplicitMapIntent } from "@/lib/explicitMapIntent";
import { notifyMapFirstVisitArrivalChange } from "@/lib/mapFirstVisitArrivalGate";
import { safeLocalStorage } from "@/lib/safeStorage";

// The consent gate lives in its own import-free leaf so the root shell can read
// it without this module's graph. Re-exported so map callers keep one door.
export {
  mapFirstVisitArrivalBlocksConsent,
  setMapFirstVisitArrivalCardVisible,
  subscribeMapFirstVisitArrival,
} from "@/lib/mapFirstVisitArrivalGate";

export const MAP_FIRST_VISIT_ARRIVAL_KEY = "pubmax:map-first-visit-arrival:v1";
/**
 * How long an answer to the ask holds. Any answer counts: a tap on either
 * button, the close, or the reader's own first move on the map. After this the
 * ask may be made once more, because a location question a reader waved away in
 * their first minute is worth putting to them again when they come back.
 */
const MAP_FIRST_VISIT_ARRIVAL_QUIET_MS = 30 * 24 * 60 * 60 * 1000;
const DISMISSED_PREFIX = "dismissed:";

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  return safeLocalStorage();
}

/** Planner handoff params must not meet a first-visit card over the map. */
export function searchHasPlanHandoffParams(search: string): boolean {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  return (
    params.has(PLAN_QUERY_PARAM) ||
    params.has(PLAN_OCCASION_PARAM) ||
    params.has(PLAN_DESCRIBE_PARAM)
  );
}

export function searchSuppressesMapFirstVisitArrival(search: string): boolean {
  return (
    searchHasExplicitMapIntent(search) || searchHasPlanHandoffParams(search)
  );
}

/**
 * Whether the ask has been answered inside its quiet window.
 *
 * The stored value is `dismissed:<epoch ms>`. A bare `dismissed` is the value
 * every earlier build wrote: it carries no date, so it never expires, rather
 * than putting the ask back in front of every existing reader on one deploy.
 * An unreadable date is treated as answered, never as a reason to ask again.
 */
export function hasDismissedMapFirstVisitArrival(
  storage?: Storage | null,
  now: number = Date.now(),
): boolean {
  const store = resolveStorage(storage);
  if (!store) return true;
  try {
    const raw = store.getItem(MAP_FIRST_VISIT_ARRIVAL_KEY);
    if (raw === null) return false;
    if (!raw.startsWith(DISMISSED_PREFIX)) return raw === "dismissed";
    const answeredAt = Number(raw.slice(DISMISSED_PREFIX.length));
    if (!Number.isFinite(answeredAt)) return true;
    return now - answeredAt < MAP_FIRST_VISIT_ARRIVAL_QUIET_MS;
  } catch {
    return true;
  }
}

/**
 * The reader put a finger on the map, moved it, or opened a pub on it. Each is
 * an answer.
 *
 * The card used to hold the map `inert` until somebody pressed one of its three
 * buttons, so the painted-pin probe found nothing tappable anywhere on the
 * canvas (docs/proof/astra-live-walk/report.md B1). The map is live under the
 * strip now, and a reader who goes straight to the pins has said what they came
 * for more plainly than the close button would.
 *
 * IT TAKES NO ARGUMENTS, and that is load-bearing: it is handed straight to a
 * React event prop, so a `storage` parameter would receive the pointer event,
 * `setItem` would throw on it, and the catch would swallow the whole dismissal
 * in silence. Measured exactly that way once.
 */
export function dismissMapFirstVisitArrivalOnMapUse(): void {
  dismissMapFirstVisitArrival();
}

export function dismissMapFirstVisitArrival(
  storage?: Storage | null,
  now: number = Date.now(),
): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(MAP_FIRST_VISIT_ARRIVAL_KEY, `${DISMISSED_PREFIX}${now}`);
    notifyMapFirstVisitArrivalChange();
  } catch {
    // Storage full / private mode — degrade silently.
  }
}

export function shouldShowMapFirstVisitArrival(params: {
  pinsRevealed: boolean;
  search: string;
  /**
   * A recovery toast (basemap, pub list, pin paint) is on the surface. The map
   * keeps search plus ONE toast, and this card is 256px of opaque panel over
   * the toast's own band, so a failure the reader can act on wins outright.
   * The card is not dismissed by this, only withheld: it returns when the
   * toast clears and the visit is still a first one.
   */
  recoveryToastActive?: boolean;
  storage?: Storage | null;
}): boolean {
  if (!params.pinsRevealed) return false;
  if (params.recoveryToastActive) return false;
  if (hasDismissedMapFirstVisitArrival(params.storage)) return false;
  if (searchSuppressesMapFirstVisitArrival(params.search)) return false;
  return true;
}
