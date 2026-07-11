"use client";

import { Route, Search, Wine, X } from "lucide-react";
import { useEffect, useState } from "react";

import CitySwitcher from "@/components/map/CitySwitcher";
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
};

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
}: MapToolbarProps) {
  const [drinksOpen, setDrinksOpen] = useState(false);
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
          onClick={() => setDrinksOpen((open) => !open)}
        >
          <Wine size={15} aria-hidden="true" />
          <span>Drinks</span>
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
      </div>
    </div>
  );
}
