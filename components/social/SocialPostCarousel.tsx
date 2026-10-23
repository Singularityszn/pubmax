"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";

export type CarouselPhoto = {
  key: string;
  src: string;
  altText: string;
  /** A photo still waiting on its check: only its author is ever shown one. */
  held?: boolean;
};

/**
 * Up to four photos the way a photo app shows them: one frame at a time,
 * swiped sideways, with a dot per photo and a counter a screen reader reads.
 * Arrows join on a pointer that can hover. One photo renders as a plain frame.
 */
export default function SocialPostCarousel({ photos, caption }: { photos: CarouselPhoto[]; caption?: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  function go(next: number) {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.max(0, Math.min(photos.length - 1, next));
    track.scrollTo({ left: clamped * track.clientWidth, behavior: "smooth" });
  }

  return (
    <figure className="socialPostCarousel" aria-roledescription="carousel" aria-label={`Photos, ${photos.length}`}>
      <div
        ref={trackRef}
        className="socialPostCarousel__track"
        onScroll={(event) => {
          const track = event.currentTarget;
          const next = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
          if (next !== index) setIndex(next);
        }}
      >
        {photos.map((photo, position) => (
          <div
            key={photo.key}
            className="socialPostCarousel__slide"
            role="group"
            aria-roledescription="slide"
            aria-label={`${position + 1} of ${photos.length}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- private, reader-checked delivery route. */}
            <img src={photo.src} alt={photo.altText} loading="lazy" decoding="async" />
            {photo.held ? <span className="socialPostCarousel__held">Only you see this photo until it is checked.</span> : null}
          </div>
        ))}
      </div>
      {photos.length > 1 ? (
        <>
          <button type="button" className="socialPostCarousel__arrow socialPostCarousel__arrow--prev" aria-label="Previous photo" disabled={index === 0} onClick={() => go(index - 1)}>
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button type="button" className="socialPostCarousel__arrow socialPostCarousel__arrow--next" aria-label="Next photo" disabled={index === photos.length - 1} onClick={() => go(index + 1)}>
            <ChevronRight size={20} aria-hidden="true" />
          </button>
          <div className="socialPostCarousel__dots" aria-hidden="true">
            {photos.map((photo, position) => (
              <span key={photo.key} data-active={position === index ? "true" : undefined} />
            ))}
          </div>
          <span className="socialPostCarousel__count" aria-live="polite">{index + 1} / {photos.length}</span>
        </>
      ) : null}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
