// Founder photographs of London in a mosaic below the hero (captain 26 Sep 2026,
// restored 18 Oct 2026 with each patch's pint price). The hero owns LCP; this
// section follows it. Every tile, frame and caption renders in the first HTML
// so the mosaic holds its final size, and every frame paints its photo's own
// blurred preview from that first paint, so a tile is never an empty grey box.
// Only the full pictures wait until the section nears the viewport, so their
// bytes do not queue behind the answer photo, and each one fades in over its
// preview once decoded.

"use client";

import { lastOf } from "@/lib/tuple";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import Link from "next/link";
import { formatGbp } from "@/lib/formatGbp";
import {
  LONDON_COLLAGE_CREDIT,
  LONDON_JOURNAL_PHOTOS,
  londonPhotoMapHref,
  LONDON_COLLAGE_WIDTHS,
  londonCollagePricedTileIds,
  londonCollageSrc,
  londonCollageSrcSet,
  type LondonCollageAreaPrice,
  type LondonCollagePhoto,
} from "@/lib/landingLondonCollage";

import "./landingLondonCollage.css";

const WIDEST = lastOf(LONDON_COLLAGE_WIDTHS);

/** Phone strip tile width, tablet hero span, then the widest desktop span (2 of 5 columns). */
const COLLAGE_SIZES =
  "(max-width: 640px) min(72vw, 280px), (max-width: 1023px) 50vw, min(50vw, 600px)";

/** Start fetching a little before the reader reaches the section. */
const COLLAGE_ROOT_MARGIN = "200px 0px";

const PRICED_TILES = londonCollagePricedTileIds();

function CollagePicture({ photo }: { photo: LondonCollagePhoto }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <picture>
      <source type="image/avif" srcSet={londonCollageSrcSet(photo, "avif")} sizes={COLLAGE_SIZES} />
      <source type="image/webp" srcSet={londonCollageSrcSet(photo, "webp")} sizes={COLLAGE_SIZES} />
      <img
        className="lpCollageTile__img"
        data-loaded={loaded ? "true" : undefined}
        src={londonCollageSrc(photo, WIDEST, "webp")}
        width={photo.width}
        height={photo.height}
        alt={photo.alt}
        loading="lazy"
        decoding="async"
        sizes={COLLAGE_SIZES}
        onLoad={() => setLoaded(true)}
        ref={(node) => {
          // A cached image can finish before React attaches onLoad.
          if (node?.complete && node.naturalWidth > 0) setLoaded(true);
        }}
      />
    </picture>
  );
}

function CollageTile({
  photo,
  showPicture,
  price,
}: {
  photo: LondonCollagePhoto;
  showPicture: boolean;
  price: LondonCollageAreaPrice | null;
}) {
  return (
    <li
      className={`lpCollageTile lpCollageTile--${photo.layout}`}
      data-collage-id={photo.id}
      style={{ "--collage-cell": photo.cell } as CSSProperties}
    >
      <Link prefetch={false} href={londonPhotoMapHref(photo)} className="lpCollageTile__link"
        aria-labelledby={`london-photo-${photo.id}`}>
      <figure className="lpCollageTile__figure">
        <div
          className="lpCollageTile__frame"
          style={{ backgroundImage: `url(${photo.blurDataUrl})` }}
        >
          {showPicture ? <CollagePicture photo={photo} /> : null}
        </div>
        <figcaption id={`london-photo-${photo.id}`} className="lpCollageTile__caption">
          <span className="lpCollageTile__place">{photo.caption}</span>
          {price ? (
            <span className="lpCollageTile__price">
              Listed pints from <data value={price.cheapestPrice.toFixed(2)}>{formatGbp(price.cheapestPrice)}</data>{" "}
              within half a mile
            </span>
          ) : null}
        </figcaption>
      </figure>
      </Link>
    </li>
  );
}

export default function LandingLondonCollage({
  areaPrices = {},
}: {
  /** Each area's cheapest nearby pint (lib/landingLondonCollage.ts), from the landing's priced read. */
  areaPrices?: Readonly<Record<string, LondonCollageAreaPrice>>;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [showPictures, setShowPictures] = useState(false);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShowPictures(true);
      return;
    }

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
          <h2 id="lpCollageHeading" className="lpCollageTitle">
            Around London
          </h2>
        </header>

        <ul
          className="lpCollageMosaic"
          aria-label="Founder photographs of London"
          tabIndex={0}
        >
          {LONDON_JOURNAL_PHOTOS.map((photo) => (
            <CollageTile
              key={photo.id}
              photo={photo}
              showPicture={showPictures}
              price={PRICED_TILES.has(photo.id) ? (areaPrices[photo.area] ?? null) : null}
            />
          ))}
        </ul>

        <p className="lpCollageCredit">{LONDON_COLLAGE_CREDIT}</p>
      </div>
    </section>
  );
}
