"use client";

import { Coffee, ExternalLink, MapPin } from "lucide-react";

import {
  coffeePilotDrinkLabel,
  coffeePilotSourceLine,
  type CoffeePilotCafe,
} from "@/lib/coffeePilot";
import { formatGbp } from "@/lib/formatGbp";

import "./coffeePilotSheet.css";

// The sheet behind a Shoreditch coffee pilot cafe (lib/coffeePilot.ts). One row
// per drink the cafe's own page stated, each with its own figure, page and day,
// so a latte never answers for a flat white. A drink the page did not state has
// no row: the pilot logs what was listed and says nothing about the rest.

export default function CoffeePilotSheet({ cafe }: { cafe: CoffeePilotCafe }) {
  return (
    <div className="coffeePilot" data-coffee-pilot-cafe={cafe.id}>
      <div className="coffeePilotHead">
        <span className="coffeePilotTag">
          <Coffee size={12} aria-hidden="true" />
          Listed prices
        </span>
        <h2 className="coffeePilotName">{cafe.name}</h2>
        {cafe.address ? (
          <p className="coffeePilotAddress">
            <MapPin size={13} aria-hidden="true" />
            {cafe.address}
          </p>
        ) : null}
      </div>

      <p className="coffeePilotLead">
        What this cafe&rsquo;s own page listed, checked by hand.
      </p>

      <ul className="coffeePilotPrices">
        {cafe.prices.map((price) => (
          <li key={price.drink} className="coffeePilotPrice">
            <span className="coffeePilotDrink">{coffeePilotDrinkLabel(price.drink)}</span>
            <strong className="coffeePilotFigure">{formatGbp(price.priceGbp)}</strong>
            <a
              className="coffeePilotSourceLink"
              href={price.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {coffeePilotSourceLine(price)}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>

      {/* ODbL requires attribution wherever these cafes are displayed, and it
          is the honest provenance line: the cafe's place is OpenStreetMap's,
          its prices are its own page's. */}
      <p className="coffeePilotSource">
        Cafe location from{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
        , ODbL. Shoreditch coffee pilot: prices come from each cafe&rsquo;s own page,
        never from OpenStreetMap.
      </p>
    </div>
  );
}
