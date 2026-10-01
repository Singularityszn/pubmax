// Bundle schema and read policy for scripts/build_uk_price_bundle.mjs.
// Rows retain their producing lane, source and observation date; priceTier.ts
// decides their standing. Estimates remain available for coverage reporting,
// but authoritativeBundleRows excludes them from price claims, pin colours,
// cheapest-pint buckets, price bands and the Pint Index. This leaf imports no
// venue index.

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
 * Producing lanes describe provenance. Standing determines authority.
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
  Pick<UkPriceBundleRow, "sourceUrl" | "category" | "priceGbp" | "drinkLabel" | "servingSize">
> = [
  { sourceUrl: "https://thebellonthegreen.com/drinks/", category: "wine", priceGbp: 4, drinkLabel: "London Pride 500ml" },
  { sourceUrl: "https://thebellonthegreen.com/drinks/", category: "wine", priceGbp: 4, drinkLabel: "London Pride", servingSize: "500ml" },
  { sourceUrl: "https://thegallimaufry.co.uk/food-drink/", category: "wine", priceGbp: 3, drinkLabel: "Ting Grapefruit Soda 330ml" },
  { sourceUrl: "https://thegallimaufry.co.uk/food-drink/", category: "wine", priceGbp: 3, drinkLabel: "Ting Grapefruit Soda", servingSize: "330ml" },
  { sourceUrl: "https://thebrownswood.co.uk/drinks-menu/", category: "beer", priceGbp: 2.6, drinkLabel: "~ 1/2 pint Tonic, Slim Tonic, Ginger Ale / Beer-" },
  { sourceUrl: "https://thebrownswood.co.uk/drinks-menu/", category: "rum", priceGbp: 8, drinkLabel: "Paloma –" },
  { sourceUrl: "https://thebrownswood.co.uk/drinks-menu/", category: "vodka", priceGbp: 4, drinkLabel: "Virgin Bloody Mary AF –" },
  { sourceUrl: "https://thebrownswood.co.uk/drinks-menu/", category: "coffee", priceGbp: 4.3, drinkLabel: "Liquors Amaretto Lazzaroni –" },
  { sourceUrl: "https://thegallimaufry.co.uk/food-drink/", category: "cocktail", priceGbp: 6, drinkLabel: ".5 Wiper & True · Too Much Fun Guava Peach Pineapple Sour · 5.2% · 440ml" },
  { sourceUrl: "https://www.greeneking.co.uk/pubs/greater-london/punch-and-judy/menu", category: "wine", priceGbp: 8.1, drinkLabel: "/" },
  { sourceUrl: "https://www.greeneking.co.uk/pubs/greater-london/punch-and-judy/menu", category: "wine", priceGbp: 13, drinkLabel: "### Limoncello Spritz Bright and zesty Isolabella Limoncello, prosecco and soda" },
  { sourceUrl: "https://www.greeneking.co.uk/pubs/greater-london/punch-and-judy/menu", category: "wine", priceGbp: 13, drinkLabel: "#### Aperol Spritz A classic serve of Aperol, prosecco, and soda" },
  { sourceUrl: "https://www.greeneking.co.uk/pubs/greater-london/punch-and-judy/menu", category: "wine", priceGbp: 13, drinkLabel: "Hugo Spritz Fresh and floral St-Germain Elderflower Liqueur, prosecco and soda" },
  { sourceUrl: "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu", category: "wine", priceGbp: 7.8, drinkLabel: "/" },
  { sourceUrl: "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu", category: "wine", priceGbp: 11, drinkLabel: "### Limoncello Spritz Bright and zesty Isolabella Limoncello, prosecco and soda" },
  { sourceUrl: "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu", category: "wine", priceGbp: 11, drinkLabel: "#### Aperol Spritz A classic serve of Aperol, prosecco, and soda" },
  { sourceUrl: "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu", category: "wine", priceGbp: 11, drinkLabel: "Hugo Spritz Fresh and floral St-Germain Elderflower Liqueur, prosecco and soda" },
  { sourceUrl: "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu", category: "rum", priceGbp: 9, drinkLabel: "savoury and refreshing mix of Clean Co Clean V and Big Tom Spiced Tomato Juice" },
  { sourceUrl: "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu", category: "cocktail", priceGbp: 9, drinkLabel: "## 0% Espresso Martini The classic coffee cocktail shaken with Clean Co Clean V" },
  { sourceUrl: "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu", category: "cocktail", priceGbp: 9, drinkLabel: "Zesty and refreshing Clean Co Clean R with Mexican lime, Moroccan mint and soda" },
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
      item.priceGbp === row.priceGbp && item.drinkLabel === row.drinkLabel &&
      (item.servingSize === undefined || item.servingSize === row.servingSize),
    );
}

/** Recover this retained menu's literal measure; existing typed servings win. */
export function bundleRowServingSize(row: UkPriceBundleRow): string | undefined {
  if (row.servingSize !== undefined) return row.servingSize;
  if (row.lane === "site-harvest" && row.standing === "listed" &&
      row.sourceUrl === "https://thebrownswood.co.uk/drinks-menu/" &&
      row.category === "gin" && row.drinkLabel === "Gin ~ 25 ml Sacred –") {
    return "25ml";
  }
  return undefined;
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
 * Every row needs a date; listed rows also need a source URL. Estimates carry
 * their model basis and sample size instead. validate-data enforces this shape.
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
  if (row.standing === "estimate") {
    if (!isNonEmptyString(row.basis)) return false;
    if (!Number.isInteger(row.sampleSize) || (row.sampleSize as number) <= 0) return false;
  }
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
 * Rows eligible for factual price claims, excluding quarantined observations.
 */
export function authoritativeBundleRows(rows: readonly UkPriceBundleRow[]): UkPriceBundleRow[] {
  return rows.filter((row) => standingCarriesAuthority(row.standing) && !isCategoryQuarantined(row));
}

/**
 * Delegate standing and freshness for one pub and drink to priceStandingFor.
 */
export function strongestBundleRow(
  rows: readonly UkPriceBundleRow[],
  now: number = Date.now(),
): PriceStandingDecision {
  return priceStandingFor(bundlePriceInputs(rows), now);
}

/**
 * Gather listed and estimated inputs separately for one pub and drink.
 * Read and build paths share bundleRowSupersedes: newest observation wins,
 * then cheapest within that observation. priceStandingFor chooses the standing.
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
 * The default sheet price is beer, matching the map's default drink lane.
 */
export const BUNDLE_DEFAULT_CATEGORY = "beer";

/**
 * Shared read/build ordering for one pub and drink. Prefer the latest
 * observation, then the cheapest price at that timestamp. Choosing price
 * before date would preserve an older, cheaper offer after a price increase.
 * Returns true when candidate replaces held.
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
