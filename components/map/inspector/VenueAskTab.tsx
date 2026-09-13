"use client";

import LandlordPanel from "@/components/LandlordPanel";
import type { Venue } from "@/lib/venues";

/**
 * Ask, as a section of Lore. It used to be its own tab, and seven tabs wrapped
 * into two rows on a phone (site audit 13 Sep 2026, D10). A question about the
 * pub is a question about its history, so it sits with the history.
 */
export default function VenueAskSection({ venue }: { venue: Venue }) {
  return (
    <div id="venueSection-ask" className="venueAskSection">
      <LandlordPanel
        venueId={venue.id}
        venueName={venue.name}
        venueKind={venue.kind}
        context={{
          era: venue.curation.heritageEra,
          heritageNote: venue.curation.heritageNote,
          address: venue.address,
          borough: venue.primaryBorough,
        }}
      />
    </div>
  );
}
