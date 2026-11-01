import { useEffect, useRef } from "react";
import { readMapSurfaceHistory } from "@/lib/mapSurfaceHistory";
import { currentSurface } from "@/lib/surfaceStack";

import { selectionSentinelVenueId } from "@/lib/mapSelectionHistory";
import type { WalkRequest } from "@/components/map/pubmap/useMapPlanCoordinator";

type SelParamSyncArgs = {
  selParam: string;
  selectedVenueId: string;
  selectVenue: (id: string) => void;
  /** The walking-route link the mounted map last adopted. */
  walkRequest?: WalkRequest;
  /** Lets the held selection go without a history traversal. */
  clearSelection?: () => void;
};

// ?sel= is only read into the seed at mount, so a CLIENT navigation to
// /map?sel=<id> while the map is already mounted (e.g. "See on map" from a
// card) used to be ignored. Sync it: when the param changes
// to a venue that isn't the current selection, select it. The URL is the
// source of truth only in that direction. Local opens and closes belong to
// useMapSurfaceNavigation; this hook must not reopen an owned history restore.
//
// The ref-compare (NOT a dep) means only
// URL changes fire this — local selection changes never re-run it, and an
// already-matching selection is a no-op.
export function useSelParamSync({
  selParam,
  selectedVenueId,
  selectVenue,
  walkRequest,
  clearSelection,
}: SelParamSyncArgs) {
  const selectedVenueIdRef = useRef(selectedVenueId);
  const selectVenueRef = useRef(selectVenue);
  const clearSelectionRef = useRef(clearSelection);
  useEffect(() => {
    selectedVenueIdRef.current = selectedVenueId;
    selectVenueRef.current = selectVenue;
    clearSelectionRef.current = clearSelection;
  }, [clearSelection, selectedVenueId, selectVenue]);
  useEffect(() => {
    if (!selParam) return;
    // Microtask defer keeps the state updates out of the effect's synchronous
    // body (house lint rule against cascading renders). The ref comparison
    // (not a dep) means only URL changes fire this — local selection changes
    // never re-run it, and an already-matching selection is a no-op.
    queueMicrotask(() => {
      // Back/Forward already restores owned entries through map navigation.
      // Its React selection may not have committed yet; selecting again adds
      // a duplicate history entry that reopens the drawer on Close.
      if (selectionSentinelVenueId(window.history.state) === selParam) return;
      const landed = readMapSurfaceHistory<{ venueId?: string }>(window.history.state);
      const current = landed && currentSurface(landed);
      // Back and Forward restore through the history owner, without opening
      // another entry while React is still committing that restoration.
      if (current?.id === "venue" && current.state?.venueId === selParam) return;
      if (selParam !== selectedVenueIdRef.current) selectVenueRef.current(selParam);
    });
  }, [selParam]);
  // A walking-route link that names no pub can land on a map still holding the
  // one the reader opened before they left. That pub is not the link's, and a
  // held selection keeps the camera off the walk. A link with `sel=` belongs
  // to the effect above, which selects the pub it names.
  const walkRequestRef = useRef(walkRequest);
  useEffect(() => {
    if (walkRequestRef.current === walkRequest) return;
    walkRequestRef.current = walkRequest;
    if (!walkRequest) return;
    queueMicrotask(() => {
      if (walkRequest.selectedVenueId) {
        if (walkRequest.selectedVenueId !== selectedVenueIdRef.current) selectVenueRef.current(walkRequest.selectedVenueId);
      } else if (selectedVenueIdRef.current) clearSelectionRef.current?.();
    });
  }, [walkRequest]);
}
