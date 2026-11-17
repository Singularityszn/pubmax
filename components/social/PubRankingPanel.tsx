"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useLiveAccountGeneration } from "@/components/auth/useLiveAccountGeneration";
import ComparePubFlow from "@/components/social/ComparePubFlow";
import ReviewStars from "@/components/social/ReviewStars";
import { useIsSample } from "@/components/ui/sample-skeleton-context";
import { authedFetch } from "@/lib/authedFetch";
import type { SocialLotRankingEntry, SocialPubRankingEntry as StarEntry } from "@/lib/socialPostReviews";
import {
  SOCIAL_PUB_BAND_LABEL,
  socialPubRankingPayload,
  socialPubRankingReadFailure,
  type SocialPubRankingEntry,
} from "@/lib/socialPubRankings";

import "./pubRankingState.css";

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

class RankingReadError extends Error {
  constructor(readonly kind: "refused" | "unavailable") { super(kind); }
}

async function readJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await authedFetch(url, { credentials: "same-origin", signal }, { requiresIdentity: true });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new RankingReadError(socialPubRankingReadFailure(response.status, body));
  return body as T;
}

/**
 * Your pubs, ranked, the way a review app keeps them. Yours is the order you
 * built by answering "which did you prefer?", each pub with a 0-10 figure
 * from its band and place; until you have compared any, it falls back to the
 * star scores on your posts. Your lot's averages each mutual friend's newest
 * star score. Both lists are for you alone; neither moves a feed, a map or a
 * price.
 */
export default function PubRankingPanel(props: { refreshKey?: string }) {
  const generation = useLiveAccountGeneration();
  return <RankingPanel key={generation} {...props} />;
}

function RankingPanel({ refreshKey = "" }: { refreshKey?: string }) {
  const sampled = useIsSample();
  const [scope, setScope] = useState<Scope>("mine");
  const [loaded, setLoaded] = useState<{ scope: Scope; rows: Row[]; compared: SocialPubRankingEntry[] } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [phase, setPhase] = useState<"checking" | "retrying" | "ready" | "unavailable" | "refused">("checking");
  const pendingWrite = useRef<Promise<void> | undefined>(undefined);
  const generation = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusAfterRead = useRef(false);

  useLayoutEffect(() => {
    if (phase === "ready" && focusAfterRead.current) headingRef.current?.focus();
    if (phase !== "checking" && phase !== "retrying") focusAfterRead.current = false;
  }, [phase]);

  useEffect(() => {
    if (sampled) return;
    const requestGeneration = ++generation.current;
    const controller = new AbortController();
    function refuse(error: unknown): never {
      if (error instanceof RankingReadError && error.kind === "refused" &&
        !controller.signal.aborted && generation.current === requestGeneration) {
        setLoaded(null);
        setComparing(false);
        setPhase("refused");
        controller.abort();
      }
      throw error;
    }
    void (async () => {
      await pendingWrite.current;
      if (controller.signal.aborted) return;
      if (scope === "lot") {
        const lot = await readJson<{ entries?: SocialLotRankingEntry[] }>("/api/social/reviews?limit=50&scope=lot", controller.signal);
        if (controller.signal.aborted || generation.current !== requestGeneration) return;
        if (!Array.isArray(lot?.entries)) throw new RankingReadError("unavailable");
        setLoaded({ scope, rows: starRows(lot.entries), compared: [] });
        setPhase("ready");
        return;
      }
      const [compared, stars] = await Promise.allSettled([
        readJson<unknown>("/api/social/rankings", controller.signal).catch(refuse),
        readJson<{ entries?: StarEntry[] }>("/api/social/reviews?limit=50&scope=mine", controller.signal).catch(refuse),
      ]);
      if (controller.signal.aborted || generation.current !== requestGeneration) return;
      if (compared.status !== "fulfilled" || stars.status !== "fulfilled") throw new RankingReadError("unavailable");
      const comparedEntries = socialPubRankingPayload(compared.value);
      if (!comparedEntries || !Array.isArray(stars.value?.entries)) throw new RankingReadError("unavailable");
      setLoaded({
        scope,
        rows: comparedEntries.length > 0 ? comparedRows(comparedEntries) : starRows(stars.value.entries),
        compared: comparedEntries,
      });
      setPhase("ready");
    })().catch((error: unknown) => {
      if (controller.signal.aborted || generation.current !== requestGeneration) return;
      const next = error instanceof RankingReadError ? error.kind : "unavailable";
      if (next === "refused") {
        setLoaded(null);
        setComparing(false);
      }
      setPhase(next);
    });
    return () => { controller.abort(); generation.current += 1; };
  }, [refreshKey, scope, revision, sampled]);

  const rows = sampled ? [] : loaded?.scope === scope ? loaded.rows : null;
  const visible = rows ? (showAll ? rows : rows.slice(0, SHOWN)) : [];
  function refresh(retrying = false) {
    setPhase(retrying ? "retrying" : "checking");
    setRevision((value) => value + 1);
  }
  if (phase === "refused") return null;
  return (
    <section className="pubRanking" aria-labelledby="pub-ranking-title">
      <h2 id="pub-ranking-title" ref={headingRef} tabIndex={-1}>{scope === "mine" ? "Your pubs, ranked" : "Your lot's pubs"}</h2>
      <div className="pubRanking__switch" role="radiogroup" aria-label="Whose ranking">
        {(["mine", "lot"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={scope === option}
            onClick={() => { if (scope !== option) { focusAfterRead.current = false; setPhase("checking"); setScope(option); } setShowAll(false); }}
          >
            {option === "mine" ? "Yours" : "Your lot's"}
          </button>
        ))}
      </div>
      <p className={!sampled && phase !== "ready" ? "pubRanking__empty" : "sr-only"} role="status">
        {sampled || phase === "ready" ? "" : phase === "unavailable" ? "Your ranking is unavailable right now." : "Checking your ranking…"}
      </p>
      {phase === "unavailable" || phase === "retrying" ? (
        <>
          <button type="button" className="pubRanking__more" aria-disabled={phase === "retrying"} onClick={() => { if (phase === "unavailable") { focusAfterRead.current = true; refresh(true); } }}>Try again</button>
        </>
      ) : null}
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
      {scope === "mine" && (sampled || loaded?.scope === "mine") ? (
        <button type="button" className="pubRanking__rank" aria-disabled={phase !== "ready" || sampled} onClick={() => { if (phase === "ready" && !sampled) setComparing(true); }}>
          Rank a pub
        </button>
      ) : null}
      {comparing && loaded ? (
        <ComparePubFlow
          entries={loaded.compared}
          onClose={(pending) => {
            setComparing(false);
            pendingWrite.current = pending;
            refresh();
          }}
          onSaved={() => refresh()}
        />
      ) : null}
    </section>
  );
}
