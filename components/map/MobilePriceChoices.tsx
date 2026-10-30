"use client";

import MapKey from "@/components/map/MapKey";
import type { MapPriceLegendModel } from "@/lib/mapPriceLegend";
import { PINT_PRICE_CAPS, pintPriceCapIsActive } from "@/lib/pintPriceCaps";

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
  onMaxPriceChange,
}: {
  maxPrice: number;
  legend: MapPriceLegendModel;
  drinkLabel?: string;
  onMaxPriceChange: (price: number) => void;
}) {
  return (
    <>
      <MapKey legend={legend} />
      {drinkLabel || !legend.priceCapFilter ? null : (
        <fieldset className="mobilePriceChoices">
          <legend>Maximum pint price</legend>
          {/* The five caps are ONE choice, so they share one edge and are
              divided by interior hairlines. The group wrapper exists so the
              edge belongs to the GROUP: with the border on each button, the
              first segment closed its own box and read as a container in its
              own right (design judgement 2026-08-01, finding 2.4). */}
          <div className="mobilePriceChoicesGroup">
            {PINT_PRICE_CAPS.map((cap) => {
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
        </fieldset>
      )}
    </>
  );
}
