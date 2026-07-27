"use client";

import { Route, Wine } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import CitySwitcher from "@/components/map/CitySwitcher";
import ConditionsChip from "@/components/desktop/ConditionsChip";
import DrinkShapeChips from "@/components/map/DrinkShapeChips";
import MapExperienceLensControl from "@/components/map/MapExperienceLens";
import FavoritePintPicker from "@/components/map/FavoritePintPicker";
import PersonaLensPicker from "@/components/map/PersonaLensPicker";
import ZonePicker from "@/components/map/ZonePicker";
import type { CityId } from "@/lib/cities";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import type { DrinkCategory } from "@/lib/drinks";
import type { PersonaDrink } from "@/lib/personaDrinks";
import type { Filters } from "@/lib/venues";
import type { MapExperienceLens } from "@/lib/mapExperienceLens";
import type { ZonePintIndex } from "@/lib/zones";

import "./mapToolbar.css";

// Compact map chrome: search + Plan on the first row; drink lens / chips stay
// behind an optional expand so phones keep map mid-field free.
type MapToolbarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  /**
   * Shared gazetteer search surface, configured by PubMap for desktop mode.
   * Null on a base-pub-only arrival, where no venue is priced to be found.
   */
  searchContent: ReactNode;
  favoritePint: string | null;
  onFavoritePintChange: (beerId: string | null) => void;
  drinkCategory: string;
  drinkBrand: string;
  onDrinkLensChange: (next: { drinkCategory: string; drinkBrand: string }) => void;
  /** Active "Drink like..." persona id, or null when the lens is off. */
  personaId: string | null;
  /** Select a persona (or null to clear); the parent rides the drink filter. */
  onPersonaSelect: (persona: PersonaDrink | null) => void;
  /** The DrinkCategory that fits tonight, for the persona fits-tonight sort. */
  personaTonightCategory: DrinkCategory | null;
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
  experienceLens: MapExperienceLens;
  experienceSummary: string;
  onExperienceLensChange: (lens: MapExperienceLens) => void;
};

export default function MapToolbar({
  query,
  onQueryChange,
  searchContent,
  favoritePint,
  onFavoritePintChange,
  drinkCategory,
  drinkBrand,
  onDrinkLensChange,
  personaId,
  onPersonaSelect,
  personaTonightCategory,
  planningOpen,
  onTogglePlanning,
  filters,
  onFiltersChange,
  searchSettled,
  filteredVenueCount,
  searchableVenueCount,
  zoneIndex,
  cityId = DEFAULT_CITY_ID,
  experienceLens,
  experienceSummary,
  onExperienceLensChange,
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
    filters.requireCocktails ||
    Boolean(drinkCategory) ||
    filters.topShelfOnly ||
    Boolean(favoritePint);
  const trimmedQuery = query.trim();
  const showNoSearchMatches =
    searchSettled &&
    searchableVenueCount > 0 &&
    Boolean(trimmedQuery) &&
    filteredVenueCount === 0;
  const changeExperienceLens = (next: MapExperienceLens) => {
    if (next !== "all") setDrinksOpen(false);
    onExperienceLensChange(next);
  };

  return (
    <div className="mapToolbar" role="search">
      <div className="mapToolbarRow">
        {searchContent ? (
          <div className="mapToolbarSearch">{searchContent}</div>
        ) : null}

        {isMobile === false && experienceLens === "all" ? (
          <div className="mapToolbarDesktopExtras">{favoritePicker}</div>
        ) : null}

        {/* Weather verdict, always visible on desktop (owner requirement). The
            map cannot host the right rail (the venue drawer owns that edge), so
            the toolbar carries the compact chip instead. Fail-soft: renders
            nothing when the weather has no verdict. */}
        {isMobile === false ? <ConditionsChip /> : null}

        {experienceLens === "all" ? (
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
        ) : null}

        {cityId === DEFAULT_CITY_ID && experienceLens === "all" ? (
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

      <MapExperienceLensControl
        lens={experienceLens}
        summary={experienceSummary}
        onChange={changeExperienceLens}
      />

      {showNoSearchMatches ? (
        <div
          className="mapToolbarSearchStatus"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="mapToolbarSearchStatusCopy">
            No venues match ‘{trimmedQuery}’ with your current filters.
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

      {experienceLens === "all" ? (
        <div className={drinksOpen ? "mapToolbarDrinks isOpen" : "mapToolbarDrinks"}>
          {isMobile === true ? <div className="mapToolbarDrinksLens">{favoritePicker}</div> : null}
          <DrinkShapeChips filters={filters} onFiltersChange={onFiltersChange} />
          <div className="mapToolbarDrinksLens">
            <PersonaLensPicker
              personaId={personaId}
              onSelect={onPersonaSelect}
              tonightCategory={personaTonightCategory}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
