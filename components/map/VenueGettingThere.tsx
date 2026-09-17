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

import styles from "./venueGettingThere.module.css";

export type LocationRequestStatus = "idle" | "requesting" | "unavailable";

type VenueGettingThereProps = {
  userLocation: JourneyPoint | null;
  venueLocation: JourneyPoint;
  londonTransit: boolean;
  locationRequestStatus: LocationRequestStatus;
  onRequestLocation: () => void;
  onClearLocation: () => void;
};

export default function VenueGettingThere({
  userLocation,
  venueLocation,
  londonTransit,
  locationRequestStatus,
  onRequestLocation,
  onClearLocation,
}: VenueGettingThereProps) {
  const journey = useVenueJourney(
    userLocation,
    venueLocation,
    londonTransit,
  );
  const venueOnlyDirectionsHref = venueDirectionsUrl(venueLocation, null);

  if (!userLocation) {
    const locationStatusMessage =
      locationRequestStatus === "requesting"
        ? "Finding your location."
        : locationRequestStatus === "unavailable"
          ? "Location unavailable. You can try sharing it again."
          : "";
    return (
      <section className={styles.venueGettingThere} aria-label="Getting there">
        <span className={styles.venueGettingThereEyebrow}>From you</span>
        <span className={styles.venueGettingThereSrOnly} role="status" aria-live="polite">
          {locationStatusMessage}
        </span>
        <p className={styles.venueGettingTherePrivacy}>
          PUBMAXX won&rsquo;t save it. An approximate point is sent to CityMCP for
          routes. You can open the venue in Maps without sharing your location.
        </p>
        <button
          type="button"
          className={styles.venueGettingThereLocation}
          onClick={onRequestLocation}
          disabled={locationRequestStatus === "requesting"}
        >
          <LocateFixed size={16} aria-hidden="true" />
          {locationRequestStatus === "requesting"
            ? "Finding your location…"
            : locationRequestStatus === "unavailable"
              ? "Try sharing location again"
              : "Share location for travel times"}
        </button>
        <a
          className={styles.venueGettingThereVenueMaps}
          href={venueOnlyDirectionsHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open venue in Google Maps without sharing your location"
        >
          <Navigation size={14} aria-hidden="true" />
          Open venue in Maps
        </a>
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
    <section className={styles.venueGettingThere} aria-label="Getting there">
      <div className={styles.venueGettingThereHead}>
        <span className={styles.venueGettingThereEyebrow}>From you</span>
        <div className={styles.venueGettingThereActions}>
          <a
            className={styles.venueGettingThereMaps}
            href={directionsHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open directions from your location in Google Maps"
          >
            <Navigation size={14} aria-hidden="true" />
            Maps
          </a>
          <button
            type="button"
            className={styles.venueGettingThereForget}
            onClick={onClearLocation}
          >
            Forget
          </button>
        </div>
      </div>
      <div className={styles.venueGettingThereRoutes} aria-live="polite">
        {journey.walkMinutes !== null ? (
          <span className={styles.venueGettingThereRoute}>
            <Footprints size={15} aria-hidden="true" />
            <strong>Walk</strong>
            <span aria-hidden="true">·</span>
            <span>~{journey.walkMinutes} min</span>
          </span>
        ) : null}
        {londonTransit ? (
          <span className={`${styles.venueGettingThereRoute} ${styles.venueGettingThereRouteTfl}`}>
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
      {journey.status === "error" ? (
        <button
          type="button"
          className={styles.venueGettingThereRetry}
          onClick={journey.retry}
        >
          Retry routes
        </button>
      ) : null}
      <p className={styles.venueGettingTherePrivacy}>
        PUBMAXX doesn&rsquo;t save this location. CityMCP receives an approximate
        point for each route. Forget clears it from this page, but cannot undo
        an already sent request or browser permission. Maps shares it with Google
        only when opened.
      </p>
    </section>
  );
}
