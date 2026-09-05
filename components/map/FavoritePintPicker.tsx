"use client";

import type { CSSProperties } from "react";
import { Beer } from "lucide-react";

import { BEERS } from "@/lib/beers";
import { formatAbv } from "@/lib/drinks";

// The pint-brand refinement, and nothing else.
//
// Which DRINK the map is under is a lane, and it has its own first-class
// control now (components/map/DrinkLanePicker.tsx). This control used to carry
// a second copy of that choice as a `<select>`, which is exactly the shape that
// drifts: two live pickers on one page disagree the moment either writes.
//
// Brand belongs here and only here, because only beer has one. Community
// category rows do not name a brand, so a whisky-brand choice would overstate
// what its pin proves. The parent mounts this only while the pint lane owns the
// map.

type FavoritePintPickerProps = {
  value: string | null;
  onChange: (beerId: string | null) => void;
  drinkBrand: string;
  onDrinkBrandChange: (drinkBrand: string) => void;
};

const CLEAR_VALUE = "";

const selectStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--ink)",
  font: "inherit",
  padding: 0,
  cursor: "pointer",
  // No `outline: none` here: an inline style outranks every stylesheet rule,
  // so it silently killed the global :focus-visible ring (app/globals.css) and
  // left the map's drink filter with no visible focus at all.
  // The control has to be able to SAY what it is set to. At 140px a native
  // select cut "Cheapest pint (any)" to "Cheapest pint (a" with no ellipsis and
  // no scroll, so the resting state of the map's drink filter was unreadable.
  // The ceiling now fits that resting label, and anything longer (a brand plus
  // its ABV) ends in an ellipsis rather than mid-word.
  maxWidth: "12.5rem",
  textOverflow: "ellipsis",
  // The select is the TARGET, so it fills its label's height rather than
  // sitting 22px tall inside a 44px pill: measured on the control itself it
  // was under the 24px WCAG floor, and a pointer that lands on the pill's top
  // edge should hit the thing it looks like it is hitting.
  alignSelf: "stretch",
  minHeight: 32,
};

const shellStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--line)",
  background: "var(--panel-raised)",
  color: "var(--ink)",
  fontSize: 13,
  lineHeight: 1.2,
  whiteSpace: "nowrap",
};

export default function FavoritePintPicker({
  value,
  onChange,
  drinkBrand,
  onDrinkBrandChange,
}: FavoritePintPickerProps) {
  return (
    <div
      className="favoritePintPicker"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
    >
      <label className="favoritePintControl" style={shellStyle}>
        <Beer size={15} style={{ color: "var(--brass)", flexShrink: 0 }} aria-hidden />
        <span className="srOnlyOrInline" style={{ color: "var(--ink-soft)" }}>
          My pint
        </span>
        <select
          aria-label="Favourite pint or beer brand"
          value={drinkBrand || value || CLEAR_VALUE}
          className="favoritePintSelect"
          onChange={(event) => {
            const next = event.target.value;
            if (!next) {
              onChange(null);
              onDrinkBrandChange("");
              return;
            }
            // Prefer the favorite-pint path for known BEERS ids; also set
            // drinkBrand so the crawl URL round-trips.
            onChange(next);
            onDrinkBrandChange(next);
          }}
          style={selectStyle}
        >
          <option value={CLEAR_VALUE}>Cheapest pint (any)</option>
          {BEERS.map((beer) => {
            const abv = formatAbv(beer.abv);
            return (
              <option key={beer.id} value={beer.id}>
                {abv ? `${beer.label} · ${abv}` : beer.label}
              </option>
            );
          })}
        </select>
      </label>
    </div>
  );
}
