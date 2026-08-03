"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { List, MapPin, X } from "lucide-react";

import CompactVenuePrice from "@/components/map/CompactVenuePrice";
import { formatLogNearbyDistance } from "@/lib/mapLogIntent";
import type { MapVenueListModel, UkBasePubListModel } from "@/lib/mapVenueList";
import type { UkBasePub } from "@/lib/ukBasePubs";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

import "./mapVenueList.css";

// Accessibility contract (WCAG 2.1.1): keyboard/screen-reader parallel to
// canvas pins. A visible, focusable "List view" toggle opens a DOM list of the
// filtered venues projected inside the current viewport, nearest-first to its
// centre. Each row is a real <button> that drives the SAME select handler a pin
// tap does, so an AT user can enumerate and open any listed venue without
// touching the WebGL layer.
// It's also a useful feature for everyone: list view is not a
// shim.
export default function MapVenueList({
  model,
  ukBaseModel,
  cityName,
  open,
  onOpenChange,
  loaded,
  onSelectVenue,
  onSelectUkBasePub,
  onPrefetchVenue,
}: {
  model: MapVenueListModel;
  ukBaseModel: UkBasePubListModel;
  cityName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loaded: boolean;
  onSelectVenue: (id: string) => void;
  onSelectUkBasePub: (pub: UkBasePub) => void;
  onPrefetchVenue: (id: string) => void;
}) {
  const panelId = useId();
  const total = model.total + ukBaseModel.total;
  const shown = model.shown + ukBaseModel.shown;
  const truncated = model.truncated || ukBaseModel.truncated;
  const firstVenueRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const venueFocusAssignedRef = useRef(false);
  const firstCuratedId = model.rows[0]?.id;
  const firstBaseId = firstCuratedId ? undefined : ukBaseModel.rows[0]?.id;

  // The list opens from a toggle that stays on screen beside it, so the way
  // back is that toggle and it does not join the surface trail. Escape leaves
  // it, because opening the list moves focus INTO the list and a keyboard
  // reader had no way out but to tab to the close glyph.
  const closeList = useCallback(() => onOpenChange(false), [onOpenChange]);
  useDismissOnEscape(open, closeList);

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
  }, [firstBaseId, firstCuratedId, open]);

  return (
    <section className={`mapVenueList${open ? " mapVenueList--open" : ""}`} aria-label={`${cityName} venue list`}>
      {open ? (
        <div className="mapVenueListPanel" id={panelId} role="group" aria-label={`${cityName} venues on the map`}>
          <header className="mapVenueListHead">
            <div className="mapVenueListHeadMeta">
              <h2 className="mapVenueListTitle">Venues on the map</h2>
              <span className="mapVenueListCount" role="status" aria-live="polite">
                {!loaded && ukBaseModel.total === 0
                  ? "Counting them up…"
                  : total === 0
                    ? "Nothing matches"
                    : truncated
                      ? `Nearest ${shown} of ${total}`
                      : `${total} venue${total === 1 ? "" : "s"}`}
              </span>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              className="mapVenueListClose"
              aria-label="Close venue list"
              onClick={closeList}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          {model.coverageNote ? (
            <p className="mapVenueListCoverage" role="status">
              {model.coverageNote}
            </p>
          ) : null}

          {total === 0 ? (
            <p className="mapVenueListEmpty" role="status">
              {loaded
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
                <section className="mapVenueListGroup mapVenueListGroup--unverified" aria-label="Other pubs with no listed price">
                  <h3 className="mapVenueListGroupTitle">Other pubs · no listed price</h3>
                  <ul className="mapVenueListItems" aria-label="Other pubs with no listed price">
                    {ukBaseModel.rows.map((row) => (
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
        </div>
      ) : null}

      <button
        type="button"
        className="mapVenueListToggle"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => onOpenChange(!open)}
      >
        <List size={17} aria-hidden="true" />
        <span>List view</span>
        {loaded && total > 0 ? <span className="mapVenueListToggleCount">{total}</span> : null}
      </button>
    </section>
  );
}
