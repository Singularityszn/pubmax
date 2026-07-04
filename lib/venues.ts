import { getVenueCuration, type VenueCuration } from "@/lib/curation";

export type CrawlStyle =
  | "balanced"
  | "cheapest"
  | "heritage"
  | "writerTrail"
  | "beerGarden"
  | "sports"
  | "dateNight";

export type VenuePrice = {
  app_price_id: string;
  pub_name: string;
  pint_name: string;
  price_gbp: number | null;
  price_text: string;
  address: string;
  latitude: number;
  longitude: number;
  boroughs_visible: string;
  boroughs_raw_embedded_non_anomaly: string;
  boroughs_raw_embedded_site_anomaly: string;
  primary_borough: string;
  rank_visible_borough: string;
  estimated_average_price_text: string;
  pub_url: string;
  constructed_pub_url: string;
  borough_urls: string;
  phone_number: string;
  email: string;
  website: string;
  booking_link: string;
  image_url: string;
  description: string;
  comment: string;
  food: string;
  cocktails: string;
  beer_garden: string;
  live_sports: string;
  live_music: string;
  pub_quiz: string;
  darts: string;
  pool: string;
  happy_hour: string;
  karaoke: string;
  cool: string;
  source_datasets: string;
  source_row_count: number;
  has_visible_borough_row: boolean;
  has_raw_embedded_map_row: boolean;
  has_individual_pub_page_row: boolean;
  is_clean_canonical_app_row: boolean;
  data_quality_notes: string;
};

export type Venue = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  primaryBorough: string;
  visibleBoroughs: string[];
  prices: VenuePrice[];
  cheapestPrice: number | null;
  cheapestPint: string;
  averagePrice: number | null;
  amenities: {
    food: boolean;
    cocktails: boolean;
    beerGarden: boolean;
    liveSports: boolean;
    liveMusic: boolean;
    pubQuiz: boolean;
    darts: boolean;
    pool: boolean;
    happyHour: boolean;
    karaoke: boolean;
  };
  website: string;
  imageUrl: string;
  description: string;
  dataQualityNotes: string[];
  sourceDatasets: string[];
  curation: VenueCuration;
};

export type Filters = {
  query: string;
  maxPrice: number;
  crawlStyle: CrawlStyle;
  stopCount: number;
  routeWindow: number;
  requireBeerGarden: boolean;
  requireLiveSports: boolean;
  requireFood: boolean;
  requireCocktails: boolean;
  requireWater: boolean;
  requireHeritage: boolean;
  canonicalOnly: boolean;
};

export function truthyFlag(value: string): boolean {
  return ["yes", "true", "y", "1"].includes(String(value).trim().toLowerCase());
}

export function splitList(value: string): string[] {
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatPrice(value: number | null): string {
  return typeof value === "number" ? `£${value.toFixed(2)}` : "No price";
}

function normaliseVenueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function venueGroupingKey(row: VenuePrice): string {
  return [
    normaliseVenueKeyPart(row.pub_name),
    normaliseVenueKeyPart(row.address),
    row.latitude.toFixed(5),
    row.longitude.toFixed(5),
  ].join("|");
}

export function stableVenueIdFromKey(key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

export function groupVenuePrices(rows: VenuePrice[]): Venue[] {
  const grouped = new Map<string, VenuePrice[]>();
  for (const row of rows) {
    const key = venueGroupingKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return Array.from(grouped.entries()).map(([key, prices]) => {
    const sortedPrices = [...prices].sort((a, b) => {
      const left = a.price_gbp ?? Number.POSITIVE_INFINITY;
      const right = b.price_gbp ?? Number.POSITIVE_INFINITY;
      return left - right;
    });
    const first = sortedPrices[0];
    const numericPrices = sortedPrices
      .map((price) => price.price_gbp)
      .filter((price): price is number => typeof price === "number");
    const sourceDatasets = new Set<string>();
    const dataQualityNotes = new Set<string>();
    for (const price of prices) {
      splitList(price.source_datasets).forEach((source) => sourceDatasets.add(source));
      splitList(price.data_quality_notes).forEach((note) => dataQualityNotes.add(note));
    }

    const curation = getVenueCuration(sortedPrices);

    return {
      id: stableVenueIdFromKey(key),
      name: first.pub_name,
      address: first.address,
      latitude: first.latitude,
      longitude: first.longitude,
      primaryBorough: first.primary_borough,
      visibleBoroughs: splitList(first.boroughs_visible),
      prices: sortedPrices,
      cheapestPrice: numericPrices.length ? Math.min(...numericPrices) : null,
      cheapestPint: first.pint_name,
      averagePrice: numericPrices.length
        ? numericPrices.reduce((sum, price) => sum + price, 0) / numericPrices.length
        : null,
      amenities: {
        food: prices.some((price) => truthyFlag(price.food)),
        cocktails: prices.some((price) => truthyFlag(price.cocktails)),
        beerGarden: prices.some((price) => truthyFlag(price.beer_garden)),
        liveSports: prices.some((price) => truthyFlag(price.live_sports)),
        liveMusic: prices.some((price) => truthyFlag(price.live_music)),
        pubQuiz: prices.some((price) => truthyFlag(price.pub_quiz)),
        darts: prices.some((price) => truthyFlag(price.darts)),
        pool: prices.some((price) => truthyFlag(price.pool)),
        happyHour: prices.some((price) => truthyFlag(price.happy_hour)),
        karaoke: prices.some((price) => truthyFlag(price.karaoke)),
      },
      website: prices.find((price) => price.website)?.website ?? "",
      imageUrl: prices.find((price) => price.image_url)?.image_url ?? "",
      description: prices.find((price) => price.description)?.description ?? "",
      dataQualityNotes: Array.from(dataQualityNotes),
      sourceDatasets: Array.from(sourceDatasets),
      curation,
    };
  });
}

export function filterVenues(venues: Venue[], filters: Filters): Venue[] {
  const query = filters.query.trim().toLowerCase();
  return venues.filter((venue) => {
    const matchesQuery =
      !query ||
      venue.name.toLowerCase().includes(query) ||
      venue.address.toLowerCase().includes(query) ||
      venue.primaryBorough.toLowerCase().includes(query) ||
      venue.visibleBoroughs.some((borough) => borough.toLowerCase().includes(query));

    const matchesPrice =
      venue.cheapestPrice === null || venue.cheapestPrice <= filters.maxPrice;

    const matchesAmenities =
      (!filters.requireBeerGarden || venue.amenities.beerGarden) &&
      (!filters.requireLiveSports || venue.amenities.liveSports) &&
      (!filters.requireFood || venue.amenities.food) &&
      (!filters.requireCocktails || venue.amenities.cocktails);

    const matchesCuration =
      (!filters.requireWater || Boolean(venue.curation.nearWater)) &&
      (!filters.requireHeritage || Boolean(venue.curation.heritageNote));

    const matchesCanonical =
      !filters.canonicalOnly ||
      venue.prices.some((price) => price.is_clean_canonical_app_row);

    return matchesQuery && matchesPrice && matchesAmenities && matchesCuration && matchesCanonical;
  });
}

export function priceColor(price: number | null): string {
  if (price === null) return "#64748b";
  if (price <= 5.5) return "#138a63";
  if (price <= 7) return "#d28b16";
  return "#c24132";
}

export function distanceKm(a: Venue, b: Venue): number {
  const earthRadiusKm = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function scoreVenue(venue: Venue, style: CrawlStyle): number {
  const price = venue.cheapestPrice ?? 8;
  const cheapness = Math.max(0, 10 - price);
  const amenityScore =
    Number(venue.amenities.beerGarden) * 1.5 +
    Number(venue.amenities.liveSports) +
    Number(venue.amenities.food) +
    Number(venue.amenities.cocktails) +
    Number(venue.amenities.liveMusic) +
    Number(venue.amenities.pubQuiz);
  const hasVenueContext = venue.description.length > 80 ? 1 : 0;
  const hasHeritage = venue.curation.heritageNote ? 2.5 : 0;
  const nearWater = venue.curation.nearWater ? 1.5 : 0;
  const writerPick = venue.curation.writerPick ? 5 : 0;
  const sourceTrust = venue.prices.some((priceItem) => priceItem.is_clean_canonical_app_row)
    ? 1
    : 0;

  if (style === "cheapest") return cheapness * 3 + sourceTrust;
  if (style === "beerGarden") return Number(venue.amenities.beerGarden) * 7 + cheapness;
  if (style === "sports") return Number(venue.amenities.liveSports) * 7 + cheapness;
  if (style === "heritage") return hasHeritage * 4 + nearWater * 2 + amenityScore + sourceTrust;
  if (style === "writerTrail") {
    return writerPick * 5 + hasHeritage * 3 + nearWater * 2 + hasVenueContext + cheapness + sourceTrust;
  }
  if (style === "dateNight") {
    return (
      Number(venue.amenities.cocktails) * 2 +
      Number(venue.amenities.food) * 2 +
      Number(venue.amenities.beerGarden) * 2 +
      (hasVenueContext + hasHeritage) * 2 +
      cheapness
    );
  }
  return cheapness * 1.5 + amenityScore + hasVenueContext + hasHeritage + nearWater + sourceTrust;
}

export function buildCrawlRoute(venues: Venue[], filters: Filters): Venue[] {
  if (!venues.length) return [];
  const sorted = [...venues]
    .sort((a, b) => scoreVenue(b, filters.crawlStyle) - scoreVenue(a, filters.crawlStyle))
    .slice(0, 180);
  const maxLegKm = filters.routeWindow <= 15 ? 1.4 : filters.routeWindow <= 20 ? 1.9 : 2.8;

  const candidates = sorted.slice(0, 60).map((seed) => {
    const route: Venue[] = [seed];

    while (route.length < filters.stopCount) {
      const last = route[route.length - 1];
      const localCandidates = sorted
        .filter((venue) => !route.some((selected) => selected.id === venue.id))
        .map((venue) => {
          const distance = distanceKm(last, venue);
          return {
            venue,
            distance,
            score: scoreVenue(venue, filters.crawlStyle) - distance * 2.4,
          };
        })
        .filter((candidate) => candidate.distance <= maxLegKm)
        .sort((a, b) => b.score - a.score);

      const next = localCandidates[0]?.venue;
      if (!next) break;
      route.push(next);
    }

    const summary = crawlSummary(route);
    const routeScore =
      route.reduce((sum, venue) => sum + scoreVenue(venue, filters.crawlStyle), 0) -
      summary.distance * 3 +
      route.length * 4;

    return { route, routeScore };
  });

  return candidates.sort((a, b) => b.routeScore - a.routeScore)[0]?.route ?? [];
}

export function crawlSummary(route: Venue[]): { total: number; average: number; distance: number } {
  const prices = route
    .map((venue) => venue.cheapestPrice)
    .filter((price): price is number => typeof price === "number");
  const total = prices.reduce((sum, price) => sum + price, 0);
  const distance = route.reduce((sum, venue, index) => {
    const next = route[index + 1];
    return next ? sum + distanceKm(venue, next) : sum;
  }, 0);
  return {
    total,
    average: prices.length ? total / prices.length : 0,
    distance,
  };
}
