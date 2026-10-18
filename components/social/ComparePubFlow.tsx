"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { authedActionJson, authedFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import {
  answerSocialPubComparison,
  nextSocialPubOpponent,
  SOCIAL_PUB_BAND_LABEL,
  SOCIAL_PUB_BANDS,
  socialPubComparisonNeighbours,
  startSocialPubComparison,
  type SocialPubBand,
  type SocialPubComparison,
  type SocialPubRankingEntry,
} from "@/lib/socialPubRankings";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

import "./comparePub.css";

type Venue = { id: string; name: string; borough?: string };
type Step = "pick" | "band" | "compare" | "saving" | "done";

function formatScore(score: number): string {
  return score.toFixed(1);
}

/**
 * Rank a pub the way a review app does: pick it, say how it went (a band),
 * then answer "which did you prefer?" until it has a place. The questions are
 * a binary search over that band, so a long list still takes a few taps.
 * Saving tells the server which two pubs it landed between; if the list moved
 * meanwhile the server says so and the questions start again.
 */
export default function ComparePubFlow({
  entries,
  startVenue,
  onClose,
  onSaved,
}: {
  entries: SocialPubRankingEntry[];
  startVenue?: Venue | null;
  onClose: () => void;
  onSaved: (entries: SocialPubRankingEntry[]) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<Step>(startVenue ? "band" : "pick");
  const [venue, setVenue] = useState<Venue | null>(startVenue ?? null);
  const [band, setBand] = useState<SocialPubBand | null>(null);
  const [list, setList] = useState(entries);
  const [session, setSession] = useState<SocialPubComparison | null>(null);
  const [asked, setAsked] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Venue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [placed, setPlaced] = useState<SocialPubRankingEntry | null>(null);
  useDismissOnEscape(true, onClose, dialogRef);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const text = query.trim();
    if (step !== "pick" || text.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void authedFetch(`/api/social/venues?q=${encodeURIComponent(text)}`, { credentials: "same-origin", signal: controller.signal }, { requiresIdentity: true })
        .then((response) => (response.ok ? response.json() : { venues: [] }))
        .then((body: { venues?: Venue[] }) => setResults(body.venues ?? []))
        .catch(() => {});
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, step]);

  function begin(nextBand: SocialPubBand, from = list) {
    if (!venue) return;
    const inBand = from.filter((entry) => entry.band === nextBand).map((entry) => entry.venueId);
    const fresh = startSocialPubComparison(inBand, venue.id);
    setBand(nextBand);
    setSession(fresh);
    setAsked(0);
    if (nextSocialPubOpponent(fresh) === null) void save(nextBand, fresh);
    else setStep("compare");
  }

  function answer(preferred: "new" | "existing" | "tie") {
    if (!session || !band) return;
    const next = answerSocialPubComparison(session, preferred);
    setSession(next);
    setAsked((count) => count + 1);
    if (nextSocialPubOpponent(next) === null) void save(band, next);
  }

  async function save(chosenBand: SocialPubBand, settled: SocialPubComparison) {
    if (!venue) return;
    setStep("saving");
    setNotice(null);
    const neighbours = socialPubComparisonNeighbours(settled);
    try {
      const { response, body } = await authedActionJson<{ entries?: SocialPubRankingEntry[]; code?: string; error?: string }>(
        "/api/social/rankings",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ venueId: venue.id, band: chosenBand, ...neighbours }),
        },
        { requiresIdentity: true },
      );
      if (response.status === 409 && body.code === "STALE_RANKING") {
        const fresh = await authedFetch("/api/social/rankings", { credentials: "same-origin" }, { requiresIdentity: true })
          .then((reply) => (reply.ok ? reply.json() : { entries: list }))
          .then((reply: { entries?: SocialPubRankingEntry[] }) => reply.entries ?? list);
        setList(fresh);
        setNotice("Your list changed in another tab. A couple more questions.");
        begin(chosenBand, fresh);
        return;
      }
      if (!response.ok || !body.entries) throw new Error(errorMessageFrom(body, "That ranking did not save. Try again."));
      setList(body.entries);
      setPlaced(body.entries.find((entry) => entry.venueId === venue.id) ?? null);
      onSaved(body.entries);
      setStep("done");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "That ranking did not save. Try again.");
      setStep("band");
    }
  }

  const opponentId = session ? nextSocialPubOpponent(session) : null;
  const opponent = opponentId ? list.find((entry) => entry.venueId === opponentId) : null;
  const remaining = session ? Math.max(1, Math.ceil(Math.log2(session.high - session.low + 1))) : 0;

  return createPortal(
    <div className="comparePub__scrim">
      <div ref={dialogRef} className="comparePub" role="dialog" aria-modal="true" aria-labelledby="compare-pub-title">
        <button type="button" className="comparePub__close" onClick={onClose} aria-label="Close">
          <X size={20} aria-hidden="true" />
        </button>

        {step === "pick" ? (
          <>
            <h2 id="compare-pub-title" ref={headingRef} tabIndex={-1}>Rank a pub</h2>
            <label className="comparePub__search">
              Which pub?
              <input value={query} autoComplete="off" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search pubs" />
            </label>
            <ul className="comparePub__results">
              {results.map((result) => (
                <li key={result.id}>
                  <button type="button" onClick={() => { setVenue(result); setStep("band"); }}>
                    <strong>{result.name}</strong>
                    {result.borough ? <span>{result.borough}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {step === "band" && venue ? (
          <>
            <h2 id="compare-pub-title" ref={headingRef} tabIndex={-1}>How was {venue.name}?</h2>
            <div className="comparePub__bands">
              {SOCIAL_PUB_BANDS.map((option) => (
                <button key={option} type="button" data-band={option} onClick={() => begin(option)}>
                  {SOCIAL_PUB_BAND_LABEL[option]}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === "compare" && venue && opponent ? (
          <>
            <h2 id="compare-pub-title" ref={headingRef} tabIndex={-1}>Which did you prefer?</h2>
            <p className="comparePub__progress" aria-live="polite">
              Question {asked + 1}, about {remaining} to go
            </p>
            <div className="comparePub__pair">
              <button type="button" onClick={() => answer("new")}>
                <span className="comparePub__label">New</span>
                <strong>{venue.name}</strong>
              </button>
              <span className="comparePub__or" aria-hidden="true">or</span>
              <button type="button" onClick={() => answer("existing")}>
                <span className="comparePub__figure">#{opponent.place} · {formatScore(opponent.score)}</span>
                <strong>{opponent.venueName ?? "A pub you ranked"}</strong>
              </button>
            </div>
            <button type="button" className="comparePub__tie" onClick={() => answer("tie")}>Too close to call</button>
          </>
        ) : null}

        {step === "saving" ? (
          <p id="compare-pub-title" className="comparePub__progress" role="status">Saving your ranking…</p>
        ) : null}

        {step === "done" && venue ? (
          <>
            <h2 id="compare-pub-title" ref={headingRef} tabIndex={-1}>{venue.name} is in</h2>
            {placed ? (
              <p className="comparePub__result">
                <span className="comparePub__place">#{placed.place}</span>
                <span className="comparePub__score">{formatScore(placed.score)}</span>
                <span>{SOCIAL_PUB_BAND_LABEL[placed.band]}</span>
              </p>
            ) : null}
            <div className="comparePub__actions">
              <button type="button" onClick={() => { setVenue(null); setQuery(""); setResults([]); setStep("pick"); }}>Rank another</button>
              <button type="button" className="comparePub__primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : null}

        {notice ? <p className="comparePub__notice" role="status">{notice}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
