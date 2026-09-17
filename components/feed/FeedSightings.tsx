"use client";

import Link from "next/link";

import PriceBadge from "@/components/PriceBadge";
import { formatSightingDay, type SightingDTO } from "@/lib/feedSightings";

import styles from "./feedSightings.module.css";

// Ambient price sightings on the feed's London tab. These are NOT user drops:
// each is a real price from a NAMED source with a date, grouped under one
// sourced-price heading and styled apart from drinker cards so we never fake
// activity (docs/VOICE.md taste doctrine). Two shapes:
//   - "primary" — the whole surface when no drinker has logged tonight, replacing
//     the dead empty state with honest content;
//   - "strip"   — a quiet strip BELOW real user drops when there are some.
// Placement is decided upstream (lib/feedSightings.ts sightingPlacement).

function SightingRow({ sighting }: { sighting: SightingDTO }) {
  const day = formatSightingDay(sighting.observedAt);
  const dated = day ? `${sighting.sourceDomain} · ${day}` : sighting.sourceDomain;
  return (
    <Link
      className={styles.feedSighting}
      href={sighting.venueMapUrl}
      aria-label={`Sourced price: ${sighting.drink} at ${sighting.priceLabel}, ${sighting.venueName}. Source ${sighting.sourceDomain}${
        day ? `, seen ${day}` : ""
      }. Open on the map.`}
    >
      <span className={styles.feedSightingMain} aria-hidden="true">
        <span className={styles.feedSightingDrink}>{sighting.drink}</span>
        <PriceBadge variant="current" className={styles.feedSightingPrice}>
          {sighting.priceLabel}
        </PriceBadge>
        <span className={styles.feedSightingVenue}>{sighting.venueName}</span>
        <span className={styles.feedSightingSource}>{dated}</span>
      </span>
    </Link>
  );
}

// One id: the two variants are mutually exclusive branches upstream, so the
// section's accessible name never needs a second one.
const TITLE_ID = "feed-sightings-title";

export default function FeedSightings({
  variant,
  sightings,
}: {
  variant: "primary" | "strip";
  sightings: SightingDTO[];
}) {
  if (sightings.length === 0) return null;

  return (
    <section
      className={`${styles.feedSightings} ${
        variant === "primary" ? styles.feedSightingsPrimary : styles.feedSightingsStrip
      }`}
      aria-labelledby={TITLE_ID}
    >
      <h2 className={styles.feedSightingsTitle} id={TITLE_ID}>
        Recent sourced prices
      </h2>
      {variant === "primary" ? (
        <p className={styles.feedSightingsLede}>
          No pints logged here yet tonight, so these are the latest prices from
          named sources, each with the day it was seen.
        </p>
      ) : null}
      <ul className={styles.feedSightingsList}>
        {sightings.map((sighting) => (
          <li key={sighting.id}>
            <SightingRow sighting={sighting} />
          </li>
        ))}
      </ul>
      {variant === "primary" ? (
        <Link className={styles.feedSightingsCta} href="/map?log=1">
          Find a pub and drop a pint
        </Link>
      ) : null}
    </section>
  );
}
