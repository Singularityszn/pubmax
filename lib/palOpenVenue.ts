import type { Route } from "next";
import {
  DEFAULT_CITY_ID,
  enabledCityContainingPoint,
  type CityId,
} from "@/lib/cities";
import { cityAwareMapPath } from "@/lib/cityMapHref";
import { cityIdFromVenueId } from "@/lib/cityVenueIds";
import {
  MAP_SELECTION_NOTICE_PARAM,
  UNKNOWN_MAP_SELECTION_NOTE,
} from "@/lib/mapSelectionNotice";
import { parseUkPlaceMapArrival, ukPlaceMapUrl } from "@/lib/ukPlaceSearch";
import { venueMapUrl } from "@/lib/venueMapUrl";
import type { SlimVenue } from "@/lib/venuesSlim";

export { UNKNOWN_MAP_SELECTION_NOTE as PAL_UNMATCHED_VENUE_NOTICE };

export type PalVenueOpenTarget =
  | { kind: "open"; href: Route }
  | { kind: "fallback"; href: Route; notice: string };

/** Listed venue ids from the slim index — the one honest pre-check Pal can run client-side. */
export function palKnownVenueIds(slim: readonly SlimVenue[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const row of slim) {
    if (row.id) ids.add(row.id);
  }
  return ids;
}

/** Map browse link with no `?sel=` — the unmatched fallback lands here. */
function palMapBrowseHref(cityId: CityId | null = DEFAULT_CITY_ID): Route {
  return cityAwareMapPath(
    cityId ?? DEFAULT_CITY_ID,
    `${MAP_SELECTION_NOTICE_PARAM}=unknown`,
  );
}

/**
 * Where a Pal venue card should navigate. Reuses {@link venueMapUrl} for a
 * listed id. When the slim read has answered and the id is absent, Pal opens
 * the city map without `?sel=` and names the refusal locally before leaving.
 * When the slim read has not answered, trust the Pal card and let the map's
 * own `?sel=` honesty handle a bad id.
 */
export function resolvePalVenueOpenTarget(
  venueId: string,
  knownIds: ReadonlySet<string> | null,
): PalVenueOpenTarget {
  const trimmed = venueId.trim();
  if (!trimmed) {
    return {
      kind: "fallback",
      href: palMapBrowseHref(),
      notice: UNKNOWN_MAP_SELECTION_NOTE,
    };
  }

  if (knownIds && !knownIds.has(trimmed)) {
    return {
      kind: "fallback",
      href: palMapBrowseHref(cityIdFromVenueId(trimmed)),
      notice: UNKNOWN_MAP_SELECTION_NOTE,
    };
  }

  return { kind: "open", href: venueMapUrl(trimmed) };
}

/**
 * Where a confirmed Pal "Fly to" goes. The map reads `?lat=&lng=&place=` only
 * for a point OUTSIDE every curated city (`parseUkPlaceMapArrival`), so a fly
 * to a London pub built that way opened the map with nothing selected. A fly
 * that names a listed pub opens that pub, the same as its card. A point
 * outside the cities keeps the place arrival, and any other point opens the
 * city map it sits in.
 */
export function palFlyToHref(
  proposal: { lat: number; lng: number; place?: string; venueId?: string },
  knownIds: ReadonlySet<string> | null,
): Route {
  const venueId = proposal.venueId?.trim();
  if (venueId) return resolvePalVenueOpenTarget(venueId, knownIds).href;
  const arrival = parseUkPlaceMapArrival(
    new URLSearchParams({
      place: proposal.place ?? "",
      lat: String(proposal.lat),
      lng: String(proposal.lng),
    }),
  );
  if (arrival) return ukPlaceMapUrl(arrival);
  return cityAwareMapPath(
    enabledCityContainingPoint(proposal.lat, proposal.lng)?.id ?? DEFAULT_CITY_ID,
  );
}
