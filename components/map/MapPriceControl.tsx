"use client";

// Compact desktop price key plus optional filter popover.

import { Coins, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { MapPriceLegendModel } from "@/lib/mapPriceLegend";
import {
  markMapLegendOneshotConsumed,
  shouldAutoOpenMapLegendOneshot,
} from "@/lib/mapLegendOneshot";
import { NO_PINT_PRICE_CAP, type Filters } from "@/lib/venues";
import MapKey from "@/components/map/MapKey";
import { trackEvent } from "@/lib/analytics";

import "./mapPriceControl.css";

const PRICE_OPTIONS: { label: string; maxPrice: number }[] = [
  // "Any" has to be the one OFF value, or picking it leaves a cap behind that
  // no control reads back. See NO_PINT_PRICE_CAP.
  { label: "Any", maxPrice: NO_PINT_PRICE_CAP },
  { label: "≤ £5.50", maxPrice: 5.5 },
  { label: "≤ £7", maxPrice: 7 },
];

type MapPriceControlProps = {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  placement?: "map" | "header" | "mobile";
  legend: MapPriceLegendModel;
  lensLabel?: string;
  priceFiltersEnabled: boolean;
};

function activeLabel(maxPrice: number): string {
  // A fresh visitor has no cap, so the FAB reads "Prices" (not a cryptic "≤£10").
  // Only surface a £ label when the reader tightens to the cheapest band.
  if (maxPrice <= 5.5) return "≤£5.50";
  return "Prices";
}

export default function MapPriceControl({
  filters,
  onFiltersChange,
  placement = "map",
  legend,
  lensLabel,
  priceFiltersEnabled,
}: MapPriceControlProps) {
  // W3 one-shot: never open during SSR (hydration-safe). After mount, amplify
  // once when the tour is already seen and the session gate is free.
  const [open, setOpen] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);
  const oneshotTracked = useRef(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  // Default is ≤£7; "Any" (9) is the wide/unfiltered option — neither looks "on".
  // Only a tightened band (≤£5.50) marks the FAB as actively filtered.
  const filtered = priceFiltersEnabled && filters.maxPrice <= 5.5;

  useEffect(() => {
    if (placement !== "map" && placement !== "mobile") return;
    if (oneshotTracked.current) return;
    if (!shouldAutoOpenMapLegendOneshot()) return;
    oneshotTracked.current = true;
    markMapLegendOneshotConsumed();
    // Async setState — never the sync effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => {
      setAutoOpened(true);
      setOpen(true);
    });
  }, [placement]);

  useEffect(() => {
    if (!autoOpened || !open) return;
    const timer = window.setTimeout(() => {
      setOpen(false);
      setAutoOpened(false);
    }, 6_000);
    return () => window.clearTimeout(timer);
  }, [autoOpened, open]);

  function togglePanel() {
    setAutoOpened(false);
    setOpen((value) => !value);
  }

  function closePanel() {
    setAutoOpened(false);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Claim the key so the map-level Escape (close drawer) doesn't also fire.
        event.preventDefault();
        closePanel();
        trackEvent("map_legend_dismissed");
      }
    }
    function onPointer(event: MouseEvent | TouchEvent) {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && !root.contains(event.target)) {
        closePanel();
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
          : placement === "mobile"
            ? "mapPriceControl mapPriceControl--mobile"
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
        onClick={togglePanel}
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

      {placement === "mobile" ? (
        <button
          type="button"
          className={open ? "mapPriceFab isActive" : "mapPriceFab"}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Close map key" : "Open map key"}
          title="Map key"
          onClick={togglePanel}
        >
          <Coins size={16} aria-hidden="true" />
          <span>Key</span>
        </button>
      ) : null}

      {placement === "map" ? (
        <button
          type="button"
          className={open || filtered ? "mapPriceFab isActive" : "mapPriceFab"}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={
            open
              ? "Close price key"
              : lensLabel
                ? `Show ${lensLabel.toLowerCase()} map key`
                : "Filter pubs by pint price"
          }
          title={lensLabel ? `${lensLabel} map key` : "Filter by pint price"}
          onClick={togglePanel}
        >
          <Coins size={16} aria-hidden="true" />
          <span>{lensLabel ?? activeLabel(filters.maxPrice)}</span>
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
              onClick={() => {
                closePanel();
                trackEvent("map_legend_dismissed");
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <MapKey legend={legend} />
          {priceFiltersEnabled ? (
            <div className="mapPriceFilterBlock">
              <strong>Maximum pint price</strong>
              <div className="mapPriceOptions" role="group" aria-label="Max pint price">
                {PRICE_OPTIONS.map((option) => {
                  const on =
                    option.label === "Any"
                      ? filters.maxPrice >= NO_PINT_PRICE_CAP
                      : Math.abs(filters.maxPrice - option.maxPrice) < 0.01;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      className={on ? "mapPriceChip isOn" : "mapPriceChip"}
                      aria-pressed={on}
                      onClick={() => {
                        onFiltersChange({ ...filters, maxPrice: option.maxPrice });
                        closePanel();
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
      ) : null}
    </div>
  );
}
