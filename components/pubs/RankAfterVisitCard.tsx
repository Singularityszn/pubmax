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

import { useEffect, useState } from "react";

import { useViewerSession } from "@/components/auth/useViewerSession";
import { authedActionJson, authedFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { formatGbp } from "@/lib/formatGbp";
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

import "./rankAfterVisit.css";

export type RankVisit = { venueId: string; venueName: string };

type Subject = { venueId: string; venueName: string; listedPrice: number | null };

type Loaded = {
  /** The visit this read belongs to, so a stale read never paints the next pub. */
  forVenueId: string;
  entries: SocialPubRankingEntry[];
  subject: Subject | null;
};

type Phase =
  | { kind: "band" }
  | { kind: "compare"; band: SocialPubBand; session: SocialPubComparison; asked: number }
  | { kind: "saving" }
  | { kind: "done"; shared: boolean | null };

function priceLine(price: number | null | undefined): string {
  return typeof price === "number" ? formatGbp(price) : "No price listed";
}

async function readList(venueId: string): Promise<Omit<Loaded, "forVenueId"> | null> {
  try {
    const response = await authedFetch(
      `/api/social/rankings?venue=${encodeURIComponent(venueId)}`,
      { credentials: "same-origin" },
      { requiresIdentity: true },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { entries?: SocialPubRankingEntry[]; subject?: Subject };
    return { entries: body.entries ?? [], subject: body.subject ?? null };
  } catch {
    return null;
  }
}

export default function RankAfterVisitCard({ visits }: { visits: readonly RankVisit[] }) {
  const { signedIn } = useViewerSession();
  if (!signedIn || visits.length === 0) return null;
  return <RankAfterVisit visits={visits} />;
}

function RankAfterVisit({ visits }: { visits: readonly RankVisit[] }) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Social said no (not verified, unavailable): the card stays away.
  const [refused, setRefused] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "band" });
  const [notice, setNotice] = useState<string | null>(null);
  const [tellYourLot, setTellYourLot] = useTellYourLot();
  const visit = visits[index] ?? null;
  const visitId = visit?.venueId ?? null;

  useEffect(() => {
    if (!visitId) return;
    let active = true;
    void readList(visitId).then((list) => {
      if (!active) return;
      if (!list) {
        setRefused(true);
        return;
      }
      // Not a listed pub, or a pub already on the list: offer the next one.
      const subject = list.subject;
      if (!subject || list.entries.some((entry) => entry.venueId === visitId || entry.venueId === subject.venueId)) {
        setIndex((current) => current + 1);
        return;
      }
      setPhase({ kind: "band" });
      setNotice(null);
      setLoaded({ forVenueId: visitId, ...list });
    });
    return () => {
      active = false;
    };
  }, [visitId]);

  if (refused || !visit || loaded?.forVenueId !== visit.venueId) return null;
  const { entries, subject } = loaded;
  const venueName = subject?.venueName ?? visit.venueName;
  const venueId = subject?.venueId ?? visit.venueId;
  const nextVisit = visits[index + 1] ?? null;

  function skip() {
    setIndex((current) => current + 1);
  }

  async function save(band: SocialPubBand, settled: SocialPubComparison, asked: number) {
    setPhase({ kind: "saving" });
    setNotice(null);
    try {
      const { response, body } = await authedActionJson<{
        entries?: SocialPubRankingEntry[];
        shared?: boolean;
        code?: string;
        error?: string;
      }>(
        "/api/social/rankings",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            venueId,
            band,
            ...socialPubComparisonNeighbours(settled),
            ...(tellYourLot ? { shareToLot: true } : {}),
          }),
        },
        { requiresIdentity: true },
      );
      if (response.status === 409 && body.code === "STALE_RANKING") {
        const fresh = await readList(visit.venueId);
        if (!fresh) throw new Error("That ranking did not save. Try again.");
        setLoaded({ forVenueId: visit.venueId, ...fresh });
        setNotice("Your list changed in another tab. One more go.");
        begin(band, fresh.entries, asked);
        return;
      }
      if (!response.ok || !body.entries) {
        throw new Error(errorMessageFrom(body, "That ranking did not save. Try again."));
      }
      setPhase({ kind: "done", shared: tellYourLot ? body.shared === true : null });
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "That ranking did not save. Try again.");
      setPhase({ kind: "band" });
    }
  }

  function begin(band: SocialPubBand, from: readonly SocialPubRankingEntry[] = entries, asked = 0) {
    const inBand = from.filter((entry) => entry.band === band).map((entry) => entry.venueId);
    const session = startSocialPubComparison(inBand, venueId);
    if (nextSocialPubOpponent(session) === null) {
      void save(band, session, asked);
      return;
    }
    if (asked >= RANK_AFTER_VISIT_MAX_COMPARISONS) {
      void save(band, settleSocialPubComparison(session), asked);
      return;
    }
    setPhase({ kind: "compare", band, session, asked });
  }

  function answer(preferred: "new" | "existing" | "tie") {
    if (phase.kind !== "compare") return;
    const next = answerSocialPubComparison(phase.session, preferred);
    const asked = phase.asked + 1;
    if (nextSocialPubOpponent(next) === null) {
      void save(phase.band, next, asked);
    } else if (asked >= RANK_AFTER_VISIT_MAX_COMPARISONS) {
      void save(phase.band, settleSocialPubComparison(next), asked);
    } else {
      setPhase({ ...phase, session: next, asked });
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

      {phase.kind === "saving" ? (
        <p id={headingId} className="rankAfterVisit__lede" role="status">Saving your ranking…</p>
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
