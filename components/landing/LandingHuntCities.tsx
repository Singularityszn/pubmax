import Link from "next/link";

import {
  HUNT_CITIES_TITLE,
  HUNT_CITY_EMPTY_ACTION,
  HUNT_CITY_EMPTY_LINE,
  HUNT_CITY_OLD_ACTION,
  HUNT_CITY_OLD_LINE,
  HUNT_CITY_UNNAMED_ACTION,
  HUNT_CITY_UNNAMED_LINE,
  type CheapestHunt,
  type HuntPint,
} from "@/lib/cheapestHunt";

import { HuntPrice, HuntSource } from "./LandingHuntCard";

function PricedCity({ name, pint }: { name: string; pint: HuntPint }) {
  return (
    <>
      <span className="lpHuntCityName">{name}</span>
      <span className="lpHuntCityPrice">
        <HuntPrice pint={pint} />
      </span>
      <span className="lpHuntCityPub">
        <Link prefetch={false} href={pint.mapHref}>
          {pint.pubName}
        </Link>
      </span>
      <HuntSource pint={pint} className="lpHuntCitySource" />
    </>
  );
}

export default function LandingHuntCities({ hunt }: { hunt: CheapestHunt | null }) {
  // A read we could not finish ships no rows, so no city is called empty on
  // the strength of a failed read (lib/cheapestHunt.server.ts).
  if (!hunt || hunt.cities.length === 0) return null;
  return (
    <section className="lpHunt" id="cheapest-pint-by-city" aria-labelledby="lp-hunt-cities-title">
      <h2 className="lpHuntCitiesTitle" id="lp-hunt-cities-title">
        {HUNT_CITIES_TITLE}
      </h2>
      <p className="lpHuntDek">
        Prices from our records for each city on the map. Current prices may differ.
      </p>
      <ul className="lpHuntCityList">
        {hunt.cities.map((row) => (
          <li key={row.cityId} className="lpHuntCityRow" data-city={row.cityId}>
            {row.pint ? (
              <PricedCity name={row.cityName} pint={row.pint} />
            ) : row.oldPrice ? (
              <>
                <span className="lpHuntCityName">{row.cityName}</span>
                <span className="lpHuntCityEmpty" data-price-age="old">
                  {HUNT_CITY_OLD_LINE}{" "}
                  <Link prefetch={false} href={row.oldPrice.mapHref}>
                    {row.oldPrice.pubName}
                  </Link>
                  : {row.oldPrice.line}. Listed by {row.oldPrice.publisher}.{" "}
                  <Link prefetch={false} href={row.logHref}>
                    {HUNT_CITY_OLD_ACTION}
                  </Link>
                </span>
              </>
            ) : (
              <>
                <span className="lpHuntCityName">{row.cityName}</span>
                <span className="lpHuntCityEmpty">
                  {row.unnamedPricesHeld ? HUNT_CITY_UNNAMED_LINE : HUNT_CITY_EMPTY_LINE}{" "}
                  <Link prefetch={false} href={row.logHref}>
                    {row.unnamedPricesHeld ? HUNT_CITY_UNNAMED_ACTION : HUNT_CITY_EMPTY_ACTION}
                  </Link>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>

    </section>
  );
}
