import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { isRecordlessMapSelection, type MapSelectionNotice, type VenueDetailStatus } from "@/lib/pubMap";
import type { Venue } from "@/lib/venues";
import {
  rememberOpenedVenue,
  savedVenueCopyAt,
  warmVenueDetail,
  type VenueDetailLookupResult,
} from "@/lib/warmVenueDetail";

type SelectedVenueDetailArgs = {
  selectedVenueId: string;
  detailById: Map<string, Venue>;
  setDetailById: Dispatch<SetStateAction<Map<string, Venue>>>;
  setDetailStatusById: Dispatch<SetStateAction<Map<string, VenueDetailStatus>>>;
  setSelectedVenueId: Dispatch<SetStateAction<string>>;
  setSelectionNotice: Dispatch<SetStateAction<MapSelectionNotice | null>>;
  resolveMapSelection: (requestedVenueId: string, canonicalVenueId: string) => void;
};

/**
 * Loads the selected pub's full detail into the sheet, and keeps a copy of
 * each pub opened so its sheet still reads with no signal. A displayed copy
 * stays dated until a live read succeeds or confirms removal.
 */
export function useSelectedVenueDetail({
  selectedVenueId,
  detailById,
  setDetailById,
  setDetailStatusById,
  setSelectedVenueId,
  setSelectionNotice,
  resolveMapSelection,
}: SelectedVenueDetailArgs): string | null {
  const selectionRef = useRef({ detailById, selectedVenueId });
  useEffect(() => {
    selectionRef.current = { detailById, selectedVenueId };
  }, [detailById, selectedVenueId]);

  const acceptDetail = useCallback(
    (requestedVenueId: string, result: VenueDetailLookupResult, saved?: Venue) => {
      if (saved && (
        selectionRef.current.detailById.get(requestedVenueId) !== saved ||
        result.status === "failed" ||
        (result.status === "found" && result.savedAt)
      )) return;
      if (result.status !== "found") {
        if (saved) {
          setDetailById((current) => {
            if (current.get(requestedVenueId) !== saved) return current;
            const next = new Map(current);
            next.delete(requestedVenueId);
            return next;
          });
        }
        setDetailStatusById((current) => {
          const next = new Map(current);
          next.set(requestedVenueId, result.status === "missing" ? "missing" : "unavailable");
          return next;
        });
        return;
      }
      if (result.venue.retired) {
        setDetailById((current) => new Map(current).set(requestedVenueId, result.venue));
        return;
      }
      const canonicalVenueId = result.venue.id;
      if (!result.savedAt) rememberOpenedVenue(requestedVenueId);
      resolveMapSelection(requestedVenueId, canonicalVenueId);
      setDetailById((current) => {
        const next = new Map(current);
        if (canonicalVenueId !== requestedVenueId) next.delete(requestedVenueId);
        next.set(canonicalVenueId, result.venue);
        return next;
      });
      setDetailStatusById((current) => {
        const next = new Map(current);
        next.delete(requestedVenueId);
        next.delete(canonicalVenueId);
        return next;
      });
      if (selectionRef.current.selectedVenueId === requestedVenueId) setSelectionNotice(null);
      if (canonicalVenueId !== requestedVenueId) {
        setSelectedVenueId((current) =>
          current === requestedVenueId ? canonicalVenueId : current,
        );
      }
    },
    [resolveMapSelection, setDetailById, setDetailStatusById, setSelectedVenueId, setSelectionNotice],
  );

  useEffect(() => {
    const refreshSavedCopies = () => {
      for (const [id, saved] of selectionRef.current.detailById) {
        if (!savedVenueCopyAt(saved)) continue;
        void warmVenueDetail(id).then((result) => acceptDetail(id, result, saved));
      }
    };
    window.addEventListener("online", refreshSavedCopies);
    return () => window.removeEventListener("online", refreshSavedCopies);
  }, [acceptDetail]);

  const selectedDetail = detailById.get(selectedVenueId);
  useEffect(() => {
    if (!selectedVenueId || isRecordlessMapSelection(selectedVenueId)) return;
    const held = selectedDetail;
    if (held && !savedVenueCopyAt(held)) {
      if (!held.retired) rememberOpenedVenue(selectedVenueId);
      return;
    }
    if (held && !navigator.onLine) return;
    const requestedVenueId = selectedVenueId;
    let cancelled = false;
    void warmVenueDetail(requestedVenueId).then((result) => {
      if (!cancelled) acceptDetail(requestedVenueId, result, held);
    });
    return () => {
      cancelled = true;
    };
  }, [
    selectedDetail,
    acceptDetail,
    selectedVenueId,
  ]);

  return selectedDetail ? savedVenueCopyAt(selectedDetail) : null;
}
