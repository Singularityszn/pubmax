"use client";

import { Route, Search, X } from "lucide-react";

import FavoritePintPicker from "@/components/map/FavoritePintPicker";

// The only chrome on the clean, full-bleed map: search, favorite-pint picker,
// and a "Plan a crawl" toggle. Everything else (filters, route, venue detail)
// lives in drawers that slide in only when the user acts.
type MapToolbarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  favoritePint: string | null;
  onFavoritePintChange: (beerId: string | null) => void;
  planningOpen: boolean;
  onTogglePlanning: () => void;
};

export default function MapToolbar({
  query,
  onQueryChange,
  favoritePint,
  onFavoritePintChange,
  planningOpen,
  onTogglePlanning,
}: MapToolbarProps) {
  return (
    <div className="mapToolbar" role="search">
      <div className="mapToolbarSearch">
        <Search size={15} aria-hidden="true" />
        <input
          id="mapSearchInput"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search a pub, area or borough…"
          aria-label="Search pubs by name, area or borough"
        />
        {query ? (
          <button
            type="button"
            className="mapToolbarClear"
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
          >
            <X size={13} />
          </button>
        ) : null}
      </div>

      <FavoritePintPicker value={favoritePint} onChange={onFavoritePintChange} />

      <button
        type="button"
        className={planningOpen ? "planBtn active" : "planBtn"}
        onClick={onTogglePlanning}
        aria-pressed={planningOpen}
      >
        <Route size={15} aria-hidden="true" />
        {planningOpen ? "Close planner" : "Plan a crawl"}
      </button>
    </div>
  );
}
