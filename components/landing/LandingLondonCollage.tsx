// Founder photographs of London in a mosaic below the hero (captain 26 Sep 2026).
// The hero owns LCP; this section is always below the fold. Every tile, frame and
// caption renders in the first HTML so the mosaic holds its final size; only the
// pictures mount once the section nears the viewport, so their bytes do not queue
// behind the answer photo.

"use client";

import { lastOf } from "@/lib/tuple";
import { useEffect, useRef, useState } from "react";

import Kicker from "@/components/ui/kicker";
import {
  LONDON_COLLAGE_CREDIT,
  LONDON_COLLAGE_PHOTOS,
  LONDON_COLLAGE_WIDTHS,
  londonCollageSrc,
  londonCollageSrcSet,
  type LondonCollagePhoto,
} from "@/lib/landingLondonCollage";

import "./landingLondonCollage.css";

const WIDEST = lastOf(LONDON_COLLAGE_WIDTHS);

/** Phone strip tile width, tablet hero span, then the widest desktop span (2 of 5 columns). */
const COLLAGE_SIZES =
  "(max-width: 699px) min(72vw, 280px), (max-width: 959px) 100vw, min(40vw, 500px)";

/** Tight margin: start fetching only when the reader is about to scroll here. */
const COLLAGE_ROOT_MARGIN = "80px 0px";

function CollageTile({ photo, showPicture }: { photo: LondonCollagePhoto; showPicture: boolean }) {
  return (
    <li
      className={`lpCollageTile lpCollageTile--${photo.layout}`}
      data-collage-id={photo.id}
    >
      <figure className="lpCollageTile__figure">
        <div className="lpCollageTile__frame">
          {showPicture ? (
            <picture>
              <source type="image/avif" srcSet={londonCollageSrcSet(photo, "avif")} sizes={COLLAGE_SIZES} />
              <source type="image/webp" srcSet={londonCollageSrcSet(photo, "webp")} sizes={COLLAGE_SIZES} />
              <img
                className="lpCollageTile__img"
                src={londonCollageSrc(photo, WIDEST, "webp")}
                width={photo.width}
                height={photo.height}
                alt={photo.alt}
                loading="lazy"
                decoding="async"
                sizes={COLLAGE_SIZES}
                style={{ backgroundImage: `url(${photo.blurDataUrl})` }}
              />
            </picture>
          ) : null}
        </div>
        <figcaption className="lpCollageTile__caption">{photo.caption}</figcaption>
      </figure>
    </li>
  );
}

export default function LandingLondonCollage() {
  const sectionRef = useRef<HTMLElement>(null);
  const [showPictures, setShowPictures] = useState(false);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShowPictures(true);
          observer.disconnect();
        }
      },
      { rootMargin: COLLAGE_ROOT_MARGIN },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="lpCollage" aria-labelledby="lpCollageHeading" ref={sectionRef}>
      <div className="lpCollageInner">
        <header className="lpCollageHead">
          <Kicker>London</Kicker>
          <h2 id="lpCollageHeading" className="lpCollageTitle">
            Streets the map sits on.
          </h2>
        </header>

        <ul
          className="lpCollageMosaic"
          aria-label="Founder photographs of London"
          tabIndex={0}
        >
          {LONDON_COLLAGE_PHOTOS.map((photo) => (
            <CollageTile key={photo.id} photo={photo} showPicture={showPictures} />
          ))}
        </ul>

        <p className="lpCollageCredit">{LONDON_COLLAGE_CREDIT}</p>
      </div>
    </section>
  );
}
