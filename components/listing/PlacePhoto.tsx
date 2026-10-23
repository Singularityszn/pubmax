// One photograph on a listing page, with its credit under it (taste plan,
// 18 Oct 2026). The data is components/listing/placePhotoRules.ts, which decides
// whether a photograph may stand here at all.
//
// It paints the way the landing photographs do (components/landing/
// LandingPhoto.tsx): a plain <picture> over files already encoded at two
// widths and two formats, and the photograph's own inline preview as the
// image's background, so the frame carries a picture from the first paint
// and is never an empty box. The frame holds its aspect ratio before a byte
// arrives, so nothing under it moves. No state and no effect: it renders the
// same on the server and in a client page.
//
// The credit is part of the component, never the caller's option. It reads as
// the landing's does: the place (when the photograph is not of the thing the
// page already names), then the photographer and the licence.

import type { ReactNode } from "react";

import type { PlacePhoto as PlacePhotoData } from "./placePhotoRules";

import "./placePhoto.css";

function PlacePhotoCredit({ photo }: { photo: PlacePhotoData }) {
  const { credit } = photo;
  if (credit.kind === "founder") {
    return (
      <p className="placePhotoCredit">
        {photo.namesPlace ? `${photo.place}. ` : null}Photo: the PUBMAXX founder
      </p>
    );
  }
  return (
    <p className="placePhotoCredit">
      {photo.namesPlace ? (
        <>
          <a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer">
            {photo.place}
          </a>
          {". "}
        </>
      ) : null}
      {"Photo: "}
      {photo.namesPlace ? (
        credit.author
      ) : (
        <a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer">
          {credit.author}
        </a>
      )}
      {", "}
      <a href={credit.licenceUrl} target="_blank" rel="noopener noreferrer">
        {credit.licence}
      </a>
    </p>
  );
}

export default function PlacePhoto({
  photo,
  sizes,
  caption,
  className = "",
}: {
  photo: PlacePhotoData;
  /** The width the photograph really paints at, so the browser picks a file. */
  sizes: string;
  /**
   * Words above the credit, such as the pub the photograph shows. The frame is
   * 16:9 unless the caller's class sets another `aspect-ratio` on
   * `.placePhoto__frame`; the photograph covers it either way.
   */
  caption?: ReactNode;
  className?: string;
}) {
  return (
    <figure
      className={`placePhoto ${className}`.trim()}
      data-photo-scope={photo.scope}
      data-photo-key={photo.key}
    >
      <div className="placePhoto__frame">
        <picture>
          <source type="image/avif" srcSet={photo.srcSetAvif} sizes={sizes} />
          <source type="image/webp" srcSet={photo.srcSetWebp} sizes={sizes} />
          <img
            className="placePhoto__img"
            src={photo.src}
            width={photo.width}
            height={photo.height}
            alt={photo.alt}
            loading="lazy"
            decoding="async"
            sizes={sizes}
            style={{ backgroundImage: `url(${photo.blurDataUrl})` }}
          />
        </picture>
      </div>
      <figcaption className="placePhoto__caption">
        {caption}
        <PlacePhotoCredit photo={photo} />
      </figcaption>
    </figure>
  );
}
