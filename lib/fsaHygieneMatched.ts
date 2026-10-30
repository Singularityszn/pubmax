import { useSyncExternalStore } from "react";

// HYGIENE IS SAID ONCE, AND THE FSA SAYS IT. The venue sheet printed a pub's
// food hygiene twice: "Food hygiene x/5" in the CityMCP strip, and the FSA
// rating with its date and source in VenueHygiene lower down (launch UX
// micro-fix 2, 30 Oct 2026). The FSA badge is the one with provenance, so it
// wins. VenueHygiene marks a venue here once the FSA answered for it, and the
// CityMCP strip reads the mark and drops its own hygiene line.
//
// This is a page-lifetime memory of which venues the FSA matched, nothing
// more: no rating is held, nothing is persisted, and a venue the FSA did not
// match is never marked, so the strip keeps its line where it is the only one.

const matched = new Set<string>();
const listeners = new Set<() => void>();

/** VenueHygiene calls this when the FSA answered for `venueId`. */
export function markFsaHygieneMatched(venueId: string): void {
  if (!venueId || matched.has(venueId)) return;
  matched.add(venueId);
  for (const listener of listeners) listener();
}

/** True once the FSA badge has answered for `venueId` in this page. */
export function fsaHygieneMatched(venueId: string): boolean {
  return matched.has(venueId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The mark, as a hook: re-renders the reader when the FSA answers. */
export function useFsaHygieneMatched(venueId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => matched.has(venueId),
    () => false,
  );
}

/** Test seam: forget every mark. */
export function resetFsaHygieneMatchedForTests(): void {
  matched.clear();
  for (const listener of listeners) listener();
}
