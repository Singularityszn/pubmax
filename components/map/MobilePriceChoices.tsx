"use client";

import { mapPriceLegend } from "@/lib/mapPriceLegend";

const PRICE_CHOICES = [10, 7, 6, 5.5];

export default function MobilePriceChoices({
  maxPrice,
  hasTypeRelativePrices,
  drinkLabel,
  onMaxPriceChange,
}: {
  maxPrice: number;
  hasTypeRelativePrices: boolean;
  drinkLabel?: string;
  onMaxPriceChange: (price: number) => void;
}) {
  const legend = mapPriceLegend(hasTypeRelativePrices, drinkLabel);
  return (
    <>
      <section className="mobilePriceBandLegend" aria-label={legend.ariaLabel}>
        <strong>{legend.title}</strong>
        <p>{legend.hint}</p>
        <ul>
          {legend.rows.map((row) => (
            <li key={row.label}>
              <i data-tone={row.tone} aria-hidden="true" />
              <span>{row.label}</span>
            </li>
          ))}
        </ul>
      </section>
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
