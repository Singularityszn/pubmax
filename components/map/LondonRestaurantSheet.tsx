"use client";

import { ForkKnife, MapPin } from "lucide-react";

import DataCreditsLink from "@/components/legal/DataCreditsLink";
import type { LondonRestaurant } from "@/lib/londonRestaurants";

import "./londonRestaurantSheet.css";

export default function LondonRestaurantSheet({ restaurant }: { restaurant: LondonRestaurant }) {
  const osmRef = /^venue-osm-([nwr])(\d+)$/.exec(restaurant.id);
  const osmType = osmRef ? ({ n: "node", w: "way", r: "relation" }[osmRef[1]!] ?? "node") : null;
  return (
    <div className="londonRestaurant" data-london-restaurant={restaurant.id}>
      <div className="londonRestaurantHead">
        <span className="londonRestaurantTag">
          <ForkKnife size={14} aria-hidden="true" />
          Restaurant
        </span>
        <h2 className="londonRestaurantName">{restaurant.name}</h2>
        {restaurant.address ? (
          <p className="londonRestaurantAddress">
            <MapPin size={14} aria-hidden="true" />
            {restaurant.address}
          </p>
        ) : null}
      </div>

      {restaurant.cuisine ? <p className="londonRestaurantLead">Cuisine: {restaurant.cuisine.replaceAll("_", " ").replaceAll(";", ", ")}</p> : null}
      {restaurant.openingHours ? (
        <p className="londonRestaurantLead">Opening hours (OpenStreetMap): {restaurant.openingHours}</p>
      ) : null}
      {osmRef ? (
        <p className="londonRestaurantLead">
          <a className="londonRestaurantMapLink" href={`https://www.openstreetmap.org/${osmType}/${osmRef[2]}`} target="_blank" rel="noreferrer">View on OpenStreetMap</a>
        </p>
      ) : null}
      <p className="londonRestaurantSource">
        Place from{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
        , ODbL.
        {restaurant.observedAt ? ` Snapshot: ${restaurant.observedAt.slice(0, 10)}.` : ""} <DataCreditsLink />
      </p>
    </div>
  );
}
