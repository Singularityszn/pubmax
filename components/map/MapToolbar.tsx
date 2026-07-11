"use client";

import { Route, Search, SlidersHorizontal, Utensils, Wine, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
   * Shown in the sticky filter status strip and the panel apply buttons.
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

/**
 * Text for the sticky filter status strip shown below the toolbar row when any
 * lens is active. Generalises the old food-only hint to all active filters.
 * Pure — safe to unit-test without a render.
 */
export function filterStripText(
  query: string,
  filters: Pick<Filters, "cuisineTag" | "requireFood" | "drinkCategory" | "requireCocktails">,
  favoritePint: string | null,
  drinkCategoryProp: string,
  count: number | undefined,
): string {
  const labels: string[] = [];

  if (filters.cuisineTag?.trim()) {
    const tag = filters.cuisineTag.trim();
    labels.push(tag.charAt(0).toUpperCase() + tag.slice(1));
  } else if (filters.requireFood) {
    labels.push("Food");
  }

  const drinkCat = (filters.drinkCategory || drinkCategoryProp).trim();
  if (drinkCat) {
    labels.push(drinkCat.charAt(0).toUpperCase() + drinkCat.slice(1));
  } else if (filters.requireCocktails) {
    labels.push("Cocktails");
  } else if (favoritePint) {
    labels.push("Your pint");
  }

  if (query.trim()) {
    labels.push(`"${query.trim()}"`);
  }

  if (count !== undefined && labels.length > 0) {
    return `${count} pub${count === 1 ? "" : "s"} · ${labels.join(", ")}`;
  }
  if (count !== undefined) {
    return `${count} pub${count === 1 ? "" : "s"}`;
  }
  return labels.join(" · ");
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
  // Desktop: separate panel state for Drinks and Food
  const [drinksOpen, setDrinksOpen] = useState(false);
  const [foodOpen, setFoodOpen] = useState(false);
  // Mobile: combined Filters panel state + active tab
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filtersTab, setFiltersTab] = useState<"drinks" | "food">("drinks");

  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => {
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
  const filtersActive = drinksActive || foodActive;

  // Whether the sticky strip below the toolbar row should be visible.
  const stripActive = filtersActive || Boolean(query);
  const stripText = stripActive
    ? filterStripText(query, filters, favoritePint, drinkCategory, filteredVenueCount)
    : "";

  // Clear all active lenses in one tap.
  const handleClearAll = useCallback(() => {
    onQueryChange("");
    onFiltersChange({
      ...filters,
      cuisineTag: "",
      requireFood: false,
      drinkCategory: "",
      requireCocktails: false,
    });
    onFavoritePintChange(null);
    onDrinkLensChange({ drinkCategory: "", drinkBrand: "" });
    setDrinksOpen(false);
    setFoodOpen(false);
    setFiltersOpen(false);
  }, [filters, onQueryChange, onFiltersChange, onFavoritePintChange, onDrinkLensChange]);

  // Auto-expand food panel on rising edge only (deep-link / chip select).
  // Do NOT bind panel visibility to foodActive — that trapped the panel open
  // and could show Drinks + Food chip rows at once.
  const wasFoodActive = useRef(false);
  useEffect(() => {
    if (foodActive && !wasFoodActive.current) {
      void Promise.resolve().then(() => {
        if (isMobile) {
          setFiltersOpen(true);
          setFiltersTab("food");
        } else {
          setFoodOpen(true);
          setDrinksOpen(false);
        }
      });
    }
    wasFoodActive.current = foodActive;
  }, [foodActive, isMobile]);

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

        {/* Desktop-only: favorite pint picker inline */}
        {isMobile === false ? <div className="mapToolbarDesktopExtras">{favoritePicker}</div> : null}

        {/* ── Mobile: single combined Filters button ────────────────────── */}
        {isMobile === true ? (
          <button
            type="button"
            className={
              filtersOpen || filtersActive
                ? "mapToolbarDrinksBtn isActive"
                : "mapToolbarDrinksBtn"
            }
            aria-pressed={filtersOpen}
            aria-expanded={filtersOpen}
            aria-label={filtersOpen ? "Hide filters" : "Show filters"}
            onClick={() => {
              if (!filtersOpen) {
                // Open to the tab with active filters; default to drinks
                if (foodActive && !drinksActive) setFiltersTab("food");
                else setFiltersTab("drinks");
              }
              setFiltersOpen((open) => !open);
            }}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            <span>Filters</span>
            {filtersActive ? <span className="mapToolbarFilterDot" aria-hidden="true" /> : null}
          </button>
        ) : null}

        {/* ── Desktop: separate Drinks and Food buttons ─────────────────── */}
        {isMobile !== true ? (
          <>
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
          </>
        ) : null}

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

        {/* CitySwitcher lives here on desktop; on mobile it moves to SiteNav. */}
        <div className="mapToolbarCityDesktop">
          <CitySwitcher cityId={cityId} />
        </div>
      </div>

      {/* ── Sticky filter status strip ─────────────────────────────────── */}
      {/* Shows below the toolbar row whenever any lens or query is active.
          Replaces the old food-only mapToolbarFoodHint and generalises it. */}
      {stripActive && stripText ? (
        <div className="mapFilterStrip" role="status" aria-live="polite">
          <span className="mapFilterStripText">{stripText}</span>
          <button
            type="button"
            className="mapFilterStripClear"
            onClick={handleClearAll}
            aria-label="Clear all filters"
          >
            Clear
          </button>
        </div>
      ) : null}

      {/* ── Mobile: combined Drinks + Food panel with segmented tabs ──── */}
      {isMobile === true ? (
        <div className={filtersOpen ? "mapToolbarDrinks isOpen" : "mapToolbarDrinks"}>
          <div className="mapFiltersTabBar" role="tablist" aria-label="Filter type">
            <button
              type="button"
              role="tab"
              className={filtersTab === "drinks" ? "mapFiltersTab isActive" : "mapFiltersTab"}
              aria-selected={filtersTab === "drinks"}
              onClick={() => setFiltersTab("drinks")}
            >
              <Wine size={13} aria-hidden="true" />
              <span>Drinks</span>
              {drinksActive ? <span className="mapFiltersTabDot" aria-hidden="true" /> : null}
            </button>
            <button
              type="button"
              role="tab"
              className={filtersTab === "food" ? "mapFiltersTab isActive" : "mapFiltersTab"}
              aria-selected={filtersTab === "food"}
              onClick={() => setFiltersTab("food")}
            >
              <Utensils size={13} aria-hidden="true" />
              <span>Food</span>
              {foodActive ? <span className="mapFiltersTabDot" aria-hidden="true" /> : null}
            </button>
          </div>

          {filtersTab === "drinks" ? (
            <>
              <div className="mapToolbarDrinksLens">{favoritePicker}</div>
              <DrinkShapeChips filters={filters} onFiltersChange={onFiltersChange} />
              <button
                type="button"
                className="mapToolbarApplyBtn"
                disabled={drinksPanelSearchLabel(filters, favoritePint, filteredVenueCount).startsWith("No ")}
                onClick={() => {
                  setFiltersOpen(false);
                  onSearchApply?.();
                }}
              >
                {drinksPanelSearchLabel(filters, favoritePint, filteredVenueCount)}
              </button>
            </>
          ) : (
            <>
              <CuisineShapeChips filters={filters} onFiltersChange={onFiltersChange} />
              <button
                type="button"
                className="mapToolbarApplyBtn"
                disabled={foodPanelSearchLabel(filters, filteredVenueCount).startsWith("No ")}
                onClick={() => {
                  setFiltersOpen(false);
                  onSearchApply?.();
                }}
              >
                {foodPanelSearchLabel(filters, filteredVenueCount)}
              </button>
            </>
          )}
        </div>
      ) : null}

      {/* ── Desktop: separate Drinks panel ────────────────────────────── */}
      {isMobile !== true ? (
        <div className={drinksOpen ? "mapToolbarDrinks isOpen" : "mapToolbarDrinks"}>
          {isMobile === false ? <div className="mapToolbarDrinksLens">{favoritePicker}</div> : null}
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
      ) : null}

      {/* ── Desktop: separate Food panel ──────────────────────────────── */}
      {isMobile !== true ? (
        <div className={foodOpen ? "mapToolbarDrinks isOpen" : "mapToolbarDrinks"}>
          <CuisineShapeChips filters={filters} onFiltersChange={onFiltersChange} />
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
      ) : null}
    </div>
  );
}
