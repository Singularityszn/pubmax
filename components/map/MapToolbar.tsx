"use client";

import { Route, Search, Wine, X } from "lucide-react";
import { useEffect, useState } from "react";

import DrinkShapeChips from "@/components/map/DrinkShapeChips";
import FavoritePintPicker from "@/components/map/FavoritePintPicker";
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
}: MapToolbarProps) {
  const [drinksOpen, setDrinksOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setIsMobile(mq.matches);
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
  const drinksActive =
    Boolean(filters.query && /beer|wine|cocktail|whisky|gin|rum|vodka|shot/i.test(filters.query)) ||
    filters.requireCocktails ||
    Boolean(drinkCategory) ||
    Boolean(favoritePint);

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

        {!isMobile ? <div className="mapToolbarDesktopExtras">{favoritePicker}</div> : null}

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
        >
          <Route size={15} aria-hidden="true" />
          <span className="planBtnFull">{planningOpen ? "Close planner" : "Plan a crawl"}</span>
          <span className="planBtnShort">{planningOpen ? "Close" : "Plan"}</span>
        </button>
      </div>

      <div className={drinksOpen ? "mapToolbarDrinks isOpen" : "mapToolbarDrinks"}>
        {isMobile ? <div className="mapToolbarDrinksLens">{favoritePicker}</div> : null}
        <DrinkShapeChips filters={filters} onFiltersChange={onFiltersChange} />
      </div>
    </div>
  );
}
