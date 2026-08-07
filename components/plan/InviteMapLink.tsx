"use client";

import Link from "next/link";

import { trackEvent } from "@/lib/analytics";

// The guest's own way from the invite card to the map, tracked as
// invite_map_opened. Reuses PlanRoute.tsx's own /map?venue=<id> precedent —
// no multi-stop deep link exists yet, so this opens the map on the first
// stop, from where the rest of the route is visible. firstVenueId is
// undefined only when a plan somehow has no stops, in which case the page
// omits this link entirely rather than pointing at nothing.
export default function InviteMapLink({ firstVenueId }: { firstVenueId: string }) {
  return (
    <Link
      className="invite__mapLink"
      href={`/map?venue=${encodeURIComponent(firstVenueId)}`}
      onClick={() => trackEvent("invite_map_opened")}
    >
      See these pubs on the map
    </Link>
  );
}
