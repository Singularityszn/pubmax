"use client";

// Rank at the moment (design record V3, "Rank card"): after a visit, one
// inline card asks "Which did you prefer?" with two pub names and their listed
// prices, plus "Too close to call" and "Skip". It is the pairwise compare the
// Social page opens (ComparePubFlow), cut to three questions per visit, so a
// long list costs three taps and the pub lands near where it belongs.
//
// It is a guest below a receipt, never a gate in front of it: it renders
// nothing until the viewer is known to be signed in and their list has
// answered, and nothing at all for a signed-out viewer or one Social refuses.
// No score and no aggregate: the card shows names and listed prices only.
//
// Given several visits (the stops of a finished night) it offers them one by
// one, skipping a pub already on the list.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useViewerSession } from "@/components/auth/useViewerSession";
import { authedActionJson, authedFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { formatGbp } from "@/lib/formatGbp";
import { readProviderAccountRevision, subscribeProviderIdentityRevision } from "@/lib/authProviderRevision";
import {
  answerSocialPubComparison,
  nextSocialPubOpponent,
  RANK_AFTER_VISIT_MAX_COMPARISONS,
  SOCIAL_PUB_BAND_LABEL,
  SOCIAL_PUB_BANDS,
  settleSocialPubComparison,
  socialPubComparisonNeighbours,
  startSocialPubComparison,
  type SocialPubBand,
  type SocialPubComparison,
} from "@/lib/socialPubRankings";
import {
  startVisitRanking, transitionVisitRanking, visitRankingBusy,
  type VisitRankingEventInput, type VisitRankingRead, type VisitRankingSave,
} from "@/lib/rankAfterVisitState";

import { useTellYourLot } from "./useTellYourLot";
import {
  rankingSubject,
  socialPubRankingPayload,
  socialPubRankingReadFailure,
  socialPubRankingSaveAnswer,
} from "@/lib/rankAfterVisitCheckpoint";

import "./rankAfterVisit.css";

export type RankVisit = { venueId: string; venueName: string };

function priceLine(price: number | null | undefined): string {
  return typeof price === "number" ? formatGbp(price) : "No price listed";
}

async function readList(venueId: string, signal: AbortSignal): Promise<VisitRankingRead> {
  try {
    const response = await authedFetch(
      `/api/social/rankings?venue=${encodeURIComponent(venueId)}`,
      { credentials: "same-origin", cache: "no-store", signal },
      { requiresIdentity: true },
    );
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { kind: socialPubRankingReadFailure(response.status, body) };
    const entries = socialPubRankingPayload(body);
    const subject = rankingSubject(body);
    return entries && subject !== "unavailable"
      ? { kind: "entries", list: { entries, subject } } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

export default function RankAfterVisitCard({ visits }: { visits: readonly RankVisit[] }) {
  const { signedIn } = useViewerSession();
  const accountRevision = useSyncExternalStore(subscribeProviderIdentityRevision, readProviderAccountRevision, () => 0);
  if (!signedIn || visits.length === 0) return null;
  return <RankAfterVisit key={accountRevision} visits={visits} accountRevision={accountRevision} />;
}

function RankAfterVisit({ visits, accountRevision }: { visits: readonly RankVisit[]; accountRevision: number }) {
  const [index, setIndex] = useState(0);
  const skip = useCallback(() => setIndex((current) => current + 1), []);
  const visit = visits[index];
  return visit ? <VisitRanking key={visit.venueId} visit={visit} nextVisit={visits[index + 1]} onSkip={skip} accountRevision={accountRevision} /> : null;
}

function VisitRanking({ visit, nextVisit, onSkip, accountRevision }: {
  visit: RankVisit;
  nextVisit?: RankVisit;
  onSkip: () => void;
  accountRevision: number;
}) {
  const visitId = visit.venueId;
  const [phase, setPhase] = useState(() => startVisitRanking({ venueId: visitId, accountRevision }));
  const currentPhase = useRef(phase);
  const [tellYourLot, setTellYourLot] = useTellYourLot();
  const scope = useRef<AbortController | null>(null);

  const send = useCallback((event: VisitRankingEventInput) => {
    const next = transitionVisitRanking(currentPhase.current, { ...event, venueId: visitId, accountRevision }, RANK_AFTER_VISIT_MAX_COMPARISONS);
    if (next !== currentPhase.current) {
      currentPhase.current = next;
      setPhase(next);
    }
    return next;
  }, [accountRevision, visitId]);

  const readInitial = useCallback(async (controller: AbortController, requestId: number) => {
    const result = await readList(visitId, controller.signal);
    if (controller.signal.aborted || readProviderAccountRevision() !== accountRevision) return;
    if (currentPhase.current.kind !== "loading" || currentPhase.current.requestId !== requestId) return;
    if (result.kind === "entries") {
      const { subject, entries } = result.list;
      if (!subject || entries.some((entry) => entry.venueId === visitId || entry.venueId === subject.venueId)) {
        controller.abort();
        onSkip();
        return;
      }
    }
    send({ type: "read", requestId, result });
  }, [accountRevision, onSkip, send, visitId]);

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    void readInitial(controller, currentPhase.current.requestId);
    return () => controller.abort();
  }, [readInitial]);

  if (phase.kind === "refused" || phase.kind === "loading") return null;
  const loaded = "loaded" in phase ? phase.loaded : null;
  const entries = loaded?.entries ?? [];
  const subject = loaded?.subject;
  const venueName = subject?.venueName ?? visit.venueName;
  const venueId = subject?.venueId ?? visitId;

  function ownsRequest() {
    return scope.current !== null && !scope.current.signal.aborted && readProviderAccountRevision() === accountRevision;
  }

  function retire(requestId: number) {
    send({ type: "refused", requestId });
    scope.current?.abort();
  }

  function skip() {
    if (visitRankingBusy(currentPhase.current) || !ownsRequest()) return;
    scope.current?.abort();
    onSkip();
  }

  async function reconcile(pending: VisitRankingSave) {
    if (!ownsRequest()) return;
    const previous = currentPhase.current;
    const checking = send({ type: "check", pending });
    if (checking === previous || checking.kind !== "checking") return;
    const result = await readList(visitId, scope.current!.signal);
    if (!ownsRequest()) return;
    send({ type: "read", requestId: checking.requestId, result });
    if (result.kind === "refused") scope.current?.abort();
  }

  async function save(band: SocialPubBand, settled: SocialPubComparison) {
    if (visitRankingBusy(currentPhase.current) || !ownsRequest()) return;
    const saving = send({ type: "save" });
    if (saving.kind !== "saving") return;
    const pending: VisitRankingSave = { band, neighbours: socialPubComparisonNeighbours(settled), shareRequested: tellYourLot, uncertain: true };
    try {
      const { response, body } = await authedActionJson<unknown>(
        "/api/social/rankings",
        {
          method: "POST", credentials: "same-origin", signal: scope.current!.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ venueId, band, ...pending.neighbours, ...(pending.shareRequested ? { shareToLot: true } : {}) }),
        },
        { requiresIdentity: true },
      );
      if (!ownsRequest()) return;
      const saved = response.ok ? socialPubRankingPayload(body) : null;
      if (saved?.some((entry) => entry.venueId === venueId && entry.band === band)) {
        const shared = (body as { shared?: unknown }).shared;
        send({ type: "saved", requestId: saving.requestId, entries: saved,
          shared: pending.shareRequested && typeof shared === "boolean" ? shared : null });
        return;
      }
      const outcome = socialPubRankingSaveAnswer(response.status, body);
      if (outcome === "refused") { retire(saving.requestId); return; }
      if (outcome === "rejected") {
        send({ type: "rejected", requestId: saving.requestId,
          notice: errorMessageFrom(body, "That ranking did not save. Try again.") });
        return;
      }
      await reconcile({ ...pending, uncertain: outcome !== "stale" });
    } catch (cause) {
      if (!ownsRequest()) return;
      if ((cause as { code?: unknown } | null)?.code === "AUTH_SESSION_WAKING") {
        send({ type: "rejected", requestId: saving.requestId,
          notice: cause instanceof Error ? cause.message : "Still waking your session. Try again." });
        return;
      }
      await reconcile(pending);
    }
  }

  function begin(band: SocialPubBand) {
    const current = currentPhase.current;
    if (current.kind !== "band" || !ownsRequest()) return;
    const inBand = entries.filter((entry) => entry.band === band).map((entry) => entry.venueId);
    const session = startSocialPubComparison(inBand, venueId);
    if (nextSocialPubOpponent(session) === null || current.asked >= RANK_AFTER_VISIT_MAX_COMPARISONS) {
      void save(band, settleSocialPubComparison(session));
    } else send({ type: "compare", band, session });
  }

  function answer(preferred: "new" | "existing" | "tie") {
    const current = currentPhase.current;
    if (current.kind !== "compare" || !ownsRequest()) return;
    const next = answerSocialPubComparison(current.session, preferred);
    const advanced = send({ type: "answer", session: next });
    if (advanced === current) return;
    if (nextSocialPubOpponent(next) === null || advanced.asked >= RANK_AFTER_VISIT_MAX_COMPARISONS) {
      void save(current.band, settleSocialPubComparison(next));
    }
  }

  const opponentId = phase.kind === "compare" ? nextSocialPubOpponent(phase.session) : null;
  const opponent = opponentId ? entries.find((entry) => entry.venueId === opponentId) ?? null : null;
  const headingId = `rankAfterVisit-${venueId}`;

  return (
    <section className="rankAfterVisit" aria-labelledby={headingId} data-testid="rank-after-visit">
      {phase.kind === "band" ? (
        <>
          <h3 id={headingId} className="rankAfterVisit__title">How was {venueName}?</h3>
          <p className="rankAfterVisit__lede">Rank it against your other pubs. Only you see your list.</p>
          <div className="rankAfterVisit__bands">
            {SOCIAL_PUB_BANDS.map((band) => (
              <button key={band} type="button" data-band={band} onClick={() => begin(band)}>
                {SOCIAL_PUB_BAND_LABEL[band]}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {phase.kind === "compare" && opponent ? (
        <>
          <h3 id={headingId} className="rankAfterVisit__title">Which did you prefer?</h3>
          <div className="rankAfterVisit__pair">
            <button type="button" data-testid="rank-after-visit-new" onClick={() => answer("new")}>
              <strong>{venueName}</strong>
              <span>{priceLine(subject?.listedPrice)}</span>
            </button>
            <button type="button" data-testid="rank-after-visit-existing" onClick={() => answer("existing")}>
              <strong>{opponent.venueName ?? "A pub you ranked"}</strong>
              <span>{priceLine(opponent.listedPrice)}</span>
            </button>
          </div>
          <button type="button" className="rankAfterVisit__quiet" onClick={() => answer("tie")}>
            Too close to call
          </button>
        </>
      ) : null}

      {phase.kind === "saving" || phase.kind === "checking" ? (
        <p id={headingId} className="rankAfterVisit__lede" role="status">{phase.kind === "checking" ? "Checking your ranking…" : "Saving your ranking…"}</p>
      ) : null}

      {phase.kind === "unavailable" || phase.kind === "recover" ? (
        <>
          <p id={headingId} className="rankAfterVisit__lede" role="status">
            {phase.kind === "recover" ? "We could not confirm your ranking. Check your list before ranking again." : "Your ranking is unavailable right now."}
          </p>
          <button type="button" className="rankAfterVisit__quiet" data-testid="rank-after-visit-retry" onClick={() => {
            if (visitRankingBusy(currentPhase.current) || !ownsRequest()) return;
            if (currentPhase.current.kind === "recover") void reconcile(currentPhase.current.pending);
            else {
              const retrying = send({ type: "retry" });
              if (retrying.kind === "loading" && scope.current) void readInitial(scope.current, retrying.requestId);
            }
          }}>
            Check your list
          </button>
          <button type="button" className="rankAfterVisit__quiet" data-testid="rank-after-visit-skip" onClick={skip}>Skip</button>
        </>
      ) : null}

      {phase.kind === "done" ? (
        <>
          <p id={headingId} className="rankAfterVisit__lede" role="status">
            {venueName} is in your pubs, ranked.
            {phase.shared === true ? " Your lot will see it." : null}
            {phase.shared === false ? " It stayed private this time." : null}
          </p>
          {nextVisit ? (
            <button type="button" className="rankAfterVisit__quiet" onClick={skip}>
              Next: {nextVisit.venueName}
            </button>
          ) : null}
        </>
      ) : null}

      {phase.kind === "band" || phase.kind === "compare" ? (
        <div className="rankAfterVisit__foot">
          <label className="rankAfterVisit__lot">
            <input
              type="checkbox"
              checked={tellYourLot}
              onChange={(event) => setTellYourLot(event.currentTarget.checked)}
            />
            <span>
              Tell your lot
              <small>Your mutuals see one line saying you ranked it.</small>
            </span>
          </label>
          <button type="button" className="rankAfterVisit__quiet" data-testid="rank-after-visit-skip" onClick={skip}>
            Skip
          </button>
        </div>
      ) : null}

      {phase.notice ? <p className="rankAfterVisit__notice" role="status">{phase.notice}</p> : null}
    </section>
  );
}
