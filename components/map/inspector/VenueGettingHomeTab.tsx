"use client";

import { useEffect, useRef, useState } from "react";

import LastTrainCard from "../LastTrainCard";
import NearbyBusDepartures from "../NearbyBusDepartures";
import { GetHomeHandoffRow } from "@/components/night/RouteEndingCard";
import { SafeNightStrip } from "@/components/night/SafeNightStrip";
import { venueToGetHomeHandoff } from "@/lib/getHomeHandoff";
import type { Venue } from "@/lib/venues";
import type { LastPintDecision } from "@/lib/tfl";
import type { CityId } from "@/lib/cities";
import { gettingHomeLabel } from "@/lib/venueInspectorTabs";

import "@/components/disclosure.css";
import { scrollMotionBehavior } from "@/lib/scrollMotion";

/**
 * Getting home, as a fold on the Overview. It used to be the seventh tab, and
 * seven tabs wrapped into two rows on a phone (site audit 13 Sep 2026, D10).
 *
 * The body mounts only while the fold is open, exactly as the tab panel mounted
 * only while its tab was selected: the bus board and the handoff row make their
 * own reads, and a sheet open may not spend them for a card nobody opened.
 * `openRequest` is a caller asking for this section by name (the route-end
 * "check the last train" door), so the fold opens and scrolls into view.
 */
export default function VenueGettingHomeSection({
  venue,
  cityId,
  openRequest = false,
  onSelectVenue,
  onDecision,
}: {
  venue: Venue;
  cityId: CityId;
  openRequest?: boolean;
  onSelectVenue?: (id: string) => void;
  onDecision: (decision: LastPintDecision | null) => void;
}) {
  const [open, setOpen] = useState(openRequest);
  const [lastPintDecision, setLastPintDecision] = useState<LastPintDecision | null>(
    null,
  );
  const foldRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!openRequest) return;
    const frame = window.requestAnimationFrame(() => {
      foldRef.current?.scrollIntoView({ block: "start", behavior: scrollMotionBehavior() });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openRequest]);

  return (
    <details
      ref={foldRef}
      id="venueSection-getting-home"
      className="contentDisclosure venueGettingHome"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{gettingHomeLabel(cityId)}</summary>
      {open ? (
        <div className="contentDisclosureBody venueGettingHomeBody">
          <LastTrainCard
            key={`${cityId}:${venue.id}:${venue.latitude}:${venue.longitude}:${venue.name}`}
            lat={venue.latitude}
            lng={venue.longitude}
            venueName={venue.name}
            cityId={cityId}
            venueKind={venue.kind}
            onSelectVenue={onSelectVenue}
            onDecision={(decision) => {
              setLastPintDecision(decision);
              onDecision(decision);
            }}
          />
          {cityId === "london" ? (
            <NearbyBusDepartures
              key={venue.id}
              lat={venue.latitude}
              lng={venue.longitude}
            />
          ) : null}
          <GetHomeHandoffRow
            venue={venueToGetHomeHandoff(venue)}
            decision={lastPintDecision?.decision ?? null}
          />
          <SafeNightStrip
            venue={{
              id: venue.id,
              name: venue.name,
              latitude: venue.latitude,
              longitude: venue.longitude,
            }}
            cityId={cityId}
          />
        </div>
      ) : null}
    </details>
  );
}
