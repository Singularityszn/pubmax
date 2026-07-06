import type { CrawlStyle } from "@/lib/venues";

// Named "generational" curated crawls — hand-picked routes through pubs that
// genuinely cluster in a themed patch of London, so an older drinker's pub
// knowledge becomes a walkable, shareable route for the next generation.
//
// venueId values are the content-hashed stable ids for the real dataset rows
// (stableVenueIdFromKey(venueGroupingKey(row)), see lib/venues.ts). They are
// pinned against public/data/pint_prices_app_dataset.json by
// __tests__/curatedCrawls.test.ts, which recomputes each id from the dataset —
// so a re-export that moves a venue is caught instead of silently 404-ing.

export type CuratedCrawl = {
  id: string;
  name: string;
  blurb: string;
  crawlStyle: CrawlStyle;
  venueIds: string[];
  /**
   * Optional landmark id (lib/landmarks) the crawl starts at — the crawls page
   * shows a "starts at Big Ben"-style origin chip when set (story 27). Left
   * undefined for a crawl with no obvious single landmark start.
   */
  startLandmarkId?: string;
};

export const curatedCrawls: CuratedCrawl[] = [
  {
    id: "victorian-soho",
    name: "Victorian Soho",
    blurb:
      "Five Dean Street–era snugs the old Soho hands drank in — pass the round on to whoever's next.",
    crawlStyle: "heritage",
    // Tight cluster around Dean St / Greek St, W1D — every leg under 200m.
    venueIds: [
      "venue-1ufn31x", // The Nellie Dean — 89 Dean St
      "venue-1t8siin", // The Crown & Two Chairmen — 31-32 Dean St
      "venue-xiesdn", // The Dog & Duck — 18 Bateman St
      "venue-phqazo", // The Coach & Horses — 29 Greek St
      "venue-15i2wst", // Golden Lion (Soho) — 51 Dean Street
    ],
    startLandmarkId: "piccadilly-circus",
  },
  {
    id: "fleet-street-writers",
    name: "Fleet Street & the Writers",
    blurb:
      "The old press strip, Strand to Fleet Street — where a generation of hacks filed copy, then drank it back.",
    crawlStyle: "writerTrail",
    // Walkable west→east along the Strand and Fleet St, WC2/EC4.
    venueIds: [
      "venue-dbukrn", // The Coal Hole — 91-92 Strand
      "venue-q9lryg", // The Lyceum Tavern — 354 Strand
      "venue-11n82fd", // The Seven Stars — 53 Carey St
      "venue-lrlyh8", // The Old Bank of England — 194 Fleet St
      "venue-1sx1vco", // Ye Olde Cock Tavern — 22 Fleet Street
      "venue-1r447i7", // The Tipperary — 66 Fleet St
    ],
    startLandmarkId: "somerset-house",
  },
  {
    id: "bloomsbury-literary",
    name: "Bloomsbury Literary",
    blurb:
      "From the Museum Tavern down Lamb's Conduit Street — the reading-room-and-a-pint round handed down since the British Museum days.",
    crawlStyle: "writerTrail",
    // British Museum → Lamb's Conduit St spine, WC1.
    venueIds: [
      "venue-fr71bp", // Museum Tavern — 49 Great Russell Street
      "venue-1yd70c7", // The Lamb — 94 Lamb's Conduit St
      "venue-erabed", // The Perseverance — 63 Lamb's Conduit St
      "venue-1kbl05l", // The Rugby Tavern — 19 Great James St
      "venue-12ino21", // The Dolphin Tavern — 44 Red Lion St
    ],
    startLandmarkId: "british-museum",
  },
  {
    id: "riverside-heritage",
    name: "Riverside Heritage",
    blurb:
      "St Katharine Docks east to Limehouse — the Thames-side taverns watermen and their grandkids still drink in at the turn of the tide.",
    crawlStyle: "heritage",
    // Along the river west→east, Wapping to Limehouse — a proper riverside walk.
    venueIds: [
      "venue-xvusrx", // The Dickens Inn — St Katharine's Way
      "venue-1d8a5xb", // The Captain Kidd — 108 Wapping High St
      "venue-16pnwmm", // Prospect of Whitby — 57 Wapping Wall
      "venue-ekvkuv", // The Grapes — 76 Narrow St, Limehouse
    ],
    startLandmarkId: "tower-bridge",
  },
  {
    id: "pint-park-view",
    name: "A pint, a park, a view",
    blurb:
      "A City-fringe loop past Leadenhall Market that climbs to a free rooftop garden with one of London's best skyline views — a pint at each end of the climb.",
    crawlStyle: "beerGarden",
    // Bishopsgate/Cornhill cluster, EC2/EC3 — every leg under 550m, all inside
    // the 22 Bishopsgate viewpoint's "on the way" radius via lib/routeLegs.
    venueIds: [
      "venue-bdasst", // Kings Arms (beer garden) — 27-28 Wormwood Street
      "venue-25y8c7", // The Counting House — 50 Cornhill
      "venue-zottpx", // The Crosse Keys — 9 Gracechurch Street
      "venue-6r6xa3", // The Lord Aberconway — 72 Old Broad Street
      "venue-1mr5its", // Railway (beer garden) — 15 Liverpool Street
    ],
    startLandmarkId: "leadenhall-market",
  },
  {
    id: "borough-market-crawl",
    name: "Borough Market crawl",
    blurb:
      "A tight loop through the stalls and railway arches of Borough Market — London's oldest food market, trading since at least the 13th century, threaded between five pubs.",
    crawlStyle: "balanced",
    // Southwark St / Borough High St, SE1 — every leg under 250m.
    venueIds: [
      "venue-133uf6h", // Katzenjammers — The Hop Exchange, 24 Southwark St
      "venue-fpmfjs", // The Rake — 14A Winchester Walk
      "venue-1gs68ga", // The George — 75-77 Borough High Street
      "venue-1ywc2og", // The Old King's Head — King's Head Yard
      "venue-2e3otf", // The Barrowboy & Banker — 6-8 Borough High St
    ],
    startLandmarkId: "borough-market",
  },
  {
    id: "bankside-riverside",
    name: "Bankside riverside walk",
    blurb:
      "Straight along the Thames path from Clink Street to the South Bank — the old wharves and a working riverside pub, with Tate Modern and the river the whole way.",
    crawlStyle: "heritage",
    // Along the river, Bankside/Southwark, SE1 — every leg under 550m.
    venueIds: [
      "venue-1x50b6d", // The Old Thameside Inn — Pickfords Wharf, Clink St
      "venue-1bb3t97", // The Mudlark — Montague Close
      "venue-gv8lwa", // Anchor — 34 Park Street
      "venue-1pvqxca", // Lord Clyde — 27 Clennam Street
    ],
    startLandmarkId: "tate-modern",
  },
  {
    id: "camden-market-crawl",
    name: "Camden Market crawl",
    blurb:
      "From the lock down Camden High Street — market stalls, canal views, and the pubs that have watched Camden's music scene since punk.",
    crawlStyle: "sports",
    // Camden Lock down Camden High St, NW1 — every leg under 400m.
    venueIds: [
      "venue-17u2i1w", // The Ice Wharf (JD Wetherspoon) — 28A Jamestown Rd
      "venue-t20n94", // The Oxford Arms — 265 Camden High St
      "venue-11wwbzz", // The Elephants Head — 224 Camden High St
      "venue-1d1tez", // The Dublin Castle — 94 Parkway
    ],
    startLandmarkId: "camden-lock",
  },
];
