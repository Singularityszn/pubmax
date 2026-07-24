// Selection-history sentinel model (trusted-handoff §4.6).
//
// The Map owns a single history sentinel so Back has an exact contract:
//   Back over an open Venue closes the sheet and reveals a clean Map; a second
//   Back leaves the Map. This module is the PURE core — the sentinel shape, the
//   URL builders that preserve owned non-selection params, and the transition
//   decider. The client hook (components/map/pubmap/useMapSelectionHistory.ts)
//   applies these against window.history; keeping the decisions here makes the
//   whole contract unit-testable with no DOM.
//
// Server-safe: no window/DOM/React.

/** The sentinel stamped onto a selected history entry via history.pushState. */
export const PUBMAX_SELECTION_SENTINEL = 1 as const;

export type PubmaxSelectionHistory = {
  pubmaxSelection: typeof PUBMAX_SELECTION_SENTINEL;
  venueId: string;
};

// sel is the inspected Venue; accept=1 / src=<source> are the accepted-handoff
// markers. All three belong to a specific selection/acceptance arrival and are
// stripped when we build a clean Map entry. Everything else (pubs, mode, plan,
// log, style, band, …) is owned passthrough and is preserved on every rewrite.
const SELECTION_PARAMS = ["sel", "accept", "src"] as const;
const ACCEPTANCE_PARAMS = ["accept", "src"] as const;

/** Type guard: does an unknown history.state carry our selection sentinel? */
export function isSelectionSentinel(state: unknown): state is PubmaxSelectionHistory {
  if (typeof state !== "object" || state === null) return false;
  const record = state as { pubmaxSelection?: unknown; venueId?: unknown };
  return (
    record.pubmaxSelection === PUBMAX_SELECTION_SENTINEL &&
    typeof record.venueId === "string"
  );
}

/** The sentinel's venueId when present, else null. */
export function selectionSentinelVenueId(state: unknown): string | null {
  return isSelectionSentinel(state) ? state.venueId : null;
}

/** Build the sentinel state object for a given Venue. */
export function selectionSentinel(venueId: string): PubmaxSelectionHistory {
  return { pubmaxSelection: PUBMAX_SELECTION_SENTINEL, venueId };
}

/**
 * Merge the sentinel INTO the existing history.state so the framework router's
 * own state on this entry survives (Next.js App Router keeps its routing tree
 * there). isSelectionSentinel only inspects our two keys, so extra keys are
 * ignored on read.
 */
export function withSelectionSentinel(
  base: unknown,
  venueId: string,
): PubmaxSelectionHistory & Record<string, unknown> {
  const carry = base && typeof base === "object" ? (base as Record<string, unknown>) : {};
  return { ...carry, pubmaxSelection: PUBMAX_SELECTION_SENTINEL, venueId };
}

function normalizeSearch(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

function toUrl(pathname: string, params: URLSearchParams, hash: string): string {
  const query = params.toString();
  return query ? `${pathname}?${query}${hash}` : `${pathname}${hash}`;
}

/** Does the arrival search already name an inspected Venue (`?sel=`)? */
export function searchHasSelection(search: string): boolean {
  return normalizeSearch(search).get("sel") !== null;
}

/**
 * The clean-Map URL: selection + acceptance params removed, every owned
 * passthrough param preserved. This is the entry Back reveals.
 */
export function cleanMapUrl(pathname: string, search: string, hash = ""): string {
  const params = normalizeSearch(search);
  for (const key of SELECTION_PARAMS) params.delete(key);
  return toUrl(pathname, params, hash);
}

/**
 * A browse-selection URL for `venueId`: owned params kept, acceptance markers
 * dropped (a pin/switch selection is browse-only, §4.8), and `sel` set. Used
 * for the in-Map push (clean → selected) and replace (selected → other).
 */
export function browseSelectionUrl(
  pathname: string,
  search: string,
  venueId: string,
  hash = "",
): string {
  const params = normalizeSearch(search);
  for (const key of ACCEPTANCE_PARAMS) params.delete(key);
  params.set("sel", venueId);
  return toUrl(pathname, params, hash);
}

export type SelectionHistoryAction =
  | { kind: "none" }
  /** clean Map → first Venue selection: push one selected entry. */
  | { kind: "push"; venueId: string }
  /** switching Venue while a sentinel is active: replace the selected entry. */
  | { kind: "replace"; venueId: string }
  /** close and the current entry owns the sentinel: pop it with history.back(). */
  | { kind: "back" }
  /** close with no sentinel: replace the URL, stripping sel/accept/src. */
  | { kind: "strip" };

/**
 * Decide the history action for a selectedVenueId transition.
 *
 * - prev/next are the previous and next selectedVenueId ("" = no selection).
 * - currentEntryOwnsSentinel is whether history.state is our sentinel right now.
 *
 * Closing (next === "") pops the sentinel entry with Back when we own it, so a
 * single Back returns to the clean Map; otherwise we strip the params in place
 * so a stray `?sel=` never survives a local close.
 */
export function selectionTransition(input: {
  prev: string;
  next: string;
  currentEntryOwnsSentinel: boolean;
}): SelectionHistoryAction {
  const prev = input.prev || "";
  const next = input.next || "";
  if (next === prev) return { kind: "none" };
  if (next) {
    return prev ? { kind: "replace", venueId: next } : { kind: "push", venueId: next };
  }
  return input.currentEntryOwnsSentinel ? { kind: "back" } : { kind: "strip" };
}
