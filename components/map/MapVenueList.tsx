"use client";

import { useId } from "react";
import { List, MapPin, X } from "lucide-react";

import { formatLogNearbyDistance } from "@/lib/mapLogIntent";
import type { MapVenueListModel } from "@/lib/mapVenueList";

import "./mapVenueList.css";

// A11Y finding #1 (WCAG 2.1.1) — the keyboard/screen-reader parallel to the
// canvas pins. A visible, focusable "List view" toggle opens a DOM list of the
// venues currently on the map (nearest-first to the viewport centre). Each row
// is a real <button> that drives the SAME select handler a pin tap does, so an
// AT user can enumerate and open any pin without touching the WebGL layer.
// It's also just a genuinely useful feature for everyone — list view is not a
// shim.
export default function MapVenueList({
  model,
  cityName,
  open,
  onOpenChange,
  loaded,
  onSelectVenue,
  onPrefetchVenue,
}: {
  model: MapVenueListModel;
  cityName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loaded: boolean;
  onSelectVenue: (id: string) => void;
  onPrefetchVenue: (id: string) => void;
}) {
  const panelId = useId();
  const { rows, total, shown, truncated } = model;

  return (
    <section className={`mapVenueList${open ? " mapVenueList--open" : ""}`} aria-label={`${cityName} pub list`}>
      {open ? (
        <div className="mapVenueListPanel" id={panelId} role="group" aria-label={`${cityName} pubs on the map`}>
          <header className="mapVenueListHead">
            <div className="mapVenueListHeadMeta">
              <h2 className="mapVenueListTitle">Pubs on the map</h2>
              <span className="mapVenueListCount" role="status" aria-live="polite">
                {!loaded
                  ? "Loading pubs…"
                  : total === 0
                    ? "No pubs match your filters"
                    : truncated
                      ? `Nearest ${shown} of ${total}`
                      : `${total} pub${total === 1 ? "" : "s"}`}
              </span>
            </div>
            <button
              type="button"
              className="mapVenueListClose"
              aria-label="Close pub list"
              onClick={() => onOpenChange(false)}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          {total === 0 ? (
            <p className="mapVenueListEmpty" role="status">
              {loaded
                ? "No pubs match your current filters. Widen the price cap or clear a drink filter to see more on the map."
                : "Finding the pubs…"}
            </p>
          ) : (
            <ul className="mapVenueListItems" aria-label="Pubs on the map, nearest first">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="mapVenueListItem"
                    onClick={() => {
                      onSelectVenue(row.id);
                      onOpenChange(false);
                    }}
                    onPointerEnter={() => onPrefetchVenue(row.id)}
                    onFocus={() => onPrefetchVenue(row.id)}
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
