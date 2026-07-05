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
    id: "westminster-abbey",
    name: "Westminster Abbey",
    coordinates: [-0.1281, 51.4994],
    history:
      "Westminster Abbey was consecrated in 1065 under Edward the Confessor and rebuilt in the Gothic style begun by Henry III in 1245. Since the coronation of William the Conqueror in 1066 it has been the coronation church of England's, then Britain's, monarchs.",
    source: {
      label: "Westminster Abbey",
      url: "https://www.westminster-abbey.org/history/history-of-westminster-abbey",
    },
  },
  {
    id: "nelsons-column",
    name: "Nelson's Column",
    coordinates: [-0.1281, 51.5079],
    history:
      "Nelson's Column has stood at the centre of Trafalgar Square since 1843, commemorating Admiral Horatio Nelson, who was killed at the Battle of Trafalgar in 1805. Designed by William Railton, the granite Corinthian column rises about 52 metres and is topped by Edward Hodges Baily's statue of Nelson.",
    source: {
      label: "Britannica",
      url: "https://www.britannica.com/place/Nelsons-Column",
    },
  },
  {
    id: "british-museum",
    name: "British Museum",
    coordinates: [-0.127, 51.5194],
    history:
      "The British Museum was established by Act of Parliament in 1753 as the first national public museum in the world. Its landmark Greek Revival building on Great Russell Street, designed by Sir Robert Smirke, was built between 1823 and 1852.",
    source: {
      label: "British Museum",
      url: "https://www.britishmuseum.org/about-us/british-museum-story/history",
    },
  },
  {
    id: "shakespeares-globe",
    name: "Shakespeare's Globe",
    coordinates: [-0.0972, 51.5081],
    history:
      "This Bankside theatre is a reconstruction of the Elizabethan Globe, first built in 1599 for the company that staged Shakespeare's plays. Championed by the actor Sam Wanamaker, the modern Globe opened close to the original site in 1997.",
    source: {
      label: "Shakespeare's Globe",
      url: "https://www.shakespearesglobe.com/discover/about-us/globe-theatre/",
    },
  },
  {
    id: "barbican",
    name: "Barbican Centre",
    coordinates: [-0.0937, 51.52],
    history:
      "The Barbican is a landmark of post-war Brutalist architecture, designed by Chamberlin, Powell and Bon on land in the City of London flattened by wartime bombing. Its arts centre opened in 1982, and the surrounding estate was Grade II listed in 2001.",
    source: {
      label: "City of London",
      url: "https://www.cityoflondon.gov.uk/services/barbican-estate/barbican-estate-history",
    },
  },
  {
    id: "camden-lock",
    name: "Camden Lock",
    coordinates: [-0.1466, 51.5416],
    history:
      "Camden Lock sits beside the Hampstead Road Locks on the Regent's Canal, opened in 1820 to link London's docks to the national canal network. As canal trade faded, a crafts market started here in 1974 and grew into one of London's best-known markets.",
    source: {
      label: "Wikipedia",
      url: "https://en.wikipedia.org/wiki/Camden_Lock",
    },
  },
  {
    id: "royal-albert-hall",
    name: "Royal Albert Hall",
    coordinates: [-0.1774, 51.501],
    history:
      "The Royal Albert Hall was opened by Queen Victoria in 1871 as part of a memorial to her husband Prince Albert, whose vision it fulfilled in South Kensington. The Grade I listed concert hall has hosted the BBC Proms every summer since 1941.",
    source: {
      label: "Royal Albert Hall",
      url: "https://www.royalalberthall.com/about-the-hall/our-history/",
    },
  },
  {
    id: "natural-history-museum",
    name: "Natural History Museum",
    coordinates: [-0.1763, 51.4967],
    history:
      "The Natural History Museum on Cromwell Road opened in 1881 to house the national natural history collections. Alfred Waterhouse's cathedral-like building is clad in terracotta moulded with animals and plants, a Romanesque landmark of South Kensington.",
    source: {
      label: "Natural History Museum",
      url: "https://www.nhm.ac.uk/about-us/history-and-architecture.html",
    },
  },
  {
    id: "battersea-power-station",
    name: "Battersea Power Station",
    coordinates: [-0.1447, 51.4816],
    history:
      "Battersea Power Station's four white chimneys, on a building by Sir Giles Gilbert Scott, rose beside the Thames between 1929 and 1955. It generated electricity until 1983, was later listed Grade II*, and reopened as a mixed-use development in 2022.",
    source: {
      label: "Wikipedia",
      url: "https://en.wikipedia.org/wiki/Battersea_Power_Station",
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
