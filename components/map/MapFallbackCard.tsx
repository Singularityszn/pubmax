"use client";

import Link from "next/link";
import { useState } from "react";

import { formatPrice, type Venue } from "@/lib/venues";
import styles from "./MapFallbackCard.module.css";

/**
 * The one thing the map shows when there is no map.
 *
 * This card was written inside `components/PubMapCanvas.tsx` for the five ways
 * a MOUNTED canvas can die. It lives here because the shell needs exactly the
 * same view for the two ways the canvas never mounts at all (its module never
 * arrived; it never answered inside the readiness ceiling), and the map may
 * have ONE venue view rather than a second one that drifts from it. Both
 * callers hand it a decided heading and sentence; it decides nothing.
 *
 * The rows are the slim pin index, which needs no WebGL: tapping one opens the
 * same venue sheet a pin tap opens. `/pubs` is the whole directory behind them.
 * The technical disclosure is a plain React toggle rather than a native
 * `<details>`, because the canvas's own RAF loop kept racing native
 * click-activation in CDP-driven clicks; this card keeps that shape so the two
 * callers behave identically.
 */
export default function MapFallbackCard({
  heading,
  message,
  detail,
  venues,
  onSelectVenue,
  onRetry,
  retryLabel = "Retry",
}: {
  heading: string;
  message: string;
  /** Raw browser diagnostic, shown only behind the disclosure. */
  detail?: string | null;
  /** Already ranked and capped by the caller (lib/mapFallbackVenues.ts). */
  venues: readonly Venue[];
  onSelectVenue: (venueId: string) => void;
  /** Null where a retry could not possibly help, which hides the control. */
  onRetry?: (() => void) | null;
  retryLabel?: string;
}) {
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <div className={`${styles.mapFallback} mapFallback`} role="alert">
      <strong>{heading}</strong>
      <p>{message}</p>
      {detail ? (
        <div className={`${styles.mapFallbackDisclosure} mapFallbackDisclosure`}>
          <button
            type="button"
            className={styles.mapFallbackDisclosureToggle}
            aria-expanded={detailOpen}
            onClick={() => setDetailOpen((open) => !open)}
          >
            Technical details
          </button>
          {detailOpen ? <small className={`${styles.mapFallbackDetail} mapFallbackDetail`}>{detail}</small> : null}
        </div>
      ) : null}
      {venues.length > 0 ? (
        <ul className={styles.mapFallbackVenues} aria-label="Pubs you can still browse">
          {venues.map((venue) => (
            <li key={venue.id}>
              <button
                type="button"
                className={`${styles.mapFallbackVenue} mapFallbackVenue`}
                onClick={() => onSelectVenue(venue.id)}
              >
                <span className={`${styles.mapFallbackVenueName} mapFallbackVenueName`}>{venue.name}</span>
                <span className={styles.mapFallbackVenueMeta}>
                  {venue.primaryBorough}
                  {venue.cheapestPrice != null
                    ? ` · ${formatPrice(venue.cheapestPrice)}`
                    : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Link className={`${styles.mapFallbackBrowse} mapFallbackBrowse`} href="/pubs">
        Browse all pubs
      </Link>
      {onRetry ? (
        <button type="button" className={`${styles.mapFallbackRetry} mapFallbackRetry`} onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
