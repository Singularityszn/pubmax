"use client";

import Link from "next/link";

import type { SightingDTO } from "@/lib/feedSightings";
import { relativeTime } from "@/lib/relativeTime";

import "./feedSightings.css";

// Ambient price sightings on the feed's London tab. These are NOT user drops:
// each is a real price from a NAMED source with a date, grouped under one
// sourced-price heading and styled apart from drinker cards so we never fake
// activity (docs/VOICE.md taste doctrine). Two shapes:
//   - "primary" — the whole surface when no drinker has logged tonight, replacing
//     the dead empty state with honest content;
//   - "strip"   — a quiet strip BELOW real user drops when there are some.
// Placement is decided upstream (lib/feedSightings.ts sightingPlacement).

function SightingRow({ sighting }: { sighting: SightingDTO }) {
  const ago = relativeTime(sighting.observedAt);
  const dated = ago ? `${sighting.sourceDomain} · ${ago}` : sighting.sourceDomain;
  return (
    <Link
      className="feedSighting"
      href={sighting.venueMapUrl}
      aria-label={`Sourced price: ${sighting.drink} at ${sighting.priceLabel}, ${sighting.venueName}. Source ${dated}. Open on the map.`}
    >
      <span className="feedSightingMain" aria-hidden="true">
        <span className="feedSightingDrink">{sighting.drink}</span>
        <span className="feedSightingPrice">{sighting.priceLabel}</span>
        <span className="feedSightingVenue">{sighting.venueName}</span>
        <span className="feedSightingSource">{dated}</span>
      </span>
    </Link>
  );
}

export default function FeedSightings({
  variant,
  sightings,
}: {
  variant: "primary" | "strip";
  sightings: SightingDTO[];
}) {
  if (sightings.length === 0) return null;

  const titleId =
    variant === "primary" ? "feed-sightings-title" : "feed-sightings-strip-title";

  return (
    <section
      className={`feedSightings ${
        variant === "primary" ? "feedSightingsPrimary" : "feedSightingsStrip"
      }`}
      aria-labelledby={titleId}
    >
      <h2 className="feedSightingsTitle" id={titleId}>
        Recent sourced prices
      </h2>
      <ul className="feedSightingsList">
        {sightings.map((sighting) => (
          <li key={sighting.id}>
            <SightingRow sighting={sighting} />
          </li>
        ))}
      </ul>
      {variant === "primary" ? (
        <Link className="feedSightingsCta" href="/map?log=1">
          Find a pub and drop a pint
        </Link>
      ) : null}
    </section>
  );
}
