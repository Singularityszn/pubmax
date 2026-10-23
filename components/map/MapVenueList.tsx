"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import Link from "next/link";
import { ForkKnife, MapPin } from "lucide-react";

import CompactVenuePrice from "@/components/map/CompactVenuePrice";
import { formatLogNearbyDistance } from "@/lib/mapLogIntent";
import type {
  MapVenueListModel,
  MapVenueListSortMode,
  LondonRestaurantListModel,
  UkBasePubListModel,
} from "@/lib/mapVenueList";
import { summarizeListGroups } from "@/lib/mapVenueList";
import type { UkBasePub, UkBaseStreamStatus } from "@/lib/ukBasePubs";
import SurfaceNav from "@/components/ui/surface-nav";
import { Button } from "@/components/ui/button";
import { homeActionLabel } from "@/lib/surfaceStack";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

import "./mapVenueList.css";

const EMPTY_RESTAURANT_MODEL: LondonRestaurantListModel = {
  rows: [],
  total: 0,
  shown: 0,
  truncated: false,
};

// Accessibility contract (WCAG 2.1.1): keyboard/screen-reader parallel to
// canvas pins. A DOM list of the filtered venues projected inside the current
// viewport, nearest-first to its centre by default, with an optional cheapest
// sort for priced pubs. Each row is a real <button> that drives the SAME select
// handler a pin tap does, so an AT user can enumerate and open any listed venue
// without touching the WebGL layer.
// The way IN is the Layers control ("List view" inside the popover), not a
// toggle floating over the pins: the map surface is search plus one toast (see
// lib/mapSurfaceChrome.ts). Do not rebuild the floating toggle.
// It's also a useful feature for everyone: list view is not a
// shim.
export default function MapVenueList({
  model,
  ukBaseModel,
  restaurantModel = EMPTY_RESTAURANT_MODEL,
  ukBaseStatus = "ready",
  cityName,
  open,
  onOpenChange,
  loaded,
  mapUnavailable = false,
  onSelectVenue,
  onSelectUkBasePub,
  onPrefetchVenue,
  sortMode = "nearest",
  onSortModeChange,
  backLabel = null,
  onBack,
  onHome,
  homeTitle = "the map",
}: {
  model: MapVenueListModel;
  ukBaseModel: UkBasePubListModel;
  /** London restaurant pins in view (lib/londonRestaurants.ts). */
  restaurantModel?: LondonRestaurantListModel;
  ukBaseStatus?: UkBaseStreamStatus;
  cityName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loaded: boolean;
  mapUnavailable?: boolean;
  onSelectVenue: (id: string) => void;
  onSelectUkBasePub: (pub: UkBasePub) => void;
  onPrefetchVenue: (id: string) => void;
  /** How the listed pubs are ordered. Default stays nearest. */
  sortMode?: MapVenueListSortMode;
  onSortModeChange?: (mode: MapVenueListSortMode) => void;
  /** The way out, shared with every other surface. See MobileSharedSheet. */
  backLabel?: string | null;
  onBack?: () => void;
  onHome?: () => void;
  homeTitle?: string;
}) {
  const panelId = useId();
  const { total, shown, truncated, firstRowId } = summarizeListGroups([
    model,
    ukBaseModel,
    restaurantModel,
  ]);
  const firstVenueRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const venueFocusAssignedRef = useRef(false);

  // The list opens from Layers, so the way back is this panel's own SurfaceNav
  // and it does not join the surface trail. Escape leaves it too, because
  // opening the list moves focus INTO the list and a keyboard reader had no way
  // out but to tab to the close glyph.
  // A venue opened from the list keeps the list open under the desktop drawer,
  // and the drawer's trap makes it inert there: the drawer owns that Escape.
  const listRef = useRef<HTMLElement>(null);
  const closeList = useCallback(() => onOpenChange(false), [onOpenChange]);
  useDismissOnEscape(open, closeList, listRef);

  useEffect(() => {
    if (!open) {
      venueFocusAssignedRef.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (venueFocusAssignedRef.current) return;
      if (firstVenueRef.current) {
        firstVenueRef.current.focus();
        venueFocusAssignedRef.current = true;
      } else {
        closeButtonRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [firstRowId, open]);

  // Closed, this component owns nothing on screen: the way IN is Layers, so a
  // named landmark region holding no content would only pad every screen
  // reader's landmark list on both viewports.
  if (!open) return null;

  const awaitingRows =
    total === 0
    && ukBaseStatus !== "unavailable"
    && (ukBaseStatus === "loading" || !loaded);

  return (
    <section ref={listRef} className="mapVenueList mapVenueList--open" aria-label={`${cityName} venue list`}>
        <div className="mapVenueListPanel" id={panelId} role="group" aria-label={`${cityName} venues on the map`}>
          <header className="mapVenueListHead">
            <div className="mapVenueListHeadMeta">
              <h2 className="mapVenueListTitle">{mapUnavailable ? "Map unavailable" : "Venues on the map"}</h2>
              <span className="mapVenueListCount" role="status" aria-live="polite">
                {mapUnavailable
                  ? "Browse without the map"
                  : ukBaseStatus === "unavailable" && total === 0
                  ? "Unlisted pubs unavailable"
                  : awaitingRows
                  ? "Counting them up…"
                  : total === 0
                    ? "Nothing matches"
                    : truncated
                      ? `${sortMode === "cheapest" ? "Cheapest" : "Nearest"} ${shown} of ${total}`
                      : `${total} venue${total === 1 ? "" : "s"}`}
              </span>
            </div>
            <SurfaceNav
              backLabel={backLabel}
              onBack={onBack}
              homeLabel={backLabel ? homeActionLabel(homeTitle) : "Close venue list"}
              onHome={onHome ?? closeList}
              closeRef={closeButtonRef}
            />
          </header>

          {mapUnavailable ? (
            <p className="mapVenueListEmpty">
              You can still browse every pub in the directory. <Button variant="secondary" asChild><Link href="/pubs">Browse all pubs</Link></Button>
            </p>
          ) : <>
          {onSortModeChange && total > 0 ? (
            <div className="mapVenueListSort" role="group" aria-label="Sort venues on the map">
              <button
                type="button"
                className="mapVenueListSortChip"
                aria-pressed={sortMode === "nearest"}
                onClick={() => onSortModeChange("nearest")}
              >
                Nearest
              </button>
              <button
                type="button"
                className="mapVenueListSortChip"
                aria-pressed={sortMode === "cheapest"}
                onClick={() => onSortModeChange("cheapest")}
              >
                Cheapest
              </button>
            </div>
          ) : null}

          {model.coverageNote ? (
            <p className="mapVenueListCoverage" role="status">
              {model.coverageNote}
            </p>
          ) : null}
          {ukBaseStatus === "unavailable" && total > 0 ? (
            <p className="mapVenueListCoverage" role="status">
              Some unlisted pubs could not load.
            </p>
          ) : null}

          {total === 0 ? (
            awaitingRows ? null : <p className="mapVenueListEmpty">
              {ukBaseStatus === "unavailable"
                ? "Unlisted pubs could not load. Try the map again."
                : loaded
                ? "Nothing in view fits that, which takes some doing round here. Push the price cap up or drop a filter and the pubs come back."
                : "Counting them up…"}
            </p>
          ) : (
            <div className="mapVenueListGroups">
              {model.rows.length > 0 ? (
                <section className="mapVenueListGroup" aria-label="Listed pubs and venues">
                  <h3 className="mapVenueListGroupTitle">Listed pubs and venues</h3>
                  <ul className="mapVenueListItems" aria-label="Listed pubs and venues">
                    {model.rows.map((row) => (
                      <li key={row.id}>
                        <button
                          ref={row.id === firstRowId ? firstVenueRef : undefined}
                          id={`map-venue-list-item-${row.id}`}
                          type="button"
                          className="mapVenueListItem"
                          data-venue-id={row.id}
                          onClick={() => {
                            onSelectVenue(row.id);
                          }}
                          onPointerEnter={() => onPrefetchVenue(row.id)}
                          onFocus={() => onPrefetchVenue(row.id)}
                        >
                          <span className="mapVenueListItemName">
                            <MapPin size={14} aria-hidden="true" />
                            {row.name}
                          </span>
                          <span className="mapVenueListItemMeta">
                            <span>{row.typeLabel}</span>
                            {typeof row.distanceKm === "number" ? (
                              <span className="mapVenueListItemDist">{formatLogNearbyDistance(row.distanceKm)}</span>
                            ) : null}
                            <CompactVenuePrice
                              priceLabel={row.priceLabel}
                              anchor={row.anchor}
                              band={row.priceBand ?? null}
                              className="mapVenueListCompactPrice"
                              provenanceClassName="mapVenueListPriceProvenance"
                            />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {ukBaseModel.rows.length > 0 ? (
                <section className="mapVenueListGroup mapVenueListGroup--unverified" aria-label="Other pubs and bars with no listed price">
                  <h3 className="mapVenueListGroupTitle">Other pubs and bars · no listed price</h3>
                  <ul className="mapVenueListItems" aria-label="Other pubs and bars with no listed price">
                    {ukBaseModel.rows.map((row) => (
                      <li key={row.id}>
                        <button
                          ref={row.id === firstRowId ? firstVenueRef : undefined}
                          id={`map-venue-list-item-${row.id}`}
                          type="button"
                          className="mapVenueListItem"
                          data-venue-id={row.id}
                          onClick={() => {
                            onSelectUkBasePub(row.pub);
                          }}
                        >
                          <span className="mapVenueListItemName">
                            <MapPin size={14} aria-hidden="true" />
                            {row.name}
                          </span>
                          <span className="mapVenueListItemMeta">
                            {typeof row.distanceKm === "number" ? (
                              <span className="mapVenueListItemDist">{formatLogNearbyDistance(row.distanceKm)}</span>
                            ) : null}
                            <span>{row.priceLabel}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {restaurantModel.rows.length > 0 ? (
                <section className="mapVenueListGroup mapVenueListGroup--unverified" aria-label="Restaurants with no listed price">
                  <h3 className="mapVenueListGroupTitle">Restaurants · no listed price</h3>
                  <ul className="mapVenueListItems" aria-label="Restaurants with no listed price">
                    {restaurantModel.rows.map((row) => (
                      <li key={row.id}>
                        <button
                          ref={row.id === firstRowId ? firstVenueRef : undefined}
                          id={`map-venue-list-item-${row.id}`}
                          type="button"
                          className="mapVenueListItem"
                          data-venue-id={row.id}
                          onClick={() => {
                            onSelectVenue(row.id);
                          }}
                        >
                          <span className="mapVenueListItemName">
                            <ForkKnife size={14} aria-hidden="true" />
                            {row.name}
                          </span>
                          <span className="mapVenueListItemMeta">
                            {typeof row.distanceKm === "number" ? (
                              <span className="mapVenueListItemDist">{formatLogNearbyDistance(row.distanceKm)}</span>
                            ) : null}
                            <span>{row.priceLabel}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
          </>}
        </div>
    </section>
  );
}
