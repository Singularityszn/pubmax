import {
  formatPublishedDay,
  nationalPintArc,
  type NationalPintBenchmark,
} from "@/lib/nationalPintBenchmarks";
import { priceMovementLine } from "@/lib/priceMovementLine";
import { formatPrice } from "@/lib/venues";

import styles from "./nationalPintBenchmarks.module.css";

// The national yardstick, on the Pint Index.
//
// Everything else on this page is a price we hold evidence for. Nothing in this
// block is. So the block says so in its own heading, prints WHAT each publisher
// counted right beside the figure, and carries the publisher and the day under
// every line. A reader who wants to check us can, in one tap, and a reader who
// does not still cannot mistake a national cask average for a London pub.
//
// The two-figure row reuses the venue sheet's then-and-now idiom exactly (see
// components/map/VenuePriceThen.tsx): the old price, the newer price, then one
// short movement line from the shared lib/priceMovementLine.ts, so the two
// surfaces cannot drift into two wordings. Same shape, same reason.

function BenchmarkFigures({ row }: { row: NationalPintBenchmark }) {
  const arc = nationalPintArc(row);
  if (!arc) {
    const [only] = row.figures;
    return (
      <p className={styles.nationalPintLine}>
        <span className={styles.nationalPintClause}>
          <strong className={styles.nationalPintNow}>{formatPrice(only.priceGbp)}</strong> in {only.period}.
        </span>
      </p>
    );
  }
  return (
    <>
      {/* Two sentences, each unbreakable, so a narrow column breaks BETWEEN
          them and never orphans a date on a line of its own. */}
      <p className={styles.nationalPintLine}>
        <span className={styles.nationalPintClause}>
          <strong className={styles.nationalPintThen}>{formatPrice(arc.then.priceGbp)}</strong> in{" "}
          {arc.then.period}.
        </span>{" "}
        <span className={styles.nationalPintClause}>
          <strong className={styles.nationalPintNow}>{formatPrice(arc.latest.priceGbp)}</strong> in{" "}
          {arc.latest.period}.
        </span>
      </p>
      <p className={styles.nationalPintMovement}>{priceMovementLine(arc.deltaGbp, arc.years)}</p>
    </>
  );
}

export default function NationalPintBenchmarks({
  rows,
  headingId,
}: {
  rows: readonly NationalPintBenchmark[];
  headingId: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className={styles.nationalPint}>
      <dl className={styles.nationalPintList} aria-labelledby={headingId}>
        {rows.map((row) => (
          <div className={styles.nationalPintRow} key={row.id}>
            <dt className={styles.nationalPintMeasure}>{row.measure}</dt>
            <dd className={styles.nationalPintValue}>
              <BenchmarkFigures row={row} />
              <p className={styles.nationalPintSource}>
                <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer">
                  {row.publisher}
                </a>
                , {formatPublishedDay(row.publishedOn)}. {row.method}.
              </p>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
