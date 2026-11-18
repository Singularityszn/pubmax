"use client";

import type { Route } from "next";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useLiveAccountGeneration } from "@/components/auth/useLiveAccountGeneration";
import ComparePubFlow from "@/components/social/ComparePubFlow";
import ReviewStars from "@/components/social/ReviewStars";
import { useIsSample } from "@/components/ui/sample-skeleton-context";
import { authedFetch } from "@/lib/authedFetch";
import { panelMineOutcome, type PanelPart } from "@/lib/pubRankingPanelRead";
import {
  heldRanking,
  retiredFocusRequest,
  retryFocusRequest,
  retryingRanking,
  startRankingCheckpoint,
  transitionRankingCheckpoint,
  type RankingCheckpointEvent,
  type RankingReadOutcome,
} from "@/lib/rankingCheckpoint";
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

type Loaded = { scope: Scope; rows: Row[]; compared: SocialPubRankingEntry[] };

/** One read, as what it proves: a value, an outage, or a refusal of this account. */
async function readPart<T>(url: string, signal: AbortSignal, pick: (body: unknown) => T | null): Promise<PanelPart<T>> {
  try {
    const response = await authedFetch(url, { credentials: "same-origin", signal }, { requiresIdentity: true });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { kind: socialPubRankingReadFailure(response.status, body) };
    const value = pick(body);
    return value === null ? { kind: "unavailable" } : { kind: "ok", value };
  } catch {
    return { kind: "unavailable" };
  }
}

function entriesOf<T>(body: unknown): T[] | null {
  const entries = body !== null && typeof body === "object" ? (body as { entries?: unknown }).entries : undefined;
  return Array.isArray(entries) ? entries as T[] : null;
}

/**
 * Reads one scope of the panel and answers as soon as the reads prove
 * something (lib/pubRankingPanelRead.ts). A later definite refusal still answers.
 */
function readPanel(
  scope: Scope,
  signal: AbortSignal,
  answer: (outcome: RankingReadOutcome<Loaded>) => void,
  refusal: () => RankingReadOutcome<Loaded>,
): void {
  if (scope === "lot") {
    void readPart("/api/social/reviews?limit=50&scope=lot", signal, entriesOf<SocialLotRankingEntry>).then((lot) => {
      if (lot.kind === "ok") answer({ kind: "data", data: { scope, rows: starRows(lot.value), compared: [] } });
      else if (lot.kind === "refused") answer(refusal());
      else if (lot.kind === "unavailable") answer({ kind: "unavailable" });
    });
    return;
  }
  let rankings: PanelPart<SocialPubRankingEntry[]> = { kind: "pending" };
  let reviews: PanelPart<StarEntry[]> = { kind: "pending" };
  const settle = () => {
    const outcome = panelMineOutcome(rankings, reviews);
    switch (outcome.kind) {
      case "wait":
        return;
      case "refused":
        answer(refusal());
        return;
      case "unavailable":
        answer({ kind: "unavailable" });
        return;
      case "compared":
        answer({ kind: "data", data: { scope, rows: comparedRows(outcome.entries), compared: outcome.entries } });
        return;
      case "stars":
        answer({ kind: "data", data: { scope, rows: starRows(outcome.stars), compared: [] } });
        return;
      default: {
        const unreachable: never = outcome;
        return unreachable;
      }
    }
  };
  void readPart("/api/social/rankings", signal, socialPubRankingPayload).then((part) => { rankings = part; settle(); });
  void readPart("/api/social/reviews?limit=50&scope=mine", signal, entriesOf<StarEntry>).then((part) => { reviews = part; settle(); });
}

function PanelRows({ rows, scope }: { rows: Row[]; scope: Scope }) {
  return (
    <ol>
      {rows.map((row, index) => (
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
  );
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
  const [showAll, setShowAll] = useState(false);
  const [state, setState] = useState(startRankingCheckpoint<Loaded>);
  const current = useRef(state);
  const send = useCallback((event: RankingCheckpointEvent<Loaded>) => {
    const next = transitionRankingCheckpoint(current.current, event);
    if (next === current.current) return;
    current.current = next;
    setState(next);
  }, []);
  const pendingWrite = useRef<Promise<void> | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const triggers = useRef({ refreshKey, scope });
  const scopeRef = useRef(scope);
  useEffect(() => { scopeRef.current = scope; }, [scope]);

  // A refresh from outside or a new scope reads again.
  useEffect(() => {
    if (triggers.current.refreshKey === refreshKey && triggers.current.scope === scope) return;
    triggers.current = { refreshKey, scope };
    send({ type: "read", retrying: false });
  }, [refreshKey, scope, send]);

  // A read lives as long as its request, past early rows, so a late refusal still lands.
  const request = state.request;
  useEffect(() => {
    if (sampled || current.current.phase !== "reading") return;
    const readScope = scopeRef.current;
    const controller = new AbortController();
    const answer = (outcome: RankingReadOutcome<Loaded>) => {
      if (!controller.signal.aborted) send({ type: "answered", request, outcome });
    };
    const refusal = (): RankingReadOutcome<Loaded> => ({
      kind: "refused",
      readerInside: Boolean(sectionRef.current?.contains(document.activeElement)),
    });
    void (async () => {
      // A save the dialog never confirmed settles before the list is read.
      await pendingWrite.current;
      if (!controller.signal.aborted) readPanel(readScope, controller.signal, answer, refusal);
    })();
    return () => controller.abort();
  }, [request, sampled, send]);

  const afterRetry = retryFocusRequest(state);
  useLayoutEffect(() => {
    if (afterRetry !== null) headingRef.current?.focus();
  }, [afterRetry]);

  const retired = retiredFocusRequest(state);
  useEffect(() => {
    if (retired === null) return;
    // A closing comparison hands the page back in a microtask.
    queueMicrotask(() => headingRef.current?.focus());
  }, [retired]);

  if (state.phase === "refused") {
    return state.retired ? (
      <section className="pubRanking" aria-labelledby="pub-ranking-title">
        <h2 id="pub-ranking-title" ref={headingRef} tabIndex={-1}>Your pubs, ranked</h2>
        <p className="pubRanking__empty" role="status">Your ranking is not available to this account right now.</p>
      </section>
    ) : null;
  }
  const phase = state.phase;
  const held = heldRanking(state);
  const retrying = retryingRanking(state);
  const rows = sampled ? [] : held?.scope === scope ? held.rows : null;
  const visible = rows ? (showAll ? rows : rows.slice(0, SHOWN)) : [];
  return (
    <section ref={sectionRef} className="pubRanking" aria-labelledby="pub-ranking-title">
      <h2 id="pub-ranking-title" ref={headingRef} tabIndex={-1}>{scope === "mine" ? "Your pubs, ranked" : "Your lot's pubs"}</h2>
      <div className="pubRanking__switch" role="radiogroup" aria-label="Whose ranking">
        {(["mine", "lot"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={scope === option}
            onClick={() => { if (scope !== option) setScope(option); setShowAll(false); }}
          >
            {option === "mine" ? "Yours" : "Your lot's"}
          </button>
        ))}
      </div>
      <p className={!sampled && phase !== "ready" ? "pubRanking__empty" : "sr-only"} role="status">
        {sampled || phase === "ready" ? "" : phase === "unavailable" ? "Your ranking is unavailable right now." : "Checking your ranking…"}
      </p>
      {phase === "unavailable" || retrying ? (
        <button type="button" className="pubRanking__more" aria-disabled={retrying} onClick={() => { if (phase === "unavailable") send({ type: "read", retrying: true }); }}>Try again</button>
      ) : null}
      {rows && rows.length === 0 ? (
        <p className="pubRanking__empty">
          {scope === "mine"
            ? "Rank a pub you have been to. A few quick questions put it in your order."
            : "When your lot score the pubs they post about, their favourites land here."}
        </p>
      ) : null}
      {rows && rows.length > 0 ? <PanelRows rows={visible} scope={scope} /> : null}
      {rows && rows.length > SHOWN ? (
        <button type="button" className="pubRanking__more" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show the top 5" : `Show all ${rows.length}`}
        </button>
      ) : null}
      {scope === "mine" && (sampled || held?.scope === "mine") ? (
        <button type="button" className="pubRanking__rank" aria-disabled={phase !== "ready" || sampled} onClick={() => { if (phase === "ready" && !sampled) send({ type: "session_opened" }); }}>
          Rank a pub
        </button>
      ) : null}
      {state.session !== "none" && held ? (
        <ComparePubFlow
          entries={held.compared}
          onClose={(refresh, reason) => {
            if (reason !== "refused") pendingWrite.current = refresh;
            send({ type: "session_closed", refresh: refresh !== undefined, refused: reason === "refused" });
          }}
          onSaved={(saved) => send({ type: "session_saved", data: { scope: "mine", rows: comparedRows(saved), compared: saved } })}
        />
      ) : null}
    </section>
  );
}
