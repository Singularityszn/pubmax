import "server-only";

import { getCity } from "@/lib/cities";
import { readAllDrinkPriceUpdates } from "@/lib/priceUpdates.server";
import { buildSocialAlternatives, type SocialAlternatives } from "@/lib/socialAlternatives";
import { ukPriceBundleRowsByVenue } from "@/lib/ukPriceBundle.server";
import { getUkNationalPubCatalog } from "@/lib/ukNationalPubSearch.server";
import { readCityVenueIndex } from "@/lib/venueIndex";
import { getPricedVenues } from "@/lib/venuePriceIndex";

/** Read bundled public menu data. This never reads a session or Social store. */
export async function loadSocialAlternatives(): Promise<SocialAlternatives> {
  const [venues, updates, bundle, london] = await Promise.all([
    getPricedVenues().catch(() => []), readAllDrinkPriceUpdates(), ukPriceBundleRowsByVenue(), readCityVenueIndex(getCity("london")),
  ]);
  const catalog = getUkNationalPubCatalog();
  if (!london || catalog.status !== "ready" || bundle.status === "unavailable" || venues.length === 0) {
    return buildSocialAlternatives([], null);
  }
  const identities: Parameters<typeof buildSocialAlternatives>[0][number][] = [...venues];
  const knownIds = new Set(venues.map((venue) => venue.id));
  for (const { venue } of london.values()) {
    if (knownIds.has(venue.id)) continue;
    identities.push({ ...venue, address: "", latitude: venue.lat, longitude: venue.lng, prices: [] });
    knownIds.add(venue.id);
  }
  for (const pub of catalog.pubs) {
    if (pub.closed || knownIds.has(pub.id) || !bundle.byVenue.has(pub.id)) continue;
    identities.push({ ...pub, kind: "pub", latitude: pub.lat, longitude: pub.lng, prices: [] });
  }
  return buildSocialAlternatives(identities, updates, Date.now(), [...bundle.byVenue.values()].flat());
}
