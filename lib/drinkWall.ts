// The city-wide Drink Wall: validation and reader copy on top of venuePhotos.

import type { Route } from "next";
import {
  cleanDrinkWallPlaceLabel,
  cleanVenuePhotoCaption,
  DRINK_WALL_CATEGORIES,
  DRINK_WALL_CATEGORY_LABEL,
  type DrinkWallCategory,
  isDrinkWallCategory,
  isVenuePhotoVenueId,
  parseVenuePhotoDrinkCategory,
  type VenuePhotoDTO,
  type VenuePhotoPage,
} from "@/lib/venuePhotos";
import type { DrinkCategory } from "@/lib/drinks";

export { DRINK_WALL_CATEGORIES, DRINK_WALL_CATEGORY_LABEL, type DrinkWallCategory };

/** Per account for rows linked to no pub (venue_id null). */
export const DRINK_WALL_CITY_CAP_PER_ACCOUNT = 100;

type DrinkWallSubmission = {
  wallCategory: DrinkWallCategory;
  venueId: string | null;
  placeLabel: string;
  drinkCategory: DrinkCategory | null;
  caption: string;
};

export type DrinkWallValidation =
  | { ok: true; value: DrinkWallSubmission }
  | { ok: false; error: string };

export function validateDrinkWallSubmission(input: unknown): DrinkWallValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Photo details are not valid." };
  }
  const raw = input as Record<string, unknown>;
  const wallCategory = raw.wallCategory;
  if (!isDrinkWallCategory(wallCategory)) {
    return { ok: false, error: "Choose a wall category." };
  }

  const venueRaw = raw.venueId;
  let venueId: string | null = null;
  if (venueRaw !== undefined && venueRaw !== null && venueRaw !== "") {
    if (!isVenuePhotoVenueId(venueRaw)) {
      return { ok: false, error: "Choose a valid pub." };
    }
    venueId = venueRaw;
  }

  const drinkCategory =
    wallCategory === "pint" ? parseVenuePhotoDrinkCategory(raw.drinkCategory) : null;
  if (wallCategory === "pint" && drinkCategory === undefined) {
    return { ok: false, error: "Choose a listed drink." };
  }

  return {
    ok: true,
    value: {
      wallCategory,
      venueId,
      placeLabel: cleanDrinkWallPlaceLabel(raw.placeLabel),
      drinkCategory: wallCategory === "pint" ? drinkCategory ?? null : null,
      caption: cleanVenuePhotoCaption(raw.caption),
    },
  };
}

export function drinkWallEmptyLine(degraded: boolean): string {
  return degraded
    ? "We could not read the wall just now. Try again in a moment."
    : "No photos on the wall yet. Share a pint, a pub or a London view.";
}

export function drinkWallAltText(photo: {
  wallCategory: DrinkWallCategory;
  author: { handle: string };
  drinkCategory: DrinkCategory | null;
  caption: string;
  placeLabel?: string | null;
  venueName?: string | null;
}): string {
  if (photo.caption) return `@${photo.author.handle}: ${photo.caption}`;
  const where =
    drinkWallPlaceLine({ venueName: photo.venueName ?? null, placeLabel: photo.placeLabel || null }) ??
    DRINK_WALL_CATEGORY_LABEL[photo.wallCategory];
  return `${where}, by @${photo.author.handle}`;
}

/** A Drink Wall tile: the wall DTO plus the linked pub's name, when it has one. */
export type DrinkWallPhotoDTO = VenuePhotoDTO & { venueName: string | null };

export type DrinkWallPage = Omit<VenuePhotoPage, "photos"> & { photos: DrinkWallPhotoDTO[] };

/** Where a tile was taken, as a sighted reader should see it: the pub first, then the author's place. */
export function drinkWallPlaceLine(photo: { venueName: string | null; placeLabel: string | null }): string | null {
  return photo.venueName ?? photo.placeLabel ?? null;
}

/** The author's delete removes the one row every wall reads, so the confirm names each wall it leaves. */
export function drinkWallRemoveConfirmLine(photo: { venueId: string | null }): string {
  return photo.venueId
    ? "Delete this photo for good? It comes off the Drink Wall and its pub wall."
    : "Delete this photo for good? It comes off the Drink Wall.";
}

export const DRINK_WALL_SIGN_IN_LINE =
  "Sign in and pick a handle to add a photo to the Drink Wall.";

export function drinkWallSignInHref(from?: string | null): Route {
  const back = from && from.startsWith("/") ? from : "/wall";
  return `/login?from=${encodeURIComponent(back)}`;
}

export function drinkWallCapLine(): string {
  return `You have all ${DRINK_WALL_CITY_CAP_PER_ACCOUNT} of your city wall photos. Remove one to add another.`;
}

export function drinkWallCaptionHint(category: DrinkWallCategory): string {
  if (category === "london") {
    return "Describe what we are looking at (skyline, street, landmark) for anyone who cannot see the photo.";
  }
  if (category === "pub") {
    return "Say whether this is inside or outside, or what caught your eye.";
  }
  return "Optional: name the drink or the moment.";
}
