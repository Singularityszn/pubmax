"use client";

import { MapPin } from "lucide-react";
import { useCallback, useDeferredValue, useId, useMemo, useState } from "react";

import { SearchField } from "@/components/ui/search-field";
import type { CityId } from "@/lib/cities";
import {
  buildMapSearchSuggestions,
  type AreaSuggestion,
  type MapSearchAreaOption,
  type PubSuggestion,
} from "@/lib/mapSearchSuggest";
import type { Locality } from "@/lib/localities";
import type { Venue } from "@/lib/venues";

import "./mapSearchSuggest.css";

// The map's as-you-type search: the house SearchField plus a suggestions popup
// beneath it, listing matching AREAS (the modelled areas + boroughs) and PUBS,
// each with an honest distance from the viewer (or the map centre). This is the
// same search surface PubMap already owns — same filters.query, same
// selectVenue fly, same flyToArea camera — extended, not forked.
//
// aria-combobox pattern: the input is the combobox, the panel is its listbox,
// options are addressed by aria-activedescendant so focus never leaves the
// input. Desktop gets arrow-key + Enter navigation; a tap works everywhere.

type FlatItem =
  | { type: "area"; item: AreaSuggestion }
  | { type: "pub"; item: PubSuggestion };

export type MapSearchSuggestProps = {
  id: string;
  mode?: "overlay" | "toolbar";
  cityId: CityId;
  query: string;
  onQueryChange: (query: string) => void;
  venues: Venue[];
  /** Greater London locality gazetteer; [] for other cities / before it loads. */
  localities: Locality[];
  userLocation: { lat: number; lng: number } | null;
  mapCenter: [number, number];
  placeholder: string;
  /** Fly + open a pub's venue card (the same select a pin tap drives). */
  onSelectVenue: (id: string) => void;
  /** Fly the map to an area/borough centre (reduced-motion safe in the canvas). */
  onFlyToArea: (option: MapSearchAreaOption) => void;
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
  userLocation,
  mapCenter,
  placeholder,
  onSelectVenue,
  onFlyToArea,
  onSubmitQuery,
  onClose,
}: MapSearchSuggestProps) {
  const listboxId = useId();
  const optionId = useCallback((index: number) => `${listboxId}-opt-${index}`, [listboxId]);
  const [toolbarFocused, setToolbarFocused] = useState(false);
  const closeToolbarPanel = useCallback(() => {
    if (mode !== "toolbar") return;
    setToolbarFocused(false);
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }, [mode]);

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
        userLocation,
        mapCenter,
      }),
    [cityId, deferredQuery, venues, localities, userLocation, mapCenter],
  );

  const items = useMemo<FlatItem[]>(
    () => [
      ...suggestions.areas.map((item) => ({ type: "area" as const, item })),
      ...suggestions.pubs.map((item) => ({ type: "pub" as const, item })),
    ],
    [suggestions],
  );

  const [activeIndex, setActiveIndex] = useState(-1);
  // The list underneath can shrink between renders (fewer matches); clamp the
  // highlight to what still exists so aria-activedescendant never dangles.
  const safeActive = activeIndex < items.length ? activeIndex : -1;

  // Typing invalidates the highlight — reset it in the change handler (an event,
  // never an effect) so the list and its active row can't drift out of sync.
  const changeQuery = useCallback(
    (next: string) => {
      setActiveIndex(-1);
      onQueryChange(next);
    },
    [onQueryChange],
  );

  const trimmed = query.trim();
  // Panel shows once there is anything to say: matches, the empty-query area
  // prompt, or the honest "nothing matching" line for a typed dead end.
  const panelEnabled = mode === "overlay" || toolbarFocused;
  const showPanel = panelEnabled && (trimmed.length > 0 || items.length > 0);
  const showEmptyLine = trimmed.length > 0 && !suggestions.hasResults;

  const activate = useCallback(
    (entry: FlatItem | undefined) => {
      if (!entry) return;
      if (entry.type === "pub") {
        onSelectVenue(entry.item.id);
        closeToolbarPanel();
      } else {
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
      }
    },
    [closeToolbarPanel, onFlyToArea, onSelectVenue],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown" && items.length > 0) {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % items.length);
        return;
      }
      if (event.key === "ArrowUp" && items.length > 0) {
        event.preventDefault();
        setActiveIndex((current) => (current <= 0 ? items.length - 1 : current - 1));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (items.length > 0) {
          activate(safeActive >= 0 ? items[safeActive] : items[0]);
        } else {
          onSubmitQuery?.();
        }
        return;
      }
      if (event.key === "Escape") {
        if (safeActive >= 0) {
          setActiveIndex(-1);
          return;
        }
        closeToolbarPanel();
        onClose?.();
      }
    },
    [activate, closeToolbarPanel, safeActive, items, onClose, onSubmitQuery],
  );

  const pubStartIndex = suggestions.areas.length;
  const originNote =
    suggestions.origin === "user" ? "Distances from you" : "Distances from the map centre";

  return (
    <div className={`mapSearchSuggest mapSearchSuggest--${mode}`}>
      <SearchField
        id={id}
        role="combobox"
        aria-expanded={showPanel && items.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={safeActive >= 0 ? optionId(safeActive) : undefined}
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
          <div id={listboxId} role="listbox" aria-label="Search suggestions" className="mapSearchSuggestScroll">
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
                    onPointerEnter={() => setActiveIndex(index)}
                  >
                    <span className="mapSearchSuggestRowMain">
                      <MapPin size={15} aria-hidden="true" className="mapSearchSuggestRowIcon" />
                      <span className="mapSearchSuggestRowName">{area.name}</span>
                      {area.contextLabel ? (
                        <span className="mapSearchSuggestBorough">{area.contextLabel}</span>
                      ) : null}
                      {area.coverage ? (
                        <span className="mapSearchSuggestCoverage" data-tone={area.coverage.tone}>
                          {area.coverage.label}
                        </span>
                      ) : null}
                    </span>
                    {area.distanceLabel ? (
                      <span className="mapSearchSuggestDistance">{area.distanceLabel}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {suggestions.pubs.length > 0 ? (
              <div role="group" aria-label="Pubs" className="mapSearchSuggestGroup">
                <p className="mapSearchSuggestGroupHead">
                  <span>Pubs</span>
                </p>
                {suggestions.pubs.map((pub, offset) => {
                  const index = pubStartIndex + offset;
                  return (
                    <div
                      key={pub.id}
                      id={optionId(index)}
                      role="option"
                      aria-selected={safeActive === index}
                      className={`mapSearchSuggestRow${safeActive === index ? " isActive" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => activate({ type: "pub", item: pub })}
                      onPointerEnter={() => setActiveIndex(index)}
                    >
                      <span className="mapSearchSuggestRowMain">
                        <span className="mapSearchSuggestRowName">{pub.name}</span>
                        {pub.boroughLabel ? (
                          <span className="mapSearchSuggestBorough">{pub.boroughLabel}</span>
                        ) : null}
                      </span>
                      <span className="mapSearchSuggestMeta">
                        {pub.priceLabel ? (
                          <span className="mapSearchSuggestPrice">{pub.priceLabel}</span>
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

            {showEmptyLine ? (
              <p className="mapSearchSuggestEmpty">Nothing matching that. Try an area like Soho.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
