// The playful-but-honest "Zone pint index": median pint per fare zone with a
// dry one-line "zone tax" summary. Pure presentational + no "use client", so it
// server-renders on /pint-index and re-renders client-side inside the map's
// zone picker with the same numbers.
//
// Two shapes for two jobs. On /pint-index it is a CHART (taste plan, 18 Oct
// 2026): Zone 1 to 6 down the page in their own order, each median a dot on
// ONE shared price axis, the figure at the row's end in its price band. The
// zones are ordinal and the medians are magnitudes, and six coloured boxes in
// a row said neither: the eye compared box colours, not distances. In the
// map's zone picker (`onPickZone`) it stays a row of buttons, because there
// each cell is a filter you tap.
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

import PriceBadge from "@/components/PriceBadge";
import { priceBand, priceBandClass } from "@/lib/priceBand";

import "./zonePintIndex.css";

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

// The shared price axis: whole pounds either side of the priced medians, at
// least a pound wide, with a tick at every pound (or every 50p when the span
// is a pound or two, so the axis is never two lonely labels).
function zoneAxis(index: ZonePintIndex): { lo: number; hi: number; ticks: number[] } | null {
  const medians = index.rows
    .filter((row) => row.enough && row.medianGbp !== null)
    .map((row) => row.medianGbp as number);
  if (medians.length === 0) return null;
  const lo = Math.floor(Math.min(...medians));
  let hi = Math.ceil(Math.max(...medians));
  if (hi - lo < 1) hi = lo + 1;
  const step = hi - lo <= 2 ? 0.5 : 1;
  const ticks: number[] = [];
  for (let tick = lo; tick <= hi + 1e-9; tick += step) ticks.push(Math.round(tick * 100) / 100);
  return { lo, hi, ticks };
}

function axisPct(value: number, lo: number, hi: number): string {
  return `${(((value - lo) / (hi - lo)) * 100).toFixed(2)}%`;
}

function ZoneDotPlot({ index }: { index: ZonePintIndex }) {
  const axis = zoneAxis(index);
  return (
    <div className="zoneDotPlot">
      <ol className="zoneDotRows" aria-label="Median pint price by fare zone">
        {index.rows.map((row) => {
          const priced = row.enough && row.medianGbp !== null && axis !== null;
          const label = `Zone ${row.zone}`;
          return (
            <li
              key={row.zone}
              className={priced ? "zoneDotRow" : "zoneDotRow isThin"}
              title={
                priced
                  ? `${label}: median ${formatZoneGbp(row.medianGbp)} from ${row.pricedCount} priced pubs`
                  : `${label}: only ${row.pricedCount} priced pubs. Not enough pints logged yet`
              }
            >
              <span className="zoneDotLabel">{label}</span>
              <span className="zoneDotTrack" aria-hidden="true">
                {priced ? (
                  <span
                    className="zoneDotMark"
                    style={{ left: axisPct(row.medianGbp as number, axis.lo, axis.hi) }}
                  />
                ) : null}
              </span>
              <span className="zoneDotValue">
                {priced ? (
                  <PriceBadge band={priceBand(row.medianGbp, { city: "london" })}>
                    {formatZoneGbp(row.medianGbp)}
                  </PriceBadge>
                ) : (
                  <span className="zoneDotThin">
                    {row.pricedCount} of {MIN_PRICED_VENUES} pubs
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {axis ? (
        <div className="zoneDotAxis" aria-hidden="true">
          <span className="zoneDotAxisTrack">
            {axis.ticks.map((tick) => (
              <span key={tick} className="zoneDotTick" style={{ left: axisPct(tick, axis.lo, axis.hi) }}>
                {formatZoneGbp(tick)}
              </span>
            ))}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default function ZonePintIndexStrip({
  index,
  onPickZone,
  activeZone = null,
  compact = false,
}: ZonePintIndexStripProps) {
  const hasAny = index.ranked.length > 0;
  const orderSurprise = zoneOrderSurpriseLine(index);
  const className = compact ? "zonePintIndex isCompact" : "zonePintIndex";

  return (
    <div className={className}>
      {onPickZone ? (
        <ol className="zonePintIndexRow" aria-label="Median pint price by fare zone">
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
              "zonePintCell",
              priced ? "isPriced" : "isThin",
              // A zone's median is a pint figure, so the cell wears its band.
              priced ? priceBandClass(priceBand(row.medianGbp, { city: "london" })) : "",
              isActive ? "isActive" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <li key={row.zone}>
                <button
                  type="button"
                  className={cellClass}
                  aria-pressed={isActive}
                  title={title}
                  onClick={() => onPickZone(row.zone)}
                >
                  <span className="zonePintCellZone">{label}</span>
                  <span className="zonePintCellValue">{value}</span>
                  {!priced ? <span className="zonePintCellHint">log more</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <ZoneDotPlot index={index} />
      )}

      <p className="zonePintIndexTax">
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
        <p className="zonePintIndexOrderNote">{orderSurprise}</p>
      ) : null}

      <p className="zonePintIndexMethod">
        Each zone figure is the median of the cheapest recorded pint price for
        pubs assigned to that zone. Assignment uses each pub&rsquo;s nearest
        station&rsquo;s TfL fare zone. A figure appears after{" "}
        {MIN_PRICED_VENUES} priced pubs.
      </p>
    </div>
  );
}
