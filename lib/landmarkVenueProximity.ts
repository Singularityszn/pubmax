import { haversineKm } from "@/lib/haversine";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Landmark } from "@/lib/landmarks";
import type { Venue } from "@/lib/venues";

export type NearbyStoryPub = { venue: Venue; km: number };

/** The section head every story surface prints over its nearest story pubs. */
export const STORY_PUBS_NEARBY_HEADING = "Story pubs nearby";

/**
 * Said ONCE, in the section head, never on every row. A distance here is a
 * straight line between two points, not a walk, and a row that repeats the
 * caveat three times reads as three warnings where one sentence will do.
 */
export const STORY_PUBS_DISTANCE_CAVEAT = "As the crow flies. The walk is a bit longer.";

export function nearestStoryPubs(
  landmark: Landmark,
  venues: Venue[],
  limit = 3,
): NearbyStoryPub[] {
  return venues
    .filter((venue) => venue.hasStory && isPubVenue(venue))
    .map((venue) => ({
      venue,
      km: haversineKm(landmark.coordinates, [venue.longitude, venue.latitude]),
    }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}
