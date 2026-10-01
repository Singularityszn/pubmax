"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";

import CompactVenuePrice from "@/components/map/CompactVenuePrice";
import { formatLogNearbyDistance } from "@/lib/mapLogIntent";
import { combineMapVenueListRows } from "@/lib/mapVenueList";
import type { DrinkCategory } from "@/lib/drinks";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import type {
  MapVenueListModel,
  MapVenueListSortMode,
  UkBasePubListModel,
} from "@/lib/mapVenueList";
import type { UkBasePub, UkBaseStreamStatus } from "@/lib/ukBasePubs";
import SurfaceNav from "@/components/ui/surface-nav";
import { Button } from "@/components/ui/button";
import { homeActionLabel } from "@/lib/surfaceStack";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

import "./mapVenueList.css";

const VENUES_PER_PAGE = 60;

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
  ukBaseStatus = "ready",
  cityName,
  open,
  onOpenChange,
  loaded,
  onSelectVenue,
  onSelectUkBasePub,
  onPrefetchVenue,
  sortMode = "nearest",
  onSortModeChange,
  backLabel = null,
  onBack,
  onHome,
  homeTitle = "the map",
  drinkCategory = null,
  servingGroup = null,
}: {
  model: MapVenueListModel;
  ukBaseModel: UkBasePubListModel;
  ukBaseStatus?: UkBaseStreamStatus;
  cityName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loaded: boolean;
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
  drinkCategory?: DrinkCategory | null;
  servingGroup?: string | null;
}) {
  const panelId = useId();
  const total = model.total + ukBaseModel.total;
  const shown = model.shown + ukBaseModel.shown;
  const truncated = model.truncated || ukBaseModel.truncated;
  const priceOrderAvailable = model.rows.some((row) => row.sortPrice != null)
    || ukBaseModel.rows.some((row) => row.sortPrice != null);
  const effectiveSortMode = sortMode === "cheapest" && !priceOrderAvailable ? "nearest" : sortMode;
  const firstVenueRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const focusedPageRef = useRef<string | null>(null);
  const groupsRef = useRef<HTMLDivElement>(null);
  const groupedRows = useMemo(() => drinkCategory
    ? combineMapVenueListRows(model.rows, ukBaseModel.rows, effectiveSortMode)
    : null, [drinkCategory, model.rows, ukBaseModel.rows, effectiveSortMode]);
  const rowCount = groupedRows?.length ?? model.rows.length + ukBaseModel.rows.length;
  const lastPage = Math.max(0, Math.ceil(rowCount / VENUES_PER_PAGE) - 1);
  const pageKey = JSON.stringify([open, cityName, sortMode, effectiveSortMode, drinkCategory, servingGroup]);
  const [pagination, setPagination] = useState({ key: pageKey, page: 0 });
  if (pagination.key !== pageKey || pagination.page > lastPage) {
    setPagination({ key: pageKey, page: pagination.key !== pageKey ? 0 : lastPage });
  }
  const page = pagination.key === pageKey ? Math.min(pagination.page, lastPage) : 0;
  const pageStart = page * VENUES_PER_PAGE;
  const pageEnd = Math.min(pageStart + VENUES_PER_PAGE, rowCount);
  const combinedPage = groupedRows?.slice(pageStart, pageEnd);
  const curatedPage = groupedRows ? [] : model.rows.slice(pageStart, pageEnd);
  const basePage = groupedRows ? [] : ukBaseModel.rows.slice(
    Math.max(0, pageStart - model.rows.length), Math.max(0, pageEnd - model.rows.length),
  );
  const firstCombinedId = combinedPage?.[0]?.id;
  const firstCuratedId = groupedRows ? undefined : curatedPage[0]?.id;
  const firstBaseId = firstCuratedId ? undefined : basePage[0]?.id;
  const focusPageKey = `${pageKey}:${page}`;

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
      focusedPageRef.current = null;
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (focusedPageRef.current === focusPageKey) return;
      if (firstVenueRef.current) {
        if (groupsRef.current) groupsRef.current.scrollTop = 0;
        firstVenueRef.current.focus({ preventScroll: true });
        focusedPageRef.current = focusPageKey;
      } else {
        closeButtonRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [firstBaseId, firstCuratedId, firstCombinedId, focusPageKey, open]);

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
              <h2 className="mapVenueListTitle">Venues on the map</h2>
              <span className="mapVenueListCount" role="status" aria-live="polite">
                {ukBaseStatus === "unavailable" && total === 0
                  ? "Unlisted pubs unavailable"
                  : awaitingRows
                  ? "Counting them up…"
                  : total === 0
                    ? "Nothing matches"
                    : truncated
                      ? `${effectiveSortMode === "cheapest" ? "Cheapest" : "Nearest"} ${shown} of ${total}`
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

          {onSortModeChange && total > 0 ? (
            <div className="mapVenueListSort" role="group" aria-label="Sort venues on the map">
              <button
                type="button"
                className="mapVenueListSortChip"
                aria-pressed={effectiveSortMode === "nearest"}
                onClick={() => onSortModeChange("nearest")}
              >
                Nearest
              </button>
              <button
                type="button"
                className="mapVenueListSortChip"
                aria-pressed={effectiveSortMode === "cheapest"}
                disabled={!priceOrderAvailable}
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
            <div ref={groupsRef} className="mapVenueListGroups">
              {groupedRows ? (
                <section className="mapVenueListGroup" aria-label="Drink offers and other venues">
                  <h3 className="mapVenueListGroupTitle">{servingGroup ? `${servingGroup} menu prices` : "Choose a serving to compare menu prices"}</h3>
                  <p className="mapVenueListCoverage">Other servings and community reports remain visible, unranked. Prices cover the published menus we have, not every offer.</p>
                  <ul className="mapVenueListItems" aria-label="Drink offers and other venues">
                    {combinedPage?.map((row) => <li key={row.id}>
                      <button ref={row.id === firstCombinedId ? firstVenueRef : undefined}
                        id={`map-venue-list-item-${row.id}`} type="button" className="mapVenueListItem"
                        data-venue-id={row.id} onClick={() => "pub" in row ? onSelectUkBasePub(row.pub) : onSelectVenue(row.id)}
                        onPointerEnter={() => { if (!("pub" in row)) onPrefetchVenue(row.id); }}
                        onFocus={() => { if (!("pub" in row)) onPrefetchVenue(row.id); }}>
                        <span className="mapVenueListItemName"><MapPin size={14} aria-hidden="true" />{row.name}</span>
                        <span className="mapVenueListItemMeta">
                          {typeof row.distanceKm === "number" ? <span className="mapVenueListItemDist">{formatLogNearbyDistance(row.distanceKm)}</span> : null}
                          <span className="mapVenueListCompactPrice"><span>{row.priceLabel}</span>
                            {row.lensPrice ? <PriceProvenance price={row.lensPrice} ranked={row.sortPrice != null} /> : null}
                          </span>
                        </span>
                      </button>
                    </li>)}
                  </ul>
                </section>
              ) : null}
              {!groupedRows && curatedPage.length > 0 ? (
                <section className="mapVenueListGroup" aria-label="Listed pubs and venues">
                  <h3 className="mapVenueListGroupTitle">Listed pubs and venues</h3>
                  <ul className="mapVenueListItems" aria-label="Listed pubs and venues">
                    {curatedPage.map((row) => (
                      <li key={row.id}>
                        <button
                          ref={row.id === firstCuratedId ? firstVenueRef : undefined}
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
              {!groupedRows && basePage.length > 0 ? (
                <section className="mapVenueListGroup mapVenueListGroup--unverified" aria-label="Other pubs and bars with no listed price">
                  <h3 className="mapVenueListGroupTitle">Other pubs and bars · no listed price</h3>
                  <ul className="mapVenueListItems" aria-label="Other pubs and bars with no listed price">
                    {basePage.map((row) => (
                      <li key={row.id}>
                        <button
                          ref={row.id === firstBaseId ? firstVenueRef : undefined}
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
            </div>
          )}
          {lastPage > 0 ? (
            <nav className="mapVenueListPagination" aria-label="Venue list pages">
              <span className="mapVenueListPageRange" role="status" aria-live="polite">
                {`${pageStart + 1}-${pageEnd} of ${rowCount}`}
              </span>
              <div className="mapVenueListPageControls">
                <Button type="button" variant="secondary" disabled={page === 0}
                  onClick={() => setPagination({ key: pageKey, page: page - 1 })}>
                  Previous
                </Button>
                <Button type="button" variant="secondary" disabled={page === lastPage}
                  onClick={() => setPagination({ key: pageKey, page: page + 1 })}>
                  Next
                </Button>
              </div>
            </nav>
          ) : null}
        </div>
    </section>
  );
}

function PriceProvenance({ price, ranked }: { price: MapLensPrice; ranked: boolean }) {
  let publisher = "Published menu";
  if (price.sourceUrl) {
    try { publisher = new URL(price.sourceUrl).hostname; } catch { /* Keep neutral source label. */ }
  }
  const date = price.observedAt ?? (price.submittedAt === undefined || !Number.isFinite(price.submittedAt) ? null : new Date(price.submittedAt).toISOString());
  return <span className="mapVenueListPriceProvenance">
    {price.drinkLabel ? `${price.drinkLabel} · ` : ""}{price.servingSize ?? "Serving not recorded"}
    {` · ${price.source === "community" ? "Community report" : publisher}`}
    {date ? ` · ${new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}` : ""}
    {!ranked ? " · Unranked" : ""}
  </span>;
}
