"use client";

import Link from "next/link";
import { ExternalLink, Landmark as LandmarkIcon } from "lucide-react";

import LandmarkHeroPhoto from "@/components/LandmarkHeroPhoto";
import { Button } from "@/components/ui/button";
import Kicker from "@/components/ui/kicker";
import type { Landmark } from "@/lib/landmarks";
import {
  STORY_PUBS_DISTANCE_CAVEAT,
  STORY_PUBS_NEARBY_HEADING,
  type NearbyStoryPub,
} from "@/lib/landmarkVenueProximity";
import { formatLogNearbyDistance } from "@/lib/mapLogIntent";

import "./landmarkStory.css";

/**
 * A landmark's story, the same body on every frame.
 *
 * The phone puts it in the shared bottom sheet, whose chrome already prints
 * the landmark's name as the one heading, so `showTitle` is false there and
 * the body opens on the line about where the landmark is. The desktop and
 * tablet put it in the left drawer under a head of its own, so the name and
 * the chapter link ride in that head (`LandmarkStoryHead`) and the body again
 * starts on the area line. Nothing here is absolutely positioned: the frame
 * owns the geometry, the body owns the words.
 *
 * Every block hangs off the same left gutter, and a nearby row is one button
 * with the name and the distance on one baseline, the distance right-aligned
 * in the data face so three rows read as a column.
 */
export function LandmarkStoryHead({
  landmark,
  className,
}: {
  landmark: Landmark;
  className?: string;
}) {
  return (
    <div className={`landmarkStoryHead${className ? ` ${className}` : ""}`}>
      <span className="landmarkStoryGlyph" aria-hidden="true">
        <LandmarkIcon size={18} strokeWidth={1.75} />
      </span>
      <h2 className="landmarkStoryTitle">{landmark.name}</h2>
      <Link className="landmarkStoryChapter" href={`/landmark/${encodeURIComponent(landmark.id)}`}>
        Open chapter
      </Link>
    </div>
  );
}

export default function LandmarkStoryBody({
  landmark,
  areaLine,
  nearby,
  showChapterLink = false,
  onOpenVenue,
  onStartCrawl,
  onAskPubmaxxer,
}: {
  landmark: Landmark;
  /** "In Piccadilly & Soho", or null when no area contains the point. */
  areaLine: string | null;
  nearby: readonly NearbyStoryPub[];
  /** The phone chrome has no room for the chapter link, so the body carries it. */
  showChapterLink?: boolean;
  onOpenVenue: (venueId: string) => void;
  onStartCrawl?: (pubIds: string[]) => void;
  onAskPubmaxxer?: (venueId: string) => void;
}) {
  const nearbyIds = nearby.map((row) => row.venue.id);
  const firstNearbyId = nearbyIds[0];
  return (
    <div className="landmarkStory">
      <LandmarkHeroPhoto
        key={landmark.id}
        image={landmark.image}
        name={landmark.name}
        className="landmarkStoryHero"
      />
      {areaLine || showChapterLink ? (
        <div className="landmarkStoryWhere">
          {areaLine ? (
            <Kicker tone="muted" as="span">
              {areaLine}
            </Kicker>
          ) : (
            <span />
          )}
          {showChapterLink ? (
            <Link
              className="landmarkStoryChapter"
              href={`/landmark/${encodeURIComponent(landmark.id)}`}
            >
              Open chapter
            </Link>
          ) : null}
        </div>
      ) : null}
      <p className="landmarkStoryHistory">{landmark.history}</p>
      <a
        className="landmarkStorySource"
        href={landmark.source.url}
        target="_blank"
        rel="noreferrer"
      >
        Source: {landmark.source.label}
        <ExternalLink size={13} aria-hidden="true" />
      </a>
      {nearby.length > 0 && (onStartCrawl || onAskPubmaxxer) ? (
        <div className="landmarkStoryActions">
          {onStartCrawl ? (
            <Button
              type="button"
              variant="primary"
              data-primary-action
              onClick={() => onStartCrawl(nearbyIds.slice(0, 3))}
            >
              Start a crawl here
            </Button>
          ) : null}
          {onAskPubmaxxer && firstNearbyId ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => onAskPubmaxxer(firstNearbyId)}
            >
              Ask the PUBMAXXER
            </Button>
          ) : null}
        </div>
      ) : null}
      {nearby.length > 0 ? (
        <section className="landmarkStoryNearby" aria-labelledby="landmarkStoryNearbyHeading">
          <h3 id="landmarkStoryNearbyHeading">{STORY_PUBS_NEARBY_HEADING}</h3>
          <p className="landmarkStoryCaveat">{STORY_PUBS_DISTANCE_CAVEAT}</p>
          <ul className="landmarkStoryPubs">
            {nearby.map(({ venue, km }) => (
              <li key={venue.id}>
                <button type="button" onClick={() => onOpenVenue(venue.id)}>
                  <span className="landmarkStoryPubName">{venue.name}</span>
                  <span className="landmarkStoryPubDistance">{formatLogNearbyDistance(km)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
