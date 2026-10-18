// The London fast-food counters: every `food` row of the London venue layer,
// read from the one-file pack (`scripts/build_london_food_pack.mjs`,
// `public/data/london_food/food.json`).
//
// A row is a counter OpenStreetMap tags as fast food and states either alcohol
// or 24/7 hours (`late_fast_food` in scripts/lib/ukOsmVenueSeed.mjs). Its name,
// address and position are OpenStreetMap's. Its borough is the borough polygon
// its point falls in.
//
// PURE and browser-safe, apart from `loadLondonFoodPlaces`, which fetches.
//
// ONE PRICE LANE, AND NOTHING ELSE. A counter is a price target for exactly one
// thing: a community soft-drink price whose drinker says it is a Coke Zero or a
// Diet Coke (the Lucia 🐐 lens). McDonald's publishes no per-restaurant price
// online and the delivery apps may not be read, so people who bought one are
// the only honest source. `foodPlacePriceRefusal` is the rule; the price route
// asks it, and the composer sends what it needs. The rule is narrow because
// `community_prices` has no subtype column: at a counter the write door is what
// makes a soft-drink row MEAN a Coke Zero or a Diet Coke, so a row there can
// never be a Sprite read as one. Pints and every other category stay pub-only.
//
// A counter is a `venue-osm-` id, so `isPubVenueKind` answers false and nothing
// here reaches a price band, a pin colour, a cheapest bucket or the Pint Index.

import {
  drivesMap,
  isWithinMaxAge,
  mapCandidateOf,
  type CommunityPrice,
} from "@/lib/communityPrice";
import { isDrinkCategory, type DrinkCategory } from "@/lib/drinks";
import {
  drinkSubtypeFamilyParentId,
  findSubtype,
} from "@/lib/drinkSubtypes";
import { parseLondonVenueShard, type LondonVenue } from "@/lib/londonVenueShards";

export const LONDON_FOOD_PACK_PATH = "/data/london_food/food.json";
const LONDON_FOOD_PACK_VERSION = 1;

/** The one category a London counter takes a price for. */
export const FOOD_PLACE_PRICE_CATEGORY: DrinkCategory = "soft-drink";

/** The subtype lens a counter's price is about: Coke Zero or Diet Coke. */
export const FOOD_PLACE_PRICE_SUBTYPE_ID = "soft-drink-lucia-special";

/** A London fast-food counter: its shard row, and the borough it stands in. */
export type LondonFoodPlace = LondonVenue & {
  /** The London borough polygon the point falls in, or "" outside every borough. */
  borough: string;
};

/** Where a read of the pack stands. */
export type LondonFoodPlaceStatus = "idle" | "loading" | "ready" | "failed";

/** A pack row: the shard row `[osmRef, name, address, lat, lng, kind]`, then the borough. */
type PackRow = [unknown, unknown, unknown, unknown, unknown, unknown, string];

function isPackRow(value: unknown): value is PackRow {
  return Array.isArray(value) && value.length === 7 && typeof value[6] === "string";
}

/**
 * Decode the pack. Null when the body is not the pack this build reads, or when
 * a row failed to decode: a pack that lost rows would refuse a real counter's
 * price with nothing saying why.
 */
export function parseLondonFoodPack(value: unknown): LondonFoodPlace[] | null {
  if (typeof value !== "object" || value === null) return null;
  const pack = value as Record<string, unknown>;
  const rows = pack.venues;
  if (
    pack.version !== LONDON_FOOD_PACK_VERSION ||
    pack.kind !== "food" ||
    !Array.isArray(rows) ||
    pack.count !== rows.length ||
    !rows.every(isPackRow)
  ) {
    return null;
  }
  const places: LondonFoodPlace[] = [];
  for (const row of rows) {
    const [venue] = parseLondonVenueShard({ venues: [row.slice(0, 6)] });
    if (!venue || venue.kind !== "food") return null;
    places.push({ ...venue, borough: row[6] });
  }
  return places;
}

/** Read the pack. Rejects when it cannot be read or does not decode. */
export async function loadLondonFoodPlaces(
  fetchImpl: typeof fetch = fetch,
): Promise<LondonFoodPlace[]> {
  const response = await fetchImpl(LONDON_FOOD_PACK_PATH);
  if (!response.ok) {
    throw new Error(`${LONDON_FOOD_PACK_PATH} answered ${response.status}`);
  }
  const places = parseLondonFoodPack(await response.json());
  if (!places) throw new Error("London food pack is malformed");
  return places;
}

/**
 * Whether OpenStreetMap names this counter McDonald's. The name is what OSM
 * states; nothing about the row is inferred from it, it only decides which
 * counters the Lucia lens lists.
 */
export function isMcDonaldsName(name: string): boolean {
  return /^mc\s?donald['’]?s\b/i.test(name.trim());
}

/**
 * The London McDonald's in a decoded pack, in borough then address order. The
 * venue layer is cut by a box around Greater London, so a counter just outside
 * it (Ashford, Waltham Abbey) is in the pack with no borough; it is not a
 * London McDonald's and the list leaves it out.
 */
export function londonMcDonalds(
  places: readonly LondonFoodPlace[],
): LondonFoodPlace[] {
  return places
    .filter((place) => isMcDonaldsName(place.name) && place.borough !== "")
    .sort(
      (left, right) =>
        left.borough.localeCompare(right.borough) ||
        left.address.localeCompare(right.address) ||
        left.id.localeCompare(right.id),
    );
}

/** True for the Lucia lens or one of its two leaves (Coke Zero, Diet Coke). */
export function isFoodPlacePriceSubtype(subtypeId: unknown): boolean {
  if (typeof subtypeId !== "string") return false;
  const subtype = findSubtype(subtypeId);
  if (!subtype) return false;
  return (
    subtype.id === FOOD_PLACE_PRICE_SUBTYPE_ID ||
    drinkSubtypeFamilyParentId(subtype.id) === FOOD_PLACE_PRICE_SUBTYPE_ID
  );
}

/** The sentence a refused counter price reads, on both sides of the wire. */
export const FOOD_PLACE_PRICE_REFUSAL =
  "Here you can log a Coke Zero or a Diet Coke, nothing else.";

/**
 * Why a price at a London counter is refused, or null when the lane admits it.
 * The category must be a soft drink and the drinker must say it was a Coke Zero
 * or a Diet Coke.
 */
export function foodPlacePriceRefusal(input: {
  drinkCategory: unknown;
  drinkSubtype: unknown;
}): string | null {
  if (!isDrinkCategory(input.drinkCategory)) return FOOD_PLACE_PRICE_REFUSAL;
  if (input.drinkCategory !== FOOD_PLACE_PRICE_CATEGORY) return FOOD_PLACE_PRICE_REFUSAL;
  if (!isFoodPlacePriceSubtype(input.drinkSubtype)) return FOOD_PLACE_PRICE_REFUSAL;
  return null;
}

/**
 * What a counter's community Coke Zero or Diet Coke price says right now.
 *
 * `agreed` is the corroborated in-window figure, the same test that lets a
 * pub's price colour a pin (`drivesMap`), so a counter's figure is never
 * stronger here than it would be anywhere else. `logged-once` is one drinker's
 * in-window report: it is shown, dated and named as one voice, and it is never
 * ranked beside an agreed figure. Anything older, or nothing at all, is `none`.
 */
export type FoodPlacePriceStanding =
  | { kind: "agreed"; priceGbp: number; submittedAt: number; corroborations: number }
  | { kind: "logged-once"; priceGbp: number; submittedAt: number }
  | { kind: "none" };

export function foodPlacePriceStanding(
  rows: readonly CommunityPrice[] | undefined,
  now: number = Date.now(),
): FoodPlacePriceStanding {
  const row = rows?.find((price) => price.drinkCategory === FOOD_PLACE_PRICE_CATEGORY);
  if (!row) return { kind: "none" };
  const candidate = mapCandidateOf(row);
  if (drivesMap(candidate, now)) {
    return {
      kind: "agreed",
      priceGbp: candidate.priceGbp,
      submittedAt: candidate.submittedAt,
      corroborations: candidate.corroborations ?? 1,
    };
  }
  if (isWithinMaxAge(row, now)) {
    return { kind: "logged-once", priceGbp: row.priceGbp, submittedAt: row.submittedAt };
  }
  return { kind: "none" };
}

/** One London McDonald's as the Lucia 🐐 list prints it. */
export type LuciaMcDonaldsRow = {
  venueId: string;
  name: string;
  address: string;
  borough: string;
  standing: FoodPlacePriceStanding;
};

/**
 * Where the list's price read got to, on the same three-way scale as every
 * category index, plus `unavailable` when the food pack itself could not be
 * read. A `degraded` read may never be worded as "nobody has logged one".
 */
type LuciaMcDonaldsStatus = "ready" | "partial" | "degraded" | "unavailable";

export type LuciaMcDonaldsSection = {
  status: LuciaMcDonaldsStatus;
  rows: LuciaMcDonaldsRow[];
};

const STANDING_ORDER: Record<FoodPlacePriceStanding["kind"], number> = {
  agreed: 0,
  "logged-once": 1,
  none: 2,
};

/**
 * The London McDonald's with what their community price says. Agreed figures
 * lead, cheapest first; one-voice reports follow, newest first, never ranked
 * among them; a counter with neither keeps its door, in borough order.
 */
export function luciaMcDonaldsRows(
  places: readonly LondonFoodPlace[],
  pricesByVenue: ReadonlyMap<string, readonly CommunityPrice[]>,
  now: number = Date.now(),
): LuciaMcDonaldsRow[] {
  const rows = londonMcDonalds(places).map((place) => ({
    venueId: place.id,
    name: place.name,
    address: place.address,
    borough: place.borough,
    standing: foodPlacePriceStanding(pricesByVenue.get(place.id), now),
  }));
  return rows
    .map((row, position) => ({ row, position }))
    .sort((left, right) => {
      const a = left.row.standing;
      const b = right.row.standing;
      const byKind = STANDING_ORDER[a.kind] - STANDING_ORDER[b.kind];
      if (byKind !== 0) return byKind;
      if (a.kind === "agreed" && b.kind === "agreed") {
        if (a.priceGbp !== b.priceGbp) return a.priceGbp - b.priceGbp;
      }
      if (a.kind === "logged-once" && b.kind === "logged-once") {
        if (a.submittedAt !== b.submittedAt) return b.submittedAt - a.submittedAt;
      }
      return left.position - right.position;
    })
    .map(({ row }) => row);
}
