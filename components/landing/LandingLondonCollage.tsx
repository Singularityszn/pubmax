// Founder photographs of London in a mosaic below the hero (captain 26 Sep 2026).
// Lazy-loaded, no preload: the hero owns LCP; this section is always below the fold.

import {
  LONDON_COLLAGE_CREDIT,
  LONDON_COLLAGE_PHOTOS,
  LONDON_COLLAGE_WIDTHS,
  londonCollageSrc,
  londonCollageSrcSet,
  type LondonCollagePhoto,
} from "@/lib/landingLondonCollage";

import "./landingLondonCollage.css";

const WIDEST = LONDON_COLLAGE_WIDTHS[LONDON_COLLAGE_WIDTHS.length - 1];

/** Phone strip tile width, tablet hero span, then the widest desktop span (2 of 5 columns). */
const COLLAGE_SIZES =
  "(max-width: 699px) min(72vw, 280px), (max-width: 959px) 100vw, min(40vw, 500px)";

function CollageTile({ photo }: { photo: LondonCollagePhoto }) {
  return (
    <li
      className={`lpCollageTile lpCollageTile--${photo.layout}`}
      data-collage-id={photo.id}
    >
      <figure className="lpCollageTile__figure">
        <div className="lpCollageTile__frame">
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
        </div>
        <figcaption className="lpCollageTile__caption">{photo.caption}</figcaption>
      </figure>
    </li>
  );
}

export default function LandingLondonCollage() {
  return (
    <section className="lpCollage" aria-labelledby="lpCollageHeading">
      <div className="lpCollageInner">
        <header className="lpCollageHead">
          <p className="lpCollageKicker">London</p>
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
            <CollageTile key={photo.id} photo={photo} />
          ))}
        </ul>

        <p className="lpCollageCredit">{LONDON_COLLAGE_CREDIT}</p>
      </div>
    </section>
  );
}
