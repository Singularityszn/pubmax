"use client";

import Link from "next/link";

import PriceBadge from "@/components/PriceBadge";
import { trackEvent } from "@/lib/analytics";
import { formatPriceDay } from "@/lib/communityPrice";
import { drinkSubtypePricedMapHref } from "@/lib/drinkSubtypeObservedPrice";
import {
  FOOD_PLACE_PRICE_SUBTYPE_ID,
  type LuciaMcDonaldsRow,
  type LuciaMcDonaldsSection as Section,
} from "@/lib/londonFoodPlaces";
import { formatPrice } from "@/lib/venues";

// London McDonald's under the Lucia 🐐 lens (lib/londonFoodPlaces.ts). McDonald's
// publishes no per-restaurant prices online and the delivery apps may not be
// read, so every figure here is a community price somebody logged with the
// bill. An agreed figure wears a NEUTRAL badge: a pint band is a tercile of
// London's pint prices and says nothing about a soft drink at a counter. A
// one-voice report is printed in words, dated, and never ranked beside one.

function statusLine(section: Section): string | null {
  if (section.status === "degraded") return "We could not check the prices logged here just now.";
  if (section.status === "partial") return "Some logged prices may be missing from this list.";
  if (section.status === "unavailable") return "We could not load the London McDonald’s just now.";
  return null;
}

function standingLine(row: LuciaMcDonaldsRow): string | null {
  const { standing } = row;
  if (standing.kind === "agreed") {
    return `Coke Zero or Diet Coke · ${standing.corroborations} drinkers agree · latest ${formatPriceDay(standing.submittedAt)}`;
  }
  if (standing.kind === "logged-once") {
    return `One report: ${formatPrice(standing.priceGbp)}, ${formatPriceDay(standing.submittedAt)}. A second drinker can confirm it.`;
  }
  return null;
}

export default function LuciaMcDonaldsSection({ section }: { section: Section }) {
  const note = statusLine(section);
  const agreed = section.rows.filter((row) => row.standing.kind === "agreed").length;
  // Only a complete read may say what is ABSENT. A partial or failed read can
  // still show the figures it found, never "none yet" or "No price yet".
  const complete = section.status === "ready";
  return (
    <section
      className="softDrinksWater__mcdonalds"
      aria-labelledby="lucia-mcdonalds-heading"
      data-lucia-mcdonalds={section.status}
    >
      <h2 id="lucia-mcdonalds-heading" className="softDrinksWater__sectionTitle">
        McDonald&rsquo;s
      </h2>
      <p className="softDrinksWater__sectionLede">
        McDonald&rsquo;s publishes no prices for its restaurants, so these are what
        people paid, logged with the bill.{" "}
        {section.rows.length > 0
          ? complete
            ? `${section.rows.length} London McDonald’s on our map, ${agreed === 0 ? "none yet" : agreed} with a price two drinkers agree on.`
            : `${section.rows.length} London McDonald’s on our map.`
          : null}
      </p>
      {note ? <p className="softDrinksWater__sectionNote">{note}</p> : null}
      {section.rows.length > 0 ? (
        <ol className="softDrinksWater__list" aria-labelledby="lucia-mcdonalds-heading">
          {section.rows.map((row) => {
            const logHref = drinkSubtypePricedMapHref({
              subtypeId: FOOD_PLACE_PRICE_SUBTYPE_ID,
              venueId: row.venueId,
              log: true,
            });
            const line = standingLine(row);
            const logClick = () =>
              trackEvent("soft_drinks_water_price_submitted", {
                subtype: FOOD_PLACE_PRICE_SUBTYPE_ID,
              });
            return (
              <li className="softDrinksWater__row" key={row.venueId} data-standing={row.standing.kind}>
                <div>
                  <Link className="softDrinksWater__venue" href={logHref} prefetch={false}>
                    {row.name}
                  </Link>
                  <span className="softDrinksWater__borough">
                    {[row.address, row.borough].filter(Boolean).join(", ")}
                  </span>
                  {line ? <span className="softDrinksWater__meta">{line}</span> : null}
                  {row.standing.kind === "agreed" ? null : (
                    <p className="softDrinksWater__door">
                      {complete && row.standing.kind === "none" ? "No price yet, " : null}
                      <Link href={logHref} prefetch={false} onClick={logClick}>
                        {complete && row.standing.kind === "none" ? "add one" : "Add a price"}
                      </Link>
                    </p>
                  )}
                </div>
                {row.standing.kind === "agreed" ? (
                  <PriceBadge variant="neutral" className="softDrinksWater__price">
                    {formatPrice(row.standing.priceGbp)}
                  </PriceBadge>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
