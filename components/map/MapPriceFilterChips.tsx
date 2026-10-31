"use client";

// The max pint price cap, as chips. It lives inside Layers beside the price
// key: the cap is a reader control, and a reader control does not float over
// the pins (see lib/mapSurfaceChrome.ts).

import { PINT_PRICE_CAPS, pintPriceCapIsActive } from "@/lib/pintPriceCaps";
import type { Filters } from "@/lib/venues";

// The caps are the one shared set (lib/pintPriceCaps.ts): the phone sheet and
// the rail slider offer exactly these. "Any" is the one OFF value, or picking
// it leaves a cap behind that no control reads back (see NO_PINT_PRICE_CAP).

export default function MapPriceFilterChips({
  filters,
  onFiltersChange,
  onPicked,
}: {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onPicked: () => void;
}) {
  return (
    <div className="mapLayersPriceBlock">
      <p className="mapLayersSectionLabel">Maximum pint price</p>
      <div
        className="mapLayersPriceOptions"
        role="group"
        aria-label="Max pint price"
      >
        {PINT_PRICE_CAPS.map((option) => {
          const on = pintPriceCapIsActive(filters.maxPrice, option.maxPrice);
          return (
            <button
              key={option.label}
              type="button"
              className={on ? "mapLayersPriceChip isOn" : "mapLayersPriceChip"}
              aria-pressed={on}
              onClick={() => {
                onFiltersChange({ ...filters, maxPrice: option.maxPrice });
                onPicked();
              }}
            >
              <i
                className={`mapLayersPriceDot ${option.tone}`}
                aria-hidden="true"
              />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
