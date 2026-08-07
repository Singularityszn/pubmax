"use client";

import { MapPin } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { SearchField } from "@/components/ui/search-field";
import { trackEvent } from "@/lib/analytics";
import type { CityId } from "@/lib/cities";
import {
  buildMapSearchSuggestions,
  UK_PLACE_SEARCH_GROUP_LABEL,
  type AreaSuggestion,
  type MapSearchAreaOption,
  type PlaceSuggestion,
  type PubSuggestion,
} from "@/lib/mapSearchSuggest";
import type { Locality } from "@/lib/localities";
import {
  normaliseUkPlaceQuery,
  parseUkPlaceIndex,
  UK_PLACE_INDEX_PATH,
  type UkPlace,
} from "@/lib/ukPlaceSearch";
import type { Venue } from "@/lib/venues";
import CompactVenuePrice from "@/components/map/CompactVenuePrice";

import "./mapSearchSuggest.css";

// The map's as-you-type search: the house SearchField plus a suggestions popup
// beneath it, listing matching AREAS (the modelled areas + boroughs), PUBS, and
// UK places from the national gazetteer, each with an honest distance from the
// viewer (or the map centre). This is the same search surface PubMap already
// owns — same filters.query, same selectVenue fly, same flyToArea camera —
// extended, not forked.
//
// aria-combobox pattern: the input is the combobox, the panel is its listbox,
// options are addressed by aria-activedescendant so focus never leaves the
// input. Desktop gets arrow-key + Enter navigation; a tap works everywhere.

type FlatItem =
  | { type: "area"; item: AreaSuggestion }
  | { type: "pub"; item: PubSuggestion }
  | { type: "place"; item: PlaceSuggestion };

type PlaceIndexState =
  | { status: "idle" | "loading"; places: UkPlace[] }
  | { status: "ready"; places: UkPlace[] }
  | { status: "error"; places: UkPlace[] };

const NO_RESULTS_MESSAGE =
  "Nothing matching that. Try a pub name, an area, or a UK town.";
const NO_RESULTS_ANNOUNCE_DELAY_MS = 300;

export type MapSearchSuggestProps = {
  id: string;
  mode?: "overlay" | "toolbar";
  cityId: CityId;
  query: string;
  onQueryChange: (query: string) => void;
  venues: Venue[];
  /** Greater London locality gazetteer; [] for other cities / before it loads. */
  localities: Locality[];
  /**
   * When false, skip local areas/pubs (limited-coverage UK place arrival) so
   * the national gazetteer can fill the panel alone.
   */
  includeLocalResults?: boolean;
  userLocation: { lat: number; lng: number } | null;
  mapCenter: [number, number];
  placeholder: string;
  /** Fly + open a pub's venue card (the same select a pin tap drives). */
  onSelectVenue: (id: string) => void;
  /** Fly the map to an area/borough centre (reduced-motion safe in the canvas). */
  onFlyToArea: (option: MapSearchAreaOption) => void;
  /**
   * Open a UK place via the chooser arrival path (`/map?place=` or a city
   * guide). Prefer a document navigation so PubMap remounts with the
   * server-resolved arrival (soft nav freezes placeArrival at mount).
   */
  onSelectPlace: (place: PlaceSuggestion) => void;
  /** Enter with nothing highlighted and no suggestions: keep the old behaviour. */
  onSubmitQuery?: () => void;
  /** Escape on the field: close the search overlay. */
  onClose?: () => void;
};

export default function MapSearchSuggest({
  id,
  mode = "overlay",
  cityId,
  query,
  onQueryChange,
  venues,
  localities,
  includeLocalResults = true,
  userLocation,
  mapCenter,
  placeholder,
  onSelectVenue,
  onFlyToArea,
  onSelectPlace,
  // onSubmitQuery intentionally not used: zero-result Enter keeps the miss
  // empty state open (hits use activate). Prop stays on the type for callers.
  onClose,
}: MapSearchSuggestProps) {
  const listboxId = useId();
  const emptyStateId = useId();
  const optionId = useCallback((index: number) => `${listboxId}-opt-${index}`, [listboxId]);
  const [toolbarFocused, setToolbarFocused] = useState(false);
  const [announcedQuery, setAnnouncedQuery] = useState("");
  const lastAnnouncedQuery = useRef("");
  const [placeIndex, setPlaceIndex] = useState<PlaceIndexState>({
    status: "idle",
    places: [],
  });
  const placeIndexRequested = useRef(false);
  const closeToolbarPanel = useCallback(() => {
    if (mode !== "toolbar") return;
    setToolbarFocused(false);
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }, [mode]);

  const loadPlaceIndex = useCallback(() => {
    if (placeIndexRequested.current) return;
    placeIndexRequested.current = true;
    setPlaceIndex({ status: "loading", places: [] });
    void fetch(UK_PLACE_INDEX_PATH)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw: unknown = await response.json();
        setPlaceIndex({ status: "ready", places: parseUkPlaceIndex(raw) });
      })
      .catch(() => {
        placeIndexRequested.current = false;
        setPlaceIndex({ status: "error", places: [] });
      });
  }, []);

  // Deferred query keeps the input responsive while the (single-pass, whole-set)
  // match recompute runs off the keystroke — the "debounced" behaviour the spec
  // asks for, without a manual timer to leak.
  const deferredQuery = useDeferredValue(query);
  const suggestions = useMemo(
    () =>
      buildMapSearchSuggestions({
        cityId,
        query: deferredQuery,
        venues,
        localities,
        places: placeIndex.places,
        includeLocalResults,
        userLocation,
        mapCenter,
      }),
    [
      cityId,
      deferredQuery,
      venues,
      localities,
      placeIndex.places,
      includeLocalResults,
      userLocation,
      mapCenter,
    ],
  );

  const items = useMemo<FlatItem[]>(
    () => [
      ...suggestions.areas.map((item) => ({ type: "area" as const, item })),
      ...suggestions.pubs.map((item) => ({ type: "pub" as const, item })),
      ...suggestions.places.map((item) => ({ type: "place" as const, item })),
    ],
    [suggestions],
  );

  const [activeIndex, setActiveIndex] = useState(-1);
  // Keyboard events can arrive before React commits the previous highlight.
  // Keep the event-time value synchronous so ArrowDown then Enter activates
  // the row a keyboard user just chose, not the first stale render-time row.
  const activeIndexRef = useRef(-1);
  const chooseActiveIndex = useCallback((next: number) => {
    activeIndexRef.current = next;
    setActiveIndex(next);
  }, []);
  // The list underneath can shrink between renders (fewer matches); clamp the
  // highlight to what still exists so aria-activedescendant never dangles.
  const safeActive = activeIndex >= 0 && activeIndex < items.length ? activeIndex : -1;

  // Typing invalidates the highlight — reset it in the change handler (an event,
  // never an effect) so the list and its active row can't drift out of sync.
  const changeQuery = useCallback(
    (next: string) => {
      chooseActiveIndex(-1);
      if (mode === "toolbar") setToolbarFocused(true);
      onQueryChange(next);
      if (normaliseUkPlaceQuery(next).length >= 2) loadPlaceIndex();
    },
    [chooseActiveIndex, loadPlaceIndex, mode, onQueryChange],
  );

  const trimmed = query.trim();
  const deferredTrimmed = deferredQuery.trim();
  const querySettled = deferredTrimmed === trimmed;
  // Panel stays present for a typed miss so the combobox never collapses into a
  // silent empty state. Toolbar search still closes when focus deliberately
  // leaves the search surface; overlay search remains open until Escape/X.
  const panelEnabled = mode === "overlay" || toolbarFocused;
  const showPanel = panelEnabled && (trimmed.length > 0 || items.length > 0);
  const showEmptyLine =
    showPanel && trimmed.length > 0 && querySettled && !suggestions.hasResults;
  const placesLoading =
    showPanel &&
    normaliseUkPlaceQuery(trimmed).length >= 2 &&
    placeIndex.status === "loading" &&
    !suggestions.hasResults;

  useEffect(() => {
    if (!showEmptyLine) {
      if (trimmed.length === 0 || suggestions.hasResults) lastAnnouncedQuery.current = "";
      return;
    }

    const normalized = deferredTrimmed.toLocaleLowerCase();
    if (lastAnnouncedQuery.current === normalized) return;

    const timer = window.setTimeout(() => {
      lastAnnouncedQuery.current = normalized;
      setAnnouncedQuery(normalized);
      // Fixed-schema, zero-property event: raw search text never enters telemetry.
      trackEvent("map_search_no_results");
    }, NO_RESULTS_ANNOUNCE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [deferredTrimmed, showEmptyLine, suggestions.hasResults, trimmed.length]);

  const activate = useCallback(
    (entry: FlatItem | undefined) => {
      if (!entry) return;
      if (entry.type === "pub") {
        onSelectVenue(entry.item.id);
        closeToolbarPanel();
        return;
      }
      if (entry.type === "place") {
        onSelectPlace(entry.item);
        closeToolbarPanel();
        return;
      }
      const { item } = entry;
      onFlyToArea({
        slug: item.slug,
        name: item.name,
        center: item.center,
        coverage: item.coverage,
        zoom: item.flyZoom,
        kind: item.kind,
        areaNewsArea: item.areaNewsArea,
      });
      closeToolbarPanel();
    },
    [closeToolbarPanel, onFlyToArea, onSelectPlace, onSelectVenue],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const eventActive =
        activeIndexRef.current >= 0 && activeIndexRef.current < items.length
          ? activeIndexRef.current
          : -1;
      if (event.key === "ArrowDown" && items.length > 0) {
        event.preventDefault();
        chooseActiveIndex((eventActive + 1) % items.length);
        return;
      }
      if (event.key === "ArrowUp" && items.length > 0) {
        event.preventDefault();
        chooseActiveIndex(eventActive <= 0 ? items.length - 1 : eventActive - 1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (items.length > 0) {
          activate(eventActive >= 0 ? items[eventActive] : items[0]);
          return;
        }
        // Zero-result miss: keep the panel + empty state open and leave focus
        // on the combobox. Do not fire onSubmitQuery (that path flies/clears
        // and would hide the honest "nothing matching" message).
        return;
      }
      if (event.key === "Escape") {
        // Always preventDefault: type=search natively clears the value on Escape,
        // which would re-fire changeQuery, re-open the toolbar panel, and flash
        // the empty-query "nearby areas" prompt instead of a clean dismiss.
        event.preventDefault();
        if (eventActive >= 0) {
          chooseActiveIndex(-1);
          return;
        }
        if (mode === "toolbar") {
          setToolbarFocused(false);
          return;
        }
        onClose?.();
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLElement>('[aria-label="Search the map"]')?.focus();
        });
      }
    },
    [activate, chooseActiveIndex, items, mode, onClose],
  );

  const pubStartIndex = suggestions.areas.length;
  const placeStartIndex = pubStartIndex + suggestions.pubs.length;
  const originNote =
    suggestions.origin === "user" ? "Distances from you" : "Distances from the map centre";
  const liveAnnouncement =
    showEmptyLine && announcedQuery === deferredTrimmed.toLocaleLowerCase()
      ? NO_RESULTS_MESSAGE
      : "";

  return (
    <div className={`mapSearchSuggest mapSearchSuggest--${mode}`}>
      <SearchField
        id={id}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listboxId}
        aria-describedby={showEmptyLine ? emptyStateId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={safeActive >= 0 ? optionId(safeActive) : undefined}
        aria-busy={!querySettled || placesLoading}
        value={query}
        onChange={changeQuery}
        onFocus={() => setToolbarFocused(true)}
        onBlur={() => {
          if (mode === "toolbar") setToolbarFocused(false);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={mode === "overlay"}
      />

      {showPanel ? (
        <div className="mapSearchSuggestPanel">
          <div
            id={listboxId}
            role="listbox"
            aria-label="Search suggestions"
            className="mapSearchSuggestScroll"
          >
            {suggestions.areas.length > 0 ? (
              <div role="group" aria-label="Areas" className="mapSearchSuggestGroup">
                <p className="mapSearchSuggestGroupHead">
                  <span>Areas</span>
                  <span className="mapSearchSuggestOrigin">{originNote}</span>
                </p>
                {suggestions.areas.map((area, index) => (
                  <div
                    key={area.key}
                    id={optionId(index)}
                    role="option"
                    aria-selected={safeActive === index}
                    className={`mapSearchSuggestRow${safeActive === index ? " isActive" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => activate({ type: "area", item: area })}
                    onPointerEnter={() => chooseActiveIndex(index)}
                  >
                    <span className="mapSearchSuggestRowMain">
                      <MapPin size={15} aria-hidden="true" className="mapSearchSuggestRowIcon" />
                      <span className="mapSearchSuggestRowName">{area.name}</span>
                      {area.contextLabel ? (
                        <span className="mapSearchSuggestBorough">{area.contextLabel}</span>
                      ) : null}
                      {/* No coverage chip here. A suggestion row is a place to
                          fly to, and the chip read "Plan with warnings" beside
                          every second name: planning words a reader cannot act
                          on, taking the width the name needs. The coverage still
                          travels with the pick (activate below) and the area
                          sheet says it there, where planning is the question. */}
                    </span>
                    {area.distanceLabel ? (
                      <span className="mapSearchSuggestDistance">{area.distanceLabel}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {suggestions.pubs.length > 0 ? (
              <div role="group" aria-label="Venues" className="mapSearchSuggestGroup">
                <p className="mapSearchSuggestGroupHead">
                  <span>Venues</span>
                </p>
                {suggestions.pubs.map((pub, offset) => {
                  const index = pubStartIndex + offset;
                  return (
                    <div
                      key={pub.id}
                      id={optionId(index)}
                      role="option"
                      data-venue-id={pub.id}
                      aria-selected={safeActive === index}
                      className={`mapSearchSuggestRow${safeActive === index ? " isActive" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => activate({ type: "pub", item: pub })}
                      onPointerEnter={() => chooseActiveIndex(index)}
                    >
                      <span className="mapSearchSuggestRowMain">
                        <span className="mapSearchSuggestRowName">{pub.name}</span>
                        <span className="mapSearchSuggestBorough">{pub.typeLabel}</span>
                        {pub.boroughLabel ? (
                          <span className="mapSearchSuggestBorough">{pub.boroughLabel}</span>
                        ) : null}
                      </span>
                      <span className="mapSearchSuggestMeta">
                        {pub.priceLabel ? (
                          <CompactVenuePrice
                            priceLabel={pub.priceLabel}
                            anchor={pub.anchor}
                            className="mapSearchSuggestPrice"
                            provenanceClassName="mapSearchSuggestPriceProvenance"
                          />
                        ) : null}
                        {pub.distanceLabel ? (
                          <span className="mapSearchSuggestDistance">{pub.distanceLabel}</span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {suggestions.places.length > 0 ? (
              <div
                role="group"
                aria-label={UK_PLACE_SEARCH_GROUP_LABEL}
                className="mapSearchSuggestGroup"
              >
                <p className="mapSearchSuggestGroupHead">
                  <span>{UK_PLACE_SEARCH_GROUP_LABEL}</span>
                </p>
                {suggestions.places.map((place, offset) => {
                  const index = placeStartIndex + offset;
                  return (
                    <div
                      key={place.key}
                      id={optionId(index)}
                      role="option"
                      aria-selected={safeActive === index}
                      className={`mapSearchSuggestRow${safeActive === index ? " isActive" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => activate({ type: "place", item: place })}
                      onPointerEnter={() => chooseActiveIndex(index)}
                    >
                      <span className="mapSearchSuggestRowMain">
                        <MapPin size={15} aria-hidden="true" className="mapSearchSuggestRowIcon" />
                        <span className="mapSearchSuggestRowName">{place.name}</span>
                        {place.contextLabel ? (
                          <span className="mapSearchSuggestBorough">{place.contextLabel}</span>
                        ) : null}
                        <span className="mapSearchSuggestBorough">
                          {place.placeKind === "curated" ? "City guide" : "No prices yet"}
                        </span>
                      </span>
                      {place.distanceLabel ? (
                        <span className="mapSearchSuggestDistance">{place.distanceLabel}</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {placesLoading ? (
              <p className="mapSearchSuggestEmpty" role="status">
                Looking across the UK pub map…
              </p>
            ) : null}

            {/* Empty state lives inside the listbox so the combobox panel keeps a
                non-zero accessible surface on a miss (Enter must not collapse it). */}
            {showEmptyLine && !placesLoading ? (
              <div
                id={emptyStateId}
                className="mapSearchSuggestEmpty"
                data-testid="map-search-no-results"
                role="presentation"
              >
                <p className="mapSearchSuggestEmptyTitle">{NO_RESULTS_MESSAGE}</p>
                <p className="mapSearchSuggestEmptyHint">
                  Try Soho, Sheffield, or The Crown. Clear search to see every venue.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <p
        className="mapSearchSuggestLive sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="map-search-no-results-live"
      >
        {liveAnnouncement}
      </p>
    </div>
  );
}
