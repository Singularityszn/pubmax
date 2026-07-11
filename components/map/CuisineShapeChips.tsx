"use client";

// Compact cuisine-tag filter chips for the map toolbar — mirrors the drink
// shape chips pattern but for food. Tapping a chip sets cuisineTag +
// requireFood and clears the drink lens so the two modes don't compound.
// Deep-links: /map?food=1&cuisine=pizza (see lib/crawlUrl.ts).

import type { CuisineTag } from "@/lib/cuisineTags";
import type { Filters } from "@/lib/venues";

const CHIP_CUISINES = [
  "pizza",
  "burger",
  "roast",
  "tapas",
  "gastropub",
  "steak",
] as const satisfies readonly CuisineTag[];

const CUISINE_LABELS: Record<(typeof CHIP_CUISINES)[number], string> = {
  pizza: "Pizza",
  burger: "Burger",
  roast: "Roast",
  tapas: "Tapas",
  gastropub: "Gastropub",
  steak: "Steak",
};

type CuisineShapeChipsProps = {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
};

function activeTag(filters: Filters): (typeof CHIP_CUISINES)[number] | null {
  const tag = filters.cuisineTag.trim().toLowerCase() as (typeof CHIP_CUISINES)[number];
  return (CHIP_CUISINES as readonly string[]).includes(tag) ? tag : null;
}

export function nextCuisineShapeFilters(
  filters: Filters,
  tag: (typeof CHIP_CUISINES)[number],
): Filters {
  const active = activeTag(filters);
  if (active === tag) {
    // Toggle off: exit food-lens mode.
    return {
      ...filters,
      cuisineTag: "",
      requireFood: false,
    };
  }
  // Selecting a cuisine chip sets food requirement and clears the drink lens
  // so the two filter modes don't AND together in confusing ways.
  return {
    ...filters,
    cuisineTag: tag,
    requireFood: true,
    drinkCategory: "",
    drinkBrand: "",
    requireCocktails: false,
  };
}

export default function CuisineShapeChips({
  filters,
  onFiltersChange,
}: CuisineShapeChipsProps) {
  const active = activeTag(filters);

  function select(tag: (typeof CHIP_CUISINES)[number]) {
    onFiltersChange(nextCuisineShapeFilters(filters, tag));
  }

  return (
    <div className="drinkShapeChips" role="group" aria-label="Filter by cuisine">
      {CHIP_CUISINES.map((tag) => {
        const on = active === tag;
        return (
          <button
            key={tag}
            type="button"
            className={on ? "drinkShapeChip isOn" : "drinkShapeChip"}
            aria-pressed={on}
            aria-label={`${CUISINE_LABELS[tag]}${on ? " (selected)" : ""}`}
            onClick={() => select(tag)}
          >
            <span className="drinkShapeChipLabel">{CUISINE_LABELS[tag]}</span>
          </button>
        );
      })}
    </div>
  );
}
