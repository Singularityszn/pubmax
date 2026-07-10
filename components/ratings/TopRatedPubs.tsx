"use client";

// "Top rated pubs this month" (PRD E3), for the discover page. Reuses the
// leaderboard idiom: a ranked semantic list. The ranking arrives from
// GET /api/ratings?kind=venue&top=1 — Bayesian-ranked, trailing-30-day
// window, ≥10-vote floor applied server-side (lib/ratings.topRated), so a pub
// below the floor is OMITTED, never shown with a hedge. Percentile framing
// ("beats N% of this month's rated pubs") is computed across the returned
// distribution.
//
// Honest empty state until real votes exist — no seeded scores, ever.
// Duty-of-care: this list celebrates PUBS, never anyone's consumption.

import Link from "next/link";
import { useEffect, useState } from "react";

import EmptyState from "@/components/EmptyState";
import prefetchVenue from "@/lib/prefetchVenue";
import { percentileFrame, type TopRatedEntry } from "@/lib/ratings";
import { venueMapUrl } from "@/lib/venueMapUrl";

import StarRating from "./StarRating";
import "./topRatedPubs.css";

export type TopRatedPubsProps = {
  /** venue id → display name, from the page's already-loaded dataset. */
  venueNames: Record<string, string>;
};

export default function TopRatedPubs({ venueNames }: TopRatedPubsProps) {
  const [entries, setEntries] = useState<TopRatedEntry[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ratings?kind=venue&top=1&limit=10", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { top: [] }))
      .then((body: { top?: TopRatedEntry[] }) => {
        setEntries(Array.isArray(body.top) ? body.top : []);
      })
      .catch(() => {
        // Fail-soft: the section keeps its honest empty state.
      });
    return () => controller.abort();
  }, []);

  if (entries.length === 0) {
    return (
      <EmptyState
        className="topRatedEmpty"
        eyebrow="Early days"
        title="No pub has earned its stars yet this month."
        body="A pub joins this list once ten people have rated it in the last thirty days — honest scores only, no seeded numbers."
        action={<Link href="/map">Find a pub to rate</Link>}
      />
    );
  }

  const distribution = entries
    .map((entry) => entry.summary.bayesian)
    .filter((score): score is number => score !== null);

  return (
    <ol className="topRatedList" aria-label="Top rated pubs this month">
      {entries.map((entry, index) => {
        const frame = percentileFrame(
          entry.summary.bayesian,
          distribution,
          "this month's rated pubs",
        );
        const name = venueNames[entry.ref] ?? entry.ref;
        return (
          <li className="topRatedItem" key={entry.ref}>
            <span className="topRatedRank">{index + 1}</span>
            <span className="topRatedMain">
              <Link
                className="topRatedName"
                href={venueMapUrl(entry.ref)}
                onPointerEnter={() => prefetchVenue(entry.ref)}
                onTouchStart={() => prefetchVenue(entry.ref)}
              >
                {name}
              </Link>
              <span className="ratingLine">
                <StarRating
                  value={entry.summary.average}
                  label={`${name} community rating`}
                  size="sm"
                />
                <span className="ratingCount">
                  {entry.summary.average?.toFixed(1)} · {entry.summary.count} ratings
                </span>
              </span>
              {frame && distribution.length > 1 ? (
                <span className="topRatedFrame">{frame.label}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
