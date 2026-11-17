"use client";

import { ForkKnife, MapPin } from "lucide-react";

import DataCreditsLink from "@/components/legal/DataCreditsLink";
import { VenueOsmHours } from "@/components/map/VenueOsmDetails";
import type { LondonRestaurant } from "@/lib/londonRestaurants";
import { readOsmOpeningHours } from "@/lib/osmOpeningHours";
import { dayLabel } from "@/lib/osmPubFacts";

import "./londonRestaurantSheet.css";

export default function LondonRestaurantSheet({ restaurant }: { restaurant: LondonRestaurant }) {
  const osmRef = /^venue-osm-([nwr])(\d+)$/.exec(restaurant.id);
  const osmType = osmRef ? ({ n: "node", w: "way", r: "relation" }[osmRef[1]!] ?? "node") : null;
  const extractDay = restaurant.observedAt?.slice(0, 10);
  const dataCredit = extractDay ? `OSM data as of ${dayLabel(extractDay) ?? extractDay}` : null;
  const hours = restaurant.openingHours ? readOsmOpeningHours(restaurant.openingHours) : null;
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

      {restaurant.cuisine ? <p className="londonRestaurantCuisine">Cuisine: {restaurant.cuisine.split(";").map(value => {
        const label = value.trim().replaceAll("_", " ");
        return label.charAt(0).toUpperCase() + label.slice(1);
      }).join(" · ")}</p> : null}
      {restaurant.openingHours ? <div className="venuePlacesDetails"><VenueOsmHours view={{ hours, hoursRaw: hours ? null : restaurant.openingHours, hoursCredit: dataCredit ?? "OpenStreetMap" }} /></div> : null}
      {osmRef ? (
        <p className="londonRestaurantMapRow">
          <a className="londonRestaurantMapLink" href={`https://www.openstreetmap.org/${osmType}/${osmRef[2]}`} target="_blank" rel="noreferrer">View on OpenStreetMap</a>
        </p>
      ) : null}
      <p className="londonRestaurantSource">
        Place from{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
        , ODbL{dataCredit ? `, ${dataCredit}.` : "."} <DataCreditsLink />
      </p>
    </div>
  );
}
