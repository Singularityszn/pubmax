"use client";

// Compact desktop price key plus optional filter popover.

import { Coins, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { CategoryPriceIndexStatus } from "@/lib/mapExperienceLens";
import { mapPriceLegend } from "@/lib/mapPriceLegend";
import type { Filters } from "@/lib/venues";
import MapKey from "@/components/map/MapKey";

import "./mapPriceControl.css";

const PRICE_OPTIONS: { label: string; maxPrice: number }[] = [
  { label: "Any", maxPrice: 9 },
  { label: "≤ £5.50", maxPrice: 5.5 },
  { label: "≤ £7", maxPrice: 7 },
];

type MapPriceControlProps = {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  placement?: "map" | "header";
  hasTypeRelativePrices?: boolean;
  drinkLabel?: string;
  drinkNoun?: string;
  drinkIndexStatus?: CategoryPriceIndexStatus;
};

function activeLabel(maxPrice: number): string {
  // Default product filter is ≤£7 — keep the FAB as "Prices" (not cryptic "≤£7").
  // Only surface a £ label when the user tightens below the default band.
  if (maxPrice <= 5.5) return "≤£5.50";
  return "Prices";
}

export default function MapPriceControl({
  filters,
  onFiltersChange,
  placement = "map",
  hasTypeRelativePrices = false,
  drinkLabel,
  drinkNoun,
  drinkIndexStatus = "ready",
}: MapPriceControlProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  // Default is ≤£7; "Any" (9) is the wide/unfiltered option — neither looks "on".
  // Only a tightened band (≤£5.50) marks the FAB as actively filtered.
  const filtered = filters.maxPrice <= 5.5;
  const legend = mapPriceLegend(
    hasTypeRelativePrices,
    drinkLabel,
    drinkIndexStatus,
    drinkNoun,
  );

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Claim the key so the map-level Escape (close drawer) doesn't also fire.
        event.preventDefault();
        setOpen(false);
      }
    }
    function onPointer(event: MouseEvent | TouchEvent) {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && !root.contains(event.target)) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("touchstart", onPointer, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("touchstart", onPointer);
    };
  }, [open]);

  return (
    <div
      className={
        placement === "header"
          ? "mapPriceControl mapPriceControl--header"
          : "mapPriceControl mapPriceControl--map"
      }
      ref={rootRef}
    >
      <button
        type="button"
        className="mapPriceLegend"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close map key" : `Open map key: ${legend.ariaLabel}`}
        title="Map key"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="mapPriceLegendTitle">Key</span>
        {legend.rows.length === 0 ? (
          <span>
            <span className="mapPriceLegendFull">{legend.title}</span>
            <span className="mapPriceLegendCompact" aria-hidden="true">
              £?
            </span>
          </span>
        ) : (
          legend.rows.map((row) => (
            <span key={row.label}>
              <i className={`mapPriceDot ${row.tone}`} aria-hidden="true" />
              <span className="mapPriceLegendFull">{row.label}</span>
              <span className="mapPriceLegendCompact" aria-hidden="true">
                {row.symbol}
              </span>
            </span>
          ))
        )}
      </button>

      {placement === "map" ? (
        <button
          type="button"
          className={open || filtered ? "mapPriceFab isActive" : "mapPriceFab"}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={
            open
              ? "Close price key"
              : drinkLabel
                ? `Show ${drinkLabel.toLowerCase()} price key`
                : "Filter pubs by pint price"
          }
          title={drinkLabel ? `${drinkLabel} price key` : "Filter by pint price"}
          onClick={() => setOpen((value) => !value)}
        >
          <Coins size={16} aria-hidden="true" />
          <span>{drinkLabel ?? activeLabel(filters.maxPrice)}</span>
        </button>
      ) : null}

      {open ? (
        <div
          id={panelId}
          className="mapPricePanel"
          role="dialog"
          aria-label="Map key and price filters"
        >
          <div className="mapPricePanelHead">
            <strong>Map key</strong>
            <button
              type="button"
              className="mapPriceClose"
              aria-label="Close map key"
              onClick={() => setOpen(false)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <MapKey legend={legend} />
          {drinkLabel ? null : (
            <div className="mapPriceFilterBlock">
              <strong>Maximum pint price</strong>
              <div className="mapPriceOptions" role="group" aria-label="Max pint price">
                {PRICE_OPTIONS.map((option) => {
                  const on =
                    option.label === "Any"
                      ? filters.maxPrice >= 9
                      : Math.abs(filters.maxPrice - option.maxPrice) < 0.01;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      className={on ? "mapPriceChip isOn" : "mapPriceChip"}
                      aria-pressed={on}
                      onClick={() => {
                        onFiltersChange({ ...filters, maxPrice: option.maxPrice });
                        setOpen(false);
                      }}
                    >
                      {option.label === "Any" ? (
                        <i className="mapPriceDot any" aria-hidden="true" />
                      ) : option.maxPrice <= 5.5 ? (
                        <i className="mapPriceDot green" aria-hidden="true" />
                      ) : option.maxPrice <= 7 ? (
                        <i className="mapPriceDot amber" aria-hidden="true" />
                      ) : (
                        <i className="mapPriceDot red" aria-hidden="true" />
                      )}
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
