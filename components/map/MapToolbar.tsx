"use client";

import { Layers, Route, Wine } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import CitySwitcher from "@/components/map/CitySwitcher";
import ConditionsChip from "@/components/desktop/ConditionsChip";
import DrinkShapeChips from "@/components/map/DrinkShapeChips";
import MapExperienceLensControl, {
  MAP_EXPERIENCE_LENS_OPTIONS,
} from "@/components/map/MapExperienceLens";
import FavoritePintPicker from "@/components/map/FavoritePintPicker";
import PersonaLensPicker from "@/components/map/PersonaLensPicker";
import ZonePicker from "@/components/map/ZonePicker";
import type { CityId } from "@/lib/cities";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import type { DrinkCategory } from "@/lib/drinks";
import type { PersonaDrink } from "@/lib/personaDrinks";
import type { Filters } from "@/lib/venues";
import type { MapExperienceLens } from "@/lib/mapExperienceLens";
import { useSpringValue } from "@/lib/useSpringValue";
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
  drinkFiltersActive: boolean;
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
  detailOpen: boolean;
  desktopLaneActive: boolean;
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
  /** Camera is outside the priced city box — national browse entry softens the switcher. */
  outsideCurated?: boolean;
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
  drinkFiltersActive,
  drinkCategory,
  drinkBrand,
  onDrinkLensChange,
  personaId,
  onPersonaSelect,
  personaTonightCategory,
  planningOpen,
  detailOpen,
  desktopLaneActive,
  onTogglePlanning,
  filters,
  onFiltersChange,
  searchSettled,
  filteredVenueCount,
  searchableVenueCount,
  zoneIndex,
  cityId = DEFAULT_CITY_ID,
  outsideCurated = false,
  experienceLens,
  experienceSummary,
  onExperienceLensChange,
}: MapToolbarProps) {
  const [drinksOpen, setDrinksOpen] = useState(false);
  // Closed at rest (design judgement 2026-08-01, finding 2.15). The panel used
  // to arrive open, so the toolbar block was a third layer over the map before
  // the reader asked for anything.
  const [lensOpen, setLensOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const {
    value: laneOffset,
    animateTo: animateLaneOffset,
    jumpTo: jumpLaneOffset,
  } = useSpringValue(0, {
    response: 0.38,
    dampingRatio: 1,
  });
  const laneSyncReadyRef = useRef(false);
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  // The banners below the toolbar dock against its rendered bottom edge. That
  // edge moves when the lens or drink panels open, so the toolbar publishes its
  // own height rather than every sibling copying a constant that goes stale.
  useEffect(() => {
    const node = toolbarRef.current;
    const shell = node?.closest<HTMLElement>(".appShell");
    if (!node || !shell || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      shell.style.setProperty(
        "--map-toolbar-resting-height",
        `${Math.round(node.getBoundingClientRect().height)}px`,
      );
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      shell.style.removeProperty("--map-toolbar-resting-height");
    };
  }, []);
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const shell = toolbar?.closest<HTMLElement>(".appShell");
    if (!toolbar || !shell) return;
    if (!desktopLaneActive) {
      laneSyncReadyRef.current = false;
      jumpLaneOffset(0);
      return;
    }

    const drawerSelector = detailOpen
      ? ".mapDrawer.right"
      : planningOpen
        ? ".mapDrawer.left"
        : null;
    const drawer = drawerSelector
      ? shell.querySelector<HTMLElement>(drawerSelector)
      : null;
    const sync = (immediate = false) => {
      const width = drawer?.getBoundingClientRect().width ?? 0;
      const target = detailOpen ? -width / 2 : planningOpen ? width / 2 : 0;
      if (immediate) {
        jumpLaneOffset(target);
      } else {
        animateLaneOffset(target);
      }
    };
    sync(!laneSyncReadyRef.current);
    laneSyncReadyRef.current = true;
    if (!drawer || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => sync());
    observer.observe(drawer);
    return () => observer.disconnect();
  }, [
    animateLaneOffset,
    desktopLaneActive,
    detailOpen,
    jumpLaneOffset,
    planningOpen,
  ]);
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
  // A closed panel may not hide which view the map is under, so the control
  // names it. "All" is the resting view, so it needs no name.
  const activeLensLabel =
    MAP_EXPERIENCE_LENS_OPTIONS.find(
      (option) => option.id === experienceLens && option.id !== "all",
    )?.label ?? null;

  return (
    <div
      ref={toolbarRef}
      className="mapToolbar"
      style={
        desktopLaneActive
          ? {
              transform: `translateX(calc(-50% + ${laneOffset}px))`,
              transition: "none",
            }
          : undefined
      }
      // No search control on a base-pub-only arrival, so no search landmark:
      // navigating by landmark to a region with nothing to search is a dead end.
      role={searchContent ? "search" : undefined}
    >
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

        <button
          type="button"
          className={
            lensOpen || activeLensLabel
              ? "mapToolbarLensBtn isActive"
              : "mapToolbarLensBtn"
          }
          aria-pressed={lensOpen}
          aria-expanded={lensOpen}
          onClick={() => setLensOpen((open) => !open)}
        >
          <Layers size={15} aria-hidden="true" />
          <span>{activeLensLabel ? `Show me: ${activeLensLabel}` : "Show me"}</span>
        </button>

        {experienceLens === "all" ? (
          <button
            type="button"
            className={
              drinksOpen || drinkFiltersActive
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
          aria-label={planningOpen ? "Close plan" : "Plan an outing"}
        >
          <Route size={15} aria-hidden="true" />
          {/* One label only — the old CSS-hidden sibling span still leaked into
              textContent/AT trees as the "Plan an outingPlan" dual label. */}
          <span className={isMobile === true ? "planBtnShort" : "planBtnFull"}>
            {isMobile === true
              ? planningOpen
                ? "Close"
                : "Plan"
              : planningOpen
                ? "Close plan"
                : "Plan an outing"}
          </span>
        </button>

        <CitySwitcher cityId={cityId} outsideCurated={outsideCurated} />
      </div>

      {lensOpen ? (
        <MapExperienceLensControl
          lens={experienceLens}
          allSelected={!drinkFiltersActive}
          summary={experienceSummary}
          onChange={changeExperienceLens}
        />
      ) : null}

      {showNoSearchMatches ? (
        <div
          className="mapToolbarSearchStatus"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="mapToolbarSearchStatusCopy">
            <span>No venues match ‘</span>
            <span className="mapToolbarSearchQuery" title={trimmedQuery}>
              {trimmedQuery}
            </span>
            <span className="mapToolbarSearchQualifier">
              ’ with your current filters.
            </span>
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
