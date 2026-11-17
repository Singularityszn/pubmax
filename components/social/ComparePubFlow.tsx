"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { authedActionJson, authedFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { readProviderAccountRevision, subscribeProviderIdentityRevision } from "@/lib/authProviderRevision";
import { discardBody } from "@/lib/responseBody";
import { rankingSaveLanded } from "@/lib/firstTenRankingSession";
import {
  answerSocialPubComparison,
  nextSocialPubOpponent,
  SOCIAL_PUB_BAND_LABEL,
  SOCIAL_PUB_BANDS,
  socialPubComparisonNeighbours,
  socialPubRankingPayload,
  startSocialPubComparison,
  type SocialPubBand,
  type SocialPubComparison,
  type SocialPubRankingEntry,
} from "@/lib/socialPubRankings";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";

import "./comparePub.css";

type Venue = { id: string; name: string; borough?: string };
type Step = "pick" | "band" | "compare" | "saving" | "checking" | "unconfirmed" | "done";
type Neighbours = ReturnType<typeof socialPubComparisonNeighbours>;
/** A save whose outcome only a fresh list can tell: its answer was lost, or the list moved. */
type Unsettled = { kind: "lost"; band: SocialPubBand; neighbours: Neighbours } | { kind: "stale"; band: SocialPubBand };
async function readRankings(signal: AbortSignal): Promise<SocialPubRankingEntry[] | null> {
  try {
    const reply = await authedFetch("/api/social/rankings", { credentials: "same-origin", signal }, { requiresIdentity: true });
    if (!reply.ok) {
      discardBody(reply);
      return null;
    }
    return socialPubRankingPayload(await reply.json());
  } catch {
    return null;
  }
}

function formatScore(score: number): string {
  return score.toFixed(1);
}

/**
 * Rank a pub the way a review app does: pick it, say how it went (a band),
 * then answer "which did you prefer?" until it has a place. The questions are
 * a binary search over that band, so a long list still takes a few taps.
 * Saving tells the server which two pubs it landed between; if the list moved
 * meanwhile the server says so and the questions start again, on a list read
 * fresh. A lost save answer is checked against a fresh list before anything
 * else happens. The flow belongs to the account that opened it: a switch
 * closes it and drops any late answer.
 */
export default function ComparePubFlow({
  entries,
  startVenue,
  progress,
  onClose,
  onSaved,
}: {
  entries: SocialPubRankingEntry[];
  startVenue?: Venue | null;
  /** A session's own count, announced politely as it moves. */
  progress?: string;
  onClose: (pendingWrite?: Promise<void>) => void;
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
  const [unsettled, setUnsettled] = useState<Unsettled | null>(null);
  const accountRevision = useSyncExternalStore(subscribeProviderIdentityRevision, readProviderAccountRevision, () => 0);
  const [openedRevision] = useState(accountRevision);
  const mounted = useRef(false);
  const closing = useRef(false);
  const pendingWrite = useRef<Promise<void> | undefined>(undefined);
  const reads = useRef<AbortController | null>(null);
  const sameAccount = useCallback(() => mounted.current && !closing.current && readProviderAccountRevision() === openedRevision, [openedRevision]);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    onClose(pendingWrite.current);
  }, [onClose]);
  useDismissOnEscape(true, close, dialogRef);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    reads.current = controller;
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (accountRevision !== openedRevision) close();
  }, [accountRevision, openedRevision, close]);

  // Before the heading takes focus, so the trap keeps the opener to hand back.
  useFocusTrap(true, dialogRef, "strict-modal");

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const text = query.trim();
    if (step !== "pick" || text.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void authedFetch(`/api/social/venues?q=${encodeURIComponent(text)}`, { credentials: "same-origin", signal: controller.signal }, { requiresIdentity: true })
        .then((response) => {
          if (response.ok) return response.json();
          discardBody(response);
          return { venues: [] };
        })
        .then((body: { venues?: Venue[] }) => {
          if (!controller.signal.aborted && sameAccount()) setResults(body.venues ?? []);
        })
        .catch(() => {});
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, step, sameAccount]);

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

  function acknowledge(subjectId: string, saved: SocialPubRankingEntry[]) {
    if (!sameAccount()) return;
    // The server has answered for this write, so closing need not wait on it.
    // An unconfirmed write keeps its promise: closing then refreshes first.
    pendingWrite.current = undefined;
    onSaved(saved);
    setUnsettled(null);
    setList(saved);
    setPlaced(saved.find((entry) => entry.venueId === subjectId) ?? null);
    setStep("done");
  }

  async function reconcile(open: Unsettled) {
    if (!venue || !mounted.current || !reads.current) return;
    const subject = venue;
    setUnsettled(open);
    setNotice(null);
    setStep("checking");
    const fresh = await readRankings(reads.current.signal);
    if (!mounted.current || !sameAccount()) return;
    if (!fresh) {
      setStep("unconfirmed");
      return;
    }
    setUnsettled(null);
    setList(fresh);
    if (open.kind === "lost" && rankingSaveLanded(fresh, subject.id, open.band, open.neighbours)) {
      acknowledge(subject.id, fresh);
      return;
    }
    if (open.kind === "stale") {
      setNotice("Your list changed in another tab. A couple more questions.");
      begin(open.band, fresh);
      return;
    }
    setNotice("We could not confirm that ranking. Choose how it went again.");
    setStep("band");
  }

  async function save(chosenBand: SocialPubBand, settled: SocialPubComparison) {
    if (!venue) return;
    const subject = venue;
    setStep("saving");
    setNotice(null);
    const neighbours = socialPubComparisonNeighbours(settled);
    const lost: Unsettled = { kind: "lost", band: chosenBand, neighbours };
    let saved: { response: Response; body: unknown };
    try {
      const request = authedActionJson<unknown>(
        "/api/social/rankings",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ venueId: subject.id, band: chosenBand, ...neighbours }),
        },
        { requiresIdentity: true },
      );
      pendingWrite.current = request.then(() => undefined, () => undefined);
      saved = await request;
    } catch (cause) {
      if (!sameAccount()) return;
      // A session still waking never sent the save.
      if ((cause as { code?: unknown } | null)?.code === "AUTH_SESSION_WAKING") {
        if (!mounted.current) return;
        setNotice(cause instanceof Error ? cause.message : "That ranking did not save. Try again.");
        setStep("band");
        return;
      }
      await reconcile(lost);
      return;
    }
    if (!sameAccount()) return;
    const { response, body } = saved;
    const entries = response.ok ? socialPubRankingPayload(body) : null;
    if (entries) {
      acknowledge(subject.id, entries);
      return;
    }
    const code = body !== null && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
    if (response.status === 409 && code === "STALE_RANKING") {
      await reconcile({ kind: "stale", band: chosenBand });
      return;
    }
    if (response.ok || response.status === 409 || response.status >= 500) {
      await reconcile(lost);
      return;
    }
    if (!mounted.current) return;
    setNotice(errorMessageFrom(body, "That ranking did not save. Try again."));
    setStep("band");
  }

  const opponentId = session ? nextSocialPubOpponent(session) : null;
  const opponent = opponentId ? list.find((entry) => entry.venueId === opponentId) : null;
  const remaining = session ? Math.max(1, Math.ceil(Math.log2(session.high - session.low + 1))) : 0;

  return createPortal(
    <div className="comparePub__scrim">
      <div ref={dialogRef} className="comparePub" role="dialog" aria-modal="true" aria-labelledby="compare-pub-title">
        <button type="button" className="comparePub__close" onClick={close} aria-label="Close">
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

        {step === "saving" || step === "checking" ? (
          <p id="compare-pub-title" className="comparePub__progress" role="status">
            {step === "saving" ? "Saving your ranking…" : "Checking your list…"}
          </p>
        ) : null}

        {step === "unconfirmed" && venue && unsettled ? (
          <>
            <h2 id="compare-pub-title" ref={headingRef} tabIndex={-1}>
              {unsettled.kind === "lost" ? "We lost the answer" : "Your list changed"}
            </h2>
            <p className="comparePub__notice">
              {unsettled.kind === "lost"
                ? `${venue.name} may have saved. Check your list before you rank anything else.`
                : "It changed in another tab, and the new list did not load. Check again before the next question."}
            </p>
            <div className="comparePub__actions">
              <button type="button" onClick={close}>Close</button>
              <button type="button" className="comparePub__primary" onClick={() => void reconcile(unsettled)}>Check again</button>
            </div>
          </>
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
              <button type="button" className="comparePub__primary" onClick={close}>Done</button>
            </div>
          </>
        ) : null}

        {progress ? <p className="comparePub__progress" aria-live="polite">{progress}</p> : null}
        {notice ? <p className="comparePub__notice" role="status">{notice}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
