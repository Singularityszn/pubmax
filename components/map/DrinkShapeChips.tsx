"use client";

// Compact drink-shape filter chips for the map toolbar — continues the
// landing-page alcohol-shape metaphor without inventing pin categories.
// Tapping a glyph sets the same soft query / cocktail amenity filters that
// /map?drink=… deep-links use (see lib/crawlUrl.ts).

import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import {
  CATEGORY_META,
  type DrinkCategory,
  categoryLabel,
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
  const q = filters.query.trim().toLowerCase();
  if (!q) {
    return filters.requireCocktails ? "cocktail" : null;
  }
  for (const cat of CHIP_CATEGORIES) {
    const label = categoryLabel(cat).toLowerCase();
    if (q === label || q === cat) return cat;
  }
  return null;
}

export default function DrinkShapeChips({
  filters,
  onFiltersChange,
}: DrinkShapeChipsProps) {
  const active = activeCategory(filters);

  function select(cat: DrinkCategory) {
    if (active === cat) {
      onFiltersChange({
        ...filters,
        query: "",
        requireCocktails: false,
      });
      return;
    }
    onFiltersChange({
      ...filters,
      query: categoryLabel(cat),
      requireCocktails: cat === "cocktail",
    });
  }

  return (
    <div className="drinkShapeChips" role="group" aria-label="Filter by drink shape">
      {CHIP_CATEGORIES.map((cat) => {
        const on = active === cat;
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
            <span className="drinkShapeChipLabel">{categoryLabel(cat)}</span>
          </button>
        );
      })}
    </div>
  );
}
