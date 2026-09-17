"use client";

import Link from "next/link";

import {
  boroughCoverageMapHref,
  boroughCoverageStatusCopy,
  boroughCoverageSummary,
  type BoroughCoverageInput,
} from "@/lib/boroughCoverageStatus";

import styles from "./boroughCoverageStatus.module.css";

/**
 * Status strip for seed-borough corroborated coverage. Status, not a game:
 * no streaks, no ranks, no stranger feed.
 */
export default function BoroughCoverageStatus({
  rows,
}: {
  rows: BoroughCoverageInput[];
}) {
  if (rows.length === 0) return null;

  // Said once when every borough is saying the same thing, and once each when
  // they differ. lib/boroughCoverageStatus.ts owns which, so the words and the
  // shape of the list cannot disagree.
  const summary = boroughCoverageSummary(rows);

  return (
    <section className={styles.boroughCoverage} aria-labelledby="boroughCoverageHeading">
      <h2 id="boroughCoverageHeading" className={styles.boroughCoverageTitle}>
        Borough coverage
      </h2>
      <p className={styles.boroughCoverageDek}>
        These lines count corroborated people-logged pints only. Grey pins
        still mean we do not yet have the second voice.
      </p>
      {summary.kind === "shared" ? (
        <>
          <p className={styles.boroughCoverageCopy}>{summary.line}</p>
          {/* No sentence per borough, so the link carries the name: a bare
              "Open on the map" five times over would say even less than the
              five identical sentences it replaces. */}
          <ul className={`${styles.boroughCoverageList} ${styles.boroughCoverageListShared}`}>
            {rows.map((row) => (
              <li key={row.slug}>
                <Link prefetch={false}
                  className={styles.boroughCoverageLink}
                  href={boroughCoverageMapHref(row.mapQuery)}
                >
                  {row.name}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ul className={styles.boroughCoverageList}>
          {rows.map((row) => (
            <li key={row.slug} className={styles.boroughCoverageRow}>
              <p className={styles.boroughCoverageCopy}>{boroughCoverageStatusCopy(row)}</p>
              <Link prefetch={false} className={styles.boroughCoverageLink} href={boroughCoverageMapHref(row.mapQuery)}>
                Open on the map
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
