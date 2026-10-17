"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import ReviewStars from "@/components/social/ReviewStars";
import { authedFetch } from "@/lib/authedFetch";
import type { SocialPubRankingEntry } from "@/lib/socialPostReviews";
import { venueMapUrl } from "@/lib/venueMapUrl";

const SHOWN = 5;

/**
 * The pubs you have scored, best first: your own list, the way a review app
 * keeps one. It counts nobody's scores but yours. `refreshKey` changes when
 * you post, so a new score lands in the list without a reload.
 */
export default function PubRankingPanel({ refreshKey = "" }: { refreshKey?: string }) {
  const [entries, setEntries] = useState<SocialPubRankingEntry[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void authedFetch("/api/social/reviews?limit=50", { credentials: "same-origin", signal: controller.signal }, { requiresIdentity: true })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { entries?: SocialPubRankingEntry[] } | null) => setEntries(body?.entries ?? []))
      .catch(() => {});
    return () => controller.abort();
  }, [refreshKey]);

  if (entries === null) return null;
  const visible = showAll ? entries : entries.slice(0, SHOWN);
  return (
    <section className="pubRanking" aria-labelledby="pub-ranking-title">
      <h2 id="pub-ranking-title">Your pubs, ranked</h2>
      {entries.length === 0 ? (
        <p className="pubRanking__empty">Name a pub in a post and give it a score. Your list builds from there.</p>
      ) : (
        <ol>
          {visible.map((entry, index) => (
            <li key={entry.venueId}>
              <span className="pubRanking__place" aria-hidden="true">{index + 1}</span>
              <Link prefetch={false} href={venueMapUrl(entry.venueId)} className="pubRanking__name">
                {entry.venueName ?? "A pub you scored"}
              </Link>
              <ReviewStars rating={entry.rating} size={12} />
            </li>
          ))}
        </ol>
      )}
      {entries.length > SHOWN ? (
        <button type="button" className="pubRanking__more" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show your top 5" : `Show all ${entries.length}`}
        </button>
      ) : null}
    </section>
  );
}
