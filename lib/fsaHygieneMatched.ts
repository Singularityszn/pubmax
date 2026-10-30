import { useSyncExternalStore } from "react";

// HYGIENE IS SAID ONCE, AND THE FSA SAYS IT. The venue sheet printed a pub's
// food hygiene twice: "Food hygiene x/5" in the CityMCP strip, and the FSA
// rating with its date and source in VenueHygiene lower down (launch UX
// micro-fix 2, 30 Oct 2026). The FSA badge is the one with provenance, so it
// wins. VenueHygiene holds a mark for a venue WHILE its FSA badge is on the
// page, and the CityMCP strip reads the mark and drops its own hygiene line.
//
// The mark is the badge that is rendered now, never a memory of an earlier
// answer: a badge that unmounts, or a later read that fails or finds no match,
// lets the mark go, so the strip keeps its line where it is the only one
// (review finding 3, PR 2402). No rating is held and nothing is persisted.

const shown = new Map<string, number>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * VenueHygiene calls this while its FSA badge for `venueId` is rendered, and
 * calls the returned release when the badge goes. Safe to release twice.
 */
export function holdFsaHygieneBadge(venueId: string): () => void {
  if (!venueId) return () => {};
  shown.set(venueId, (shown.get(venueId) ?? 0) + 1);
  if (shown.get(venueId) === 1) notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (shown.get(venueId) ?? 1) - 1;
    if (left > 0) {
      shown.set(venueId, left);
      return;
    }
    shown.delete(venueId);
    notify();
  };
}

/** True while an FSA badge for `venueId` is rendered. */
export function fsaHygieneMatched(venueId: string): boolean {
  return shown.has(venueId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The mark, as a hook: re-renders the reader when the FSA badge comes or goes. */
export function useFsaHygieneMatched(venueId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => shown.has(venueId),
    () => false,
  );
}

/** Test seam: forget every mark. */
export function resetFsaHygieneMatchedForTests(): void {
  shown.clear();
  notify();
}
