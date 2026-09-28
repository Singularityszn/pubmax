"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import PriceBadge from "@/components/PriceBadge";
import Screen from "@/components/ui/screen";
import EmptyState from "@/components/ui/empty-state";
import SoftDrinkSubtypeMiniMap from "@/components/drinks/SoftDrinkSubtypeMiniMap";
import { PricedLandingPublisher } from "@/components/drinks/PricedLandingRows";
import { trackEvent } from "@/lib/analytics";
import { formatObservedDate } from "@/lib/dataFreshness";
import {
  drinkSubtypePricedMapHref,
  SOFT_DRINKS_WATER_LAUNCH_SUBTYPE_IDS,
  softDrinksWaterChipSelected,
  softDrinksWaterChipSubtypes,
  type SubtypePricedVenueRow,
} from "@/lib/drinkSubtypeObservedPrice";
import { findSubtype } from "@/lib/drinkSubtypes";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import type { PricedLandingRow } from "@/lib/pricedLanding";
import { formatPrice } from "@/lib/venues";

import "./drinkSubtypePricedView.css";

export type DrinkSubtypePricedViewProps = {
  title: string;
  /** Launch chip ids (zero-sugar cola family and still water by default); leaf cola brands stay off the chip row. */
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

export default function DrinkSubtypePricedView({
  title,
  launchSubtypeIds,
  activeSubtypeId,
  rows,
  observedCounts,
}: DrinkSubtypePricedViewProps) {
  const router = useRouter();
  const openedRef = useRef(false);
  const chips = useMemo(
    () => softDrinksWaterChipSubtypes(launchSubtypeIds),
    [launchSubtypeIds],
  );
  const active = findSubtype(activeSubtypeId);

  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    trackEvent("soft_drinks_water_view_opened", { subtype: activeSubtypeId });
  }, [activeSubtypeId]);

  const pricedCount = observedCounts[activeSubtypeId] ?? 0;
  const mapHref = drinkSubtypePricedMapHref({ subtypeId: activeSubtypeId });
  const logHref = drinkSubtypePricedMapHref({
    subtypeId: activeSubtypeId,
    log: true,
  });
  const activeLabel = active?.longLabel.toLowerCase() ?? "soft drink";

  return (
    <div className="softDrinksWater">
      <Screen
        as="section"
        className="softDrinksWater__screen"
        kicker="Soft drinks"
        title={title}
        titleId="soft-drinks-water-heading"
        lede={
          pricedCount === 0
            ? `No listed ${activeLabel} prices in London yet.`
            : active
              ? `${pricedCount} pubs with a listed ${activeLabel} price in London.`
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
            const on = softDrinksWaterChipSelected(subtype.id, activeSubtypeId);
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
          {pricedCount === 0 ? (
            <EmptyState
              title="Nobody has logged one here yet."
              action={
                <Link
                  prefetch={false}
                  href={logHref}
                  onClick={() =>
                    trackEvent("soft_drinks_water_price_submitted", {
                      subtype: activeSubtypeId,
                    })
                  }
                >
                  Add a price
                </Link>
              }
            >
              Be the first on the map for {activeLabel}.
            </EmptyState>
          ) : (
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
          )}

          <SoftDrinkSubtypeMiniMap subtypeId={activeSubtypeId} rows={rows} />
        </div>
      </Screen>
    </div>
  );
}

export const DEFAULT_SOFT_DRINKS_WATER_LAUNCH_IDS = SOFT_DRINKS_WATER_LAUNCH_SUBTYPE_IDS;
