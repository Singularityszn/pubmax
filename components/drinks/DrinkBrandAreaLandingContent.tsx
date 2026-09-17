import Link from "next/link";

import LandingPhoto from "@/components/landing/LandingPhoto";
import PricedLandingRows, {
  PricedLandingPublisher,
  formatPricedLandingCollectedDate,
} from "@/components/drinks/PricedLandingRows";
import type { DrinkBrandAreaLanding } from "@/lib/drinkBrandAreaLanding";
import { landingPhotoFor } from "@/lib/landingImagery";
import {
  pricedLandingAreaMapCta,
  pricedLandingCountLabel,
  pricedLandingLogCta,
  pricedLandingMapArrivalRow,
  type MapSelectableVenueIds,
  type PricedLandingRow,
} from "@/lib/pricedLanding";
import { formatPrice } from "@/lib/venues";

import styles from "./drinkBrandDirectory.module.css";

// The map opens on a PUB, never on `?q=<area name>`: `q` is a free-text venue
// filter (lib/venues.ts matchesVenueQuery), so an area name matches whatever
// pubs happen to carry it and "Piccadilly & Soho" matches none. A pub is named
// only while the map can resolve it, through the same seam the London brand
// page uses. No `?drink=beer`: decodeDrinkLens already fills the category from
// the brand, and PubMap excludes beer from the selected lens.
//
// The head stands over a photograph of the area (captain 6 Sep 2026), or of
// London where lib/landingImagery.ts holds no picture of it. It sits UNDER the
// heading and the figure rather than over them: this page's answer is a price,
// and a picture in front of it would be a picture in front of the answer.
export default function DrinkBrandAreaLandingContent({
  landing,
  mapSelectableVenueIds,
}: {
  landing: DrinkBrandAreaLanding;
  mapSelectableVenueIds: MapSelectableVenueIds;
}) {
  const firstRow = landing.rows[0];
  // The heading names the CHEAPEST pint here, so the arrival is that row or no
  // row at all: a different pub would make the label untrue, and a `sel` the
  // map cannot open would make it unreachable.
  const selectableVenueId = (row: PricedLandingRow): string | undefined =>
    pricedLandingMapArrivalRow([row], mapSelectableVenueIds)?.venueId;
  const arrival = pricedLandingAreaMapCta({
    brandSlug: landing.brandSlug,
    brandLabel: landing.brandLabel,
    areaName: landing.areaName,
    row: firstRow,
    selectable: mapSelectableVenueIds,
  });

  return (
    <div className={styles.drinkBrandDirectory}>
      <header className={styles.drinkBrandDirectoryHead}>
        <p className={styles.drinkBrandDirectoryEyebrow}>
          <Link prefetch={false} href="/map">London map</Link> <span aria-hidden="true">·</span>{" "}
          <Link href={`/drink/${encodeURIComponent(landing.brandSlug)}`}>
            {landing.brandLabel}
          </Link>{" "}
          <span aria-hidden="true">·</span> {landing.areaName}
        </p>
        <h1>
          Cheapest {landing.brandLabel} pints in {landing.areaName}
        </h1>
        <p className={styles.drinkBrandDirectoryFrom}>
          <strong>From {formatPrice(firstRow.priceGbp)}</strong>
          <PricedLandingPublisher
            className={styles.drinkBrandDirectoryFromPublisher}
            row={firstRow}
            variant="hero"
          />
        </p>
        <p className={styles.drinkBrandDirectorySummary}>
          {landing.totalPricedVenues} pubs with listed {landing.brandLabel} pints. Collected{" "}
          {formatPricedLandingCollectedDate(landing.collectedAt)}.
        </p>
        <div className={styles.drinkBrandDirectoryActions}>
          <Link className={styles.drinkBrandDirectoryPrimary} href={arrival.href}>
            {arrival.label}
          </Link>
        </div>
        <LandingPhoto
          resolved={landingPhotoFor({ areaSlug: landing.areaSlug })}
          variant="band"
          sizes="(max-width: 1100px) 100vw, 1040px"
          priority
          className={styles.drinkBrandDirectoryPhoto}
        />
      </header>

      <section
        className={styles.drinkBrandDirectoryPrices}
        aria-labelledby="drink-brand-area-price-heading"
      >
        <div className={styles.drinkBrandDirectorySectionHead}>
          <h2 id="drink-brand-area-price-heading">The pubs</h2>
          <span className={styles.drinkBrandDirectorySectionCount}>
            {pricedLandingCountLabel(landing.totalPricedVenues, landing.rows.length)}
          </span>
        </div>
        <PricedLandingRows
          rows={landing.rows}
          rowAction={(row) =>
            pricedLandingLogCta({
              brandSlug: landing.brandSlug,
              brandLabel: landing.brandLabel,
              venueId: selectableVenueId(row),
            })
          }
        />
      </section>
    </div>
  );
}
