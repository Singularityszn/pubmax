// One photograph of London, rendered the same way on every landing.
//
// A plain <picture> rather than next/image, for two reasons a landing feels:
// the files are already encoded at the two widths and both formats
// (scripts/landing/build-landing-photos.mjs), so the optimizer would re-encode
// an optimal file and add a /_next/image request to the LCP path; and the
// landing document is prerendered and CDN-held, so the fewer moving parts in
// front of the first paint the better.
//
// The placeholder is inline base64 in the element's own style, so it paints
// with the HTML and the card never opens as a hole. The credit is part of the
// component rather than the caller's problem: a CC BY photograph without its
// photographer's name beside it is one we had no right to publish.

import { lastOf } from "@/lib/tuple";
import {
  landingPhotoAlt,
  landingPhotoCreditNamesPlace,
  landingPhotoSrc,
  landingPhotoSrcSet,
  LANDING_PHOTO_WIDTHS,
  type ResolvedLandingPhoto,
} from "@/lib/landingImagery";

import "./landingPhoto.css";

const WIDEST = lastOf(LANDING_PHOTO_WIDTHS);

export default function LandingPhoto({
  resolved,
  sizes,
  priority = false,
  preloadMedia,
  variant = "card",
  className = "",
}: {
  resolved: ResolvedLandingPhoto;
  /** What width the photograph really paints at, so the browser picks a file. */
  sizes: string;
  /** True on the ONE image that is the route's own largest paint, never more. */
  priority?: boolean;
  /**
   * The viewports on which this photograph, not another image, is the largest
   * paint. A high-priority preload fires only where the query matches, so
   * other viewports keep the image lazy and fetch it after their own LCP.
   */
  preloadMedia?: string;
  /** `card` fills its parent behind content; `band` is a framed picture. */
  variant?: "card" | "band";
  className?: string;
}) {
  const { photo } = resolved;
  return (
    <div
      className={`landingPhoto landingPhoto--${variant} ${className}`.trim()}
      data-photo-scope={resolved.scope}
    >
      {preloadMedia ? (
        <link
          rel="preload"
          as="image"
          type="image/avif"
          media={preloadMedia}
          imageSrcSet={landingPhotoSrcSet(photo, "avif")}
          imageSizes={sizes}
          fetchPriority="high"
        />
      ) : null}
      <picture>
        <source type="image/avif" srcSet={landingPhotoSrcSet(photo, "avif")} sizes={sizes} />
        <source type="image/webp" srcSet={landingPhotoSrcSet(photo, "webp")} sizes={sizes} />
        <img
          className="landingPhoto__img"
          src={landingPhotoSrc(photo, WIDEST, "webp")}
          width={photo.width}
          height={photo.height}
          alt={landingPhotoAlt(resolved)}
          decoding={priority ? "sync" : "async"}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          sizes={sizes}
          style={{ backgroundImage: `url(${photo.blurDataUrl})` }}
        />
      </picture>
      <span className="landingPhoto__scrim" aria-hidden="true" />
      {variant === "band" ? <LandingPhotoCredit resolved={resolved} /> : null}
    </div>
  );
}

/**
 * Who took the photograph and under what licence. A CC BY picture without its
 * photographer's name beside it is one we had no right to publish, so this is
 * part of the lane rather than a caller's option.
 *
 * A `band` carries it over its own scrim. A CARD renders it IN FLOW as its
 * last line instead: the card's content is the whole of its box, so an
 * overlaid credit would sit on the line above it, and reserving room by
 * guessing at how many lines the credit wraps to is a guess that is wrong at
 * some width. The place is named only when the photograph is NOT of the thing
 * the surface already names, which is the whole honesty of the fallback.
 */
export function LandingPhotoCredit({
  resolved,
  className = "",
}: {
  resolved: ResolvedLandingPhoto;
  className?: string;
}) {
  const { photo } = resolved;
  return (
    <p className={`landingPhotoCredit ${className}`.trim()}>
      {landingPhotoCreditNamesPlace(resolved.scope) ? (
        <>
          <a href={photo.credit.sourceUrl} target="_blank" rel="noopener noreferrer">
            {photo.place}
          </a>
          {". "}
        </>
      ) : null}
      {"Photo: "}
      {landingPhotoCreditNamesPlace(resolved.scope) ? (
        photo.credit.author
      ) : (
        <a href={photo.credit.sourceUrl} target="_blank" rel="noopener noreferrer">
          {photo.credit.author}
        </a>
      )}
      {", "}
      <a href={photo.credit.licenceUrl} target="_blank" rel="noopener noreferrer">
        {photo.credit.licence}
      </a>
    </p>
  );
}
