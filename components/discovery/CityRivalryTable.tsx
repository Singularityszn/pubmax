"use client";

import Link from "next/link";

import styles from "@/app/discover/Discover.module.css";
import type { CityRivalryEntry } from "@/lib/cityRivalry";
import { writePreferredCity } from "@/lib/cityPreference";
import { cityMapShareUrl } from "@/lib/cityShare";

type CityRivalryTableProps = {
  entries: CityRivalryEntry[];
  caption?: string;
};

/**
 * Compact UK city energy table for Discover — community drops + curated crawls
 * + venue coverage, not a fake price catalogue. Links each city via cityMapShareUrl
 * (London stays `/map`; other cities use `/map/{id}`). City taps also persist
 * preferred-city so Map/Drop nav follow the last rivalry pick.
 */
export default function CityRivalryTable({
  entries,
  caption = "UK city energy. Demo Pint Drops, listed crawls, and venue coverage.",
}: CityRivalryTableProps) {
  if (entries.length === 0) {
    return (
      <p className={styles.discoverEmpty} role="status">
        City energy ranks land once the packs ship.
      </p>
    );
  }

  return (
    <table className={`${styles.leaderboard} ${styles.cityRivalry}`}>
      <caption className={styles.srOnly}>{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className={styles.leaderboardRank}>
            #
          </th>
          <th scope="col">City</th>
          <th scope="col" className={`${styles.leaderboardArea} ${styles.cityRivalryDrops}`}>
            Drops
          </th>
          <th scope="col" className={styles.leaderboardPriceHead}>
            Energy
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, index) => (
          <tr key={entry.cityId}>
            <td className={styles.leaderboardRank}>
              <span className={styles.leaderboardRankNum} aria-hidden="true">
                {index + 1}
              </span>
              <span className={styles.srOnly}>Rank {index + 1}</span>
            </td>
            <th scope="row" className={styles.leaderboardName}>
              <Link
                className={styles.cityRivalryLink}
                href={cityMapShareUrl(entry.cityId)}
                onClick={() => writePreferredCity(entry.cityId)}
              >
                <span className={styles.leaderboardPub}>{entry.displayName}</span>
                <span className={styles.leaderboardPint}>{entry.tagline}</span>
              </Link>
            </th>
            <td className={`${styles.leaderboardArea} ${styles.cityRivalryDrops}`}>{entry.dropCount}</td>
            <td className={styles.leaderboardPriceHead}>
              <span className={styles.cityRivalryScoreNum}>{formatScore(entry.score)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}
