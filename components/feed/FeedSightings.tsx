"use client";

import Link from "next/link";

import type { SightingDTO } from "@/lib/feedSightings";
import { relativeTime } from "@/lib/relativeTime";

import "./feedSightings.css";

// Ambient price sightings on the feed's London tab. These are NOT user drops:
// each is a real price from a NAMED source with a date, badged "Spotted" and
// styled apart from drinker cards so we never fake activity (docs/VOICE.md taste
// doctrine). Two shapes:
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
      aria-label={`Spotted: ${sighting.drink} at ${sighting.priceLabel}, ${sighting.venueName}. Source ${dated}. Open on the map.`}
    >
      <span className="feedSightingKicker" aria-hidden="true">
        Spotted
      </span>
      <span className="feedSightingMain" aria-hidden="true">
        <span className="feedSightingDrink">{sighting.drink}</span>
        <span className="feedSightingVenue">{sighting.venueName}</span>
      </span>
      <span className="feedSightingAside" aria-hidden="true">
        <span className="feedSightingPrice">{sighting.priceLabel}</span>
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

  if (variant === "primary") {
    return (
      <section
        className="feedSightings feedSightingsPrimary"
        aria-labelledby="feed-sightings-title"
      >
        <header className="feedSightingsHead">
          <p className="feedSightingsEyebrow">Spotted around London</p>
          <h2 className="feedSightingsTitle" id="feed-sightings-title">
            No pints logged here yet tonight.
          </h2>
          <p className="feedSightingsLede">
            So here&rsquo;s what we&rsquo;ve spotted lately: real prices from named
            sources, each with a date. Log yours and it leads the feed.
          </p>
          <Link className="feedSightingsCta" href="/map?log=1">
            Find a pub and drop a pint
          </Link>
        </header>
        <ul className="feedSightingsList">
          {sightings.map((sighting) => (
            <li key={sighting.id}>
              <SightingRow sighting={sighting} />
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section
      className="feedSightings feedSightingsStrip"
      aria-labelledby="feed-sightings-strip-title"
    >
      <div className="feedSightingsStripHead">
        <p className="feedSightingsStripTitle" id="feed-sightings-strip-title">
          Also spotted around London
        </p>
        <p className="feedSightingsStripHint">
          Sourced prices, not drinker logs. Each with a date and a link.
        </p>
      </div>
      <ul className="feedSightingsList feedSightingsListCompact">
        {sightings.map((sighting) => (
          <li key={sighting.id}>
            <SightingRow sighting={sighting} />
          </li>
        ))}
      </ul>
    </section>
  );
}
