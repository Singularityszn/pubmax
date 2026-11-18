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
  type SocialPubRankingEntry,
} from "@/lib/socialPubRankings";

import { useTellYourLot } from "./useTellYourLot";
import {
  rankingSubject,
  socialPubRankingPayload,
  socialPubRankingReadFailure,
  socialPubRankingSaveAnswer,
  type RankSubject,
} from "./rankAfterVisitCheckpoint";

import "./rankAfterVisit.css";

export type RankVisit = { venueId: string; venueName: string };

type Loaded = { entries: SocialPubRankingEntry[]; subject: RankSubject | null };
type PendingSave = {
  band: SocialPubBand;
  neighbours: { aboveVenueId: string | null; belowVenueId: string | null };
  shareRequested: boolean;
  uncertain: boolean;
};
type Phase =
  | { kind: "loading" | "unavailable" | "band" | "saving" }
  | { kind: "compare"; band: SocialPubBand; session: SocialPubComparison }
  | { kind: "checking" | "recover"; pending: PendingSave }
  | { kind: "done"; shared: boolean | null };
type ListRead = { kind: "entries"; list: Loaded } | { kind: "refused" | "unavailable" };

function priceLine(price: number | null | undefined): string {
  return typeof price === "number" ? formatGbp(price) : "No price listed";
}

async function readList(venueId: string, signal: AbortSignal): Promise<ListRead> {
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
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [refused, setRefused] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const currentPhase = useRef(phase);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [tellYourLot, setTellYourLot] = useTellYourLot();
  const scope = useRef<AbortController | null>(null);
  const busy = useRef(true);
  const asked = useRef(0);
  const visitId = visit.venueId;

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    busy.current = true;
    void readList(visitId, controller.signal).then((result) => {
      if (controller.signal.aborted || readProviderAccountRevision() !== accountRevision) return;
      busy.current = false;
      if (result.kind !== "entries") {
        if (result.kind === "refused") setRefused(true);
        else setPhase({ kind: "unavailable" });
        return;
      }
      const { subject, entries } = result.list;
      if (!subject || entries.some((entry) => entry.venueId === visitId || entry.venueId === subject.venueId)) {
        controller.abort();
        onSkip();
        return;
      }
      setLoaded(result.list);
      currentPhase.current = { kind: "band" };
      setPhase(currentPhase.current);
    });
    return () => controller.abort();
  }, [visitId, accountRevision, loadAttempt, onSkip]);

  if (refused || phase.kind === "loading") return null;
  const entries = loaded?.entries ?? [];
  const subject = loaded?.subject;
  const venueName = subject?.venueName ?? visit.venueName;
  const venueId = subject?.venueId ?? visitId;

  function ownsRequest() {
    return scope.current !== null && !scope.current.signal.aborted && readProviderAccountRevision() === accountRevision;
  }

  function move(next: Phase) {
    currentPhase.current = next;
    setPhase(next);
  }

  function retire() {
    scope.current?.abort();
    setLoaded(null);
    setNotice(null);
    setRefused(true);
  }

  function skip() {
    if (busy.current || !ownsRequest()) return;
    scope.current?.abort();
    onSkip();
  }

  async function reconcile(pending: PendingSave) {
    if (!ownsRequest()) return;
    busy.current = true;
    move({ kind: "checking", pending });
    setNotice(null);
    const result = await readList(visitId, scope.current!.signal);
    if (!ownsRequest()) return;
    busy.current = false;
    if (result.kind === "refused") { retire(); return; }
    if (result.kind === "unavailable") {
      move({ kind: "recover", pending });
      return;
    }
    const fresh = result.list;
    setLoaded({ ...fresh, subject: fresh.subject ?? subject ?? null });
    const inBand = fresh.entries.filter((entry) => entry.band === pending.band).map((entry) => entry.venueId);
    const position = inBand.indexOf(venueId);
    const landed = position !== -1 && (inBand[position - 1] ?? null) === pending.neighbours.aboveVenueId &&
      (inBand[position + 1] ?? null) === pending.neighbours.belowVenueId;
    if (pending.uncertain && landed) {
      move({ kind: "done", shared: null });
      if (pending.shareRequested) setNotice("We could not confirm whether your lot saw it.");
    } else {
      move({ kind: "band" });
      setNotice(pending.uncertain ? "Your list is checked. Choose how to rank it again." : "Your list changed in another tab. One more go.");
    }
  }

  async function save(band: SocialPubBand, settled: SocialPubComparison) {
    if (busy.current || !ownsRequest()) return;
    busy.current = true;
    move({ kind: "saving" });
    setNotice(null);
    const pending: PendingSave = { band, neighbours: socialPubComparisonNeighbours(settled), shareRequested: tellYourLot, uncertain: true };
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
        busy.current = false;
        setLoaded({ entries: saved, subject: subject ?? null });
        const shared = (body as { shared?: unknown }).shared;
        move({ kind: "done", shared: pending.shareRequested && typeof shared === "boolean" ? shared : null });
        return;
      }
      const outcome = socialPubRankingSaveAnswer(response.status, body);
      if (outcome === "refused") { retire(); return; }
      if (outcome === "rejected") {
        busy.current = false;
        setNotice(errorMessageFrom(body, "That ranking did not save. Try again."));
        move({ kind: "band" });
        return;
      }
      await reconcile({ ...pending, uncertain: outcome !== "stale" });
    } catch (cause) {
      if (!ownsRequest()) return;
      if ((cause as { code?: unknown } | null)?.code === "AUTH_SESSION_WAKING") {
        busy.current = false;
        setNotice(cause instanceof Error ? cause.message : "Still waking your session. Try again.");
        move({ kind: "band" });
        return;
      }
      await reconcile(pending);
    }
  }

  function begin(band: SocialPubBand) {
    if (!loaded || busy.current || !ownsRequest() || currentPhase.current.kind !== "band") return;
    const inBand = entries.filter((entry) => entry.band === band).map((entry) => entry.venueId);
    const session = startSocialPubComparison(inBand, venueId);
    setNotice(null);
    if (nextSocialPubOpponent(session) === null || asked.current >= RANK_AFTER_VISIT_MAX_COMPARISONS) {
      void save(band, settleSocialPubComparison(session));
    } else move({ kind: "compare", band, session });
  }

  function answer(preferred: "new" | "existing" | "tie") {
    const current = currentPhase.current;
    if (current.kind !== "compare" || busy.current || !ownsRequest()) return;
    const next = answerSocialPubComparison(current.session, preferred);
    asked.current += 1;
    if (nextSocialPubOpponent(next) === null || asked.current >= RANK_AFTER_VISIT_MAX_COMPARISONS) {
      void save(current.band, settleSocialPubComparison(next));
    } else move({ ...current, session: next });
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
            if (busy.current || !ownsRequest()) return;
            if (phase.kind === "recover") void reconcile(phase.pending);
            else { busy.current = true; move({ kind: "loading" }); setLoadAttempt((attempt) => attempt + 1); }
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

      {notice ? <p className="rankAfterVisit__notice" role="status">{notice}</p> : null}
    </section>
  );
}
