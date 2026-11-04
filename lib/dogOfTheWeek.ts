// Dog of the week (launch review F7): the newest approved Dog photo off the
// photo wall, with the pub it was met at. Pure: the read is
// lib/dogOfTheWeek.server.ts, the page is app/dog-of-the-week.
//
// A dog photo always names its pub (lib/drinkWall.ts refuses one without),
// so a row with no pub, or a pub the index no longer names, is passed over
// rather than printed without a place. The uploader's handle is shown because
// the photo wall shows it on every tile.

import type { Route } from "next";

import type { DrinkWallPhotoDTO } from "@/lib/drinkWall";

export const DOG_OF_THE_WEEK_PATH = "/dog-of-the-week" as const;

export const DOG_OF_THE_WEEK_TITLE = "Dog of the week";

/** The page's empty state. Discover prints nothing in the same case. */
export const DOG_OF_THE_WEEK_EMPTY_LINE =
  "No dog yet. Upload one from a pub's photo wall.";

/** The page when the wall could not be read, which is not the same as no dog. */
export const DOG_OF_THE_WEEK_UNREAD_LINE =
  "We could not read the photo wall just now. Try again in a moment.";

export type DogOfTheWeek = {
  photoId: string;
  url: string;
  width: number;
  height: number;
  caption: string;
  createdAt: string;
  venueId: string;
  venueName: string;
  handle: string;
};

export type DogOfTheWeekRead =
  | { status: "ready"; dog: DogOfTheWeek | null }
  | { status: "unavailable" };

/** The newest approved Dog photo that names a pub, from a newest-first wall page. */
export function pickDogOfTheWeek(photos: readonly DrinkWallPhotoDTO[]): DogOfTheWeek | null {
  for (const photo of photos) {
    if (photo.wallCategory !== "dog") continue;
    if (!photo.venueId || !photo.venueName) continue;
    return {
      photoId: photo.id,
      url: photo.url,
      width: photo.width,
      height: photo.height,
      caption: photo.caption,
      createdAt: photo.createdAt,
      venueId: photo.venueId,
      venueName: photo.venueName,
      handle: photo.author.handle,
    };
  }
  return null;
}

/** The pub's own page. */
export function dogOfTheWeekPubHref(dog: Pick<DogOfTheWeek, "venueId">): Route {
  return `/pubs/${encodeURIComponent(dog.venueId)}` as Route;
}

/** What a screen reader hears for the photo. */
export function dogOfTheWeekAlt(dog: Pick<DogOfTheWeek, "caption" | "venueName">): string {
  return dog.caption
    ? `A dog at ${dog.venueName}: ${dog.caption}`
    : `A dog at ${dog.venueName}`;
}

/** The line under the photo. */
export function dogOfTheWeekMetLine(dog: Pick<DogOfTheWeek, "venueName">): string {
  return `Met at ${dog.venueName}`;
}
