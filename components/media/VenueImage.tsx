"use client";

// E3′ — one shared proxied venue-image component for sheets, feed, crawls, and
// hover cards. Always routes remote photos through /api/image-proxy via
// proxiedVenueImageUrl so CSP img-src stays tight.

import Image from "next/image";
import { useState } from "react";

import { proxiedVenueImageUrl } from "@/lib/venueImages";

import "./venueImage.css";

type VenueImageProps = {
  src?: string | null;
  alt: string;
  className?: string;
  /** Optional provenance caption under the image ("Checked …"). */
  caption?: string;
  width?: number;
  height?: number;
  priority?: boolean;
  /** When true, fill the parent (object-fit cover). */
  fill?: boolean;
};

export default function VenueImage({
  src,
  alt,
  className = "",
  caption,
  width = 640,
  height = 360,
  priority = false,
  fill = false,
}: VenueImageProps) {
  const [failed, setFailed] = useState(false);
  const proxied = src ? proxiedVenueImageUrl(src) : "";
  const show = Boolean(proxied) && !failed;

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

  return (
    <figure className={`venueImage ${className}`.trim()}>
      {fill ? (
        <Image
          src={proxied}
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
          src={proxied}
          alt={alt}
          width={width}
          height={height}
          className="venueImage__img"
          priority={priority}
          unoptimized
          onError={() => setFailed(true)}
        />
      )}
      {caption ? <figcaption className="venueImage__caption">{caption}</figcaption> : null}
    </figure>
  );
}
