"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import PriceBadge from "@/components/PriceBadge";
import Screen from "@/components/ui/screen";
import SoftDrinkSubtypeMiniMap from "@/components/drinks/SoftDrinkSubtypeMiniMap";
import { PricedLandingPublisher } from "@/components/drinks/PricedLandingRows";
import { trackEvent } from "@/lib/analytics";
import { formatObservedDate } from "@/lib/dataFreshness";
import {
  drinkSubtypePricedMapHref,
  SOFT_DRINKS_WATER_LAUNCH_SUBTYPE_IDS,
  type SubtypePricedVenueRow,
} from "@/lib/drinkSubtypeObservedPrice";
import { findSubtype, subtypesForCategory } from "@/lib/drinkSubtypes";
import type { DrinkSubtype } from "@/lib/drinkSubtypes";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import type { PricedLandingRow } from "@/lib/pricedLanding";
import { formatPrice } from "@/lib/venues";

import "./drinkSubtypePricedView.css";

export type DrinkSubtypePricedViewProps = {
  title: string;
  /** Subtype chips shown first; any other soft-drink subtype may be passed for extension. */
  launchSubtypeIds: readonly string[];
  activeSubtypeId: string;
  rows: readonly SubtypePricedVenueRow[];
  observedCounts: Record<string, number>;
};

function publisherRow(
  row: SubtypePricedVenueRow,
): PricedLandingRow | null {
  if (!row.observed) return null;
  return {
    rank: 0,
    venueId: row.venueId,
    venueName: row.venueName,
    borough: row.borough,
    pintName: row.observed.drinkLabel,
    priceGbp: row.observed.priceGbp,
    publisher: row.observed.publisher,
  };
}

function chipSubtypes(
  launchSubtypeIds: readonly string[],
): DrinkSubtype[] {
  const launch = launchSubtypeIds
    .map((id) => findSubtype(id))
    .filter((hit): hit is DrinkSubtype => hit !== null);
  const rest = subtypesForCategory("soft-drink").filter(
    (subtype) => !launchSubtypeIds.includes(subtype.id),
  );
  return [...launch, ...rest];
}

export default function DrinkSubtypePricedView({
  title,
  launchSubtypeIds,
  activeSubtypeId,
  rows,
  observedCounts,
}: DrinkSubtypePricedViewProps) {
  const router = useRouter();
  const openedRef = useRef(false);
  const chips = useMemo(() => chipSubtypes(launchSubtypeIds), [launchSubtypeIds]);
  const active = findSubtype(activeSubtypeId);

  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    trackEvent("soft_drinks_water_view_opened", { subtype: activeSubtypeId });
  }, [activeSubtypeId]);

  const pricedCount = observedCounts[activeSubtypeId] ?? 0;
  const mapHref = drinkSubtypePricedMapHref({ subtypeId: activeSubtypeId });

  return (
    <div className="softDrinksWater">
      <Screen
        as="section"
        className="softDrinksWater__screen"
        kicker="Soft drinks"
        title={title}
        titleId="soft-drinks-water-heading"
        lede={
          active
            ? `${pricedCount} ${pricedCount === 1 ? "pub" : "pubs"} with a listed ${active.longLabel.toLowerCase()} price in London.`
            : "Listed soft-drink prices in London."
        }
        primary={<Link prefetch={false} href={mapHref}>Open the map</Link>}
      >
        <div
          className="softDrinksWater__chips"
          role="tablist"
          aria-label="Drink"
        >
          {chips.map((subtype) => {
            const on = subtype.id === activeSubtypeId;
            return (
              <button
                key={subtype.id}
                type="button"
                role="tab"
                aria-selected={on}
                className={on ? "softDrinksWater__chip isOn" : "softDrinksWater__chip"}
                onClick={() => {
                  trackEvent("soft_drinks_water_view_opened", { subtype: subtype.id });
                  router.push(
                    `/soft-drinks-and-water?sub=${encodeURIComponent(subtype.id)}`,
                  );
                }}
              >
                {subtype.label}
              </button>
            );
          })}
        </div>

        <div className="softDrinksWater__layout">
          <ol className="softDrinksWater__list" aria-labelledby="soft-drinks-water-heading">
            {rows.map((row) => {
              const priced = row.observed;
              const landingRow = publisherRow(row);
              const logHref = drinkSubtypePricedMapHref({
                subtypeId: activeSubtypeId,
                venueId: row.venueId,
                log: true,
              });
              return (
                <li className="softDrinksWater__row" key={row.venueId}>
                  <div>
                    <Link className="softDrinksWater__venue" href={`/ledger/${encodeURIComponent(row.venueId)}`}>
                      {row.venueName}
                    </Link>
                    <span className="softDrinksWater__borough">{row.borough}</span>
                    {priced && landingRow ? (
                      <>
                        <span className="softDrinksWater__meta">
                          {priced.drinkLabel}
                          {priced.observedAt
                            ? ` · Collected ${formatObservedDate(new Date(priced.observedAt))}`
                            : null}
                        </span>
                        <PricedLandingPublisher
                          className="softDrinksWater__meta"
                          row={landingRow}
                        />
                      </>
                    ) : (
                      <p className="softDrinksWater__door">
                        No price yet,{" "}
                        <Link
                          href={logHref}
                          prefetch={false}
                          onClick={() =>
                            trackEvent("soft_drinks_water_price_submitted", {
                              subtype: activeSubtypeId,
                            })
                          }
                        >
                          add one
                        </Link>
                      </p>
                    )}
                  </div>
                  {priced ? (
                    <PriceBadge
                      variant="current"
                      className="softDrinksWater__price"
                      band={priceBand(priced.priceGbp, priceBandAreaForVenue(row.venueId))}
                    >
                      {formatPrice(priced.priceGbp)}
                    </PriceBadge>
                  ) : null}
                </li>
              );
            })}
          </ol>

          <SoftDrinkSubtypeMiniMap subtypeId={activeSubtypeId} rows={rows} />
        </div>
      </Screen>
    </div>
  );
}

export const DEFAULT_SOFT_DRINKS_WATER_LAUNCH_IDS = SOFT_DRINKS_WATER_LAUNCH_SUBTYPE_IDS;
