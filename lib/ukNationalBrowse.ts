// UK national browse intent — the third map's entry, not a city pack.
// Below UK_BASE_MIN_ZOOM pubs are intentionally absent (payload contract);
// the banner must say so, never that the country has no pubs.

export const UK_NATIONAL_PARAM = "uk";
export const UK_NATIONAL_PARAM_VALUE = "1";

/** Quiet overview: whole UK framed; pubs appear from zoom 12. */
export const UK_NATIONAL_MAP_VIEW = {
  // Rough geographic centre of Great Britain (lng, lat).
  center: [-2.5, 54.2] as [number, number],
  zoom: 5.6,
  pitch: 0,
  bearing: 0,
};

export const UK_NATIONAL_MAP_HREF = `/map?${UK_NATIONAL_PARAM}=${UK_NATIONAL_PARAM_VALUE}`;

/**
 * Where a reader searches for a UK town by name.
 *
 * The chooser's own route is retired: /choose-city 308s to /places. TWO
 * surfaces now answer a town, and both read `public/data/uk_base/places.json`
 * through the same policy: the landing's #cities section, which is the one
 * remaining mount of CityChooser, and the picker itself, where
 * `placesTownResults` falls back to that index when no city row matches. This
 * link still points at the landing, whose search field IS the section it lands
 * on; whether it should move to the picker now that /places answers a town is
 * the author's call and sits with the captain. The field is not focused on
 * arrival either way; the anchor puts it on screen.
 */
export const UK_TOWN_SEARCH_HREF = "/#cities";

export const UK_NATIONAL_BROWSE_COPY = {
  title: "Pubs across the UK",
  body: "Zoom in to load pubs on the map. Priced city maps keep their packs; everywhere else starts unpriced until people log them.",
} as const;

export const UK_NATIONAL_ENTRY_LABEL = "Browse pubs across the UK";

export const UK_OUTSIDE_CITY_COPY = {
  title: "Outside the priced city map",
  body: "Pubs here are the base layer. Zoom in to load them. Prices only where people have logged them.",
} as const;

export function isUkNationalBrowse(search: string | URLSearchParams): boolean {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;
  return params.get(UK_NATIONAL_PARAM) === UK_NATIONAL_PARAM_VALUE;
}
