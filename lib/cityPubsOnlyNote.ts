// City maps with limited price coverage show a note beside the city picker.

import type { Route } from "next";

import { getCityCapabilityProfile } from "@/lib/cityCapabilities";
import { PLACES_PATH } from "@/lib/cityPickerRoute";

export type CityPubsOnlyNote = {
  text: string;
  linkLabel: string;
  href: Route;
};

export const CITY_PUBS_ONLY_NOTE: CityPubsOnlyNote = {
  text: "Few prices here yet.",
  linkLabel: "Tell us your city.",
  href: PLACES_PATH as Route,
};

/** The line a city map prints, or null when price coverage is available. */
export function cityPubsOnlyNoteFor(cityId: string | null | undefined): CityPubsOnlyNote | null {
  return getCityCapabilityProfile(cityId).prices.availability === "available"
    ? null
    : CITY_PUBS_ONLY_NOTE;
}
