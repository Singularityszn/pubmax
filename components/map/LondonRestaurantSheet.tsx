"use client";

import { ForkKnife, MapPin } from "lucide-react";

import type { LondonVenue } from "@/lib/londonVenueShards";

import "./londonRestaurantSheet.css";

// The sheet behind a London restaurant pin (lib/londonRestaurants.ts). The map
// knows four things about it: its name, address, position and that it serves
// alcohol. It holds no price, no menu and no hours, so the sheet says what it
// knows, says where that came from and invents nothing else.

export default function LondonRestaurantSheet({ restaurant }: { restaurant: LondonVenue }) {
  return (
    <div className="londonRestaurant" data-london-restaurant={restaurant.id}>
      <div className="londonRestaurantHead">
        <span className="londonRestaurantTag">
          <ForkKnife size={12} aria-hidden="true" />
          Restaurant
        </span>
        <h2 className="londonRestaurantName">{restaurant.name}</h2>
        {restaurant.address ? (
          <p className="londonRestaurantAddress">
            <MapPin size={13} aria-hidden="true" />
            {restaurant.address}
          </p>
        ) : null}
      </div>

      <p className="londonRestaurantLead">
        A restaurant that serves alcohol. We have no prices for it.
      </p>

      {/* ODbL requires attribution wherever these places are shown, and it is
          the honest provenance line for the one claim the sheet makes. */}
      <p className="londonRestaurantSource">
        Place from{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
        , ODbL. It is on the map because OpenStreetMap or the restaurant&rsquo;s own
        website says it serves alcohol.
      </p>
    </div>
  );
}
