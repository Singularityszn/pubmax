"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import type { CityId } from "@/lib/cities";
import {
  areaElsewhereOptions,
  cheapestDrinksInArea,
  cheapestDrinksNearPoint,
  type AreaElsewhereOption,
} from "@/lib/areaButton";
import type { NightArea } from "@/lib/nightAreas";
import {
  drinkLensCoverageNote,
  type CategoryPriceIndexStatus,
  type MapLensPrice,
} from "@/lib/mapExperienceLens";
import type { Venue } from "@/lib/venues";

import "./areaSheet.css";

/**
 * An ad-hoc place (a locality or borough a map search flew to) that is NOT one
 * of the modelled Night Areas: the sheet derives its pubs from a walkable ring
 * around this centroid instead of an area's own region. When set it takes
 * precedence over `area`, and the header names this place.
 */
export type AreaSheetPlaceFocus = {
  name: string;
  /** [lng, lat] the map flew to — the ring centre + distance origin. */
  center: [number, number];
  radiusKm: number;
};

// Body of the map's Area sheet (the house bottom Sheet the mobile top-bar Area
// button opens). Two sections: the current area's cheapest pints, and a "go
// somewhere else" grid of the modelled Night Areas. All the logic lives in
// lib/areaButton.ts — this is a thin, hermetic render over those models.
type AreaSheetProps = {
  cityId: CityId;
  /** The Night Area under the map centre, or null before the map settles. */
  area: NightArea | null;
  /** A searched locality/borough to show instead of `area` — the ad-hoc ring.
   *  null (the Area button) keeps the modelled `area` behaviour. */
  placeFocus?: AreaSheetPlaceFocus | null;
  /** Full on-map venue set (unfiltered) — the price pins the map loaded. */
  venues: Venue[];
  /** Trusted prices for selected non-pint drink, or null for pint default. */
  lensPrices?: ReadonlyMap<string, MapLensPrice> | null;
  /** Human category label used beside every lens figure and unknown row. */
  drinkLabel?: string;
  /** How complete the selected drink's cross-venue read was. A failed or
   *  truncated index may never be rendered as "none here yet". */
  lensStatus?: CategoryPriceIndexStatus;
  /** Live map centre [lng, lat], for area membership + row distances. */
  center: [number, number];
  /** Fly + open a pub's venue card — the same selection a pin tap drives. */
  onSelectVenue: (id: string) => void;
  /** Fly the map to another area's centre (reduced-motion safe in the canvas). */
  onFlyToArea: (option: AreaElsewhereOption) => void;
  /** Close the sheet (the map is already in view). */
  onClose: () => void;
};

// The sheet lingers one beat after a "go somewhere else" tap so the fly reads,
// then closes itself.
const AREA_HOP_CLOSE_MS = 900;

export default function AreaSheet({
  cityId,
  area,
  placeFocus = null,
  venues,
  lensPrices = null,
  drinkLabel = "Pints",
  lensStatus = "ready",
  center,
  onSelectVenue,
  onFlyToArea,
  onClose,
}: AreaSheetProps) {
  const closeTimer = useRef<number | null>(null);
  const elsewhere = useMemo(() => areaElsewhereOptions(cityId), [cityId]);
  // A searched locality/borough (placeFocus) derives its pubs from a walkable
  // ring around its centroid; otherwise the modelled area under the map centre
  // owns the list. The name shown in the header follows the same precedence.
  const pubs = useMemo(
    () =>
      placeFocus
        ? cheapestDrinksNearPoint(
            placeFocus.center,
            venues,
            placeFocus.radiusKm,
            undefined,
            lensPrices,
            drinkLabel,
            lensStatus,
          )
        : area
          ? cheapestDrinksInArea(
              area,
              venues,
              center,
              undefined,
              lensPrices,
              drinkLabel,
              lensStatus,
            )
          : [],
    [placeFocus, area, venues, center, lensPrices, drinkLabel, lensStatus],
  );
  const focusName = placeFocus?.name ?? area?.name ?? null;
  const drinkNoun = lensPrices === null ? "pints" : drinkLabel.toLowerCase();
  // The rows below list unpriced pubs too, so an index that failed or was cut
  // short would otherwise read as a settled "none here". Say which it was.
  const coverageNote =
    lensPrices === null ? null : drinkLensCoverageNote(drinkNoun, lensStatus);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  const pickPub = useCallback(
    (id: string) => {
      clearCloseTimer();
      onSelectVenue(id);
      onClose();
    },
    [clearCloseTimer, onClose, onSelectVenue],
  );

  const hopToArea = useCallback(
    (option: AreaElsewhereOption) => {
      onFlyToArea(option);
      clearCloseTimer();
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        onClose();
      }, AREA_HOP_CLOSE_MS);
    },
    [clearCloseTimer, onClose, onFlyToArea],
  );

  return (
    <div className="areaSheet">
      <section
        className="areaSheetSection"
        aria-label={`Cheapest ${drinkNoun} in this area`}
      >
        <h3 className="areaSheetHeading">
          {focusName
            ? `Cheapest ${drinkNoun} in ${focusName}`
            : `Cheapest ${drinkNoun} here`}
        </h3>
        {coverageNote ? (
          <p className="areaSheetEmpty areaSheetCoverage" role="status">
            {coverageNote}
          </p>
        ) : null}
        {focusName && pubs.length > 0 ? (
          <ul className="areaSheetList">
            {pubs.map((pub) => (
              <li key={pub.id}>
                <button
                  type="button"
                  className="areaSheetPub"
                  onClick={() => pickPub(pub.id)}
                >
                  <span className="areaSheetPubName">{pub.name}</span>
                  <span className="areaSheetPubMeta">
                    <span
                      className={
                        pub.price !== null
                          ? "areaSheetPrice"
                          : "areaSheetPrice isUnpriced"
                      }
                    >
                      {pub.priceLabel}
                    </span>
                    {pub.distanceLabel ? (
                      <span className="areaSheetDistance">{pub.distanceLabel}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="areaSheetSeeAll" onClick={onClose}>
                See all on the map
              </button>
            </li>
          </ul>
        ) : (
          <p className="areaSheetEmpty">
            {!placeFocus && !area
              ? `Pan the map over an area to see its cheapest ${drinkNoun}.`
              : coverageNote
                ? "Try somewhere else below."
                : placeFocus
                  ? `No ${drinkNoun} prices nearby yet. Try somewhere else below.`
                  : `No ${drinkNoun} prices in this area yet. Try somewhere else below.`}
          </p>
        )}
      </section>

      <section className="areaSheetSection" aria-label="Go somewhere else">
        <h3 className="areaSheetHeading">Go somewhere else</h3>
        <ul className="areaSheetGrid">
          {elsewhere.map((option) => {
            const isCurrent = option.slug === area?.slug;
            return (
              <li key={option.slug}>
                <button
                  type="button"
                  className={isCurrent ? "areaSheetChip isCurrent" : "areaSheetChip"}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => hopToArea(option)}
                >
                  <span className="areaSheetChipName">{option.name}</span>
                  {option.coverage ? (
                    <span
                      className="areaSheetChipCoverage"
                      data-tone={option.coverage.tone}
                    >
                      {option.coverage.label}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
