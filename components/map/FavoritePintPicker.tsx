"use client";

import type { CSSProperties } from "react";
import { Beer, GlassWater } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import { BEERS } from "@/lib/beers";
import {
  CATEGORY_META,
  type DrinkCategory,
  formatAbv,
} from "@/lib/drinks";
import {
  isMapLensDrinkCategory,
  MAP_LENS_DRINK_CATEGORIES,
} from "@/lib/mapExperienceLens";

// Drink lens: category prices for non-beer drinks; exact brand prices only on
// the existing favorite-pint path. Community category rows do not name a brand,
// so offering a whisky-brand choice here would overstate what its pin proves.
// The offered set is the map's own lens list, so this picker cannot select a
// category the map has no honest figure or label for.

type FavoritePintPickerProps = {
  value: string | null;
  onChange: (beerId: string | null) => void;
  drinkCategory: string;
  drinkBrand: string;
  onDrinkLensChange: (next: { drinkCategory: string; drinkBrand: string }) => void;
};

const CLEAR_VALUE = "";
const LENS_CATEGORIES: readonly DrinkCategory[] = MAP_LENS_DRINK_CATEGORIES;

const selectStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--ink)",
  font: "inherit",
  padding: 0,
  cursor: "pointer",
  outline: "none",
  maxWidth: 140,
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
  drinkCategory,
  drinkBrand,
  onDrinkLensChange,
}: FavoritePintPickerProps) {
  // A category the map cannot lens (today: `other`, still submittable) reads as
  // the pint default here rather than showing a choice this control cannot make.
  const category: DrinkCategory | "" =
    isMapLensDrinkCategory(drinkCategory) && drinkCategory !== "beer"
      ? drinkCategory
      : "";
  const useBeerPintPath = category === "";
  const categorySelectValue = category || "beer";

  return (
    <div
      className="favoritePintPicker"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
    >
      <label className="favoritePintControl" style={shellStyle}>
        <GlassWater size={15} style={{ color: "var(--brass)", flexShrink: 0 }} aria-hidden />
        <span className="srOnlyOrInline" style={{ color: "var(--ink-soft)" }}>
          Drink
        </span>
        <select
          aria-label="Drink category"
          value={categorySelectValue}
          className="favoritePintSelect"
          onChange={(event) => {
            const next = event.target.value;
            if (!isMapLensDrinkCategory(next)) return;
            // Pint is the map default (empty lens). Leaving a non-pint lens for
            // pint clears; picking a non-pint family selects. Category enum
            // only - never a brand id or free text.
            if (next === "beer") {
              if (category) trackEvent("drink_lens_cleared", { category });
            } else if (next !== category) {
              trackEvent("drink_lens_selected", { category: next });
            }
            onDrinkLensChange({
              drinkCategory: next === "beer" ? "" : next,
              drinkBrand: "",
            });
            // Leaving beer clears the favorite-pint re-price path.
            if (next !== "beer") onChange(null);
          }}
          style={selectStyle}
        >
          {LENS_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat === "beer" ? "Pint" : CATEGORY_META[cat].label}
            </option>
          ))}
        </select>
      </label>

      {useBeerPintPath ? (
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
                  onDrinkLensChange({ drinkCategory: category || "beer", drinkBrand: "" });
                  return;
                }
                // Prefer the favorite-pint path for known BEERS ids; also set
                // drinkBrand so the crawl URL round-trips.
                onChange(next);
                onDrinkLensChange({ drinkCategory: "beer", drinkBrand: next });
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
        ) : (
          <span
            style={{
              ...shellStyle,
              color: "var(--ink-soft)",
              fontSize: 12,
              maxWidth: 180,
              whiteSpace: "normal",
            }}
            role="status"
          >
            {CATEGORY_META[category].label} prices cover any{" "}
            {CATEGORY_META[category].label.toLowerCase()}
          </span>
        )}
    </div>
  );
}
