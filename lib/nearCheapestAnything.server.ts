import "server-only";

import { measureFromServingSize, type DrinkMeasure } from "@/lib/drinkMeasure";
import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import { selectObservedSubtypePriceForVenue } from "@/lib/drinkSubtypeObservedPrice";
import { drinkSubtypeFromText } from "@/lib/drinkSubtypes";
import {
  nearDrinkReadDay,
  type NearDrinkLaneId,
  type NearDrinkLanes,
  type NearDrinkRow,
} from "@/lib/nearCheapestAnything";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import { allDrinkPriceUpdates } from "@/lib/priceUpdates.server";
import { authoritativeBundleRows, type UkPriceBundleRow } from "@/lib/ukPriceBundle";
import { ukPriceBundleRowsByVenue } from "@/lib/ukPriceBundle.server";
import { isPublicRankablePub } from "@/lib/venueKindFilters";
import { venueGroupingKey, type Venue } from "@/lib/venues";

// The rows behind the Cheapest anything chips (lib/nearCheapestAnything.ts),
// read once at build for the prerendered /near document.
//
// EVERY LANE REUSES THE READER ITS OWN PAGE ALREADY TRUSTS.
//   Guinness  not here: the page already hands over the /drink/guinness rows
//             for the Guinness line (lib/nearGuinness.server.ts), and the chip
//             reads those same rows (nearGuinnessRows), so the two never differ.
//   Coke      the /soft-drinks-and-water Coca-Cola lens (Coke Zero and Diet
//             Coke) through selectObservedSubtypePriceForVenue.
//   Wine, coffee, alcohol-free
//             the reviewed drink publish (public/data/drink_price_updates) and
//             the listed site-harvest rows of the UK price bundle
//             (public/data/uk_prices/rows.json, authoritativeBundleRows), the
//             two lanes the round forecast and the subtype pages read. An
//             estimate never passes authoritativeBundleRows.
//
// One row per pub per measure: the cheapest the pub lists in that measure.

const COKE_LENS = "soft-drink-lucia-special";
const LABEL_MAX = 60;

// ---------------------------------------------------------------------------
// Which listed rows a lane may hold, by the row's own label.

const NOT_A_GLASS_OF_WINE =
  /\b(?:lemonade|soda|spritz|juice|cordial|tonic|cocktail|mocktail|kcal|alcohol[- ]free|non[- ]alcoholic|sangria|mulled|punch|cooler|fizz|prosecco|champagne|cava)\b|\b0(?:\.0)?%/i;
const HOUSE_WINE_SUBTYPES: ReadonlySet<string> = new Set(["wine-red", "wine-white", "wine-rose"]);

/** A still red, white or rosé the row's own label names. */
export function isHouseWineLabel(label: string | null | undefined): boolean {
  if (typeof label !== "string" || label.trim().length < 3) return false;
  if (NOT_A_GLASS_OF_WINE.test(label)) return false;
  const subtype = drinkSubtypeFromText(label, "wine");
  return subtype !== null && HOUSE_WINE_SUBTYPES.has(subtype.id);
}

const COFFEE_WORD = /\b(?:coffee|espresso|americano|latte|cappuccino|flat white|cortado|macchiato|mocha)\b/i;
const NOT_A_COFFEE =
  /\b(?:martini|irish|liqueur|baileys|kahlua|tia maria|affogato|cocktail|vodka|rum|whiske?y|brandy|cognac|amaretto|limoncello|tequila|gin)\b/i;

/** A coffee the row's own label names, never a coffee cocktail or a pudding. */
export function isCoffeeLabel(label: string | null | undefined): boolean {
  if (typeof label !== "string") return false;
  return COFFEE_WORD.test(label) && !NOT_A_COFFEE.test(label);
}

/** An alcohol-free row needs a name, so the answer can say what it is. */
export function isAlcoholFreeLabel(label: string | null | undefined): boolean {
  return typeof label === "string" && label.trim().length >= 3;
}

type MenuLane = Extract<NearDrinkLaneId, "wine" | "coffee" | "alcohol-free">;

const MENU_LANES: Record<MenuLane, { category: string; accepts: (label: string | null | undefined) => boolean }> = {
  wine: { category: "wine", accepts: isHouseWineLabel },
  coffee: { category: "coffee", accepts: isCoffeeLabel },
  "alcohol-free": { category: "alcohol-free", accepts: isAlcoholFreeLabel },
};

type MenuCandidate = {
  priceGbp: number;
  observedOn: string | null;
  publisher: string | null;
  drinkLabel: string;
  measure: DrinkMeasure | null;
};

function cleanLabel(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1).trimEnd()}…` : text;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function fromDrinkUpdate(update: DrinkPriceUpdate, lane: MenuLane): MenuCandidate | null {
  const rule = MENU_LANES[lane];
  if (update.lane === "demo" || update.category !== rule.category) return null;
  if (!positive(update.priceGbp) || !rule.accepts(update.drinkName)) return null;
  return {
    priceGbp: update.priceGbp,
    observedOn: nearDrinkReadDay(update.observedAt),
    publisher: update.source.label.trim() || null,
    drinkLabel: cleanLabel(update.drinkName),
    measure: measureFromServingSize(update.servingSize),
  };
}

// The bundle's own drink-price-update rows repeat what `drinkUpdates` already
// carries, so only its site-harvest rows are read here.
function fromBundleRow(row: UkPriceBundleRow, lane: MenuLane): MenuCandidate | null {
  const rule = MENU_LANES[lane];
  if (row.lane !== "site-harvest" || row.category !== rule.category) return null;
  if (!positive(row.priceGbp) || !row.sourceUrl || !rule.accepts(row.drinkLabel)) return null;
  return {
    priceGbp: row.priceGbp,
    observedOn: nearDrinkReadDay(row.observedAt),
    publisher: row.publisher?.trim() || hostOf(row.sourceUrl),
    drinkLabel: cleanLabel(row.drinkLabel ?? ""),
    measure: measureFromServingSize(row.servingSize),
  };
}

/** The cheapest candidate per measure, as rows for one venue. */
function cheapestPerMeasure(venueId: string, candidates: readonly MenuCandidate[]): NearDrinkRow[] {
  const best = new Map<DrinkMeasure | null, MenuCandidate>();
  for (const candidate of candidates) {
    const held = best.get(candidate.measure);
    if (
      !held
      || candidate.priceGbp < held.priceGbp
      || (candidate.priceGbp === held.priceGbp && candidate.drinkLabel < held.drinkLabel)
    ) {
      best.set(candidate.measure, candidate);
    }
  }
  return [...best.values()].map((candidate) => [
    venueId,
    candidate.priceGbp,
    candidate.observedOn,
    candidate.publisher,
    candidate.drinkLabel,
    candidate.measure,
  ]);
}

function venueDrinkKey(venue: Venue): string | null {
  const lead = venue.prices[0];
  return lead ? venueGroupingKey(lead) : null;
}

/** Every lane's rows. Pure over its inputs, so a test can hand in fixtures. */
export function buildNearDrinkLanes(
  venues: readonly Venue[],
  drinkUpdates: readonly DrinkPriceUpdate[],
  bundleByVenue: ReadonlyMap<string, readonly UkPriceBundleRow[]>,
): Required<Omit<NearDrinkLanes, "guinness">> {
  const lanes: { [K in Exclude<NearDrinkLaneId, "guinness">]: NearDrinkRow[] } = {
    wine: [],
    coke: [],
    coffee: [],
    "alcohol-free": [],
  };
  const updatesByKey = new Map<string, DrinkPriceUpdate[]>();
  for (const update of drinkUpdates) {
    updatesByKey.set(update.venueKey, [...(updatesByKey.get(update.venueKey) ?? []), update]);
  }
  for (const venue of venues) {
    if (!isPublicRankablePub(venue)) continue;
    const key = venueDrinkKey(venue);
    const venueUpdates = key ? updatesByKey.get(key) ?? [] : [];
    const bundleRows = bundleByVenue.get(venue.id) ?? [];

    const coke = selectObservedSubtypePriceForVenue(venue, COKE_LENS, venueUpdates, bundleRows);
    if (coke) {
      lanes.coke.push([
        venue.id,
        coke.priceGbp,
        nearDrinkReadDay(coke.observedAt),
        coke.publisher?.label ?? null,
        cleanLabel(coke.drinkLabel),
        null,
      ]);
    }

    const authoritative = authoritativeBundleRows(bundleRows);
    for (const lane of Object.keys(MENU_LANES) as MenuLane[]) {
      const candidates = [
        ...venueUpdates.flatMap((update) => {
          const hit = fromDrinkUpdate(update, lane);
          return hit ? [hit] : [];
        }),
        ...authoritative.flatMap((row) => {
          const hit = fromBundleRow(row, lane);
          return hit ? [hit] : [];
        }),
      ];
      lanes[lane].push(...cheapestPerMeasure(venue.id, candidates));
    }
  }
  return lanes;
}

/**
 * The lanes this build could read. A READ WE COULD NOT RUN IS NOT AN EMPTY
 * LANE: a lane whose source failed is left out, and the chip says it could not
 * read those prices, rather than "none listed nearby".
 */
export async function loadNearDrinkLanes(): Promise<NearDrinkLanes> {
  try {
    const [venues, drinkUpdates, bundle] = await Promise.all([
      loadPintPriceLandingVenues(),
      allDrinkPriceUpdates(),
      ukPriceBundleRowsByVenue(),
    ]);
    const lanes: NearDrinkLanes = buildNearDrinkLanes(venues, drinkUpdates, bundle.byVenue);
    if (bundle.status === "unavailable") {
      delete lanes.wine;
      delete lanes.coke;
      delete lanes.coffee;
      delete lanes["alcohol-free"];
    }
    return lanes;
  } catch {
    return {};
  }
}

let listedAlcoholFree: Promise<readonly NearDrinkRow[] | null> | null = null;

/**
 * The alcohol-free lane alone, for the dry round (lib/dryRound.ts): the SAME
 * reader as the Alcohol-free chip, never a second one. Its inputs are bundled
 * and change only on deploy, so a process holds the answer once. A read that
 * failed answers null, never an empty lane, and is not held, so the next
 * request asks again.
 */
export function loadListedAlcoholFreeRows(): Promise<readonly NearDrinkRow[] | null> {
  const pending = (listedAlcoholFree ??= loadNearDrinkLanes().then((lanes) => lanes["alcohol-free"] ?? null));
  void pending.then((rows) => {
    if (!rows && listedAlcoholFree === pending) listedAlcoholFree = null;
  });
  return pending;
}
