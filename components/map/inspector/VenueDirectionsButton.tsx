"use client";

import { Navigation } from "lucide-react";
import { nativePlatform } from "@/lib/nativePlatform";
import { venueDirectionsUrl } from "@/lib/venueJourney";
import type { Venue } from "@/lib/venues";

export default function VenueDirectionsButton({ venue }: { venue: Venue }) {
  const destination = { lat: venue.latitude, lng: venue.longitude };
  return (
    <a
      className="venueSheetStickyGhost"
      href={venueDirectionsUrl(destination, null, { mode: "walking" })}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Walking directions to ${venue.name}`}
      onClick={(event) => {
        const platform = nativePlatform();
        if (!platform || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        window.location.assign(venueDirectionsUrl(destination, null, { mode: "walking", platform }));
      }}
    >
      <Navigation size={16} aria-hidden="true" />
      Directions
    </a>
  );
}
