import { bundleRowDedupeDrinkKey } from "@/lib/bundleDrinkFields";
import {
  DRINK_CATEGORIES,
  isDrinkCategory,
  type DrinkCategory,
} from "@/lib/drinks";
import { listedServingComparisonKey } from "@/lib/listedPriceComparison";
import { priceStandingFor } from "@/lib/priceTier";
import {
  authoritativeBundleRows,
  bundleRowSupersedes,
  type UkPriceBundleRow,
} from "@/lib/ukPriceBundle";

export type ListedCategoryPrice = {
  source: "listed";
  category: DrinkCategory;
  drinkLabel: string | null;
  priceGbp: number;
  servingSize: string | null;
  sourceUrl: string;
  observedAt: string;
};

const MAX_QUOTES_PER_CATEGORY = 4;
const MAX_SOURCE_URL_LENGTH = 2048;
const MAX_SERVING_LENGTH = 48;

/** Venue-scoped, attributable non-beer quotes from the approved bundle. */
export function listedCategoryPrices(
  rows: readonly UkPriceBundleRow[],
  now: number = Date.now(),
): ListedCategoryPrice[] {
  const eligible: { quote: ListedCategoryPrice; index: number; row: UkPriceBundleRow }[] = [];

  for (const [index, row] of authoritativeBundleRows(rows).entries()) {
    if (
      row.standing !== "listed" ||
      !isDrinkCategory(row.category) ||
      row.category === "beer"
    ) {
      continue;
    }
    const decision = priceStandingFor(
      {
        listed: {
          priceGbp: row.priceGbp,
          sourceUrl: row.sourceUrl ?? "",
          observedAt: row.observedAt,
        },
      },
      now,
    );
    if (
      decision.standing !== "listed" ||
      !decision.sourceUrl ||
      decision.sourceUrl.length > MAX_SOURCE_URL_LENGTH ||
      !decision.asOf ||
      decision.priceGbp === null
    ) {
      continue;
    }
    const rawServing = (row as UkPriceBundleRow & { servingSize?: unknown })
      .servingSize;
    const servingSize =
      typeof rawServing === "string" &&
      rawServing.trim().length > 0 &&
      rawServing.length <= MAX_SERVING_LENGTH
        ? rawServing.trim()
        : null;
    eligible.push({
      quote: {
        source: "listed",
        category: row.category,
        drinkLabel: row.drinkLabel ?? null,
        priceGbp: decision.priceGbp,
        servingSize,
        sourceUrl: decision.sourceUrl,
        observedAt: decision.asOf,
      },
      index,
      row,
    });
  }

  // A later reading of the same named drink and serving replaces its earlier
  // price. Unnamed rows have no drink identity and stay separate.
  const currentByDrink = new Map<string, (typeof eligible)[number]>();
  const unnamed: (typeof eligible)[number][] = [];
  for (const entry of eligible) {
    const drinkKey = entry.row.drinkLabel?.trim()
      ? bundleRowDedupeDrinkKey(entry.row)
      : "";
    if (!drinkKey) {
      unnamed.push(entry);
      continue;
    }
    const servingKey =
      listedServingComparisonKey(entry.quote.category, entry.quote.servingSize) ??
      entry.quote.servingSize?.toLowerCase() ??
      null;
    const key = JSON.stringify([entry.quote.category, drinkKey, servingKey]);
    const held = currentByDrink.get(key);
    if (!held || bundleRowSupersedes(entry.row, held.row)) {
      currentByDrink.set(key, entry);
    }
  }

  // A stated, identical serving can be compared by price. Unknown and mixed
  // servings retain source order by recency, never a price rank.
  const current = [...currentByDrink.values(), ...unnamed];
  current.sort(
    (left, right) =>
      right.quote.observedAt.localeCompare(left.quote.observedAt) ||
      left.index - right.index,
  );
  const result: ListedCategoryPrice[] = [];
  for (const category of DRINK_CATEGORIES) {
    if (category === "beer") continue;
    const bestByServing = new Map<string, (typeof eligible)[number]>();
    const neutral: (typeof eligible)[number][] = [];
    for (const entry of current) {
      if (entry.quote.category !== category) continue;
      const key = listedServingComparisonKey(category, entry.quote.servingSize);
      if (key === null) {
        neutral.push(entry);
        continue;
      }
      const current = bestByServing.get(key);
      if (!current || entry.quote.priceGbp < current.quote.priceGbp) {
        bestByServing.set(key, entry);
      }
    }
    const comparable = [...bestByServing.values()].sort(
      (left, right) =>
        right.quote.observedAt.localeCompare(left.quote.observedAt) ||
        left.index - right.index,
    );
    for (const { quote } of [...comparable, ...neutral].slice(
      0,
      MAX_QUOTES_PER_CATEGORY,
    )) {
      result.push(quote);
    }
  }
  return result;
}
