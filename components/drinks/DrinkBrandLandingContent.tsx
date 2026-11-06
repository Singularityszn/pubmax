import Link from "next/link";

import PricedLandingRows, {
  PricedLandingPublisher,
  formatPricedLandingCollectedDate,
} from "@/components/drinks/PricedLandingRows";
import Screen from "@/components/ui/screen";
import type { DrinkBrandLanding } from "@/lib/drinkBrandLanding";
import {
  pricedLandingCountLabel,
  pricedLandingLogCta,
  pricedLandingMapArrivalRow,
  pricedLandingMapHref,
  type MapSelectableVenueIds,
  type PricedLandingBrandAreaLink,
} from "@/lib/pricedLanding";
import { formatPrice } from "@/lib/venues";

export default function DrinkBrandLandingContent({
  landing,
  mapSelectableVenueIds,
  areaPages = [],
}: {
  landing: DrinkBrandLanding;
  mapSelectableVenueIds: MapSelectableVenueIds;
  areaPages?: readonly PricedLandingBrandAreaLink[];
}) {
  const firstRow = landing.rows[0];
  const lowestPrice = formatPrice(firstRow.priceGbp);
  // `log=1` arms the composer for the RESOLVED venue, so the pub it names must
  // be one the map can open: the cheapest row inside the eager slim shard,
  // which is not always rank 1. With none, the link carries the brand alone and
  // the map offers its own picker rather than dropping a pub we named.
  const contributionRow = pricedLandingMapArrivalRow(
    landing.rows,
    mapSelectableVenueIds,
  );
  const mapHref = pricedLandingMapHref({ brandSlug: landing.slug });
  const contribution = pricedLandingLogCta({
    brandSlug: landing.slug,
    brandLabel: landing.brandLabel,
    venueId: contributionRow?.venueId,
    surface: "hero",
  });

  // docs/design/LAUNCH_SCREENS.md: the drink is the kicker, the map is the one
  // primary action, and the quiet way onward stays this landing's own
  // contribution door, because a governed price page exists to be corrected by
  // the people drinking there. The immediate answer (the lowest listed figure
  // and who published it) is the lede, so it sits above the actions.
  return (
    <div className="drinkBrandDirectory">
      <Screen
        as="section"
        className="drinkBrandDirectory__screen"
        kicker={landing.brandLabel}
        title={`Cheapest ${landing.brandLabel} pints in London`}
        titleId="drink-brand-heading"
        lede={
          <span className="drinkBrandDirectory__from">
            <strong>From {lowestPrice}</strong>
            <PricedLandingPublisher
              className="drinkBrandDirectory__fromPublisher"
              row={firstRow}
              variant="hero"
            />
          </span>
        }
        primary={<Link prefetch={false} href={mapHref}>Open the map</Link>}
        secondary={<Link href={contribution.href}>{contribution.label}</Link>}
      >
        <p className="drinkBrandDirectory__summary">
          {landing.totalPricedVenues} pubs with listed {landing.brandLabel} pints.
          {landing.collectedAt
            ? ` Collected ${formatPricedLandingCollectedDate(landing.collectedAt)}.`
            : null}
        </p>

        <section
          className="drinkBrandDirectory__prices"
          aria-labelledby="drink-brand-price-heading"
        >
          <div className="drinkBrandDirectory__sectionHead">
            <h2 id="drink-brand-price-heading">The pubs</h2>
            <span className="drinkBrandDirectory__sectionCount">
              {pricedLandingCountLabel(landing.totalPricedVenues, landing.rows.length)}
            </span>
          </div>
          <PricedLandingRows rows={landing.rows} />
        </section>

        {areaPages.length > 0 ? (
          <nav
            className="drinkBrandDirectory__areas"
            aria-label={`${landing.brandLabel} in other areas`}
          >
            <h2>By area</h2>
            <ul>
              {areaPages.map((page) => (
                <li key={page.href}>
                  <Link href={page.href}>{page.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </Screen>
    </div>
  );
}
