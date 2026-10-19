// Which photograph a listing page may show, and of what (taste plan, 18 Oct
// 2026: "/historic and /crawls show only text").
//
// A photograph comes from ONE of two sets the site already holds: the licensed
// landing photographs (lib/landingImagery.ts, each with its photographer and
// licence) and the founder's own photographs of London
// (lib/landingLondonCollage.ts). Nothing is fetched, generated or hotlinked.
//
// THREE honesty rules. Rule 2 answers for a borough, a Night Area and London
// alike, and a saved plan meets rules 2 and 3 together.
//
// (1) A PUB photograph is shown only for THAT pub, matched by venue id through
//     PUB_PHOTOS, never by a name (`pubPlacePhoto`).
// (2) A BOROUGH, AREA or LONDON photograph leads a page or a section ABOUT
//     that place, and its caption names the place it really shows
//     (`boroughPlacePhoto`, `areaPlacePhoto`, `londonPlacePhoto`).
// (3) A ROUTE is led by a photograph of the patch it walks through only when
//     EVERY stop sits within a short walk of where the photograph was taken
//     (`routePlacePhoto`). A route spread across London gets none, and a
//     photograph of one pub is never used for a route at all. A route that
//     already names its area takes only that area's photograph, on the same
//     walk (`areaRoutePlacePhoto`).
//
// The result is plain data, so a server page resolves it and hands it to a
// client component without shipping either photograph table to the browser.

import { haversineMeters } from "@/lib/greatCircle.mjs";
import {
  AREA_PHOTOS,
  BOROUGH_PHOTOS,
  LANDING_PHOTO_SPOTS,
  LONDON_PHOTO_ID,
  LANDING_PHOTOS,
  PUB_PHOTOS,
  landingPhotoCreditNamesPlace,
  landingPhotoSrc,
  landingPhotoSrcSet,
  type LandingPhoto,
  type LandingPhotoScope,
} from "@/lib/landingImagery";
import {
  LONDON_COLLAGE_PHOTOS,
  londonCollageSrc,
  londonCollageSrcSet,
  type LondonCollagePhoto,
} from "@/lib/landingLondonCollage";
import { slugifyBorough } from "@/lib/boroughs";

/** Half a mile as the crow flies, the same walk the landing collage prices. */
export const PLACE_PHOTO_WALK_METRES = 800;

/**
 * Founder photographs of ONE pub. They show a pub, not a patch, so no route
 * may borrow them (rule 3).
 */
const COLLAGE_PUB_PHOTO_IDS: ReadonlySet<string> = new Set(["crown-tavern"]);

type PlacePhotoCredit =
  | {
      kind: "licensed";
      author: string;
      licence: string;
      licenceUrl: string;
      sourceUrl: string;
    }
  | { kind: "founder" };

export type PlacePhoto = {
  /** Stable key, `landing:<id>` or `collage:<id>`. */
  key: string;
  /** What the photograph shows, printed in the caption. */
  place: string;
  alt: string;
  width: number;
  height: number;
  /** Inline preview painted from the first frame, so a frame is never empty. */
  blurDataUrl: string;
  srcSetAvif: string;
  srcSetWebp: string;
  /** The widest webp, for a browser that reads no srcset. */
  src: string;
  /** Whether the caption must name the place (anything but the pub itself). */
  namesPlace: boolean;
  scope: LandingPhotoScope;
  credit: PlacePhotoCredit;
};

function fromLanding(photo: LandingPhoto, scope: LandingPhotoScope): PlacePhoto {
  return {
    key: `landing:${photo.id}`,
    place: photo.place,
    alt: photo.alt,
    width: photo.width,
    height: photo.height,
    blurDataUrl: photo.blurDataUrl,
    srcSetAvif: landingPhotoSrcSet(photo, "avif"),
    srcSetWebp: landingPhotoSrcSet(photo, "webp"),
    src: landingPhotoSrc(photo, photo.width, "webp"),
    namesPlace: landingPhotoCreditNamesPlace(scope),
    scope,
    credit: { kind: "licensed", ...photo.credit },
  };
}

function fromCollage(photo: LondonCollagePhoto): PlacePhoto {
  return {
    key: `collage:${photo.id}`,
    place: photo.caption,
    alt: photo.alt,
    width: photo.width,
    height: photo.height,
    blurDataUrl: photo.blurDataUrl,
    srcSetAvif: londonCollageSrcSet(photo, "avif"),
    srcSetWebp: londonCollageSrcSet(photo, "webp"),
    src: londonCollageSrc(photo, 1280, "webp"),
    namesPlace: true,
    scope: "area",
    credit: { kind: "founder" },
  };
}

/** The photograph OF this pub, or none (rule 1). */
export function pubPlacePhoto(venueId: string | null | undefined): PlacePhoto | null {
  const id = venueId ? PUB_PHOTOS[venueId] : undefined;
  const photo = id ? LANDING_PHOTOS[id] : undefined;
  return photo ? fromLanding(photo, "pub") : null;
}

/** The photograph that stands for this borough, captioned with its place, or none (rule 2). */
export function boroughPlacePhoto(borough: string | null | undefined): PlacePhoto | null {
  const id = borough ? BOROUGH_PHOTOS[slugifyBorough(borough)] : undefined;
  const photo = id ? LANDING_PHOTOS[id] : undefined;
  return photo ? fromLanding(photo, "borough") : null;
}

/**
 * The photograph that stands for this Night Area (lib/nightAreas.ts slug),
 * captioned with its place, or none (rule 2). It leads a page or a section
 * ABOUT that area, never a row or a route.
 */
export function areaPlacePhoto(areaSlug: string | null | undefined): PlacePhoto | null {
  const id = areaSlug ? AREA_PHOTOS[areaSlug] : undefined;
  const photo = id ? LANDING_PHOTOS[id] : undefined;
  return photo ? fromLanding(photo, "area") : null;
}

/** The photograph that stands for London as a whole, captioned with its place (rule 2). */
export function londonPlacePhoto(): PlacePhoto | null {
  const photo = LANDING_PHOTOS[LONDON_PHOTO_ID];
  return photo ? fromLanding(photo, "london") : null;
}

type Point = { lat: number; lng: number };

/**
 * The photograph of a NAMED Night Area, for a route already said to be in it,
 * or none (rules 2 and 3 at once).
 *
 * A saved plan names its area in public and keeps its stops private, so its
 * lead may only be the photograph of the area it already names, and only when
 * every stop is a short walk from where that photograph was taken. A plan
 * whose stops stray, or an area whose photograph has no spot, gets none.
 */
export function areaRoutePlacePhoto(
  areaSlug: string | null | undefined,
  points: readonly Point[],
): PlacePhoto | null {
  const id = areaSlug ? AREA_PHOTOS[areaSlug] : undefined;
  const spot = id ? LANDING_PHOTO_SPOTS[id] : undefined;
  if (!id || !spot || points.length === 0) return null;
  const [lat, lng] = spot;
  for (const point of points) {
    if (haversineMeters(lat, lng, point.lat, point.lng) > PLACE_PHOTO_WALK_METRES) return null;
  }
  const photo = LANDING_PHOTOS[id];
  return photo ? fromLanding(photo, "area") : null;
}

type SpottedPhoto = { spot: readonly [number, number]; resolve: () => PlacePhoto };

function spottedPhotos(): SpottedPhoto[] {
  const spotted: SpottedPhoto[] = [];
  for (const [id, spot] of Object.entries(LANDING_PHOTO_SPOTS)) {
    const photo = LANDING_PHOTOS[id];
    if (photo) spotted.push({ spot, resolve: () => fromLanding(photo, "area") });
  }
  const seenSpots = new Set<string>();
  for (const photo of LONDON_COLLAGE_PHOTOS) {
    if (COLLAGE_PUB_PHOTO_IDS.has(photo.id)) continue;
    // Several founder photographs share one spot; the first of each is enough.
    const spotKey = photo.spot.join(",");
    if (seenSpots.has(spotKey)) continue;
    seenSpots.add(spotKey);
    spotted.push({ spot: photo.spot, resolve: () => fromCollage(photo) });
  }
  return spotted;
}

/**
 * The photograph of the patch a route walks through, or none (rule 3).
 *
 * Every stop must sit within PLACE_PHOTO_WALK_METRES of where the photograph
 * was taken. Of the photographs that qualify, the one nearest the route's
 * farthest stop wins, so the picture is of the patch the whole route is in.
 */
export function routePlacePhoto(points: readonly Point[]): PlacePhoto | null {
  if (points.length === 0) return null;
  let best: { reach: number; photo: SpottedPhoto } | null = null;
  for (const candidate of spottedPhotos()) {
    const [lat, lng] = candidate.spot;
    let reach = 0;
    for (const point of points) {
      reach = Math.max(reach, haversineMeters(lat, lng, point.lat, point.lng));
      if (reach > PLACE_PHOTO_WALK_METRES) break;
    }
    if (reach > PLACE_PHOTO_WALK_METRES) continue;
    if (!best || reach < best.reach) best = { reach, photo: candidate };
  }
  return best ? best.photo.resolve() : null;
}
