import { assignVenueToNightArea } from "@/lib/pricedLanding";
import type { Venue } from "@/lib/venues";
import type { WhatsOnRow } from "@/lib/whatsOn";

function areaVenue(row: WhatsOnRow): Venue {
  return {
    id: row.venueId ?? row.id,
    name: row.placeName,
    address: "",
    latitude: row.lat ?? Number.NaN,
    longitude: row.lng ?? Number.NaN,
    primaryBorough: "",
    visibleBoroughs: [],
    prices: [],
    cheapestPrice: null,
    cheapestPint: "",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
  } as unknown as Venue;
}

/** Serve-time night-area slug from the row's own point. Never invents a pub. */
export function fillEventArea(row: WhatsOnRow): WhatsOnRow {
  if (row.area) return row;
  if (row.lat === undefined || row.lng === undefined) return row;
  const assigned = assignVenueToNightArea(areaVenue(row));
  return assigned ? { ...row, area: assigned.slug } : row;
}
