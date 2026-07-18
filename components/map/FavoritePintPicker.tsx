"use client";

import type { CSSProperties } from "react";
import { Beer, GlassWater } from "lucide-react";

import { BEERS } from "@/lib/beers";
import {
  brandsForCategory,
  categoryHasBrandCoverage,
} from "@/lib/drinkBrands";
import {
  CATEGORY_META,
  DRINK_CATEGORIES,
  type DrinkCategory,
  abvForBrand,
  formatAbv,
  isDrinkCategory,
} from "@/lib/drinks";

// Drink lens: category → optional brand. Beer keeps the favorite-pint path
// (re-prices pins via BEERS) while also setting drinkCategory/drinkBrand for
// URL sync. Other categories filter via Filters.drinkCategory / drinkBrand.

type FavoritePintPickerProps = {
  value: string | null;
  onChange: (beerId: string | null) => void;
  drinkCategory: string;
  drinkBrand: string;
  onDrinkLensChange: (next: { drinkCategory: string; drinkBrand: string }) => void;
};

const CLEAR_VALUE = "";
const CLEAR_CATEGORY = "";

const LENS_CATEGORIES: DrinkCategory[] = DRINK_CATEGORIES.filter(
  (category) => category !== "other",
);

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
  const category: DrinkCategory | "" =
    drinkCategory && isDrinkCategory(drinkCategory) ? drinkCategory : "";
  const brands = category ? brandsForCategory(category) : [];
  // Shot (and other thin-coverage categories) share the brand / thin-coverage
  // path — do not special-case shot out of the picker.
  const showBrandSelect = category !== "";
  const useBeerPintPath = category === "beer" || category === "";

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
          value={category}
          className="favoritePintSelect"
          onChange={(event) => {
            const next = event.target.value;
            if (!next) {
              onDrinkLensChange({ drinkCategory: "", drinkBrand: "" });
              onChange(null);
              return;
            }
            if (!isDrinkCategory(next)) return;
            onDrinkLensChange({ drinkCategory: next, drinkBrand: "" });
            // Leaving beer clears the favorite-pint re-price path.
            if (next !== "beer") onChange(null);
          }}
          style={selectStyle}
        >
          <option value={CLEAR_CATEGORY}>Any drink</option>
          {LENS_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORY_META[cat].label}
            </option>
          ))}
        </select>
      </label>

      {showBrandSelect ? (
        useBeerPintPath ? (
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
        ) : categoryHasBrandCoverage(category) ? (
          <label className="favoritePintControl" style={shellStyle}>
            <span className="srOnlyOrInline" style={{ color: "var(--ink-soft)" }}>
              Brand
            </span>
            <select
              aria-label={`${CATEGORY_META[category].label} brand`}
              value={drinkBrand || CLEAR_VALUE}
              className="favoritePintSelect"
              onChange={(event) => {
                const next = event.target.value;
                onDrinkLensChange({
                  drinkCategory: category,
                  drinkBrand: next,
                });
              }}
              style={selectStyle}
            >
              <option value={CLEAR_VALUE}>Any {CATEGORY_META[category].label.toLowerCase()}</option>
              {brands.map((brand) => {
                const abv = formatAbv(abvForBrand(brand));
                return (
                  <option key={brand.id} value={brand.id}>
                    {abv ? `${brand.label} · ${abv}` : brand.label}
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
            Thin coverage. Category filter only
          </span>
        )
      ) : null}
    </div>
  );
}
