"use client";

// Compact drink-shape filter chips for the map toolbar — continues the
// landing-page alcohol-shape metaphor without inventing pin categories.
// Tapping a glyph sets the same drinkCategory lens that /map?drink=… deep-links
// use (see lib/crawlUrl.ts). Do NOT also set filters.query — that AND'd with
// drinkCategory and dropped slim pins whose category isn't in name/searchText.

import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import {
  CATEGORY_DEFAULT_ABV,
  CATEGORY_META,
  type DrinkCategory,
  categoryLabel,
  formatAbv,
} from "@/lib/drinks";
import type { Filters } from "@/lib/venues";

const CHIP_CATEGORIES: DrinkCategory[] = [
  "beer",
  "wine",
  "cocktail",
  "whisky",
  "gin",
  "rum",
];

type DrinkShapeChipsProps = {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
};

function activeCategory(filters: Filters): DrinkCategory | null {
  const lens = filters.drinkCategory.trim().toLowerCase();
  if (CHIP_CATEGORIES.includes(lens as DrinkCategory)) return lens as DrinkCategory;
  return filters.requireCocktails ? "cocktail" : null;
}

export function nextDrinkShapeFilters(filters: Filters, cat: DrinkCategory): Filters {
  const active = activeCategory(filters);
  if (active === cat) {
    return {
      ...filters,
      requireCocktails: false,
      drinkCategory: "",
      drinkBrand: "",
    };
  }
  // Switching to a drink lens clears the food lens entirely so the two
  // filter modes don't compound (cuisineTag alone wasn't enough — leftover
  // requireFood kept the Food control lit and AND'd amenity filtering).
  return {
    ...filters,
    requireCocktails: cat === "cocktail",
    drinkCategory: cat,
    drinkBrand: "",
    cuisineTag: "",
    requireFood: false,
  };
}

export default function DrinkShapeChips({
  filters,
  onFiltersChange,
}: DrinkShapeChipsProps) {
  const active = activeCategory(filters);

  function select(cat: DrinkCategory) {
    onFiltersChange(nextDrinkShapeFilters(filters, cat));
  }

  return (
    <div className="drinkShapeChips" role="group" aria-label="Filter by drink shape">
      {CHIP_CATEGORIES.map((cat) => {
        const on = active === cat;
        const defaultAbv = formatAbv(CATEGORY_DEFAULT_ABV[cat]);
        const label = defaultAbv
          ? `${categoryLabel(cat)} · ~${defaultAbv}`
          : categoryLabel(cat);
        return (
          <button
            key={cat}
            type="button"
            className={on ? "drinkShapeChip isOn" : "drinkShapeChip"}
            aria-pressed={on}
            aria-label={`${CATEGORY_META[cat].label}${on ? " (selected)" : ""}`}
            onClick={() => select(cat)}
          >
            <DrinkGlyph category={cat} size={22} inheritColor={on} />
            <span className="drinkShapeChipLabel">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
