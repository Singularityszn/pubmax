import Link from "next/link";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";

import PriceBadge from "@/components/PriceBadge";
import { formatObservedDate } from "@/lib/dataFreshness";
import {
  formatPricedLandingPintName,
  formatPricedLandingPublisherStatus,
  type PricedLandingRow,
} from "@/lib/pricedLanding";
import { formatPrice } from "@/lib/venues";

import styles from "./drinkBrandDirectory.module.css";

export function formatPricedLandingCollectedDate(iso: string): string {
  return formatObservedDate(new Date(iso));
}

export function PricedLandingPublisher({
  className,
  row,
  variant = "row",
}: {
  className: string;
  row: PricedLandingRow;
  variant?: "hero" | "row";
}) {
  const status = formatPricedLandingPublisherStatus(row.publisher);

  return (
    <span className={className}>
      {row.publisher ? (
        variant === "hero" ? (
          <a href={row.publisher.url} target="_blank" rel="noopener noreferrer">
            {status}
          </a>
        ) : (
          <>
            <span>Publisher: </span>
            <a href={row.publisher.url} target="_blank" rel="noopener noreferrer">
              {row.publisher.label}
            </a>
          </>
        )
      ) : (
        status
      )}
    </span>
  );
}

/**
 * The ONE ranked price list every governed landing page prints.
 *
 * `role="list"` is explicit because `list-style: none` drops list semantics in
 * Safari, and the rank is marked presentational: the ordered list already gives
 * a screen reader the position, and a name on a bare span is prohibited so an
 * `aria-label` there is dropped.
 *
 * EVERY row states its own publisher status beside its own figure
 * (docs/VOICE.md), rank 1 included: the hero's copy sits above the h1 and the
 * actions, so a reader scrolled to the list would otherwise meet the cheapest
 * price on the page with nothing saying where it came from.
 */
export default function PricedLandingRows({
  rows,
  rowAction,
}: {
  rows: readonly PricedLandingRow[];
  rowAction?: (row: PricedLandingRow) => { href: string; label: string };
}) {
  return (
    <ol className={styles.drinkBrandDirectoryList} role="list">
      {rows.map((row) => {
        const action = rowAction?.(row);
        return (
          <li className={styles.drinkBrandDirectoryRow} key={row.venueId}>
            <span className={styles.drinkBrandDirectoryRank} aria-hidden="true">
              {row.rank}
            </span>
            <div
              className={
                action
                  ? `${styles.drinkBrandDirectoryDetails} ${styles.drinkBrandDirectoryDetailsWithAction}`
                  : styles.drinkBrandDirectoryDetails
              }
            >
              <Link
                className={styles.drinkBrandDirectoryVenue}
                href={`/ledger/${encodeURIComponent(row.venueId)}`}
              >
                {row.venueName}
              </Link>
              <span className={styles.drinkBrandDirectoryBorough}>{row.borough}</span>
              <span className={styles.drinkBrandDirectoryPint}>
                {formatPricedLandingPintName(row.pintName)}
              </span>
              <PricedLandingPublisher
                className={styles.drinkBrandDirectoryPublisher}
                row={row}
              />
              {action ? (
                <Link
                  className={styles.drinkBrandDirectoryContribution}
                  href={action.href}
                >
                  {action.label}
                </Link>
              ) : null}
            </div>
            <PriceBadge
              variant="current"
              className={styles.drinkBrandDirectoryPrice}
              band={priceBand(row.priceGbp, priceBandAreaForVenue(row.venueId))}
            >
              {formatPrice(row.priceGbp)}
            </PriceBadge>
          </li>
        );
      })}
    </ol>
  );
}
