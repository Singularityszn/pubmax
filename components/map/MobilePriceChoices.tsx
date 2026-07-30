"use client";

import MapKey from "@/components/map/MapKey";
import type { MapPriceLegendModel } from "@/lib/mapPriceLegend";

const PRICE_CHOICES = [10, 7, 6, 5.5];

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
      {drinkLabel ? null : (
        <fieldset className="mobilePriceChoices">
          <legend>Maximum pint price</legend>
          {PRICE_CHOICES.map((price) => (
            <button
              type="button"
              key={price}
              className={maxPrice === price ? "isActive" : ""}
              aria-pressed={maxPrice === price}
              onClick={() => onMaxPriceChange(price)}
            >
              {price === 10 ? "Any" : `£${price.toFixed(2)}`}
            </button>
          ))}
        </fieldset>
      )}
    </>
  );
}
