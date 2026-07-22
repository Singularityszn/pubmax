"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import type { CityId } from "@/lib/cities";
import {
  areaElsewhereOptions,
  cheapestPintsInArea,
  type AreaElsewhereOption,
} from "@/lib/areaButton";
import type { NightArea } from "@/lib/nightAreas";
import type { Venue } from "@/lib/venues";

import "./areaSheet.css";

// Body of the map's Area sheet (the house bottom Sheet the mobile top-bar Area
// button opens). Two sections: the current area's cheapest pints, and a "go
// somewhere else" grid of the modelled Night Areas. All the logic lives in
// lib/areaButton.ts — this is a thin, hermetic render over those models.
type AreaSheetProps = {
  cityId: CityId;
  /** The Night Area under the map centre, or null before the map settles. */
  area: NightArea | null;
  /** Full on-map venue set (unfiltered) — the price pins the map loaded. */
  venues: Venue[];
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
  venues,
  center,
  onSelectVenue,
  onFlyToArea,
  onClose,
}: AreaSheetProps) {
  const closeTimer = useRef<number | null>(null);
  const elsewhere = useMemo(() => areaElsewhereOptions(cityId), [cityId]);
  const pubs = useMemo(
    () => (area ? cheapestPintsInArea(area, venues, center) : []),
    [area, venues, center],
  );

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
      <section className="areaSheetSection" aria-label="Cheapest pints in this area">
        <h3 className="areaSheetHeading">
          {area ? `Cheapest pints in ${area.name}` : "Cheapest pints here"}
        </h3>
        {area && pubs.length > 0 ? (
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
                        pub.cheapestPrice !== null
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
            {area
              ? "No priced pints in this area yet. Try somewhere else below."
              : "Pan the map over an area to see its cheapest pints."}
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
