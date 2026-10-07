"use client";

import Link from "next/link";

import {
  boroughCoverageMapHref,
  boroughCoverageStatusCopy,
  boroughCoverageSummary,
  type BoroughCoverageInput,
} from "@/lib/boroughCoverageStatus";

import "./boroughCoverageStatus.css";

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
    <section className="boroughCoverage" aria-labelledby="boroughCoverageHeading">
      <h2 id="boroughCoverageHeading" className="boroughCoverageTitle">
        Borough coverage
      </h2>
      <p className="boroughCoverageDek">
        These lines count corroborated people-logged pints only. Grey pins
        still mean nobody else has backed up that price yet.
      </p>
      {summary.kind === "shared" ? (
        <>
          <p className="boroughCoverageCopy">{summary.line}</p>
          {/* No sentence per borough, so the link carries the name: a bare
              "Open on the map" five times over would say even less than the
              five identical sentences it replaces. */}
          <ul className="boroughCoverageList boroughCoverageList--shared">
            {rows.map((row) => (
              <li key={row.slug}>
                <Link prefetch={false}
                  className="boroughCoverageLink"
                  href={boroughCoverageMapHref(row.mapQuery)}
                >
                  {row.name}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ul className="boroughCoverageList">
          {rows.map((row) => (
            <li key={row.slug} className="boroughCoverageRow">
              <p className="boroughCoverageCopy">{boroughCoverageStatusCopy(row)}</p>
              <Link prefetch={false} className="boroughCoverageLink" href={boroughCoverageMapHref(row.mapQuery)}>
                Open on the map
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
