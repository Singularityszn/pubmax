import { CITIES } from "@/lib/cities";
import { cityIdFromVenueId, isNationalBaseVenueId } from "@/lib/cityVenueIds";
import type { ListedBuilding } from "@/lib/heritageListings";
import { venueAreaLabel } from "@/lib/venueDisplay";
import type { Venue } from "@/lib/venues";

const SITE_URL = "https://pubmaxxing.com";

// The region is the city the venue id names. A London id carries no city
// prefix, so the region stays London. A national base id names no city, so
// the region is omitted rather than labelled London.
function venueAddressRegion(venueId: string): string | undefined {
  const cityId = cityIdFromVenueId(venueId);
  if (cityId) return CITIES[cityId].displayName;
  if (isNationalBaseVenueId(venueId)) return undefined;
  return "London";
}

// Only pub and bar records receive BarOrPub structured data. An absent kind
// retains the legacy pub interpretation. The schema includes the name,
// coordinates, postal address, and canonical URL. No invented cuisine,
// price range, or rating. lat/lng and the street address are omitted when
// absent. The region is the city the id names. When the pub is on the official
// register (Historic England NHLE) we add a factual `description` + a
// heritage `additionalProperty` carrying the grade + list-entry citation, so
// AI/search engines see the listed-building status straight from the JSON-LD.
export function venueJsonLd(venue: Venue, listed: ListedBuilding | null) {
  const addressRegion = venueAddressRegion(venue.id);
  const hasGeo =
    typeof venue.latitude === "number" && typeof venue.longitude === "number";
  return {
    "@context": "https://schema.org",
    "@type": "BarOrPub",
    name: venue.name,
    url: `${SITE_URL}/pubs/${encodeURIComponent(venue.id)}`,
    ...(listed
      ? {
          description: listed.fact,
          additionalProperty: {
            "@type": "PropertyValue",
            name: "Listed building",
            value: `Grade ${listed.grade}`,
            url: listed.url,
          },
        }
      : {}),
    ...(venue.address || venue.locality || venue.primaryBorough
      ? {
          address: {
            "@type": "PostalAddress",
            ...(venue.address ? { streetAddress: venue.address } : {}),
            ...(venue.locality || venue.primaryBorough
              ? { addressLocality: venueAreaLabel(venue) }
              : {}),
            ...(addressRegion ? { addressRegion } : {}),
            addressCountry: "GB",
          },
        }
      : {}),
    ...(hasGeo
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: venue.latitude,
            longitude: venue.longitude,
          },
        }
      : {}),
  };
}
