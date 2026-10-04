import {
  DRINK_CATEGORIES,
  isDrinkCategory,
  type DrinkCategory,
} from "@/lib/drinks";
import {
  listedServingComparisonKey,
  listedServingGroup,
  listedDrinkMatchesSubtype,
} from "@/lib/listedPriceComparison";
import { priceStandingFor } from "@/lib/priceTier";
import { normalizeUkPriceBundleDrinkLabel } from "@/lib/bundleDrinkFields";
import {
  authoritativeBundleRows,
  bundleRowServingSize,
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

export const MAX_QUOTES_PER_CATEGORY = 4;
export const MAX_SOURCE_URL_LENGTH = 2048;
export const MAX_SERVING_LENGTH = 48;

function eligibleListedQuote(
  row: UkPriceBundleRow,
  categories: readonly DrinkCategory[],
  now: number,
  drinkSubtype: string | null | undefined,
): ListedCategoryPrice | null {
  if (
    row.standing !== "listed" ||
    !isDrinkCategory(row.category) ||
    !categories.includes(row.category)
  ) {
    return null;
  }
  if (!listedDrinkMatchesSubtype(row.category, row.drinkLabel, drinkSubtype)) return null;
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
    return null;
  }
  const rawServing = bundleRowServingSize(row);
  const servingSize =
    typeof rawServing === "string" &&
    rawServing.trim().length > 0 &&
    rawServing.length <= MAX_SERVING_LENGTH
      ? rawServing.trim()
      : null;
  return {
    source: "listed",
    category: row.category,
    drinkLabel: row.drinkLabel ?? null,
    priceGbp: decision.priceGbp,
    servingSize,
    sourceUrl: decision.sourceUrl,
    observedAt: decision.asOf,
  };
}

/** Venue-scoped approved quotes. Beer is opt-in for the unranked base sheet. */
export function listedCategoryPrices(
  rows: readonly UkPriceBundleRow[],
  now: number = Date.now(),
  {
    includeBeer = false,
    serving,
    drinkSubtype,
    drinkLabel,
    onServingGroup,
  }: {
    includeBeer?: boolean;
    serving?: string | null;
    drinkSubtype?: string | null;
    drinkLabel?: string;
    onServingGroup?: (category: DrinkCategory, group: string) => void;
  } = {},
): ListedCategoryPrice[] {
  const categories: readonly DrinkCategory[] = includeBeer
    ? DRINK_CATEGORIES
    : DRINK_CATEGORIES.filter((category) => category !== "beer");
  const eligible: { quote: ListedCategoryPrice; index: number; row: UkPriceBundleRow }[] = [];

  for (const [index, row] of authoritativeBundleRows(rows).entries()) {
    const quote = eligibleListedQuote(row, categories, now, drinkSubtype);
    if (quote) eligible.push({ quote, index, row });
  }

  // A later reading of the same named drink and serving replaces its earlier
  // price. Unnamed rows have no drink identity and stay separate.
  const currentByDrink = new Map<string, (typeof eligible)[number]>();
  const unnamed: (typeof eligible)[number][] = [];
  for (const entry of eligible) {
    const drinkKey = entry.row.drinkLabel?.trim().toLowerCase() ?? "";
    if (!drinkKey) {
      unnamed.push(entry);
      continue;
    }
    const servingKey =
      listedServingComparisonKey(entry.quote.category, entry.quote.servingSize, drinkSubtype) ??
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
  // Exact named acceptance follows supersession, so a new source spelling
  // cannot leave an older same-name price alive. Restrict before min/cap.
  const current = [...currentByDrink.values(), ...unnamed].filter(({ quote }) =>
    drinkLabel === undefined || normalizeUkPriceBundleDrinkLabel(quote.drinkLabel) === drinkLabel,
  );
  current.sort(
    (left, right) =>
      right.quote.observedAt.localeCompare(left.quote.observedAt) ||
      left.index - right.index,
  );
  const result: ListedCategoryPrice[] = [];
  for (const category of categories) {
    const bestByServing = new Map<string, (typeof eligible)[number]>();
    const neutral: (typeof eligible)[number][] = [];
    for (const entry of current) {
      if (entry.quote.category !== category) continue;
      const key = listedServingComparisonKey(category, entry.quote.servingSize, drinkSubtype);
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
    for (const { quote } of comparable) {
      const group = listedServingGroup(category, quote.servingSize, drinkSubtype);
      if (group) onServingGroup?.(category, group);
    }
    const selectedGroup = listedServingGroup(category, serving, drinkSubtype);
    const selectedComparable = selectedGroup
      ? comparable.filter(
          ({ quote }) => listedServingGroup(category, quote.servingSize, drinkSubtype) === selectedGroup,
        )
      : comparable;
    const candidates = selectedGroup
      ? selectedComparable
      : [...comparable, ...neutral];
    for (const { quote } of candidates.slice(0, MAX_QUOTES_PER_CATEGORY)) {
      result.push(quote);
    }
  }
  return result;
}
