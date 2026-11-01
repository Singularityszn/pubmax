import Link from "next/link";

import {
  HUNT_CITIES_TITLE,
  HUNT_CITY_EMPTY_ACTION,
  HUNT_CITY_EMPTY_LINE,
  HUNT_CITY_UNNAMED_ACTION,
  HUNT_CITY_UNNAMED_LINE,
  HUNT_DEAREST_TITLE,
  type CheapestHunt,
  type HuntPint,
} from "@/lib/cheapestHunt";

import { HuntPrice, HuntSource } from "./LandingHuntCard";

// Britain's cheapest pint, city by city, and London's dearest pint, below the
// fold on the front door (captain decisions 2 and 3, 1 Nov 2026).
//
// WHY THE LANDING AND NOT ANOTHER PAGE. /places lists only the cities whose
// prices are listed and then one waitlist line, by its own rule, because a
// "prices coming" row reads as a promise; this list must name the empty cities
// out loud. /pint-index is the London Index, whose method keeps the map's
// price list out of it, and whose dearest end is the dated snapshot's own. The
// landing already reads the priced index at prerender, and it is where the
// launch story is told.
//
// It is a list of PRICES, never of drinkers. Every city on the map gets a row:
// a priced city prints its cheapest listed pint with who listed it and the day
// that source was read, and a city with none says so and hands over its own
// price door. A city whose prices name no pint (the hunt's headline bar) is not
// a city with no prices, and its row says which of the two it is. There is no
// row for a pub outside every map city: the list, like the hero above it,
// names only the cities on the map (lib/cheapestHunt.ts says why).
//
// London's dearest pint is a press card: it sits here, beside the list, and
// never on the map or in a pin colour (lib/cheapestHunt.ts says which pub, and
// why the bundle stays out of it).
//
// A SERVER COMPONENT, rendered by app/page.tsx and handed to the client page as
// a slot, so none of this ships as JavaScript. No hook, no handler, no joke:
// every line here sits beside a price, a date or a source.

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
  const dearest = hunt.londonDearest;
  return (
    <section className="lpHunt" id="cheapest-pint-by-city" aria-labelledby="lp-hunt-cities-title">
      <h2 className="lpHuntCitiesTitle" id="lp-hunt-cities-title">
        {HUNT_CITIES_TITLE}
      </h2>
      <p className="lpHuntDek">
        The cheapest listed pint we hold in each city on our map, with who listed it and the day we
        read it.
      </p>
      <ul className="lpHuntCityList">
        {hunt.cities.map((row) => (
          <li key={row.cityId} className="lpHuntCityRow" data-city={row.cityId}>
            {row.pint ? (
              <PricedCity name={row.cityName} pint={row.pint} />
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

      {dearest ? (
        <article className="lpHuntDearest" id="londons-dearest-pint" aria-labelledby="lp-hunt-dearest-title">
          <h3 className="lpHuntDearestTitle" id="lp-hunt-dearest-title">
            {HUNT_DEAREST_TITLE}
          </h3>
          <p className="lpHuntFigure" data-testid="landing-hunt-dearest-figure">
            <HuntPrice pint={dearest} />
            <span className="lpHuntWhere">
              for the cheapest pint at{" "}
              <Link prefetch={false} href={dearest.mapHref}>
                {dearest.pubName}
              </Link>
              , {dearest.placeName}
            </span>
          </p>
          <HuntSource pint={dearest} className="lpHuntSource" />
        </article>
      ) : null}
    </section>
  );
}
