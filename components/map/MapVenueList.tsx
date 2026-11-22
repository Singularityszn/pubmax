"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import Link from "next/link";
import { ForkKnife, MapPin } from "lucide-react";

import MapPhoneVenueSheet from "@/components/map/MapPhoneVenueSheet";
import { Chip } from "@/components/ui/chip";
import CompactVenuePrice from "@/components/map/CompactVenuePrice";
import { formatLogNearbyDistance } from "@/lib/mapLogIntent";
import type {
  MapVenueListModel,
  MapVenueListSortMode,
  LondonRestaurantListModel,
  UkBasePubListModel,
} from "@/lib/mapVenueList";
import { phoneMapVenueListRows } from "@/lib/mapPhoneVenueList";
import { summarizeListGroups, VENUE_LIST_READ_FAILED } from "@/lib/mapVenueList";
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

function venueListStatus({
  total,
  shown,
  truncated,
  ukBaseStatus,
  loaded,
  venueDataFailed,
  mapUnavailable,
  sortMode,
}: {
  total: number;
  shown: number;
  truncated: boolean;
  ukBaseStatus: UkBaseStreamStatus;
  loaded: boolean;
  venueDataFailed: boolean;
  mapUnavailable: boolean;
  sortMode: MapVenueListSortMode;
}) {
  const readFailed = venueDataFailed && total === 0;
  const awaitingRows =
    total === 0
    && !readFailed
    && ukBaseStatus !== "unavailable"
    && (ukBaseStatus === "loading" || !loaded);
  const zoomRequired = loaded && ukBaseStatus === "zoom_required";

  const status = mapUnavailable
    ? "Browse without the map"
    : readFailed
      ? VENUE_LIST_READ_FAILED.status
      : ukBaseStatus === "unavailable" && total === 0
      ? "Unlisted pubs unavailable"
      : awaitingRows
        ? "Counting them up…"
        : zoomRequired && total === 0
          ? "Zoom in to list pubs"
          : total === 0
            ? "Nothing matches"
            : truncated
              ? `${sortMode === "cheapest" ? "Cheapest" : "Nearest"} ${shown} of ${total}`
              : `${total} venue${total === 1 ? "" : "s"}`;
  const emptyMessage = awaitingRows
    ? null
    : readFailed
      ? VENUE_LIST_READ_FAILED.line
      : ukBaseStatus === "unavailable"
      ? "Unlisted pubs could not load. Try the map again."
      : zoomRequired
        ? "Zoom in on the map to load pubs in this view."
        : loaded
          ? "Nothing in view fits that, which takes some doing round here. Push the price cap up or drop a filter and the pubs come back."
          : "Counting them up…";

  return { status, emptyMessage };
}

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
  phone = false,
  ukBaseModel,
  restaurantModel = EMPTY_RESTAURANT_MODEL,
  ukBaseStatus = "ready",
  cityName,
  open,
  onOpenChange,
  loaded,
  venueDataFailed = false,
  onRetryVenueData,
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
  phone?: boolean;
  ukBaseModel: UkBasePubListModel;
  /** London restaurant pins in view (lib/londonRestaurants.ts). */
  restaurantModel?: LondonRestaurantListModel;
  ukBaseStatus?: UkBaseStreamStatus;
  cityName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loaded: boolean;
  /** The owner's venue index read refused, so the curated pubs are missing, not absent. */
  venueDataFailed?: boolean;
  /** Asks the owner to read the venue index again. */
  onRetryVenueData?: () => void;
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
  const rows = phone ? phoneMapVenueListRows(model.rows, sortMode) : model.rows;
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
  useDismissOnEscape(open && !phone, closeList, listRef);

  useEffect(() => {
    if (phone) return;
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
  }, [firstRowId, open, phone]);

  // Closed, this component owns nothing on screen: the way IN is Layers, so a
  // named landmark region holding no content would only pad every screen
  // reader's landmark list on both viewports.
  if (!open && !phone) return null;

  const { status, emptyMessage } = venueListStatus({
    total,
    shown,
    truncated,
    ukBaseStatus,
    loaded,
    venueDataFailed,
    mapUnavailable,
    sortMode,
  });

  const content = <>
          {mapUnavailable ? (
            <p className="mapVenueListEmpty">
              You can still browse every pub in the directory. <Button variant="secondary" asChild><Link href="/pubs">Browse all pubs</Link></Button>
            </p>
          ) : <>
          {onSortModeChange && total > 0 ? (
            <div className="mapVenueListSort" role="group" aria-label="Sort venues on the map">
              <Chip
                aria-pressed={sortMode === "nearest"}
                onClick={() => onSortModeChange("nearest")}
              >
                Nearest
              </Chip>
              <Chip
                aria-pressed={sortMode === "cheapest"}
                onClick={() => onSortModeChange("cheapest")}
              >
                Cheapest
              </Chip>
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
            emptyMessage === null ? null : venueDataFailed && onRetryVenueData ? (
              <div className="mapVenueListEmpty mapVenueListFailed">
                <p>{emptyMessage}</p>
                <button type="button" className="mapVenueListRetry" onClick={onRetryVenueData}>Retry</button>
              </div>
            ) : <p className="mapVenueListEmpty">
              {emptyMessage}
            </p>
          ) : (
            <div className="mapVenueListGroups">
              {[
                { title: "Pints within your cap", rows: rows.filter((row) => row.capQualification === "match") },
                { title: "Cap not verified · no comparable pint price", rows: rows.filter((row) => row.capQualification === "unknown") },
                { title: "Outside your pint cap", rows: rows.filter((row) => row.capQualification === "over") },
                { title: "Other drinks and food · pint cap does not apply", rows: rows.filter((row) => row.capQualification === "not-pint") },
                { title: "Listed pubs and venues", rows: rows.filter((row) => !row.capQualification || row.capQualification === "off") },
              ].filter((group) => group.rows.length > 0).map((group) => (
                <section key={group.title} className="mapVenueListGroup" aria-label={group.title}>
                  <h3 className="mapVenueListGroupTitle">{group.title}</h3>
                  <ul className="mapVenueListItems" aria-label={group.title}>
                    {group.rows.map((row) => (
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
                            {phone ? (
                              <span className="mapVenueListCompactPrice">
                                {row.priceEvidence ? <>
                                  <span>{row.priceEvidence.priceLabel}</span>
                                  <small className="mapVenueListPriceProvenance">
                                    {row.priceEvidence.sourceLabel} · {row.priceEvidence.dateKind} {row.priceEvidence.dateLabel}
                                  </small>
                                </> : "No dated price yet"}
                              </span>
                            ) : <CompactVenuePrice
                              priceLabel={row.priceLabel}
                              anchor={row.anchor}
                              band={row.priceBand ?? null}
                              className="mapVenueListCompactPrice"
                              provenanceClassName="mapVenueListPriceProvenance"
                            />}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {ukBaseModel.rows.length > 0 ? (
                <section className="mapVenueListGroup mapVenueListGroup--unverified" aria-label="Other pubs and bars with prices not checked">
                  <h3 className="mapVenueListGroupTitle">Other pubs and bars · prices not checked</h3>
                  <ul className="mapVenueListItems" aria-label="Other pubs and bars with prices not checked">
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
  </>;
  if (phone) return (
    <MapPhoneVenueSheet open={open} status={status} onClose={closeList} backLabel={backLabel} onBack={onBack} onHome={onHome} homeTitle={homeTitle}>
      {content}
    </MapPhoneVenueSheet>
  );
  return (
    <section ref={listRef} className="mapVenueList mapVenueList--open" aria-label={`${cityName} venue list`}>
        <div className="mapVenueListPanel" id={panelId} role="group" aria-label={`${cityName} venues on the map`}>
          <header className="mapVenueListHead">
            <div className="mapVenueListHeadMeta">
              <h2 className="mapVenueListTitle">{mapUnavailable ? "Map unavailable" : "Venues on the map"}</h2>
              <span className="mapVenueListCount" role="status" aria-live="polite">
                {status}
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

          {content}
        </div>
    </section>
  );
}
