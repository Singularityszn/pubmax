// London landmarks for the map's history layer. Static, curated, sourced —
// rendered as a brass symbol layer in PubMapCanvas, tapped for a history card.

import type { Venue } from "@/lib/venues";

export type Landmark = {
  id: string;
  name: string;
  /** [lng, lat] */
  coordinates: [number, number];
  /** 2-3 short sourced sentences. */
  history: string;
  source: { label: string; url: string };
};

export const landmarks: Landmark[] = [
  {
    id: "big-ben",
    name: "Big Ben",
    coordinates: [-0.1246, 51.5007],
    history:
      "Big Ben is the nickname of the Great Bell inside the clock tower of the Palace of Westminster, first rung in 1859. The tower itself was renamed the Elizabeth Tower in 2012 to mark Queen Elizabeth II's Diamond Jubilee.",
    source: {
      label: "UK Parliament",
      url: "https://www.parliament.uk/bigben",
    },
  },
  {
    id: "tower-bridge",
    name: "Tower Bridge",
    coordinates: [-0.0754, 51.5055],
    history:
      "Tower Bridge opened in 1894 after eight years of construction, designed by City Architect Horace Jones with engineer John Wolfe Barry. Its twin bascules still lift to let river traffic through, as they have for over a century.",
    source: {
      label: "Tower Bridge Trust",
      url: "https://www.towerbridge.org.uk/discover/history",
    },
  },
  {
    id: "st-pauls",
    name: "St Paul's Cathedral",
    coordinates: [-0.0984, 51.5138],
    history:
      "The present St Paul's is Sir Christopher Wren's masterpiece, completed in 1710 after the Great Fire of London destroyed the medieval cathedral in 1666. Its dome dominated the London skyline for two and a half centuries.",
    source: {
      label: "St Paul's Cathedral",
      url: "https://www.stpauls.co.uk/history",
    },
  },
  {
    id: "tower-of-london",
    name: "Tower of London",
    coordinates: [-0.0759, 51.5081],
    history:
      "Founded by William the Conqueror after 1066, the Tower's White Tower was raised as a statement of Norman power over the conquered city. Across nine centuries it has served as fortress, royal palace, prison, and home of the Crown Jewels.",
    source: {
      label: "Historic Royal Palaces",
      url: "https://www.hrp.org.uk/tower-of-london/history-and-stories/",
    },
  },
  {
    id: "greenwich",
    name: "Greenwich",
    coordinates: [-0.0096, 51.4823],
    history:
      "Maritime Greenwich pairs the Cutty Sark, the record-breaking tea clipper launched in 1869, with the Royal Observatory founded by Charles II in 1675. The Observatory has marked the Prime Meridian of the world since 1884.",
    source: {
      label: "Royal Museums Greenwich",
      url: "https://www.rmg.co.uk/",
    },
  },
  {
    id: "borough-market",
    name: "Borough Market",
    coordinates: [-0.091, 51.5054],
    history:
      "Borough Market traces its trading history back around 1,000 years, to a market at the southern end of London Bridge. It has stood on its present site beside Southwark Cathedral since 1756 and remains London's oldest food market.",
    source: {
      label: "Borough Market",
      url: "https://boroughmarket.org.uk/about-us/",
    },
  },
  {
    id: "monument",
    name: "The Monument",
    coordinates: [-0.0859, 51.5101],
    history:
      "The Monument to the Great Fire of London is a 61-metre Doric column by Christopher Wren and Robert Hooke, completed in 1677. Its height equals the distance to the Pudding Lane bakery where the 1666 fire began.",
    source: {
      label: "City of London",
      url: "https://www.cityoflondon.gov.uk/things-to-do/attractions-museums-entertainment/the-monument",
    },
  },
];

// Wires the landmark layer into the heritage layer (PRD target #6): tapping a
// landmark surfaces the nearest story pubs, not just a standalone history card.
// Distances are straight-line (haversine) per the PRD's out-of-scope rules —
// no routing — and the UI labels them as such.
export type NearbyStoryPub = { venue: Venue; km: number };

function straightLineKm([lng, lat]: [number, number], venue: Venue): number {
  const earthRadiusKm = 6371;
  const dLat = ((venue.latitude - lat) * Math.PI) / 180;
  const dLng = ((venue.longitude - lng) * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lat2 = (venue.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function nearestStoryPubs(
  landmark: Landmark,
  venues: Venue[],
  limit = 3,
): NearbyStoryPub[] {
  return venues
    .filter((venue) => venue.hasStory)
    .map((venue) => ({ venue, km: straightLineKm(landmark.coordinates, venue) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}
