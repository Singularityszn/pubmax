"use client";

import { PlusCircle } from "lucide-react";

import { formatPrice, type Venue } from "@/lib/venues";
import { mapPlanDrinkPriceDescription, type MapPlanDrinkPresentation } from "@/lib/mapPlanDrinkPresentation";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import type { CategoryPriceIndexStatus } from "@/lib/mapExperienceLens";

// ponytail: cap the keyboard picker render; search narrows the rest.
const PICKER_LIMIT = 40;

type VenuePickerProps = {
  filteredVenues: Venue[];
  drinkPresentation?: MapPlanDrinkPresentation | null;
  drinkPrices?: ReadonlyMap<string, MapLensPrice> | null;
  drinkPriceStatus?: CategoryPriceIndexStatus;
  builtIds: string[];
  onSelectVenue: (id: string) => void;
  onToggleStop: (id: string) => void;
};

export default function VenuePicker({
  filteredVenues,
  drinkPresentation,
  drinkPrices,
  drinkPriceStatus,
  builtIds,
  onSelectVenue,
  onToggleStop,
}: VenuePickerProps) {
  return (
    <section className="venuePicker">
      <div className="inspectorTitle">
        <PlusCircle size={16} />
        <span>Add stops</span>
      </div>
      <p className="description muted">
        Every pub that fits your filters, in a list you can use from the keyboard. You
        don&rsquo;t need the map. Search or filter to narrow the list.
      </p>
      <ul className="venuePickerList">
        {filteredVenues.slice(0, PICKER_LIMIT).map((venue) => {
          const inCrawl = builtIds.includes(venue.id);
          return (
            <li key={venue.id}>
              <button
                type="button"
                aria-pressed={inCrawl}
                onClick={() => {
                  onSelectVenue(venue.id);
                  onToggleStop(venue.id);
                }}
              >
                <span>
                  <strong>{venue.name}</strong>
                  <small>
                    {drinkPresentation
                      ? mapPlanDrinkPriceDescription(drinkPresentation, venue.id, drinkPrices, drinkPriceStatus)
                      : formatPrice(venue.cheapestPrice)} ·{" "}
                    {venue.primaryBorough || venue.visibleBoroughs[0] || "London"}
                  </small>
                </span>
                <span className="pickAction">{inCrawl ? "Remove" : "Add"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {filteredVenues.length > PICKER_LIMIT ? (
        <small className="pickerNote">
          Showing {PICKER_LIMIT} of {filteredVenues.length}. Narrow the search to see more.
        </small>
      ) : null}
    </section>
  );
}
