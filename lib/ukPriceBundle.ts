// ONE BUNDLE, EVERY PRICE WE HOLD, AND EACH ROW SAYS WHAT IT IS WORTH.
//
// Prices reach this tree down several lanes: a drinker's Pint Drop, a chain's
// own published menu, a first-party harvest of a pub's own site, and a figure
// modelled here that nobody published at all. Each lane already has an owner,
// and each owner already decides its own thing. What did not exist was ONE
// place a reader could ask "what do we hold about this pub, and how good is
// it", so a coverage question could only be answered by counting four files by
// hand.
//
// THE BUNDLE INVENTS NOTHING. Every row is a row one of those lanes already
// produced, carried through with its own source URL and its own observation
// day, and stamped with the standing lib/priceTier.ts decided for it. The
// builder is scripts/build_uk_price_bundle.mjs; this module is the shape, the
// parser and the ONE rule about who may read what.
//
// THAT RULE, and it is the reason this module exists rather than a bare JSON
// read: A BUNDLE ROW IS NOT AUTOMATICALLY A PRICE A SURFACE MAY PAINT. The
// bundle deliberately carries estimates, because a coverage answer that omits
// them is not a coverage answer. An estimate may never reach pin colour, the
// cheapest-pint buckets, the price bands or the Pint Index - the fence
// __tests__/priceEstimateAuthorityFence.test.ts holds that line for the estimate
// engine, and `authoritativeBundleRows` holds it here. A caller that wants a
// figure it may treat as a fact asks for that; a caller that wants to say what
// we hold asks for the whole set and prints the standing beside every row.
//
// This module imports the standing vocabulary and nothing else, so a surface
// that needs to read the bundle does not pull the venue index in behind it.

import {
  UK_PRICE_BUNDLE_DRINK_LABEL_MAX,
  bundleRowDedupeDrinkKey,
  isValidBundleDrinkSubtypeForRow,
} from "@/lib/bundleDrinkFields";
import {
  type EstimatedPriceInput,
  type ListedPriceInput,
  type PriceStanding,
  type PriceStandingDecision,
  priceStandingFor,
  standingCarriesAuthority,
} from "@/lib/priceTier";

export const UK_PRICE_BUNDLE_VERSION = 1;

/**
 * Which lane a row came down. This is PROVENANCE, not authority: the standing
 * says how good the row is, and the lane says who produced it, so a coverage
 * report can name the lane that is thin without re-deciding what its rows are
 * worth.
 */
export const UK_PRICE_BUNDLE_LANES = [
  // A pub's or a chain's own website, read by scripts/harvest/uk-prices.
  "site-harvest",
  // The reviewed drink-price publish, public/data/drink_price_updates.
  "drink-price-update",
  // Modelled here from lib/priceEstimate.ts. Never published by anybody.
  "estimate",
] as const;
export type UkPriceBundleLane = (typeof UK_PRICE_BUNDLE_LANES)[number];

export type UkPriceBundleRow = {
  /** The venue this price is about: a curated venue id or a `venue-uk-` id. */
  venueId: string;
  /** The pub's own name as its lane stated it, for a report a human reads. */
  name: string | null;
  /** A `lib/drinks.ts` category. Kept a string here so this module stays a leaf. */
  category: string;
  priceGbp: number;
  lane: UkPriceBundleLane;
  standing: PriceStanding;
  /** The page that published the figure. Present on every `listed` row. */
  sourceUrl: string | null;
  /** The publisher's own name, where the lane recorded one. */
  publisher: string | null;
  /** The day the figure was observed, or the day an estimate was modelled. */
  observedAt: string;
  /** Present only on an estimate, and what makes it answerable. */
  basis: string | null;
  sampleSize: number | null;
  /** How many operators an estimate's basis rests on. Owed by every non-beer estimate. */
  operatorCount?: number;
  /**
   * The drink name as printed on the source page or menu line (trimmed, max
   * 80 chars). Absent when the producing lane stated category only.
   */
  drinkLabel?: string;
  /** Source-stated serving, such as 125ml or Btl; absence means unknown volume. */
  servingSize?: string;
  /** Closed subtype from lib/drinkSubtypes.ts when the label classifies; never guessed. */
  drinkSubtype?: string;
};

/**
 * Source-ledger observations with a printed item that contradicts its assigned
 * category. Keep the observations in site_harvest.jsonl for audit, but do not
 * let these exact claims become listed facts. Match the source and printed item
 * as well as category and price, so other drinks on these menus still publish.
 */
const CATEGORY_QUARANTINE: ReadonlyArray<
  Pick<UkPriceBundleRow, "sourceUrl" | "category" | "priceGbp" | "drinkLabel">
> = [
  { sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/", category: "gin", priceGbp: 9, drinkLabel: "0% Tropical Negroni Three Spirit Livener, Lyres Italian Spritz, Tanqueray 0.0%" },
  { sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/", category: "shot", priceGbp: 12, drinkLabel: "1.50 Picante Spritz Altos Plata tequila, Beesou honey, green chilli, lime, soda" },
  { sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/", category: "whisky", priceGbp: 10, drinkLabel: "ary Absolut Tabasco Vodka, Tomato Juice, Worcestershire Sauce, Spices, Rosemary" },
  { sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/", category: "wine", priceGbp: 5.35, drinkLabel: "Pineapple & Yuzu Pineapple, coconut, apple, yuzu, soda 86kcal" },
  { sourceUrl: "https://www.theguardhousewoolwich.co.uk/food-and-drink/", category: "cocktail", priceGbp: 8, drinkLabel: "Berry Hugo 0.0% Three Spirit Livener 0.0%, Watermelon, Elderflower, Soda 93kcal" },
  { sourceUrl: "https://georgeanddragonacton.co.uk/drinks-menu", category: "wine", priceGbp: 3, drinkLabel: "Frobishers Juice (250ml)" },
  { sourceUrl: "https://www.spreadeaglewandsworth.co.uk/food-drinks/", category: "wine", priceGbp: 5.4, drinkLabel: "Raspberry Elderflower, apple juice, Fever-Tree raspberry & orange blossom soda" },
  { sourceUrl: "https://www.kingsarmsoxford.co.uk/food-drink/", category: "wine", priceGbp: 4.85, drinkLabel: ".85 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal" },
  { sourceUrl: "https://www.owlandpussycatshoreditch.com/food-drink/", category: "wine", priceGbp: 5.5, drinkLabel: "Elderflower & Raspberry Cooler Orange Blossom, Raspberry, Elderflower, and Soda" },
  { sourceUrl: "https://www.windmillclapham.co.uk/food-drink/", category: "wine", priceGbp: 5.4, drinkLabel: ".40 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal" },
  { sourceUrl: "https://www.tellersarmsfarnham.co.uk/food-drinks/", category: "wine", priceGbp: 5.15, drinkLabel: ".15 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal" },
  { sourceUrl: "https://www.groveexmouth.co.uk/food-drink/", category: "wine", priceGbp: 4.85, drinkLabel: ".85 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal" },
  { sourceUrl: "https://www.whitehart-ford.com/food-drink/", category: "wine", priceGbp: 4.6, drinkLabel: "60 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88 kcal" },
  { sourceUrl: "https://www.almawandsworth.com/food-drink/", category: "wine", priceGbp: 5.4, drinkLabel: "Elderflower & Raspberry Orange blossom, elderflower, raspberry, soda / 88 Kcal" },
  { sourceUrl: "https://www.thebullditchling.com/food-drink/", category: "wine", priceGbp: 5.15, drinkLabel: ".15 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal" },
  { sourceUrl: "https://www.thedukeofwellingtonpub.com/food-and-drinks?menu=spritz", category: "wine", priceGbp: 4, drinkLabel: "om, Raspberry, Elderflower, Soda 88kcal Light & Sparkling (AF) Raspberry & Rose" },
  { sourceUrl: "https://www.cockandbottlew11.com/food-drink?menu=spritz-menu", category: "wine", priceGbp: 4.45, drinkLabel: "om, Raspberry, Elderflower, Soda 88kcal Light & Sparkling (AF) Raspberry & Rose" },
  { sourceUrl: "https://www.orangetreerichmond.co.uk/food-drink/", category: "wine", priceGbp: 5.35, drinkLabel: ".35 Elderflower & Raspberry Orange Blossom, Raspberry, Elderflower, Soda 88kcal" },
  { sourceUrl: "https://www.theprideofpaddington.co.uk/food-drink/", category: "wine", priceGbp: 3.95, drinkLabel: "50 Elderflower & Raspberry Cooler Orange Blossom, Raspbberry, Elderflower, Soda" },
];

export function isCategoryQuarantined(row: UkPriceBundleRow): boolean {
  return row.lane === "site-harvest" && row.standing === "listed" &&
    CATEGORY_QUARANTINE.some((item) =>
      item.sourceUrl === row.sourceUrl && item.category === row.category &&
      item.priceGbp === row.priceGbp && item.drinkLabel === row.drinkLabel,
    );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFinitePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isUkPriceBundleLane(value: unknown): value is UkPriceBundleLane {
  return typeof value === "string" && (UK_PRICE_BUNDLE_LANES as readonly string[]).includes(value);
}

/**
 * An estimate owes its basis and sample, and only an estimate may carry an
 * operator count, because only a modelled figure rests on operators.
 */
function hasValidEstimateArgument(row: Record<string, unknown>): boolean {
  if (row.standing === "estimate") {
    if (!isNonEmptyString(row.basis)) return false;
    if (!Number.isInteger(row.sampleSize) || (row.sampleSize as number) <= 0) return false;
  }
  if (row.operatorCount === undefined) return true;
  return row.standing === "estimate" && Number.isInteger(row.operatorCount) && (row.operatorCount as number) > 0;
}

/**
 * A row is valid only if it can be cited. THE TWO THINGS EVERY ROW OWES are a
 * day and, unless it is modelled, a source URL; a row without them is a figure
 * nobody can check or correct, and validate-data refuses the file over it.
 */
export function isValidUkPriceBundleRow(value: unknown): value is UkPriceBundleRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (!isNonEmptyString(row.venueId)) return false;
  if (!isNonEmptyString(row.category)) return false;
  if (!isFinitePrice(row.priceGbp)) return false;
  if (!isUkPriceBundleLane(row.lane)) return false;
  if (!isNonEmptyString(row.observedAt) || !Number.isFinite(Date.parse(row.observedAt as string))) {
    return false;
  }
  if (row.standing === "listed") {
    if (!isNonEmptyString(row.sourceUrl)) return false;
    try {
      const url = new URL(row.sourceUrl as string);
      if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    } catch {
      return false;
    }
  }
  if (!hasValidEstimateArgument(row)) return false;
  if (row.drinkLabel !== undefined) {
    if (typeof row.drinkLabel !== "string" || row.drinkLabel.length === 0) return false;
    if (row.drinkLabel.length > UK_PRICE_BUNDLE_DRINK_LABEL_MAX) return false;
  }
  if (row.servingSize !== undefined) {
    if (typeof row.servingSize !== "string" || row.servingSize.trim() !== row.servingSize ||
        row.servingSize.length === 0 || row.servingSize.length > 40 ||
        /\p{Cc}/u.test(row.servingSize)) return false;
    if (row.standing !== "listed") return false;
  }
  if (row.drinkSubtype !== undefined) {
    if (!isValidBundleDrinkSubtypeForRow(row.category, row.drinkSubtype)) return false;
    if (typeof row.drinkLabel !== "string" || !row.drinkLabel.trim()) return false;
  }
  return row.standing === "confirmed" || row.standing === "listed" || row.standing === "estimate";
}

export function parseUkPriceBundleRows(raw: unknown): UkPriceBundleRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => isValidUkPriceBundleRow(row) && !isCategoryQuarantined(row));
}

/**
 * The rows a surface may treat as a FACT about tonight's price. Everything the
 * standing vocabulary says carries authority, and nothing else, which is how an
 * estimate is kept out of pin colour and the Index without every caller having
 * to remember the rule.
 */
export function authoritativeBundleRows(rows: readonly UkPriceBundleRow[]): UkPriceBundleRow[] {
  return rows.filter((row) => standingCarriesAuthority(row.standing) && !isCategoryQuarantined(row));
}

/**
 * The strongest row the bundle holds for one pub and one drink, decided by the
 * ONE decider. A harvested listing beats a modelled estimate for the same pub
 * and drink because `priceStandingFor` says so, not because this function
 * re-decides it.
 */
export function strongestBundleRow(
  rows: readonly UkPriceBundleRow[],
  now: number = Date.now(),
): PriceStandingDecision {
  return priceStandingFor(bundlePriceInputs(rows), now);
}

/**
 * The two inputs `priceStandingFor` takes, over rows already narrowed to one
 * pub and one drink.
 *
 * WITHIN ONE STANDING, THE READ SIDE PICKS WHAT THE BUILD SIDE KEEPS: the
 * freshest reading, and the cheapest within that reading. Both sides ask
 * `bundleRowSupersedes`, so a second listed lane landing for one pub cannot
 * make the sheet quote a figure the builder itself would have superseded. The
 * two standings are gathered apart because choosing BETWEEN them is the one
 * decider's job, never this function's.
 */
function bundlePriceInputs(rows: readonly UkPriceBundleRow[]): {
  listed: ListedPriceInput | null;
  estimate: EstimatedPriceInput | null;
} {
  let listed: UkPriceBundleRow | undefined;
  let estimate: UkPriceBundleRow | undefined;
  for (const row of rows) {
    if (isCategoryQuarantined(row)) continue;
    if (row.standing === "listed" && row.sourceUrl) {
      if (bundleRowSupersedes(row, listed)) listed = row;
      continue;
    }
    if (row.standing === "estimate" && row.basis && row.sampleSize) {
      if (bundleRowSupersedes(row, estimate)) estimate = row;
    }
  }
  return {
    listed: listed
      ? {
          priceGbp: listed.priceGbp,
          sourceUrl: listed.sourceUrl as string,
          observedAt: listed.observedAt,
        }
      : null,
    estimate: estimate
      ? {
          priceGbp: estimate.priceGbp,
          basis: estimate.basis as string,
          sampleSize: estimate.sampleSize as number,
          computedAt: estimate.observedAt,
        }
      : null,
  };
}

/** Those same two inputs, for the rows of one drink out of a whole pub's set. */
export function bundlePricesForCategory(
  rows: readonly UkPriceBundleRow[],
  category: string,
): { listed: ListedPriceInput | null; estimate: EstimatedPriceInput | null } {
  return bundlePriceInputs(rows.filter((row) => row.category === category));
}

/**
 * The drink a pub's own price area is about. Beer is the lane the map rests in
 * (lib/drinkLanes.ts), so the sheet's price claim is a beer claim, and naming
 * it once here stops a surface reaching for a different drink's figure.
 */
export const BUNDLE_DEFAULT_CATEGORY = "beer";

/**
 * Which of two rows for one pub and one drink the bundle keeps, and the ONE
 * ordering both sides of the bundle spend: the builder folding a lane's rows
 * down to what it stores, and `bundlePriceInputs` picking what a sheet reads
 * back out. A rule stated twice is a rule that drifts, and this one drifted
 * once already.
 *
 * TWO QUESTIONS, ANSWERED IN ORDER, because they are about different things.
 *
 * 1. THE FRESHEST READING WINS. A page read twice is one page answering twice,
 *    and the later answer is the one that is true now. Keeping the cheaper of
 *    two readings publishes last year's figure the moment a pub puts its prices
 *    up, and dates it to the day it was cheap.
 * 2. WITHIN ONE READING, THE CHEAPEST WINS. A menu states many lines for one
 *    pub's beer, and the figure a drinker can walk in and pay is the lowest of
 *    them. A reading is stamped once per page, so the rows of one page share an
 *    instant and land here as a tie.
 *
 * Returns true when `candidate` should replace `held`.
 */
export function bundleRowSupersedes(
  candidate: UkPriceBundleRow,
  held: UkPriceBundleRow | undefined,
): boolean {
  if (!held) return true;
  if (candidate.observedAt !== held.observedAt) return candidate.observedAt > held.observedAt;
  return candidate.priceGbp < held.priceGbp;
}

/** Shared collect key keeps named servings separate within each pub and lane. */
export function ukPriceBundleCollectKey(
  row: Pick<UkPriceBundleRow, "venueId" | "category" | "lane" | "drinkLabel" | "servingSize">,
): string {
  return `${row.venueId} ${row.category} ${bundleRowDedupeDrinkKey(row)} ${row.lane}`;
}

/** Rows grouped by the venue they are about, in the order the bundle states them. */
export function bundleRowsByVenue(
  rows: readonly UkPriceBundleRow[],
): Map<string, UkPriceBundleRow[]> {
  const byVenue = new Map<string, UkPriceBundleRow[]>();
  for (const row of rows) {
    const held = byVenue.get(row.venueId);
    if (held) held.push(row);
    else byVenue.set(row.venueId, [row]);
  }
  return byVenue;
}
