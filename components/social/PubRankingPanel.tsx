"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import ReviewStars from "@/components/social/ReviewStars";
import { authedFetch } from "@/lib/authedFetch";
import type { SocialLotRankingEntry, SocialPubRankingEntry } from "@/lib/socialPostReviews";
import { venueMapUrl } from "@/lib/venueMapUrl";

const SHOWN = 5;

type Scope = "mine" | "lot";
type Row = { venueId: string; venueName: string | null; rating: number; note: string | null };

function rowsFor(entries: Array<SocialPubRankingEntry | SocialLotRankingEntry>): Row[] {
  return entries.map((entry) => "averageRating" in entry
    ? {
        venueId: entry.venueId,
        venueName: entry.venueName,
        rating: entry.averageRating,
        note: entry.raterCount === 1
          ? `@${entry.raterHandles[0] ?? "a friend"}`
          : `${entry.raterCount} of your lot`,
      }
    : { venueId: entry.venueId, venueName: entry.venueName, rating: entry.rating, note: null });
}

/**
 * Your pubs, ranked, the way a review app keeps them: your own list, or
 * switched to your lot's, where each mutual friend's newest score for a pub
 * is averaged. Both lists are for you alone; neither moves a feed, a map or a
 * price. `refreshKey` changes when you post, so a new score lands without a
 * reload.
 */
export default function PubRankingPanel({ refreshKey = "" }: { refreshKey?: string }) {
  const [scope, setScope] = useState<Scope>("mine");
  const [loaded, setLoaded] = useState<{ scope: Scope; rows: Row[] } | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void authedFetch(`/api/social/reviews?limit=50&scope=${scope}`, { credentials: "same-origin", signal: controller.signal }, { requiresIdentity: true })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { entries?: Array<SocialPubRankingEntry | SocialLotRankingEntry> } | null) => {
        setLoaded({ scope, rows: rowsFor(body?.entries ?? []) });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [refreshKey, scope]);

  const rows = loaded?.scope === scope ? loaded.rows : null;
  const visible = rows ? (showAll ? rows : rows.slice(0, SHOWN)) : [];
  return (
    <section className="pubRanking" aria-labelledby="pub-ranking-title">
      <h2 id="pub-ranking-title">{scope === "mine" ? "Your pubs, ranked" : "Your lot's pubs"}</h2>
      <div className="pubRanking__switch" role="radiogroup" aria-label="Whose ranking">
        {(["mine", "lot"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={scope === option}
            onClick={() => { setScope(option); setShowAll(false); }}
          >
            {option === "mine" ? "Yours" : "Your lot's"}
          </button>
        ))}
      </div>
      {rows === null ? <p className="pubRanking__empty" role="status">Loading…</p> : null}
      {rows && rows.length === 0 ? (
        <p className="pubRanking__empty">
          {scope === "mine"
            ? "Name a pub in a post and give it a score. Your list builds from there."
            : "When your lot score the pubs they post about, their favourites land here."}
        </p>
      ) : null}
      {rows && rows.length > 0 ? (
        <ol>
          {visible.map((row, index) => (
            <li key={row.venueId}>
              <span className="pubRanking__place" aria-hidden="true">{index + 1}</span>
              <span className="pubRanking__what">
                <Link prefetch={false} href={venueMapUrl(row.venueId)} className="pubRanking__name">
                  {row.venueName ?? "A pub you scored"}
                </Link>
                {row.note ? <span className="pubRanking__note">{row.note}</span> : null}
              </span>
              <ReviewStars rating={row.rating} size={12} label={scope === "lot" ? `Your lot average ${row.rating} out of 5` : undefined} />
            </li>
          ))}
        </ol>
      ) : null}
      {rows && rows.length > SHOWN ? (
        <button type="button" className="pubRanking__more" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show the top 5" : `Show all ${rows.length}`}
        </button>
      ) : null}
    </section>
  );
}
