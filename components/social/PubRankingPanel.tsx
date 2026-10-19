"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useState } from "react";

import ComparePubFlow from "@/components/social/ComparePubFlow";
import ReviewStars from "@/components/social/ReviewStars";
import { authedFetch } from "@/lib/authedFetch";
import type { SocialLotRankingEntry, SocialPubRankingEntry as StarEntry } from "@/lib/socialPostReviews";
import { SOCIAL_PUB_BAND_LABEL, type SocialPubRankingEntry } from "@/lib/socialPubRankings";

const SHOWN = 5;

type Scope = "mine" | "lot";
type Row = { venueId: string; venueName: string | null; stars: number | null; score: number | null; note: string | null };

function starRows(entries: Array<StarEntry | SocialLotRankingEntry>): Row[] {
  return entries.map((entry) => "averageRating" in entry
    ? {
        venueId: entry.venueId,
        venueName: entry.venueName,
        stars: entry.averageRating,
        score: null,
        note: entry.raterCount === 1 ? `@${entry.raterHandles[0] ?? "a friend"}` : `${entry.raterCount} of your lot`,
      }
    : { venueId: entry.venueId, venueName: entry.venueName, stars: entry.rating, score: null, note: null });
}

function comparedRows(entries: SocialPubRankingEntry[]): Row[] {
  return entries.map((entry) => ({
    venueId: entry.venueId,
    venueName: entry.venueName,
    stars: null,
    score: entry.score,
    note: SOCIAL_PUB_BAND_LABEL[entry.band],
  }));
}

async function readJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  const response = await authedFetch(url, { credentials: "same-origin", signal }, { requiresIdentity: true });
  return response.ok ? (await response.json()) as T : null;
}

/**
 * Your pubs, ranked, the way a review app keeps them. Yours is the order you
 * built by answering "which did you prefer?", each pub with a 0-10 figure
 * from its band and place; until you have compared any, it falls back to the
 * star scores on your posts. Your lot's averages each mutual friend's newest
 * star score. Both lists are for you alone; neither moves a feed, a map or a
 * price.
 */
export default function PubRankingPanel({ refreshKey = "" }: { refreshKey?: string }) {
  const [scope, setScope] = useState<Scope>("mine");
  const [loaded, setLoaded] = useState<{ scope: Scope; rows: Row[]; compared: SocialPubRankingEntry[] } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      if (scope === "lot") {
        const lot = await readJson<{ entries?: SocialLotRankingEntry[] }>("/api/social/reviews?limit=50&scope=lot", controller.signal);
        setLoaded({ scope, rows: starRows(lot?.entries ?? []), compared: [] });
        return;
      }
      const [compared, stars] = await Promise.all([
        readJson<{ entries?: SocialPubRankingEntry[] }>("/api/social/rankings", controller.signal),
        readJson<{ entries?: StarEntry[] }>("/api/social/reviews?limit=50&scope=mine", controller.signal),
      ]);
      const comparedEntries = compared?.entries ?? [];
      setLoaded({
        scope,
        rows: comparedEntries.length > 0 ? comparedRows(comparedEntries) : starRows(stars?.entries ?? []),
        compared: comparedEntries,
      });
    })().catch(() => {});
    return () => controller.abort();
  }, [refreshKey, scope, revision]);

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
            ? "Rank a pub you have been to. A few quick questions put it in your order."
            : "When your lot score the pubs they post about, their favourites land here."}
        </p>
      ) : null}
      {rows && rows.length > 0 ? (
        <ol>
          {visible.map((row, index) => (
            <li key={row.venueId}>
              <span className="pubRanking__place" aria-hidden="true">{index + 1}</span>
              <span className="pubRanking__what">
                <Link prefetch={false} href={`/pubs/${encodeURIComponent(row.venueId)}` as Route} className="pubRanking__name">
                  {row.venueName ?? "A pub you ranked"}
                </Link>
                {row.note ? <span className="pubRanking__note">{row.note}</span> : null}
              </span>
              {row.score !== null ? (
                <span className="pubRanking__score" aria-label={`${row.score.toFixed(1)} out of 10`}>{row.score.toFixed(1)}</span>
              ) : row.stars !== null ? (
                <ReviewStars rating={row.stars} size={14} label={scope === "lot" ? `Your lot average ${row.stars} out of 5` : undefined} />
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {rows && rows.length > SHOWN ? (
        <button type="button" className="pubRanking__more" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show the top 5" : `Show all ${rows.length}`}
        </button>
      ) : null}
      {scope === "mine" && loaded?.scope === "mine" ? (
        <button type="button" className="pubRanking__rank" onClick={() => setComparing(true)}>
          Rank a pub
        </button>
      ) : null}
      {comparing && loaded ? (
        <ComparePubFlow
          entries={loaded.compared}
          onClose={() => setComparing(false)}
          onSaved={() => setRevision((value) => value + 1)}
        />
      ) : null}
    </section>
  );
}
