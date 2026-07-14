"use client";

import {
  Footprints,
  LocateFixed,
  Navigation,
  TrainFront,
} from "lucide-react";

import { useVenueJourney } from "@/components/map/useVenueJourney";
import {
  venueDirectionsUrl,
  type JourneyPoint,
} from "@/lib/venueJourney";

import "./venueGettingThere.css";

export type LocationRequestStatus = "idle" | "requesting" | "unavailable";

type VenueGettingThereProps = {
  userLocation: JourneyPoint | null;
  venueLocation: JourneyPoint;
  londonTransit: boolean;
  locationRequestStatus: LocationRequestStatus;
  onRequestLocation: () => void;
};

export default function VenueGettingThere({
  userLocation,
  venueLocation,
  londonTransit,
  locationRequestStatus,
  onRequestLocation,
}: VenueGettingThereProps) {
  const journey = useVenueJourney(
    userLocation,
    venueLocation,
    londonTransit,
  );

  if (!userLocation) {
    return (
      <section className="venueGettingThere" aria-label="Getting there">
        <span className="venueGettingThere__eyebrow">From you</span>
        <button
          type="button"
          className="venueGettingThere__location"
          onClick={onRequestLocation}
          disabled={locationRequestStatus !== "idle"}
        >
          <LocateFixed size={16} aria-hidden="true" />
          {locationRequestStatus === "requesting"
            ? "Finding your location…"
            : locationRequestStatus === "unavailable"
              ? "Location unavailable"
              : "Share location for travel times"}
        </button>
      </section>
    );
  }

  const directionsHref = venueDirectionsUrl(venueLocation, userLocation);
  const showTflEmpty =
    londonTransit &&
    (journey.status === "idle" ||
      journey.status === "empty" ||
      journey.status === "error");

  return (
    <section className="venueGettingThere" aria-label="Getting there">
      <div className="venueGettingThere__head">
        <span className="venueGettingThere__eyebrow">From you</span>
        <a
          className="venueGettingThere__maps"
          href={directionsHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open directions from your location in Google Maps"
        >
          <Navigation size={14} aria-hidden="true" />
          Maps
        </a>
      </div>
      <div className="venueGettingThere__routes" aria-live="polite">
        {journey.walkMinutes !== null ? (
          <span className="venueGettingThere__route">
            <Footprints size={15} aria-hidden="true" />
            <strong>Walk</strong>
            <span aria-hidden="true">·</span>
            <span>~{journey.walkMinutes} min</span>
          </span>
        ) : null}
        {londonTransit ? (
          <span className="venueGettingThere__route venueGettingThere__route--tfl">
            <TrainFront size={15} aria-hidden="true" />
            <strong>TfL</strong>
            <span aria-hidden="true">·</span>
            <span>
              {journey.status === "loading"
                ? "Checking…"
                : journey.bestSummary ??
                  (showTflEmpty ? "No TfL itinerary just now" : "Checking…")}
            </span>
          </span>
        ) : null}
      </div>
    </section>
  );
}
