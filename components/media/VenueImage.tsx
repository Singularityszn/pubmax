"use client";

// E3′ — one shared proxied venue-image component for the venue sheet header,
// feed/gallery/hover-card thumbnails. Always routes chain (scraped) photos
// through /api/image-proxy via resolveVenueImage so CSP img-src stays tight;
// community (Pint Drop) photos are already same-origin signed Storage URLs.
// Honest by construction: `sources` are tried in priority order and the
// first one that resolves wins, with its provenance labelled on-image — a
// photo whose provenance is unknown is never rendered, only the gradient
// fallback.

import Image from "next/image";
import { useState } from "react";

import {
  resolveVenueImage,
  VENUE_IMAGE_PROVENANCE_LABEL,
  type VenueImageSource,
} from "@/lib/venueImages";

import "./venueImage.css";

type VenueImageProps = {
  /** Candidate sources in priority order — first one that resolves wins. */
  sources: VenueImageSource[];
  alt: string;
  className?: string;
  /** Optional extra caption under the image (e.g. "the pint", "at the bar"). */
  caption?: string;
  width?: number;
  height?: number;
  priority?: boolean;
  /** When true, fill the parent (object-fit cover). */
  fill?: boolean;
  /** Show the on-image provenance label ("Photo: pub website"/"Photo: community"). Default true. */
  showProvenance?: boolean;
};

export default function VenueImage({
  sources,
  alt,
  className = "",
  caption,
  width = 640,
  height = 360,
  priority = false,
  fill = false,
  showProvenance = true,
}: VenueImageProps) {
  const [failed, setFailed] = useState(false);
  const resolved = resolveVenueImage(sources);
  const show = Boolean(resolved) && !failed;

  if (!show) {
    return (
      <div
        className={`venueImage venueImage--empty ${className}`.trim()}
        role="img"
        aria-label={alt}
      >
        <span aria-hidden="true">No photo yet</span>
      </div>
    );
  }

  const src = resolved!.url;
  const provenanceLabel = VENUE_IMAGE_PROVENANCE_LABEL[resolved!.provenance];

  return (
    <figure className={`venueImage ${className}`.trim()}>
      {fill ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(max-width: 640px) 100vw, 420px"
          className="venueImage__img"
          priority={priority}
          unoptimized
          onError={() => setFailed(true)}
        />
      ) : (
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          className="venueImage__img"
          priority={priority}
          unoptimized
          onError={() => setFailed(true)}
        />
      )}
      {showProvenance ? (
        <span className="venueImage__provenance">{provenanceLabel}</span>
      ) : null}
      {caption ? <figcaption className="venueImage__caption">{caption}</figcaption> : null}
    </figure>
  );
}
