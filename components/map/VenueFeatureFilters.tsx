"use client";

import type { Filters } from "@/lib/venues";
import { LAST_ORDERS_FILTER_CAPTION } from "@/lib/lastOrdersList";
import { OPEN_NOW_FILTER_CAPTION } from "@/lib/openNow";
import "./venueFeatureFilters.css";

const FEATURE_CHOICES = [
  ["requireBeerGarden", "Beer garden"],
  ["requireOutdoorSeating", "Outdoor seating"],
  ["requireLiveSports", "Live sport"],
  ["requireDogFriendly", "Dogs welcome"],
  ["requireDarts", "Darts"],
  ["requirePool", "Pool"],
  ["openNow", "Open now"],
  ["lastOrders", "Last orders"],
] as const;

export function activeVenueFeatureCount(filters: Filters): number {
  return FEATURE_CHOICES.filter(([key]) => filters[key] === true).length;
}

export default function VenueFeatureFilters({ filters, onChange, resultCount }: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  /** Loaded, filtered venues only. null means the map is still loading. */
  resultCount: number | null;
}) {
  const active = activeVenueFeatureCount(filters) > 0;
  return (
    <section className="venueFeatureFilters" aria-label="Pub features">
      <div className="venueFeatureFiltersHeading">
        <strong>Pub features</strong>
        {active ? <button type="button" onClick={() => onChange({ ...filters, requireBeerGarden: false, requireOutdoorSeating: false, requireLiveSports: false, requireDogFriendly: false, requireDarts: false, requirePool: false, openNow: false, lastOrders: false })}>Clear features</button> : null}
      </div>
      <div className="venueFeatureFiltersChoices">
        {FEATURE_CHOICES.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={filters[key] === true} onClick={() => onChange({ ...filters, [key]: !filters[key] })}>{label}</button>
        ))}
      </div>
      <p>Beer gardens: listed pub records and OpenStreetMap. Outdoor seating: OpenStreetMap and Google Places.</p>
      <p>Live sport: OpenStreetMap. Dogs: pub websites and OpenStreetMap. Darts and pool: listed pub records.</p>
      <p>Views and fireplaces: no sourced filter coverage yet. Dogs outside only do not match Dogs welcome. Lead restrictions may apply.</p>
      <p>Only recorded gardens and outdoor seating match. Missing details stay unknown. Outdoor seating may be a pavement or terrace.</p>
      {filters.openNow ? <p>{OPEN_NOW_FILTER_CAPTION} Hours come from Wetherspoon&apos;s directory.</p> : null}
      {filters.lastOrders ? <p>{LAST_ORDERS_FILTER_CAPTION}</p> : null}
      {active ? <p role="status">{resultCount === null ? "Loading matching places…" : `${resultCount.toLocaleString("en-GB")} matching ${resultCount === 1 ? "place" : "places"} loaded on the map.`}</p> : null}
    </section>
  );
}
