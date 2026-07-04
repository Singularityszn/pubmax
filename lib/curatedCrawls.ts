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
  },
];
