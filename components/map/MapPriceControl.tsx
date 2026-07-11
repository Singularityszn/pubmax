"use client";

// Compact bottom-left price chrome — always-visible colour key (plan: ≤£5.50 /
// >£5.50–≤£7 / >£7) plus an optional filter popover. No heritage/writer rows.

import { Coins, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { Filters } from "@/lib/venues";

import "./mapPriceControl.css";

const PRICE_OPTIONS: { label: string; maxPrice: number }[] = [
  { label: "Any", maxPrice: 9 },
  { label: "≤ £5.50", maxPrice: 5.5 },
  { label: "≤ £7", maxPrice: 7 },
];

// Labels match priceBucket() inclusivity: ≤5.50 green, >5.50–≤7 amber, >7 red.
const PRICE_LEGEND = [
  { label: "≤ £5.50", tone: "green" as const },
  { label: "> £5.50–≤ £7", tone: "amber" as const },
  { label: "> £7", tone: "red" as const },
];

type MapPriceControlProps = {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
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
}: MapPriceControlProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  // Default is ≤£7; "Any" (9) is the wide/unfiltered option — neither looks "on".
  // Only a tightened band (≤£5.50) marks the FAB as actively filtered.
  const filtered = filters.maxPrice <= 5.5;

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
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
    <div className="mapPriceControl" ref={rootRef}>
      {/* Always-visible colour key — plan: small bottom-left price legend. */}
      <div
        className="mapPriceLegend"
        role="list"
        aria-label="Pint price colour key"
      >
        {PRICE_LEGEND.map((row) => (
          <span key={row.label} role="listitem">
            <i className={`mapPriceDot ${row.tone}`} aria-hidden="true" />
            {row.label}
          </span>
        ))}
      </div>

      <button
        type="button"
        className={open || filtered ? "mapPriceFab isActive" : "mapPriceFab"}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={
          open ? "Close pint price filter" : "Filter pubs by pint price"
        }
        title="Filter by pint price"
        onClick={() => setOpen((value) => !value)}
      >
        <Coins size={16} aria-hidden="true" />
        <span>{activeLabel(filters.maxPrice)}</span>
      </button>

      {open ? (
        <div
          id={panelId}
          className="mapPricePanel"
          role="dialog"
          aria-label="Pint price filter"
        >
          <div className="mapPricePanelHead">
            <strong>Prices</strong>
            <button
              type="button"
              className="mapPriceClose"
              aria-label="Close prices filter"
              onClick={() => setOpen(false)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <p className="mapPriceHint">Show pubs at or under this pint price.</p>
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
      ) : null}
    </div>
  );
}
