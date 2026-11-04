import "server-only";

import { pickDogOfTheWeek, type DogOfTheWeekRead } from "@/lib/dogOfTheWeek";
import type { DrinkWallPhotoDTO } from "@/lib/drinkWall";
import { resolveVenue } from "@/lib/venueIndex";
import { venuePhotoStore } from "@/lib/venuePhotoStore";

/** A few rows, so one whose pub has left the index does not empty the page. */
const DOG_OF_THE_WEEK_SCAN = 5;

/**
 * The newest approved Dog photo, read the same way the photo wall reads it
 * (approved rows only, newest first), with its pub's name. A wall that could
 * not be read answers "unavailable", never "no dog".
 */
export async function loadDogOfTheWeek(): Promise<DogOfTheWeekRead> {
  try {
    const page = await venuePhotoStore().listDrinkWall({
      category: "dog",
      limit: DOG_OF_THE_WEEK_SCAN,
    });
    if (page.status !== "ready") return { status: "unavailable" };
    const photos: DrinkWallPhotoDTO[] = await Promise.all(
      page.photos.map(async (photo) => ({
        ...photo,
        venueName: photo.venueId
          ? ((await resolveVenue(photo.venueId).catch(() => null))?.name ?? null)
          : null,
      })),
    );
    return { status: "ready", dog: pickDogOfTheWeek(photos) };
  } catch {
    return { status: "unavailable" };
  }
}
