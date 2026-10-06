"use client";

import { Beer, Footprints, Navigation, TrainFront } from "lucide-react";

import { formatPrice, type Venue } from "@/lib/venues";
import { formatLeg, type OnTheWayPoi, type RouteLegsSummary } from "@/lib/routeLegs";
import { journeyAddsTransit } from "@/lib/formatJourney";
import { routeStopPlaceLabels } from "@/lib/routeStops";
import type { CrawlJourneyLegSummary } from "@/components/map/useCrawlJourneys";
import { mapPlanDrinkPriceDescription, type MapPlanDrinkPresentation } from "@/lib/mapPlanDrinkPresentation";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import type { CategoryPriceIndexStatus } from "@/lib/mapExperienceLens";

type VenueSignals = Map<
  string,
  { hasPintDrops: boolean; dropCount?: number; latestContributorPrice: number | null }
>;

type RouteListProps = {
  route: Venue[];
  drinkPresentation?: MapPlanDrinkPresentation | null;
  drinkPrices?: ReadonlyMap<string, MapLensPrice> | null;
  drinkPriceStatus?: CategoryPriceIndexStatus;
  activeVenueId: string | undefined;
  venueSignals: VenueSignals;
  legSummary: RouteLegsSummary;
  onTheWayByLeg: Map<number, OnTheWayPoi[]>;
  journeyByToIndex?: Map<number, CrawlJourneyLegSummary>;
  onSelectVenue: (id: string) => void;
};

export default function RouteList({
  route,
  drinkPresentation,
  drinkPrices,
  drinkPriceStatus,
  activeVenueId,
  venueSignals,
  legSummary,
  onTheWayByLeg,
  journeyByToIndex,
  onSelectVenue,
}: RouteListProps) {
  // A place line per stop, widened only where two stops share a name (see
  // lib/routeStops.ts). London has several Queens Heads.
  const placeLabels = routeStopPlaceLabels(
    route.map((venue) => ({
      name: venue.name,
      address: venue.address,
      storyTag: venue.curation.storyTag,
      primaryBorough: venue.primaryBorough,
      visibleBoroughs: venue.visibleBoroughs,
    })),
  );

  return (
    <ol className="routeList">
      {route.map((venue, index) => {
        const signal = venueSignals.get(venue.id);
        const dropCount = signal?.dropCount ?? 0;
        const leg = legSummary.legs[index];
        const onTheWay = onTheWayByLeg.get(index) ?? [];
        // The card prints the leg FROM this stop, so its journey is keyed by the
        // stop that leg arrives at. Reading key `index` gave the card the
        // PREVIOUS leg's journey, and gave the first card none at all, so the
        // two times under one card were two different legs.
        //
        // The card already prints this leg's walk time. A walk-only TfL journey
        // is that same leg measured twice, so only a journey that uses another
        // mode earns a second line.
        const journey = journeyByToIndex?.get(index + 1);
        const transitJourney = journey && journeyAddsTransit(journey.modes) ? journey : null;
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
                {drinkPresentation
                  ? mapPlanDrinkPriceDescription(drinkPresentation, venue.id, drinkPrices, drinkPriceStatus)
                  : stopPriceLine(signal?.latestContributorPrice ?? venue.cheapestPrice, venue)}
              </p>
              <small>{placeLabels[index]}</small>
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
              {transitJourney ? (
                <p className="routeLegTransit" aria-label="TfL leg">
                  <TrainFront size={12} aria-hidden="true" />
                  <span>{transitJourney.summary}</span>
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

function stopPriceLine(price: number | null, venue: Venue): string {
  const pint = price === venue.cheapestPrice ? venue.cheapestPint : "";
  return pint ? `${formatPrice(price)} · ${pint}` : formatPrice(price);
}
