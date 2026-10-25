"use client";

import type { Filters } from "@/lib/venues";
import { OPEN_NOW_FILTER_CAPTION } from "@/lib/openNow";
import "./venueFeatureFilters.css";

export default function VenueFeatureFilters({ filters, onChange, resultCount }: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  /** Loaded, filtered venues only. null means the map is still loading. */
  resultCount: number | null;
}) {
  const active = filters.requireBeerGarden || filters.requireOutdoorSeating || filters.openNow;
  return (
    <section className="venueFeatureFilters" aria-label="Pub features">
      <div className="venueFeatureFiltersHeading">
        <strong>Pub features</strong>
        {active ? <button type="button" onClick={() => onChange({ ...filters, requireBeerGarden: false, requireOutdoorSeating: false, openNow: false })}>Clear features</button> : null}
      </div>
      <div className="venueFeatureFiltersChoices">
        {([
          ["requireBeerGarden", "Beer garden"],
          ["requireOutdoorSeating", "Outdoor seating"],
          ["openNow", "Open now"],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={filters[key] === true} onClick={() => onChange({ ...filters, [key]: !filters[key] })}>{label}</button>
        ))}
      </div>
      <p>Beer gardens: listed pub records and OpenStreetMap. Outdoor seating: OpenStreetMap and Google Places.</p>
      <p>Only recorded gardens and outdoor seating match. Missing details stay unknown. Outdoor seating may be a pavement or terrace.</p>
      {filters.openNow ? <p>{OPEN_NOW_FILTER_CAPTION} Hours come from Wetherspoon&apos;s directory.</p> : null}
      {active ? <p role="status">{resultCount === null ? "Loading matching places…" : `${resultCount.toLocaleString("en-GB")} matching ${resultCount === 1 ? "place" : "places"} loaded on the map.`}</p> : null}
    </section>
  );
}
