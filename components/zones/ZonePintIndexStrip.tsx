// The playful-but-honest "Zone pint index" strip: median pint per fare zone,
// rendered as a compact gradient with a dry one-line "zone tax" summary. Pure
// presentational + no "use client", so it server-renders on /pint-index and
// re-renders client-side inside the map's zone picker with the same numbers.
//
// Honesty rules (see lib/zones.ts): every median is a real median of observed
// cheapest pints in that zone; a zone with fewer than MIN_PRICED_VENUES priced
// venues shows "not enough pints logged yet — fix that", never an invented
// figure. Zones are the nearest-station approximation, labelled as such.

import {
  MIN_PRICED_VENUES,
  formatZoneGbp,
  zoneOrderSurpriseLine,
  type ZonePintIndex,
} from "@/lib/zones";

import styles from "./zonePintIndex.module.css";
import { priceBand, priceBandClass } from "@/lib/priceBand";

type ZonePintIndexStripProps = {
  index: ZonePintIndex;
  /** Optional click handler — makes each zone cell a filter button (map). */
  onPickZone?: (zone: number) => void;
  /** Currently-selected zone, for the active cell state. */
  activeZone?: number | null;
  /** Compact variant for the map popover (smaller type). */
  compact?: boolean;
};

function taxLine(index: ZonePintIndex): string {
  const { cheapest, dearest, taxGbp } = index;
  if (!cheapest || !dearest || taxGbp === null) {
    return "Log a few more pints and the zone tax appears here.";
  }
  if (cheapest.zone === dearest.zone || taxGbp === 0) {
    return "Only one zone has enough pints logged so far. No tax to call yet.";
  }
  return `The Zone ${dearest.zone} tax over Zone ${cheapest.zone} is ${formatZoneGbp(taxGbp)}.`;
}

export default function ZonePintIndexStrip({
  index,
  onPickZone,
  activeZone = null,
  compact = false,
}: ZonePintIndexStripProps) {
  const hasAny = index.ranked.length > 0;
  const orderSurprise = zoneOrderSurpriseLine(index);
  const className = compact ? `${styles.zonePintIndex} ${styles.isCompact}` : styles.zonePintIndex;

  return (
    <div className={className}>
      <ol className={styles.zonePintIndexRow} aria-label="Median pint price by fare zone">
        {index.rows.map((row) => {
          const priced = row.enough && row.medianGbp !== null;
          const isActive = activeZone === row.zone;
          const label = `Zone ${row.zone}`;
          const value = priced
            ? formatZoneGbp(row.medianGbp)
            : `${row.pricedCount}/${MIN_PRICED_VENUES}`;
          const title = priced
            ? `${label}: median ${formatZoneGbp(row.medianGbp)} from ${row.pricedCount} priced pubs`
            : `${label}: only ${row.pricedCount} priced pubs. Not enough pints logged yet`;
          const cellClass = [
            styles.zonePintCell,
            priced ? styles.isPriced : styles.isThin,
            // A zone's median is a pint figure, so the cell wears its band.
            priced ? priceBandClass(priceBand(row.medianGbp, { city: "london" })) : "",
            isActive ? styles.isActive : "",
          ]
            .filter(Boolean)
            .join(" ");

          if (onPickZone) {
            return (
              <li key={row.zone}>
                <button
                  type="button"
                  className={cellClass}
                  aria-pressed={isActive}
                  title={title}
                  onClick={() => onPickZone(row.zone)}
                >
                  <span className={styles.zonePintCellZone}>{label}</span>
                  <span className={styles.zonePintCellValue}>{value}</span>
                  {!priced ? <span className={styles.zonePintCellHint}>log more</span> : null}
                </button>
              </li>
            );
          }

          return (
            <li key={row.zone} className={cellClass} title={title}>
              <span className={styles.zonePintCellZone}>{label}</span>
              <span className={styles.zonePintCellValue}>{value}</span>
              {!priced ? <span className={styles.zonePintCellHint}>log more</span> : null}
            </li>
          );
        })}
      </ol>

      <p className={styles.zonePintIndexTax}>
        {hasAny ? (
          taxLine(index)
        ) : (
          <>Not enough pints logged in any zone yet. Fix that.</>
        )}
      </p>

      {/* A figure that surprises a reader owes them the one fact that explains
          it. lib/zones.ts decides whether there is one, and stays silent when
          there is not. */}
      {orderSurprise ? (
        <p className={styles.zonePintIndexOrderNote}>{orderSurprise}</p>
      ) : null}

      <p className={styles.zonePintIndexMethod}>
        Each zone figure is the median of the cheapest recorded pint price for
        pubs assigned to that zone. Assignment uses each pub&rsquo;s nearest
        station&rsquo;s TfL fare zone. A figure appears after{" "}
        {MIN_PRICED_VENUES} priced pubs.
      </p>
    </div>
  );
}
