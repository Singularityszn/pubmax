import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { builtStopsAskedAfter, builtStopsNeedingHydration } from "@/lib/pubMap";
import { warmVenueDetail } from "@/lib/warmVenueDetail";
import type { Venue } from "@/lib/venues";

export function useBuiltRouteHydration({
  venueDataReady, builtIds, venueById, setDetailById,
}: {
  venueDataReady: boolean;
  builtIds: string[];
  venueById: ReadonlyMap<string, Venue>;
  setDetailById: Dispatch<SetStateAction<Map<string, Venue>>>;
}) {
  const askedIds = useRef(new Set<string>());
  const [settledIds, setSettledIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const requestedIds = builtStopsNeedingHydration({ venueDataReady, builtIds, venueById, askedIds: askedIds.current });
    if (requestedIds.length === 0) return;
    requestedIds.forEach((id) => askedIds.current.add(id));
    void Promise.all(requestedIds.map(async (id) => ({ id, result: await warmVenueDetail(id) }))).then((results) => {
      setSettledIds((current) => builtStopsAskedAfter(current, results.map(({ id, result }) => ({ id, status: result.status }))));
      const hydrated = results.map(({ result }) => result.status === "found" ? result.venue : null)
        .filter((venue): venue is Venue => venue !== null);
      if (hydrated.length === 0) return;
      setDetailById((current) => {
        const next = new Map(current);
        for (const venue of hydrated) next.set(venue.id, venue);
        return next;
      });
    });
  }, [builtIds, setDetailById, venueById, venueDataReady]);
  return settledIds;
}
