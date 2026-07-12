"use client";

import { Beer, Footprints, Navigation, TrainFront } from "lucide-react";

import { formatPrice, type Venue } from "@/lib/venues";
import { formatLeg, type OnTheWayPoi, type RouteLegsSummary } from "@/lib/routeLegs";
import type { CrawlJourneyLegSummary } from "@/components/map/useCrawlJourneys";

type VenueSignals = Map<
  string,
  { hasPintDrops: boolean; dropCount?: number; latestContributorPrice: number | null }
>;

type RouteListProps = {
  route: Venue[];
  activeVenueId: string | undefined;
  venueSignals: VenueSignals;
  legSummary: RouteLegsSummary;
  onTheWayByLeg: Map<number, OnTheWayPoi[]>;
  journeyByToIndex?: Map<number, CrawlJourneyLegSummary>;
  onSelectVenue: (id: string) => void;
};

export default function RouteList({
  route,
  activeVenueId,
  venueSignals,
  legSummary,
  onTheWayByLeg,
  journeyByToIndex,
  onSelectVenue,
}: RouteListProps) {
  return (
    <ol className="routeList">
      {route.map((venue, index) => {
        const signal = venueSignals.get(venue.id);
        const dropCount = signal?.dropCount ?? 0;
        const leg = legSummary.legs[index];
        const onTheWay = onTheWayByLeg.get(index) ?? [];
        return (
        <li key={venue.id} className={activeVenueId === venue.id ? "active" : ""}>
          <button
            type="button"
            onClick={() => onSelectVenue(venue.id)}
            aria-current={activeVenueId === venue.id ? "true" : undefined}
          >
            <span className="stopNumber">{index + 1}</span>
            <div>
              <strong>
                {venue.name}
                {dropCount > 0 ? (
                  <span
                    className="provChip contributor"
                    style={{ marginLeft: "6px", verticalAlign: "middle" }}
                    title={`${dropCount} Pint Drop${dropCount === 1 ? "" : "s"} logged here`}
                  >
                    <Beer size={11} aria-hidden="true" />
                    {dropCount}
                  </span>
                ) : null}
              </strong>
              <p>
                {formatPrice(signal?.latestContributorPrice ?? venue.cheapestPrice)}{" "}
                · {venue.cheapestPint}
              </p>
              <small>
                {venue.curation.storyTag ||
                  venue.primaryBorough ||
                  venue.visibleBoroughs[0] ||
                  "London"}
              </small>
            </div>
          </button>
          <a
            className="routeStopDirections"
            href={`https://www.google.com/maps/dir/?api=1&destination=${venue.latitude},${venue.longitude}&travelmode=walking`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Navigation size={12} aria-hidden="true" />
            <span>Directions</span>
          </a>
          {leg ? (
            <div className="routeLeg" aria-label={`Leg to ${leg.to.name}`}>
              <Footprints size={13} aria-hidden="true" />
              <span>{formatLeg(leg)}</span>
              {onTheWay.length > 0 ? (
                <p className="routeLegOnWay">
                  On the way: {onTheWay.map((m) => m.poi.name).join(", ")}
                </p>
              ) : null}
              {journeyByToIndex?.get(index) ? (
                <p className="routeLegTransit" aria-label="TfL leg">
                  <TrainFront size={12} aria-hidden="true" />
                  <span>{journeyByToIndex.get(index)!.summary}</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </li>
        );
      })}
    </ol>
  );
}
