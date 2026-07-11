"use client";

import { Route, Search, Utensils, Wine, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import CitySwitcher from "@/components/map/CitySwitcher";
import CuisineShapeChips from "@/components/map/CuisineShapeChips";
import DrinkShapeChips from "@/components/map/DrinkShapeChips";
import FavoritePintPicker from "@/components/map/FavoritePintPicker";
import type { CityId } from "@/lib/cities";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import type { Filters } from "@/lib/venues";

import "./mapToolbar.css";

// Compact map chrome: search + Plan on the first row; drink lens / chips stay
// behind an optional expand so phones keep map mid-field free.
type MapToolbarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  favoritePint: string | null;
  onFavoritePintChange: (beerId: string | null) => void;
  drinkCategory: string;
  drinkBrand: string;
  onDrinkLensChange: (next: { drinkCategory: string; drinkBrand: string }) => void;
  planningOpen: boolean;
  onTogglePlanning: () => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  /** Active city for the map switcher (defaults to London). */
  cityId?: CityId;
  /**
   * Number of venues currently visible on the map after all filters are applied.
   * When a food/cuisine filter is active and this count is known, a contextual
   * hint like "Showing 8 pubs tagged for pizza" is shown below the chips —
   * especially useful when the tag is niche and matches are sparse.
   */
  filteredVenueCount?: number;
  /**
   * Called when the user presses the Search CTA button at the bottom of the
   * Food or Drinks expanded panel. The panel closes itself; the parent may
   * additionally fit the map to the filtered venues.
   */
  onSearchApply?: () => void;
};

/**
 * Label for the "Search map" CTA button shown at the bottom of the Food panel.
 * Pure — safe to unit-test without a render.
 */
export function foodPanelSearchLabel(
  filters: Pick<Filters, "cuisineTag" | "requireFood">,
  count: number | undefined,
): string {
  const tag = filters.cuisineTag?.trim();
  if (tag) {
    if (count === undefined) return `Show ${tag} pubs`;
    if (count === 0) return `No ${tag} pubs found`;
    return `Show ${count} ${tag} pub${count === 1 ? "" : "s"}`;
  }
  if (filters.requireFood) {
    if (count === undefined) return "Show food pubs";
    if (count === 0) return "No food pubs found";
    return `Show ${count} food pub${count === 1 ? "" : "s"}`;
  }
  return "Search map";
}

/**
 * Label for the "Search map" CTA button shown at the bottom of the Drinks panel.
 * Pure — safe to unit-test without a render.
 */
export function drinksPanelSearchLabel(
  filters: Pick<Filters, "drinkCategory" | "requireCocktails">,
  favoritePint: string | null,
  count: number | undefined,
): string {
  const cat = filters.drinkCategory?.trim();
  if (cat) {
    const label = cat.charAt(0).toUpperCase() + cat.slice(1);
    if (count === undefined) return `Show ${label} pubs`;
    if (count === 0) return `No ${label} pubs found`;
    return `Show ${count} ${label} pub${count === 1 ? "" : "s"}`;
  }
  if (filters.requireCocktails) {
    if (count === undefined) return "Show cocktail pubs";
    if (count === 0) return "No cocktail pubs found";
    return `Show ${count} cocktail pub${count === 1 ? "" : "s"}`;
  }
  if (favoritePint) {
    if (count === undefined) return "Show pubs";
    if (count === 0) return "No matching pubs found";
    return `Show ${count} pub${count === 1 ? "" : "s"}`;
  }
  return "Search map";
}

export default function MapToolbar({
  query,
  onQueryChange,
  favoritePint,
  onFavoritePintChange,
  drinkCategory,
  drinkBrand,
  onDrinkLensChange,
  planningOpen,
  onTogglePlanning,
  filters,
  onFiltersChange,
  cityId = DEFAULT_CITY_ID,
  filteredVenueCount,
  onSearchApply,
}: MapToolbarProps) {
  const [drinksOpen, setDrinksOpen] = useState(false);
  const [foodOpen, setFoodOpen] = useState(false);
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => {
      // Defer setState out of the effect body (react-hooks/set-state-in-effect).
      void Promise.resolve().then(() => setIsMobile(mq.matches));
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const favoritePicker = (
    <FavoritePintPicker
      value={favoritePint}
      onChange={onFavoritePintChange}
      drinkCategory={drinkCategory}
      drinkBrand={drinkBrand}
      onDrinkLensChange={onDrinkLensChange}
    />
  );
  // Drive from real drink-lens state only — free-text "beer garden" must not
  // light the Drinks control as if a drink filter were applied.
  const drinksActive =
    filters.requireCocktails || Boolean(drinkCategory) || Boolean(favoritePint);
  const foodActive = filters.requireFood || Boolean(filters.cuisineTag);

  // Auto-expand food chips on rising edge only (deep-link / chip select).
  // Do NOT bind panel visibility to foodActive — that trapped the panel open
  // and could show Drinks + Food chip rows at once.
  const wasFoodActive = useRef(false);
  useEffect(() => {
    if (foodActive && !wasFoodActive.current) {
      void Promise.resolve().then(() => {
        setFoodOpen(true);
        setDrinksOpen(false);
      });
    }
    wasFoodActive.current = foodActive;
  }, [foodActive]);

  return (
    <div className="mapToolbar" role="search">
      <div className="mapToolbarRow">
        <div className="mapToolbarSearch">
          <Search size={15} aria-hidden="true" />
          <input
            id="mapSearchInput"
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSearchApply?.();
              }
            }}
            placeholder="Search pubs or area…"
            aria-label="Search pubs by name, area, borough or drink"
          />
          {query ? (
            <button
              type="button"
              className="mapToolbarClear"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          ) : null}
        </div>

        {isMobile === false ? <div className="mapToolbarDesktopExtras">{favoritePicker}</div> : null}

        <button
          type="button"
          className={
            drinksOpen || drinksActive
              ? "mapToolbarDrinksBtn isActive"
              : "mapToolbarDrinksBtn"
          }
          aria-pressed={drinksOpen}
          aria-expanded={drinksOpen}
          aria-label={drinksOpen ? "Hide drink filters" : "Show drink filters"}
          onClick={() => {
            setDrinksOpen((open) => !open);
            setFoodOpen(false);
          }}
        >
          <Wine size={15} aria-hidden="true" />
          <span>Drinks</span>
        </button>

        <button
          type="button"
          className={
            foodOpen || foodActive
              ? "mapToolbarDrinksBtn isActive"
              : "mapToolbarDrinksBtn"
          }
          aria-pressed={foodOpen}
          aria-expanded={foodOpen}
          aria-label={foodOpen ? "Hide food filters" : "Show food filters"}
          onClick={() => {
            setFoodOpen((open) => !open);
            setDrinksOpen(false);
          }}
        >
          <Utensils size={15} aria-hidden="true" />
          <span>Food</span>
        </button>

        <button
          type="button"
          className={planningOpen ? "planBtn active" : "planBtn"}
          onClick={onTogglePlanning}
          aria-pressed={planningOpen}
          aria-label={planningOpen ? "Close plan" : "Plan tonight"}
        >
          <Route size={15} aria-hidden="true" />
          <span className="planBtnFull">{planningOpen ? "Close plan" : "Plan tonight"}</span>
          <span className="planBtnShort">{planningOpen ? "Close" : "Plan"}</span>
        </button>

        <CitySwitcher cityId={cityId} />
      </div>

      <div className={drinksOpen ? "mapToolbarDrinks isOpen" : "mapToolbarDrinks"}>
        {isMobile === true ? <div className="mapToolbarDrinksLens">{favoritePicker}</div> : null}
        <DrinkShapeChips filters={filters} onFiltersChange={onFiltersChange} />
        <button
          type="button"
          className="mapToolbarApplyBtn"
          disabled={
            drinksPanelSearchLabel(filters, favoritePint, filteredVenueCount).startsWith("No ")
          }
          onClick={() => {
            setDrinksOpen(false);
            onSearchApply?.();
          }}
        >
          {drinksPanelSearchLabel(filters, favoritePint, filteredVenueCount)}
        </button>
      </div>

      <div className={foodOpen ? "mapToolbarDrinks isOpen" : "mapToolbarDrinks"}>
        <CuisineShapeChips filters={filters} onFiltersChange={onFiltersChange} />
        {/* Contextual food-mode hint — shows the active tag and match count so
            users always know which filter is live and how many pubs matched.
            Especially helpful for niche tags ("tapas", "steak") with few hits. */}
        {filters.cuisineTag ? (
          <p
            className="mapToolbarFoodHint"
            role="status"
            aria-live="polite"
          >
            {filteredVenueCount !== undefined
              ? filteredVenueCount === 0
                ? `No pubs tagged for ${filters.cuisineTag} — try a different tag`
                : `Showing ${filteredVenueCount} ${filteredVenueCount === 1 ? "pub" : "pubs"} tagged for ${filters.cuisineTag}`
              : `Showing pubs tagged for ${filters.cuisineTag}`}
          </p>
        ) : null}
        <button
          type="button"
          className="mapToolbarApplyBtn"
          disabled={
            foodPanelSearchLabel(filters, filteredVenueCount).startsWith("No ")
          }
          onClick={() => {
            setFoodOpen(false);
            onSearchApply?.();
          }}
        >
          {foodPanelSearchLabel(filters, filteredVenueCount)}
        </button>
      </div>
    </div>
  );
}
