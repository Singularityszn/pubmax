"use client";

import type { ReactNode } from "react";
import MapKey from "@/components/map/MapKey";
import PintCapMatchSummary from "@/components/map/PintCapMatchSummary";
import type { MapPriceLegendModel } from "@/lib/mapPriceLegend";
import type { PintCapMatches } from "@/lib/pintCapMatches";
import { PINT_PRICE_CAPS, pintPriceCapIsActive, pintPriceCapsFor } from "@/lib/pintPriceCaps";
import { Button } from "@/components/ui/button";

import "./mobileFilterDisclosure.css";

/**
 * The caps this sheet can set: the one shared set (lib/pintPriceCaps.ts), so
 * the phone offers what the desktop chips and the rail slider offer. The first
 * is "Any", the one OFF value.
 */
export const PRICE_CHOICES: readonly number[] = PINT_PRICE_CAPS.map((cap) => cap.maxPrice);

export default function MobilePriceChoices({
  maxPrice,
  legend,
  drinkLabel,
  matches,
  lead,
  children,
  onMaxPriceChange,
  drinkControl,
  onClearFilters,
  refinementsActive = false,
}: {
  maxPrice: number;
  legend: MapPriceLegendModel;
  drinkLabel?: string | null;
  matches?: PintCapMatches | null;
  /** An event action within the additional filters, or above the standalone price controls. */
  lead?: ReactNode;
  children?: ReactNode;
  onMaxPriceChange: (price: number) => void;
  drinkControl?: ReactNode;
  onClearFilters?: () => void;
  refinementsActive?: boolean;
}) {
  const refinements = <>{lead}{children}<MapKey legend={legend} /></>;
  return (
    <div className="mobileMapFilters">
      {onClearFilters ? <Button type="button" variant="ghost" className="mobileFilterReset" onClick={onClearFilters}>Clear filters</Button> : lead}
      {drinkLabel || !legend.priceCapFilter ? null : (
        <fieldset className="mobilePriceChoices">
          <legend>Maximum pint price</legend>
          {/* The five caps are ONE choice, so they share one edge and are
              divided by interior hairlines. The group wrapper exists so the
              edge belongs to the GROUP: with the border on each button, the
              first segment closed its own box and read as a container in its
              own right (design judgement 2026-08-01, finding 2.4). */}
          <div className="mobilePriceChoicesGroup">
            {pintPriceCapsFor(maxPrice).map((cap) => {
              const on = pintPriceCapIsActive(maxPrice, cap.maxPrice);
              return (
                <button
                  type="button"
                  key={cap.maxPrice}
                  className={on ? "isActive" : ""}
                  aria-pressed={on}
                  onClick={() => onMaxPriceChange(cap.maxPrice)}
                >
                  {cap.shortLabel}
                </button>
              );
            })}
          </div>
          <PintCapMatchSummary matches={matches} />
        </fieldset>
      )}
      {drinkControl}
      {onClearFilters ? (
        <details className="mobileFilterDisclosure" open={refinementsActive || undefined}>
          <summary>More filters{refinementsActive ? " · active" : ""}</summary>
          <div className="mobileFilterRefinements">{refinements}</div>
        </details>
      ) : <>{children}<MapKey legend={legend} /></>}
    </div>
  );
}
