"use client";

import type { CategoryPriceIndexStatus } from "@/lib/mapExperienceLens";
import { mapPriceLegend } from "@/lib/mapPriceLegend";
import type { MapRenderedState } from "@/lib/mapRenderedState";

const PRICE_CHOICES = [10, 7, 6, 5.5];

export default function MobilePriceChoices({
  maxPrice,
  drinkLabel,
  drinkNoun,
  drinkIndexStatus = "ready",
  renderedState,
  onMaxPriceChange,
}: {
  maxPrice: number;
  drinkLabel?: string;
  drinkNoun?: string;
  drinkIndexStatus?: CategoryPriceIndexStatus;
  renderedState: MapRenderedState;
  onMaxPriceChange: (price: number) => void;
}) {
  const legend = mapPriceLegend(
    drinkLabel
      ? {
          kind: "drink",
          label: drinkLabel,
          noun: drinkNoun ?? drinkLabel,
          status: drinkIndexStatus,
          renderedState,
        }
      : {
          kind: "default",
          renderedState,
        },
  );
  return (
    <>
      <section className="mobilePriceBandLegend" aria-label={legend.ariaLabel}>
        <strong>{legend.title}</strong>
        <p>{legend.hint}</p>
        {legend.rows.length > 0 ? (
          <ul>
            {legend.rows.map((row) => (
              <li key={row.label}>
                <i data-tone={row.tone} aria-hidden="true" />
                <span>{row.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
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
