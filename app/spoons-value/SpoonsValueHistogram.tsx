import { formatUnits, type SpoonsValueTableRow } from "@/lib/spoonsValue";

/**
 * What a tenner buys, across every pub, before the table that ranks them.
 *
 * 805 rows of near-identical figures read as one long column of 14.8s; the
 * shape of the whole is the thing a reader cannot get from the rows (taste
 * plan, 18 Oct 2026). Half-unit bins, one neutral bar each with a 2px gap
 * between them and no track behind, the least, the median and the most
 * labelled under the axis, and the commonest bin named over its bar. The
 * figures come straight off the rows: nothing here is estimated.
 *
 * A picture of a distribution is not something a screen reader can scan, so
 * the figure carries its own summary as its accessible name and the table
 * below it holds every value.
 */

const BIN_UNITS = 0.5;

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

export default function SpoonsValueHistogram({
  rows,
}: {
  rows: readonly SpoonsValueTableRow[];
}) {
  const values = rows.map((row) => row.milliunits).filter((v) => Number.isFinite(v) && v > 0);
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const least = sorted[0] as number;
  const most = sorted[sorted.length - 1] as number;
  const middle = median(sorted);

  const binOf = (milliunits: number) => Math.floor(milliunits / 1000 / BIN_UNITS);
  const firstBin = binOf(least);
  const lastBin = binOf(most);
  const counts = Array.from({ length: lastBin - firstBin + 1 }, () => 0);
  for (const value of sorted) {
    const index = binOf(value) - firstBin;
    counts[index] = (counts[index] ?? 0) + 1;
  }
  const tallest = Math.max(...counts);
  const commonest = counts.indexOf(tallest);
  // Where a value sits along the axis, as a share of its width.
  const span = (lastBin + 1 - firstBin) * BIN_UNITS;
  const at = (milliunits: number) =>
    `${(((milliunits / 1000 - firstBin * BIN_UNITS) / span) * 100).toFixed(2)}%`;

  const binLabel = (index: number) => {
    const from = (firstBin + index) * BIN_UNITS;
    return `${from.toFixed(1)} to ${(from + BIN_UNITS).toFixed(1)} units`;
  };

  return (
    <figure
      className="spoonsHistogram"
      role="img"
      aria-label={`Units a tenner buys across ${values.length} pubs: the least is ${formatUnits(least)}, the median ${formatUnits(middle)}, the most ${formatUnits(most)}. The commonest is ${binLabel(commonest)}, at ${tallest} pubs.`}
    >
      <figcaption className="spoonsHistogramTitle">
        Units a tenner buys, across {values.length} pubs
      </figcaption>
      <div className="spoonsHistogramPlot" aria-hidden="true">
        <div className="spoonsHistogramBars">
          {counts.map((count, index) => (
            <span
              key={index}
              className={index === commonest ? "spoonsHistogramBar isCommonest" : "spoonsHistogramBar"}
              style={{ height: `${count === 0 ? 0 : Math.max(2, (count / tallest) * 100)}%` }}
              title={`${binLabel(index)}: ${count} ${count === 1 ? "pub" : "pubs"}`}
            >
              {index === commonest ? (
                <span className="spoonsHistogramPeak">{tallest} pubs</span>
              ) : null}
            </span>
          ))}
        </div>
        <div className="spoonsHistogramAxis">
          {[
            { key: "least", label: "Least", value: least },
            { key: "median", label: "Median", value: middle },
            { key: "most", label: "Most", value: most },
          ].map((mark) => (
            <span
              key={mark.key}
              className={`spoonsHistogramMark spoonsHistogramMark--${mark.key}`}
              style={{ left: at(mark.value) }}
            >
              <b>{formatUnits(mark.value)}</b>
              <span>{mark.label}</span>
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}
