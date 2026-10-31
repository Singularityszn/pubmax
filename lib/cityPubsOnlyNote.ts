// A CITY MAP OUTSIDE LONDON SAYS WHAT IT IS (launch review, 30 Oct 2026, item
// 13). Twelve city packs are enabled and every one outside London has no
// priced pin, so a reader opened /map/manchester, saw grey pubs and nothing
// saying why. /places said "London only, for now" and the city maps said
// nothing. This is the one line a city map prints, and the one rule for when.
//
// The rule reads the city's own capability profile (lib/cityCapabilities.ts),
// never a city id list, so the line leaves a city the day its prices arrive.

import type { Route } from "next";

import { getCityCapabilityProfile } from "@/lib/cityCapabilities";
import { PLACES_PATH } from "@/lib/cityPickerRoute";

export type CityPubsOnlyNote = {
  text: string;
  linkLabel: string;
  href: Route;
};

export const CITY_PUBS_ONLY_NOTE: CityPubsOnlyNote = {
  text: "Pubs only here, no prices yet.",
  linkLabel: "Tell us your city.",
  href: PLACES_PATH as Route,
};

/** The line a city map prints, or null when the city has listed prices. */
export function cityPubsOnlyNoteFor(cityId: string | null | undefined): CityPubsOnlyNote | null {
  return getCityCapabilityProfile(cityId).prices.availability === "available"
    ? null
    : CITY_PUBS_ONLY_NOTE;
}
