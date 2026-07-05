"use client";

import { Beer } from "lucide-react";

import { BEERS } from "@/lib/beers";

// A pure, controlled favourite-pint select. The parent (PubMap) owns the value
// and its localStorage persistence via lib/favoritePint — this component only
// renders the current choice and reports changes. Compact enough to sit inside a
// floating toolbar pill; styled with the app's brass/ink/paper tokens.
type FavoritePintPickerProps = {
  value: string | null;
  onChange: (beerId: string | null) => void;
};

// The clear option's value: the empty string maps back to null on change, since
// a native <select> can only carry string option values.
const CLEAR_VALUE = "";

export default function FavoritePintPicker({ value, onChange }: FavoritePintPickerProps) {
  return (
    <label
      style={{
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
      }}
    >
      <Beer size={15} style={{ color: "var(--brass)", flexShrink: 0 }} aria-hidden />
      <span className="srOnlyOrInline" style={{ color: "var(--ink-soft)" }}>
        My pint
      </span>
      <select
        aria-label="Favourite pint"
        value={value ?? CLEAR_VALUE}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === CLEAR_VALUE ? null : next);
        }}
        style={{
          border: "none",
          background: "transparent",
          color: "var(--ink)",
          font: "inherit",
          padding: 0,
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value={CLEAR_VALUE}>Cheapest pint (any)</option>
        {BEERS.map((beer) => (
          <option key={beer.id} value={beer.id}>
            {beer.label}
          </option>
        ))}
      </select>
    </label>
  );
}
