"use client";

// E3′ — one shared proxied venue-image component for the venue sheet header,
// feed/gallery/hover-card thumbnails. Always routes chain (scraped) photos
// through /api/image-proxy via resolveVenueImage so CSP img-src stays tight;
// community (Pint Drop) photos are already same-origin signed Storage URLs.
// Honest by construction: `sources` are tried in priority order; when the
// preferred candidate's <img> fails to load, that URL is excluded and
// resolution advances to the next candidate (a dead chain proxy falls back
// to the community photo, not straight to "No photo yet"). The winning
// source's provenance is always labelled on-image — a photo whose provenance
// is unknown is never rendered, only the gradient fallback.

import { ImageOff } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import {
  isProxiedVenueImageUrl,
  resolveVenueImage,
  venueImageLoader,
  VENUE_IMAGE_PROVENANCE_LABEL,
  type VenueImageSource,
  type VenueImageWidth,
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
  /**
   * The box this picture is drawn in, as a `sizes` value. Spent only on a
   * proxied photo, where it decides which of the proxy's widths the browser
   * asks for. Without it a card thumbnail is served at the source's own size.
   */
  sizes?: string;
  /**
   * The widest the proxy may be asked for. A decorative card caps this so a
   * high-density phone stops asking for a sheet-header's worth of pixels.
   */
  maxWidth?: VenueImageWidth;
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
  sizes,
  maxWidth,
}: VenueImageProps) {
  // Per-candidate failure tracking: a resolved URL whose <img> errored is
  // excluded on the next resolution pass, so the next source in priority
  // order gets its turn. Callers pass fresh array literals every render, so
  // the reset keys off a content signature of the source set (the repo's
  // adjust-state-during-render idiom — never an effect).
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(new Set());
  const sourcesKey = sources.map((s) => `${s.provenance}:${s.url ?? ""}`).join("|");
  const [prevSourcesKey, setPrevSourcesKey] = useState(sourcesKey);
  if (prevSourcesKey !== sourcesKey) {
    setPrevSourcesKey(sourcesKey);
    setFailedUrls(new Set());
  }

  const resolved = resolveVenueImage(sources, failedUrls);

  if (!resolved) {
    return (
      <div
        className={`venueImage venueImage--empty ${className}`.trim()}
        role="img"
        aria-label={alt}
      >
        <span aria-hidden="true">
          <ImageOff size={14} aria-hidden="true" />
          No photo yet
        </span>
      </div>
    );
  }

  const { url: src, provenance } = resolved;
  const provenanceLabel = VENUE_IMAGE_PROVENANCE_LABEL[provenance];
  // Only a proxied photo can be resized: a community photo is a signed Storage
  // URL we do not re-encode, so it keeps the unoptimized path exactly as it was.
  const resizable = isProxiedVenueImageUrl(src);
  const sizing = resizable
    ? { loader: venueImageLoader(maxWidth) }
    : { unoptimized: true as const };
  const markFailed = () =>
    setFailedUrls((prev) => (prev.has(src) ? prev : new Set(prev).add(src)));

  return (
    <figure className={`venueImage ${className}`.trim()}>
      {fill ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes ?? "(max-width: 640px) 100vw, 420px"}
          className="venueImage__img"
          priority={priority}
          {...sizing}
          onError={markFailed}
        />
      ) : (
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          {...(sizes ? { sizes } : {})}
          className="venueImage__img"
          priority={priority}
          {...sizing}
          onError={markFailed}
        />
      )}
      <span className="venueImage__provenance">{provenanceLabel}</span>
      {caption ? <figcaption className="venueImage__caption">{caption}</figcaption> : null}
    </figure>
  );
}
