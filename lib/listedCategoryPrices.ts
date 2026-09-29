import { DRINK_CATEGORIES, isDrinkCategory, type DrinkCategory } from "@/lib/drinks";
import { priceStandingFor } from "@/lib/priceTier";
import { authoritativeBundleRows, type UkPriceBundleRow } from "@/lib/ukPriceBundle";

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
  const eligible: { quote: ListedCategoryPrice; index: number }[] = [];

  for (const [index, row] of authoritativeBundleRows(rows).entries()) {
    if (row.standing !== "listed" || !isDrinkCategory(row.category) || row.category === "beer") {
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
    const rawServing = (row as UkPriceBundleRow & { servingSize?: unknown }).servingSize;
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
    });
  }

  // Recency selects bounded quotes. Price never orders unknown or mixed serves.
  eligible.sort((left, right) =>
    right.quote.observedAt.localeCompare(left.quote.observedAt) || left.index - right.index,
  );
  const result: ListedCategoryPrice[] = [];
  for (const category of DRINK_CATEGORIES) {
    if (category === "beer") continue;
    let count = 0;
    for (const { quote } of eligible) {
      if (quote.category !== category) continue;
      result.push(quote);
      if (++count === MAX_QUOTES_PER_CATEGORY) break;
    }
  }
  return result;
}
