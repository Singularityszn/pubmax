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
  /**
   * Marker pictogram key (lib/mapIcons ns "lm"). The canvas draws a recognisable
   * chunky silhouette for this landmark instead of a generic glyph. Kept a bare
   * string so this data module stays decoupled from the icon-drawing library.
   */
  icon: string;
  /**
   * A real, freely-licensed photo shown at the top of the landmark history card.
   * Wikimedia Commons Special:FilePath URLs — a stable redirect that always
   * resolves to the current file, so the link never rots to a dead thumbnail.
   */
  image?: { url: string; credit: string };
};

// Every landmark photo is a Wikimedia Commons image reached through the
// Special:FilePath redirect (…/Special:FilePath/<File>?width=800). We keep them
// here rather than downloading into the bundle so the app stays lean; the
// landmark card credits Wikimedia Commons under each shot.
const commons = (file: string): { url: string; credit: string } => ({
  url: `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=800`,
  credit: "Wikimedia Commons",
});

export const landmarks: Landmark[] = [
  {
    id: "big-ben",
    name: "Big Ben",
    coordinates: [-0.1246, 51.5007],
    icon: "clock-tower",
    image: commons("Elizabeth_Tower%2C_June_2022.jpg"),
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
    icon: "civic",
    image: commons("Westminster_Abbey%2C_Westminster.jpg"),
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
    icon: "column",
    image: commons("Nelson%27s_Column%2C_Trafalgar_Square%2C_London.JPG"),
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
    icon: "civic",
    image: commons("British_Museum_%28aerial%29.jpg"),
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
    icon: "civic",
    image: commons("Restaurante_The_Swan%2C_Londres%2C_Inglaterra%2C_2014-08-11%2C_DD_113.jpg"),
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
    icon: "civic",
    image: commons("Barbican_Lakeside_on_a_summer_evening.jpg"),
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
    icon: "canal",
    image: commons("Camden_Lock_London.jpg"),
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
    icon: "dome",
    image: commons("Royal_Albert_Hall%2C_London_-_Nov_2012.jpg"),
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
    icon: "civic",
    image: commons("Natural_History_Museum_London_Jan_2006.jpg"),
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
    icon: "chimneys",
    image: commons("Battersea_Power_Station_from_the_river.jpg"),
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
    icon: "twin-towers",
    image: commons("Tower_Bridge_at_Dawn.jpg"),
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
    icon: "dome",
    image: commons("St_Pauls_aerial_%28cropped%29.jpg"),
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
    icon: "keep",
    image: commons("Tower_of_London_from_the_Shard_%288515883950%29.jpg"),
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
    icon: "ship",
    image: commons("Northeast_View_of_the_Cutty_Sark_in_Greenwich.jpg"),
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
    icon: "market",
    image: commons("London_2018_March_IMG_0663.jpg"),
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
    icon: "column",
    image: commons("The_Monument_to_the_Great_Fire_of_London.JPG"),
    history:
      "The Monument to the Great Fire of London is a 61-metre Doric column by Christopher Wren and Robert Hooke, completed in 1677. Its height equals the distance to the Pudding Lane bakery where the 1666 fire began.",
    source: {
      label: "City of London",
      url: "https://www.cityoflondon.gov.uk/things-to-do/attractions-museums-entertainment/the-monument",
    },
  },
  {
    id: "the-shard",
    name: "The Shard",
    coordinates: [-0.0865, 51.5045],
    icon: "shard",
    image: commons("The_Shard_at_sunset_2017_%28cropped%29.jpg"),
    history:
      "The Shard is western Europe's tallest building, a 310-metre spire of angled glass designed by Renzo Piano and completed in 2012. It rises straight out of London Bridge station on the site of the former Southwark Towers, its tapering facets meant to echo the masts of ships that once crowded the Thames.",
    source: {
      label: "Wikipedia",
      url: "https://en.wikipedia.org/wiki/The_Shard",
    },
  },
  {
    id: "london-eye",
    name: "London Eye",
    coordinates: [-0.1195, 51.5033],
    icon: "wheel",
    image: commons("London-Eye-2009.JPG"),
    history:
      "The London Eye is a 135-metre cantilevered observation wheel on the South Bank, opened for the millennium in 2000. Briefly the tallest of its kind in the world, its slow half-hour turn over the Thames quickly became one of the most recognisable additions to the London skyline.",
    source: {
      label: "Wikipedia",
      url: "https://en.wikipedia.org/wiki/London_Eye",
    },
  },
  {
    id: "gherkin",
    name: "30 St Mary Axe (The Gherkin)",
    coordinates: [-0.0803, 51.5145],
    icon: "gherkin",
    image: commons("30_St_Mary_Axe%2C_%27Gherkin%27.JPG"),
    history:
      "30 St Mary Axe, known to everyone as the Gherkin, is Norman Foster's 180-metre glass tower in the City, completed in 2004 on the site of the bomb-damaged Baltic Exchange. Its curved diagrid frame and rounded profile made it an instant landmark of the modern Square Mile.",
    source: {
      label: "Wikipedia",
      url: "https://en.wikipedia.org/wiki/30_St_Mary_Axe",
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
