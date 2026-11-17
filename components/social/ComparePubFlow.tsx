"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { AuthActionJsonParseError, authedActionJson, authedFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { readProviderAccountRevision, subscribeProviderIdentityRevision } from "@/lib/authProviderRevision";
import { rankingSaveLanded } from "@/lib/firstTenRankingSession";
import {
  startComparison,
  transitionComparison,
  type ComparisonEvent,
  type ComparisonListRead,
  type ComparisonNeighbours,
  type ComparisonPlan,
  type ComparisonSaveAnswer,
  type ComparisonVenue,
} from "@/lib/rankingComparisonFlow";
import { discardBody } from "@/lib/responseBody";
import {
  answerSocialPubComparison,
  nextSocialPubOpponent,
  SOCIAL_PUB_BAND_LABEL,
  SOCIAL_PUB_BANDS,
  socialPubComparisonNeighbours,
  socialPubRankingPayload,
  socialPubRankingReadFailure,
  socialPubRankingSaveAnswer,
  startSocialPubComparison,
  type SocialPubBand,
  type SocialPubComparison,
  type SocialPubRankingEntry,
} from "@/lib/socialPubRankings";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";

import "./comparePub.css";

type ListRead = { kind: "entries"; entries: SocialPubRankingEntry[] } | { kind: "refused" } | { kind: "unavailable" };

/** Why a flow ended other than by the reader: Social refused this account. */
export type ComparePubCloseReason = "refused";

async function readRankings(signal: AbortSignal): Promise<ListRead> {
  try {
    const reply = await authedFetch("/api/social/rankings", { credentials: "same-origin", signal }, { requiresIdentity: true });
    if (!reply.ok) {
      // Reading the refusal also releases the response.
      const body: unknown = await reply.json().catch(() => null);
      return { kind: socialPubRankingReadFailure(reply.status, body) === "refused" ? "refused" : "unavailable" };
    }
    const entries = socialPubRankingPayload(await reply.json());
    return entries ? { kind: "entries", entries } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Where a band, or an answer inside it, leaves the comparison for this pub. */
function planComparison(band: SocialPubBand, session: SocialPubComparison): ComparisonPlan {
  return { band, session, opponent: nextSocialPubOpponent(session), neighbours: socialPubComparisonNeighbours(session) };
}

function planBand(list: SocialPubRankingEntry[], venueId: string, band: SocialPubBand): ComparisonPlan {
  const inBand = list.filter((entry) => entry.band === band).map((entry) => entry.venueId);
  return planComparison(band, startSocialPubComparison(inBand, venueId));
}

/** What a save answer proves, from its status and body or from what it threw. */
function saveAnswerFrom(saved: { response: Response; body: unknown } | { thrown: unknown }): ComparisonSaveAnswer {
  if ("thrown" in saved) {
    const cause = saved.thrown;
    // A session still waking never sent the save.
    if ((cause as { code?: unknown } | null)?.code === "AUTH_SESSION_WAKING") {
      return { kind: "rejected", message: cause instanceof Error ? cause.message : "That ranking did not save. Try again." };
    }
    // An unreadable answer still has its status.
    const unread = cause instanceof AuthActionJsonParseError ? socialPubRankingSaveAnswer(cause.status, null) : "unknown";
    return unread === "rejected" ? { kind: "rejected", message: "That ranking did not save. Try again." } : { kind: unread };
  }
  const { response, body } = saved;
  const entries = response.ok ? socialPubRankingPayload(body) : null;
  if (entries) return { kind: "saved", entries };
  const outcome = socialPubRankingSaveAnswer(response.status, body);
  return outcome === "rejected" ? { kind: "rejected", message: errorMessageFrom(body, "That ranking did not save. Try again.") } : { kind: outcome };
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
 * closes it and drops any late answer. The lifecycle is
 * lib/rankingComparisonFlow.ts; this component runs its effects.
 */
export default function ComparePubFlow({
  entries,
  startVenue,
  progress,
  onClose,
  onSaved,
}: {
  entries: SocialPubRankingEntry[];
  startVenue?: ComparisonVenue | null;
  /** A session's own count, announced politely as it moves. */
  progress?: string;
  /**
   * The flow ended. A `refresh` promise means the caller must read its list
   * again once it settles: a save the server never confirmed, or a newer list
   * this flow read and never handed over. None means the caller already holds
   * everything the flow knows. `"refused"` means Social refused this account:
   * the caller drops what it holds for it and reads nothing more.
   */
  onClose: (refresh?: Promise<void>, reason?: ComparePubCloseReason) => void;
  onSaved: (entries: SocialPubRankingEntry[]) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const accountRevision = useSyncExternalStore(subscribeProviderIdentityRevision, readProviderAccountRevision, () => 0);
  const [flow, setFlow] = useState(() => startComparison(accountRevision, entries, startVenue));
  const current = useRef(flow);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ComparisonVenue[]>([]);
  const mounted = useRef(false);
  const pendingWrite = useRef<Promise<void> | undefined>(undefined);
  const reads = useRef<AbortController | null>(null);
  const callbacks = useRef({ onClose, onSaved });
  useEffect(() => { callbacks.current = { onClose, onSaved }; }, [onClose, onSaved]);
  const sameAccount = useCallback(
    () => mounted.current && current.current.view.step !== "closed" && readProviderAccountRevision() === current.current.account,
    [],
  );

  const send = useCallback((event: ComparisonEvent) => {
    const { flow: next, effect } = transitionComparison(current.current, event);
    if (next !== current.current) {
      current.current = next;
      setFlow(next);
    }
    if (!effect) return;
    switch (effect.type) {
      case "save":
        void runSave(effect.attempt, effect.venueId, effect.band, effect.neighbours);
        return;
      case "check":
        void runCheck(effect.attempt);
        return;
      case "publish":
        callbacks.current.onSaved(effect.entries);
        return;
      case "close":
        if (effect.reason === "refused") {
          pendingWrite.current = undefined;
          callbacks.current.onClose(undefined, "refused");
          return;
        }
        callbacks.current.onClose(effect.refresh ? pendingWrite.current ?? Promise.resolve() : undefined);
        return;
      default: {
        const unreachable: never = effect;
        return unreachable;
      }
    }
    // The effects below only ever send events back; they never set flow state.
    async function runSave(attempt: number, venueId: string, band: SocialPubBand, neighbours: ComparisonNeighbours) {
      if (!sameAccount()) return;
      let saved: { response: Response; body: unknown } | { thrown: unknown };
      try {
        const request = authedActionJson<unknown>(
          "/api/social/rankings",
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ venueId, band, ...neighbours }),
          },
          { requiresIdentity: true },
        );
        pendingWrite.current = request.then(() => undefined, () => undefined);
        saved = await request;
      } catch (thrown) {
        saved = { thrown };
      }
      if (!sameAccount()) return;
      const answer = saveAnswerFrom(saved);
      if (answer.kind === "saved") pendingWrite.current = undefined;
      send({ type: "save_answered", attempt, account: readProviderAccountRevision(), answer });
    }
    async function runCheck(attempt: number) {
      if (!reads.current) return;
      const read = await readRankings(reads.current.signal);
      if (!sameAccount()) return;
      const open = current.current.view;
      if (open.step !== "checking" || open.attempt !== attempt) return;
      let measured: ComparisonListRead = read.kind === "entries" ? { ...read, landed: false, restart: null } : read;
      if (read.kind === "entries") {
        const unsettled = open.unsettled;
        measured = unsettled.kind === "lost"
          ? { ...read, landed: rankingSaveLanded(read.entries, open.venue.id, unsettled.band, unsettled.neighbours), restart: null }
          : { ...read, landed: false, restart: planBand(read.entries, open.venue.id, unsettled.band) };
        if (measured.kind === "entries" && measured.landed) pendingWrite.current = undefined;
      }
      send({ type: "list_read", attempt, account: readProviderAccountRevision(), read: measured });
    }
  }, [sameAccount]);
  const close = useCallback(() => send({ type: "dismiss" }), [send]);
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
    send({ type: "account_changed", account: accountRevision });
  }, [accountRevision, send]);

  // Before the heading takes focus, so the trap keeps the opener to hand back.
  useFocusTrap(true, dialogRef, "strict-modal");

  const view = flow.view;
  useEffect(() => {
    headingRef.current?.focus();
  }, [view.step]);

  useEffect(() => {
    const text = query.trim();
    if (view.step !== "pick" || text.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void authedFetch(`/api/social/venues?q=${encodeURIComponent(text)}`, { credentials: "same-origin", signal: controller.signal }, { requiresIdentity: true })
        .then((response) => {
          if (response.ok) return response.json();
          discardBody(response);
          return { venues: [] };
        })
        .then((body: { venues?: ComparisonVenue[] }) => {
          if (!controller.signal.aborted && sameAccount()) setResults(body.venues ?? []);
        })
        .catch(() => {});
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, view.step, sameAccount]);

  function chooseBand(band: SocialPubBand) {
    if (view.step !== "band" || !sameAccount()) return;
    send({ type: "band_chosen", plan: planBand(flow.list, view.venue.id, band) });
  }

  function answer(preferred: "new" | "existing" | "tie") {
    if (view.step !== "compare" || !sameAccount()) return;
    send({ type: "answered", plan: planComparison(view.plan.band, answerSocialPubComparison(view.plan.session, preferred)) });
  }

  const opponent = view.step === "compare" ? flow.list.find((entry) => entry.venueId === view.plan.opponent) ?? null : null;
  const remaining = view.step === "compare"
    ? Math.max(1, Math.ceil(Math.log2(view.plan.session.high - view.plan.session.low + 1)))
    : 0;
  const notice = view.step === "pick" || view.step === "band" || view.step === "compare" ? view.notice : null;

  return createPortal(
    <div className="comparePub__scrim">
      <div ref={dialogRef} className="comparePub" role="dialog" aria-modal="true" aria-labelledby="compare-pub-title">
        <button type="button" className="comparePub__close" onClick={close} aria-label="Close">
          <X size={20} aria-hidden="true" />
        </button>

        {view.step === "pick" ? (
          <>
            <h2 id="compare-pub-title" ref={headingRef} tabIndex={-1}>Rank a pub</h2>
            <label className="comparePub__search">
              Which pub?
              <input value={query} autoComplete="off" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search pubs" />
            </label>
            <ul className="comparePub__results">
              {results.map((result) => (
                <li key={result.id}>
                  <button type="button" onClick={() => send({ type: "pick", venue: result })}>
                    <strong>{result.name}</strong>
                    {result.borough ? <span>{result.borough}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {view.step === "band" ? (
          <>
            <h2 id="compare-pub-title" ref={headingRef} tabIndex={-1}>How was {view.venue.name}?</h2>
            <div className="comparePub__bands">
              {SOCIAL_PUB_BANDS.map((option) => (
                <button key={option} type="button" data-band={option} onClick={() => chooseBand(option)}>
                  {SOCIAL_PUB_BAND_LABEL[option]}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {view.step === "compare" && opponent ? (
          <>
            <h2 id="compare-pub-title" ref={headingRef} tabIndex={-1}>Which did you prefer?</h2>
            <p className="comparePub__progress" aria-live="polite">
              Question {view.asked + 1}, about {remaining} to go
            </p>
            <div className="comparePub__pair">
              <button type="button" onClick={() => answer("new")}>
                <span className="comparePub__label">New</span>
                <strong>{view.venue.name}</strong>
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

        {view.step === "saving" || view.step === "checking" ? (
          <p id="compare-pub-title" className="comparePub__progress" role="status">
            {view.step === "saving" ? "Saving your ranking…" : "Checking your list…"}
          </p>
        ) : null}

        {view.step === "unconfirmed" ? (
          <>
            <h2 id="compare-pub-title" ref={headingRef} tabIndex={-1}>
              {view.unsettled.kind === "lost" ? "We lost the answer" : "Your list changed"}
            </h2>
            <p className="comparePub__notice">
              {view.unsettled.kind === "lost"
                ? `${view.venue.name} may have saved. Check your list before you rank anything else.`
                : "It changed in another tab, and the new list did not load. Check again before the next question."}
            </p>
            <div className="comparePub__actions">
              <button type="button" onClick={close}>Close</button>
              <button type="button" className="comparePub__primary" onClick={() => send({ type: "check_again" })}>Check again</button>
            </div>
          </>
        ) : null}

        {view.step === "done" ? (
          <>
            <h2 id="compare-pub-title" ref={headingRef} tabIndex={-1}>{view.venue.name} is in</h2>
            {view.placed ? (
              <p className="comparePub__result">
                <span className="comparePub__place">#{view.placed.place}</span>
                <span className="comparePub__score">{formatScore(view.placed.score)}</span>
                <span>{SOCIAL_PUB_BAND_LABEL[view.placed.band]}</span>
              </p>
            ) : null}
            <div className="comparePub__actions">
              <button type="button" onClick={() => { setQuery(""); setResults([]); send({ type: "rank_another" }); }}>Rank another</button>
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
