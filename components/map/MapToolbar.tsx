"use client";

import { Route, Search, Wine, X } from "lucide-react";
import { useEffect, useState } from "react";

import CitySwitcher from "@/components/map/CitySwitcher";
import DrinkShapeChips from "@/components/map/DrinkShapeChips";
import FavoritePintPicker from "@/components/map/FavoritePintPicker";
import ZonePicker from "@/components/map/ZonePicker";
import type { CityId } from "@/lib/cities";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import type { Filters } from "@/lib/venues";
import type { ZonePintIndex } from "@/lib/zones";

import "./mapToolbar.css";

// Compact map chrome: search + Plan on the first row; drink lens / chips stay
// behind an optional expand so phones keep map mid-field free.
type MapToolbarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  /** Enter/submit in the search box: jump to the current top match. */
  onSubmitQuery?: () => void;
  favoritePint: string | null;
  onFavoritePintChange: (beerId: string | null) => void;
  drinkCategory: string;
  drinkBrand: string;
  onDrinkLensChange: (next: { drinkCategory: string; drinkBrand: string }) => void;
  planningOpen: boolean;
  onTogglePlanning: () => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  /** True once the slim venue index has settled, including a failed/empty load. */
  searchSettled: boolean;
  /** Count after the query and all current map filters have been applied. */
  filteredVenueCount: number;
  /** Number of venues available to search; zero means the index is unavailable/empty. */
  searchableVenueCount: number;
  /** Per-zone median pint index for the zone picker's tappable detail. */
  zoneIndex: ZonePintIndex;
  /** Active city for the map switcher (defaults to London). */
  cityId?: CityId;
};

export default function MapToolbar({
  query,
  onQueryChange,
  onSubmitQuery,
  favoritePint,
  onFavoritePintChange,
  drinkCategory,
  drinkBrand,
  onDrinkLensChange,
  planningOpen,
  onTogglePlanning,
  filters,
  onFiltersChange,
  searchSettled,
  filteredVenueCount,
  searchableVenueCount,
  zoneIndex,
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
  const trimmedQuery = query.trim();
  const showNoSearchMatches =
    searchSettled &&
    searchableVenueCount > 0 &&
    Boolean(trimmedQuery) &&
    filteredVenueCount === 0;

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
                onSubmitQuery?.();
              }
            }}
            placeholder="Search pubs"
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

        {cityId === DEFAULT_CITY_ID ? (
          <ZonePicker
            zone={filters.zone}
            onZoneChange={(zone) => onFiltersChange({ ...filters, zone })}
            index={zoneIndex}
          />
        ) : null}

        <button
          type="button"
          className={planningOpen ? "planBtn active" : "planBtn"}
          onClick={onTogglePlanning}
          aria-pressed={planningOpen}
          aria-label={planningOpen ? "Close plan" : "Plan tonight"}
        >
          <Route size={15} aria-hidden="true" />
          {/* One label only — the old CSS-hidden sibling span still leaked into
              textContent/AT trees as the "Plan tonightPlan" dual label. */}
          <span className={isMobile === true ? "planBtnShort" : "planBtnFull"}>
            {isMobile === true
              ? planningOpen
                ? "Close"
                : "Plan"
              : planningOpen
                ? "Close plan"
                : "Plan tonight"}
          </span>
        </button>

        <CitySwitcher cityId={cityId} />
      </div>

      {showNoSearchMatches ? (
        <div
          className="mapToolbarSearchStatus"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="mapToolbarSearchStatusCopy">
            No pubs match ‘{trimmedQuery}’ with your current filters.
          </span>
          <button
            type="button"
            className="mapToolbarSearchRecovery"
            onClick={() => onQueryChange("")}
          >
            Clear search
          </button>
        </div>
      ) : null}

      <div className={drinksOpen ? "mapToolbarDrinks isOpen" : "mapToolbarDrinks"}>
        {isMobile === true ? <div className="mapToolbarDrinksLens">{favoritePicker}</div> : null}
        <DrinkShapeChips filters={filters} onFiltersChange={onFiltersChange} />
      </div>
    </div>
  );
}
