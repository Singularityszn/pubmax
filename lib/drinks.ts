import { BEERS, normalizeBeer } from "@/lib/beers";
import { isNonAlcoholicDrink } from "@/lib/nonAlcoholicDrinks";

// The all-drinks data model (PRD E1 — "extend, do not fork"). A venue today
// carries `prices: VenuePrice[]` — cheapest-pint beer rows. This module
// generalises that to a `Drink` across every category (wine, whisky, gin,
// vodka, rum, cocktail, shot, other), WITHOUT touching the pint/cheapest-price
// paths: a pint is simply `category:"beer"`, and the existing VenuePrice[] can
// be VIEWED as Drink[] through the `legacyPricesToDrinks` adapter below, so the
// Menu UI shows today's beer without any change to lib/venues.ts.
//
// PURE + browser-safe: no server imports, no node builtins — safe in a client
// component or a server component alike. Fully unit-tested (the grep-score
// deliverable). Every drink fact carries its own provenance {source, licence,
// observedAt} — provenance NEVER flattens, matching the app-wide invariant.

// ── Category taxonomy ────────────────────────────────────────────────────────
// The closed set of drink categories. A pint is "beer". "other" is the honest
// catch-all (a liqueur, a cider, an aperitif) so the CHECK constraint in the
// migration and this union never lie about what a row can be.
export const DRINK_CATEGORIES = [
  "beer",
  "wine",
  "whisky",
  "gin",
  "vodka",
  "rum",
  "cocktail",
  "shot",
  "other",
] as const;

export type DrinkCategory = (typeof DRINK_CATEGORIES)[number];

// Provenance for a single drink fact. Mirrors the shape the PRD pins for every
// drink: where the price/metadata came from, under what licence, and when it
// was observed — so the UI can always show a source chip and a stale price is
// never presented as live. `source:"seed"` + `licence:"n/a"` marks demo menu
// content (seeded for day-one liveliness), distinct from a real permissible
// source (a chain's own site, Wikidata, Open Food Facts…).
export type DrinkProvenance = {
  source: string;
  licence: string;
  // ISO-8601 timestamp the fact was observed/seeded.
  observedAt: string;
};

export type AlcoholType = "alcoholic" | "low-no" | "unknown";

// A rating rollup for a drink. Deliberately optional and minimal here — the
// full Bayesian/percentile aggregation is E3 (lib/ratings.ts). E1 only needs a
// place to hang a summary so the menu can show a star line when one exists;
// it never fabricates one (undefined = honestly unrated, never zero stars).
export type DrinkRatingSummary = {
  // Mean 1–5 stars (0.5 granularity), already aggregated upstream.
  average: number;
  // How many ratings back it — the menu hides the star line under the vote
  // floor (E3), so this is carried through, not just the average.
  count: number;
};

export type Drink = {
  id: string;
  category: DrinkCategory;
  name: string;
  producer?: string;
  // Alcohol by volume, percent (e.g. 4.5). Optional — honestly unknown when
  // absent, never defaulted to 0.
  abv?: number;
  alcoholType?: AlcoholType;
  style?: string;
  region?: string;
  // Free-text serving size ("pint", "175ml glass", "25ml", "double") — kept a
  // string, not an enum, because it varies wildly by category.
  servingSize?: string;
  priceGbp: number;
  provenance: DrinkProvenance;
  ratingSummary?: DrinkRatingSummary;
};

// ── Display metadata ─────────────────────────────────────────────────────────
// Human label + stable display order per category. `order` drives the menu's
// section ordering (beer first — it's the app's spine — then the spirits/wine
// in a sensible bar-menu sequence, "other" last). Colour tokens live in
// lib/categoryColors.ts (E5 owns the canonical palette); this file stays purely
// structural so the taxonomy and the palette can evolve independently.
export type CategoryMeta = {
  label: string;
  order: number;
};

export const CATEGORY_META: Record<DrinkCategory, CategoryMeta> = {
  beer: { label: "Beer", order: 0 },
  wine: { label: "Wine", order: 1 },
  cocktail: { label: "Cocktails", order: 2 },
  whisky: { label: "Whisky", order: 3 },
  gin: { label: "Gin", order: 4 },
  rum: { label: "Rum", order: 5 },
  vodka: { label: "Vodka", order: 6 },
  shot: { label: "Shots", order: 7 },
  other: { label: "Other", order: 8 },
};

export function isDrinkCategory(value: unknown): value is DrinkCategory {
  return (
    typeof value === "string" &&
    (DRINK_CATEGORIES as readonly string[]).includes(value)
  );
}

export function categoryLabel(category: DrinkCategory): string {
  return CATEGORY_META[category].label;
}

// Typical UK ABV (%) by category when a brand/drink has no specific value.
// `null` means honestly unknown (e.g. "other") — never fabricate 0.
export const CATEGORY_DEFAULT_ABV: Record<DrinkCategory, number | null> = {
  beer: 4,
  wine: 12,
  whisky: 40,
  gin: 40,
  vodka: 40,
  rum: 40,
  cocktail: 14,
  shot: 40,
  other: null,
};

/** Format ABV for quiet UI meta: `"4.2%"` or `""` when missing. */
export function formatAbv(abv: number | null | undefined): string {
  if (typeof abv !== "number" || !Number.isFinite(abv)) return "";
  return `${abv}%`;
}

/** Brand ABV when set; otherwise undefined (caller may fall back to category default). */
export function abvForBrand(brand: { abv?: number }): number | undefined {
  return typeof brand.abv === "number" && Number.isFinite(brand.abv)
    ? brand.abv
    : undefined;
}

export function alcoholTypeForDrink(input: {
  name: string;
  abv?: number;
}): AlcoholType {
  if (typeof input.abv === "number" && Number.isFinite(input.abv)) {
    return input.abv <= 0.5 ? "low-no" : "alcoholic";
  }
  return isNonAlcoholicDrink(input.name) ? "low-no" : "unknown";
}

// ── Grouping ─────────────────────────────────────────────────────────────────
export type DrinkCategoryGroup = {
  category: DrinkCategory;
  label: string;
  drinks: Drink[];
};

// Group a flat drink list into ordered category sections. Ordering:
//   1. sections follow CATEGORY_META.order (beer first, other last);
//   2. within a section, cheapest priced drink first, then by name for a
//      stable, deterministic render (unit-tested).
// Empty categories are omitted — the menu only renders sections that have
// drinks. Pure: does not mutate the input.
export function groupDrinksByCategory(drinks: Drink[]): DrinkCategoryGroup[] {
  const byCategory = new Map<DrinkCategory, Drink[]>();
  for (const drink of drinks) {
    const list = byCategory.get(drink.category) ?? [];
    list.push(drink);
    byCategory.set(drink.category, list);
  }

  return Array.from(byCategory.entries())
    .map(([category, list]) => ({
      category,
      label: CATEGORY_META[category].label,
      drinks: [...list].sort(
        (a, b) => a.priceGbp - b.priceGbp || a.name.localeCompare(b.name),
      ),
    }))
    .sort(
      (a, b) => CATEGORY_META[a.category].order - CATEGORY_META[b.category].order,
    );
}

// ── Legacy adapter (beer ↔ VenuePrice) ───────────────────────────────────────
// The seam that lets the Menu show today's beer WITHOUT touching lib/venues.ts:
// a venue's existing VenuePrice[] (pint rows) are viewed as Drink[] of category
// "beer". Kept structural so it only depends on the fields it reads — it takes a
// minimal `LegacyPintPrice` shape (satisfied by VenuePrice) rather than importing
// the hot lib/venues.ts type, so this file has zero contested dependencies.

export type LegacyPintPrice = {
  app_price_id: string;
  pint_name: string;
  price_gbp: number | null;
};

// A pint row → a beer Drink. Rows without a numeric price are skipped (a menu
// entry must carry a price; an unpriced pint is not a menu item). Provenance is
// the honest dataset baseline — sourced from the app dataset, not a live feed.
export function legacyPricesToDrinks(
  prices: LegacyPintPrice[],
  observedAt: string,
): Drink[] {
  const drinks: Drink[] = [];
  for (const price of prices) {
    if (typeof price.price_gbp !== "number") continue;
    const name = price.pint_name || "Pint";
    // Attach catalog ABV when the pint name resolves to a known beer — so the
    // venue Menu shows "Guinness · 4.2%". Unknown names stay ABV-less so
    // alcoholTypeForDrink can still mark low/no from the name alone.
    const beerId = normalizeBeer(name);
    const catalogAbv = beerId
      ? BEERS.find((beer) => beer.id === beerId)?.abv
      : undefined;
    const abv =
      typeof catalogAbv === "number" && Number.isFinite(catalogAbv)
        ? catalogAbv
        : undefined;
    drinks.push({
      id: `beer-${price.app_price_id}`,
      category: "beer",
      name,
      servingSize: "pint",
      ...(abv != null ? { abv } : {}),
      alcoholType: alcoholTypeForDrink({ name, abv }),
      priceGbp: price.price_gbp,
      provenance: {
        source: "app-dataset",
        licence: "first-party",
        observedAt,
      },
    });
  }
  return drinks;
}

// The inverse view: pull the beer Drinks back out of a mixed menu as legacy
// pint prices, so any beer-only path (cheapest-pint colouring, price stats) can
// keep consuming the pint shape unchanged. Non-beer drinks are dropped — beer
// is the only category the pint model can represent. Pure.
export function beerDrinksToLegacy(drinks: Drink[]): LegacyPintPrice[] {
  return drinks
    .filter((drink) => drink.category === "beer")
    .map((drink) => ({
      // Strip the "beer-" prefix legacyPricesToDrinks added, so the round-trip
      // recovers the original app_price_id.
      app_price_id: drink.id.startsWith("beer-") ? drink.id.slice(5) : drink.id,
      pint_name: drink.name,
      price_gbp: drink.priceGbp,
    }));
}
