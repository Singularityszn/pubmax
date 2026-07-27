"use client";

import { useId } from "react";
import { List, MapPin, X } from "lucide-react";

import CompactVenuePrice from "@/components/map/CompactVenuePrice";
import { formatLogNearbyDistance } from "@/lib/mapLogIntent";
import type { MapVenueListModel, UkBasePubListModel } from "@/lib/mapVenueList";
import type { UkBasePub } from "@/lib/ukBasePubs";

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
              type="button"
              className="mapVenueListClose"
              aria-label="Close venue list"
              onClick={() => onOpenChange(false)}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          {total === 0 ? (
            <p className="mapVenueListEmpty" role="status">
              {loaded
                ? "Nothing in view fits that. Push the price cap up or drop a filter and the pubs come back."
                : "Counting them up…"}
            </p>
          ) : (
            <div className="mapVenueListGroups">
              {model.rows.length > 0 ? (
                <section className="mapVenueListGroup" aria-label="Priced and curated venues">
                  <h3 className="mapVenueListGroupTitle">Priced and curated</h3>
                  <ul className="mapVenueListItems" aria-label="Priced and curated venues">
                    {model.rows.map((row) => (
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
                <section className="mapVenueListGroup mapVenueListGroup--unverified" aria-label="Unverified pubs with no price">
                  <h3 className="mapVenueListGroupTitle">Unverified pubs · no price</h3>
                  <ul className="mapVenueListItems" aria-label="Unverified pubs with no price">
                    {ukBaseModel.rows.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className="mapVenueListItem"
                          onClick={() => {
                            onSelectUkBasePub(row.pub);
                            onOpenChange(false);
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
