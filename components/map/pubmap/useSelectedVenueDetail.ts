import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { isRecordlessMapSelection, type MapSelectionNotice, type VenueDetailStatus } from "@/lib/pubMap";
import type { Venue } from "@/lib/venues";
import {
  rememberOpenedVenue,
  savedVenueCopyAt,
  warmVenueDetail,
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
 * each pub opened so its sheet still reads with no signal. A sheet drawn from
 * that copy swaps to the live detail when the connection comes back.
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
  const detailByIdRef = useRef(detailById);
  useEffect(() => {
    detailByIdRef.current = detailById;
  }, [detailById]);

  // A saved copy stays on screen, dated, until a live read replaces it. Only a
  // confirmed 404 takes it away; a 5xx or no answer keeps it.
  useEffect(() => {
    const refreshSavedCopies = () => {
      for (const [id, saved] of detailByIdRef.current) {
        if (!savedVenueCopyAt(saved)) continue;
        void warmVenueDetail(id).then((result) => {
          if (result.status === "missing") {
            setDetailById((current) => {
              if (current.get(id) !== saved) return current;
              const next = new Map(current);
              next.delete(id);
              return next;
            });
            setDetailStatusById((current) => new Map(current).set(id, "missing"));
            return;
          }
          if (result.status !== "found" || result.savedAt) return;
          setDetailById((current) =>
            current.get(id) === saved ? new Map(current).set(id, result.venue) : current,
          );
        });
      }
    };
    window.addEventListener("online", refreshSavedCopies);
    return () => window.removeEventListener("online", refreshSavedCopies);
  }, [setDetailById, setDetailStatusById]);

  useEffect(() => {
    if (
      !selectedVenueId ||
      isRecordlessMapSelection(selectedVenueId)
    ) {
      return;
    }
    const held = detailById.get(selectedVenueId);
    if (held) {
      if (!savedVenueCopyAt(held) && !held.retired) rememberOpenedVenue(selectedVenueId);
      return;
    }
    const requestedVenueId = selectedVenueId;
    let cancelled = false;
    warmVenueDetail(requestedVenueId).then((result) => {
      if (cancelled) return;
      if (result.status !== "found") {
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
        next.set(canonicalVenueId, result.venue);
        return next;
      });
      setDetailStatusById((current) => {
        const next = new Map(current);
        next.delete(requestedVenueId);
        next.delete(canonicalVenueId);
        return next;
      });
      setSelectionNotice(null);
      if (canonicalVenueId !== requestedVenueId) {
        setSelectedVenueId((current) =>
          current === requestedVenueId ? canonicalVenueId : current,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    detailById,
    resolveMapSelection,
    selectedVenueId,
    setDetailById,
    setDetailStatusById,
    setSelectedVenueId,
    setSelectionNotice,
  ]);

  const selectedDetail = detailById.get(selectedVenueId);
  return selectedDetail ? savedVenueCopyAt(selectedDetail) : null;
}
