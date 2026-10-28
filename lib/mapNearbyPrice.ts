import { findBrand, haystackMatchesBrand } from "@/lib/drinkBrands";
import { selectDrinkBrandPriceForVenue } from "@/lib/drinkBrandLanding";
import { drinkCategoryFromText } from "@/lib/drinkCategoryFromText";
import { drinkLabelMatchesSubtype, selectObservedSubtypePriceForVenue } from "@/lib/drinkSubtypeObservedPrice";
import { drinkSubtypeMembers, haystackIsTopShelf, parseDrinkSubtypeParam } from "@/lib/drinkSubtypes";
import { CATEGORY_META, isDrinkCategory, legacyPricesToDrinks, type DrinkCategory } from "@/lib/drinks";
import { firstHttp } from "@/lib/httpUrl";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import type { NearbyPrice } from "@/lib/mapNearbyRecommendations";
import { isCurrentVenueRow, isLivePriceRow } from "@/lib/priceRowEligibility.mjs";
import type { Filters, Venue, VenuePrice } from "@/lib/venues";

/** Only a serving stated in the selected row can name a non-pint measure. */
function recordedServing(row: VenuePrice): string {
  const text = `${row.pint_name} ${row.price_text}`;
  return text.match(/\b(?:\d{2,4}\s*(?:ml|cl)|half\s+pint|pint|single|double)\b/i)?.[0] ?? "";
}

function positivePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function selectedCategory(filters: Filters): DrinkCategory | null {
  if (filters.drinkCategory) return isDrinkCategory(filters.drinkCategory) ? filters.drinkCategory : null;
  const brand = findBrand(filters.drinkBrand);
  const subtype = parseDrinkSubtypeParam(filters.drinkSubtype);
  return brand?.category ?? subtype?.category ?? (filters.requireNonAlcoholic ? null : "beer");
}

/** Read already loaded rows only. A category report never proves a brand, subtype or serving. */
export function mapNearbyPriceForVenue(
  venue: Venue,
  filters: Filters,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null = null,
): NearbyPrice | null {
  const category = selectedCategory(filters);
  if (filters.drinkCategory && !category) return null;
  const brand = filters.drinkBrand ? findBrand(filters.drinkBrand) : null;
  const subtype = filters.drinkSubtype ? parseDrinkSubtypeParam(filters.drinkSubtype, category) : null;
  if ((filters.drinkBrand && !brand) || (filters.drinkSubtype && !subtype)) return null;
  if (brand && category && brand.category !== category) return null;
  const categoryMatches = (value: DrinkCategory) => category
    ? value === category
    : filters.requireNonAlcoholic && (value === "alcohol-free" || value === "soft-drink");
  const labelMatches = (label: string) => (!brand || haystackMatchesBrand(label, brand.brand))
    && (!subtype || drinkSubtypeMembers(subtype).some((member) => drinkLabelMatchesSubtype(label, member)))
    && (!filters.topShelfOnly || haystackIsTopShelf(label));
  const candidates: NearbyPrice[] = [];
  const rows = venue.prices.filter((row) => {
    const rowCategory = drinkCategoryFromText(row.pint_name) ?? "beer";
    return isCurrentVenueRow(row) && positivePrice(row.price_gbp)
      && (rowCategory !== "beer" || isLivePriceRow(row))
      && categoryMatches(rowCategory) && labelMatches(row.pint_name);
  });
  const eligible = { ...venue, prices: rows };
  const selectedRow = brand ? selectDrinkBrandPriceForVenue(eligible, brand.brand) : null;
  const subtypePrice = subtype ? selectObservedSubtypePriceForVenue(eligible, subtype.id) : null;
  const narrowedRows = selectedRow ? [selectedRow] : subtypePrice
    ? rows.filter((row) => row.pint_name === subtypePrice.drinkLabel && row.price_gbp === subtypePrice.priceGbp)
    : rows;
  for (const row of narrowedRows) {
    const drink = legacyPricesToDrinks([row])[0];
    if (!drink || !positivePrice(drink.priceGbp)) continue;
    const rowCategory = drinkCategoryFromText(row.pint_name) ?? "beer";
    const measureLabel = recordedServing(row) || (rowCategory === "beer" ? drink.servingSize ?? "" : "");
    candidates.push({
      priceGbp: drink.priceGbp,
      drinkLabel: drink.name,
      category: rowCategory,
      measureLabel,
      servingKnown: Boolean(measureLabel),
      ...(drink.provenance.source !== "app-dataset" ? { sourceLabel: drink.provenance.source } : {}),
      ...(drink.provenance.sourceUrl ? { sourceUrl: drink.provenance.sourceUrl } : {}),
      ...(drink.provenance.observedAt ? { observedAt: drink.provenance.observedAt } : {}),
    });
  }
  // Slim and community-merged pint summaries retain their own price and named drink.
  const summaryCategory = drinkCategoryFromText(venue.cheapestPint) ?? "beer";
  const community = venue.latestContributorPrice === venue.cheapestPrice;
  if ((venue.prices.length === 0 || community) && summaryCategory === "beer" && categoryMatches(summaryCategory)
    && positivePrice(venue.cheapestPrice) && isLivePriceRow({ price_gbp: venue.cheapestPrice })
    && venue.cheapestPint.trim() && labelMatches(venue.cheapestPint)) {
    candidates.push({
      priceGbp: venue.cheapestPrice, drinkLabel: venue.cheapestPint, measureLabel: "pint",
      servingKnown: true, category: "beer",
      ...(community ? { sourceLabel: "Drinker reports", observedAt: venue.latestContributorAt ?? undefined }
        : { sourceLabel: venue.priceSource, observedAt: venue.priceObservedAt }),
    });
  }
  const lens = lensPrices?.get(venue.id);
  if (!brand && !subtype && !filters.topShelfOnly && lens?.venueId === venue.id && lens.category
    && categoryMatches(lens.category) && positivePrice(lens.priceGbp)) {
    const submittedDate = typeof lens.submittedAt === "number" ? new Date(lens.submittedAt) : null;
    const observedAt = lens.observedAt ?? (submittedDate && Number.isFinite(submittedDate.getTime())
      ? submittedDate.toISOString() : undefined);
    candidates.push({
      priceGbp: lens.priceGbp, drinkLabel: CATEGORY_META[lens.category].label, category: lens.category,
      measureLabel: "", servingKnown: false,
      ...(lens.source === "community" ? { sourceLabel: "Drinker reports" } : {}),
      ...(firstHttp(lens.sourceUrl) ? { sourceUrl: firstHttp(lens.sourceUrl)! } : {}),
      ...(observedAt ? { observedAt } : {}),
    });
  }
  return candidates.sort((a, b) => a.priceGbp - b.priceGbp
    || Number(b.servingKnown) - Number(a.servingKnown)
    || a.drinkLabel.localeCompare(b.drinkLabel))[0] ?? null;
}
