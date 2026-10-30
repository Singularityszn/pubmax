"use client";

// "Log this visit": the Diary composer on a venue sheet. One tap opens a
// compact card: the day (today by default), a half-star rating and one short
// line. An entry is private to its owner in Phase 1, and the card says so.

import { useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import {
  useAccountScopedDraft,
  useContributionGate,
} from "@/components/identity/ContributionGateDialog";
import RankAfterVisitCard from "@/components/pubs/RankAfterVisitCard";
import WithTagField from "@/components/map/composer/WithTagField";
import { useTellYourLot } from "@/components/pubs/useTellYourLot";
import StarRating from "@/components/ratings/StarRating";
import {
  accountComposerAuth,
  sameAccountAuth,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import {
  DIARY_EARLIEST_VISITED_ON,
  MAX_DIARY_REVIEW,
  MAX_DIARY_USUAL_DRINK,
  clampDiaryReviewInput,
  clampDiaryUsualDrinkInput,
  diaryReviewLength,
  diaryVisitedOnLabel,
  latestDiaryVisitedOn,
} from "@/lib/diary";
import type { RatingValue } from "@/lib/ratings";

import { postDiaryEntry } from "./diaryClient";

import "@/components/visits/visitReports.css";
import "./diary.css";

export type DiaryLogPanelProps = {
  venueId: string;
  venueName: string;
};

type DiaryDraft = {
  visitedOn: string;
  rating: RatingValue | null;
  review: string;
  /** "Your usual here". Absent on a draft saved before the field existed. */
  usualDrink?: string;
  /** "With": names, and `@handles` that are asked first. */
  withWho?: string;
};

// A panel belongs to ONE pub: keying the mount drops the previous pub's
// half-typed draft and any in-flight write when the map sheet switches pins.
export default function DiaryLogPanel({ venueId, venueName }: DiaryLogPanelProps) {
  return <VenueDiaryLog key={venueId} venueId={venueId} venueName={venueName} />;
}

function VenueDiaryLog({ venueId, venueName }: DiaryLogPanelProps) {
  const latest = latestDiaryVisitedOn();
  const { user, session, rejectedContributionAuth } = useAuth();
  const viewerSession = useViewerSession();
  const { requestContribution, contributionGateDialog } = useContributionGate();
  const [openAuth, setOpenAuth] = useState<AccountAuthSnapshot | null>(null);
  const [draft, setDraft, clearDraft] = useAccountScopedDraft<DiaryDraft>(
    user?.id ?? null,
    () => ({ visitedOn: latest, rating: null, review: "" }),
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  // The receipt's rank card appears after a log lands, under the receipt line.
  const [logged, setLogged] = useState(false);
  const [tellYourLot, setTellYourLot] = useTellYourLot();
  const composerAuth = accountComposerAuth(
    user?.id ?? null,
    session,
    rejectedContributionAuth,
  );
  const open = sameAccountAuth(openAuth, composerAuth);
  const visitedOn = draft?.visitedOn ?? latest;
  const rating = draft?.rating ?? null;
  const review = draft?.review ?? "";
  const usualDrink = draft?.usualDrink ?? "";
  const withWho = draft?.withWho ?? "";

  async function submit() {
    if (!draft || !composerAuth) return;
    if (!visitedOn || visitedOn > latest || visitedOn < DIARY_EARLIEST_VISITED_ON) {
      setFeedback({
        kind: "error",
        text: "Pick the day you were there. It cannot be in the future.",
      });
      return;
    }
    setFeedback(null);
    await requestContribution(async (auth) => {
      if (!sameAccountAuth(auth, composerAuth)) {
        return { status: "sign_in_required" };
      }
      setSaving(true);
      try {
        const result = await postDiaryEntry(
          {
            venueId,
            visitedOn,
            rating,
            review: review.trim(),
            usualDrink: usualDrink.trim(),
            ...(withWho.trim() ? { withWho: withWho.trim() } : {}),
            ...(tellYourLot ? { shareToLot: true } : {}),
          },
          auth,
        );
        if (!result.ok) {
          if (result.status) {
            return { status: result.status, error: result.error };
          }
          setFeedback({ kind: "error", text: result.error });
          return;
        }
        clearDraft();
        setOpenAuth((current) => (sameAccountAuth(current, auth) ? null : current));
        const lotLine = !tellYourLot
          ? ""
          : result.shared
            ? " Your lot will see you were here."
            : " It stayed private: we could not tell your lot this time.";
        const tagLine =
          result.tagsSent === undefined
            ? ""
            : result.tagsSent
              ? " Anyone you tagged gets asked first."
              : " We could not ask the people you tagged. Tagging needs your Social account.";
        setFeedback({
          kind: "ok",
          text: `Logged ${venueName} for ${diaryVisitedOnLabel(result.entry.visitedOn)}. It's in your diary.${lotLine}${tagLine}`,
        });
        setLogged(true);
      } catch (error) {
        setFeedback({
          kind: "error",
          text:
            error instanceof Error
              ? error.message
              : "Couldn't log this visit just now.",
        });
      } finally {
        setSaving(false);
      }
    });
  }

  const headingId = `diaryLog-${venueId}`;

  return (
    <section className="diaryLogPanel visitReportPanel" aria-labelledby={headingId}>
      <div className="visitReportHead">
        <div>
          <span className="visitReportLabel">Your diary</span>
          <h3 id={headingId} className="visitReportTitle">
            Been here?
          </h3>
        </div>
        {open ? null : (
          <button
            type="button"
            className="visitReportOpen"
            data-testid="diary-log-open"
            onClick={() => {
              void requestContribution((auth) => {
                if (!sameAccountAuth(auth, composerAuth)) {
                  return { status: "sign_in_required" };
                }
                setOpenAuth(auth);
              });
            }}
          >
            {/* A null user is not sign-out: the sign-in label waits for the
                live session to answer (components/auth/useViewerSession.ts). */}
            {composerAuth || viewerSession.unresolved
              ? "Log this visit"
              : "Sign in to log a visit"}
          </button>
        )}
      </div>

      {open ? (
        <div className="visitReportCard" data-testid="diary-log-card">
          <div className="visitReportCardHead">
            <div>
              <span className="visitReportCardTitle">How was {venueName}?</span>
              <p>Pick a rating if you want one. Add a line if it helps.</p>
            </div>
            <button
              type="button"
              className="visitReportDismiss"
              aria-label="Close diary entry"
              onClick={() => setOpenAuth(null)}
            >
              ×
            </button>
          </div>

          <label className="visitReportDate">
            <span>When were you there?</span>
            <input
              type="date"
              value={visitedOn}
              min={DIARY_EARLIEST_VISITED_ON}
              max={latest}
              onChange={(event) =>
                setDraft((current) => ({ ...current, visitedOn: event.target.value }))
              }
            />
          </label>

          <div className="diaryRatingField">
            <span className="diaryRatingLabel">Your rating</span>
            <div className="diaryRatingRow">
              <StarRating
                value={rating}
                label={`Your rating of ${venueName}`}
                interactive
                onRate={(next) => setDraft((current) => ({ ...current, rating: next }))}
              />
              <span className="diaryRatingValue" aria-live="polite">
                {rating === null ? "Not rated" : `${rating} / 5`}
              </span>
              {rating === null ? null : (
                <button
                  type="button"
                  className="diaryRatingClear"
                  onClick={() => setDraft((current) => ({ ...current, rating: null }))}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <label className="visitReportNoteWrap">
            <span>One short line</span>
            <textarea
              className="visitReportNote"
              value={review}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  review: clampDiaryReviewInput(event.target.value),
                }))
              }
              rows={3}
              placeholder="What do you want to remember about it?"
            />
            <small>{MAX_DIARY_REVIEW - diaryReviewLength(review)} characters left</small>
          </label>

          <label className="visitReportNoteWrap">
            <span>Your usual here</span>
            <input
              className="diaryUsualInput"
              data-testid="diary-usual"
              type="text"
              value={usualDrink}
              maxLength={MAX_DIARY_USUAL_DRINK * 2}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  usualDrink: clampDiaryUsualDrinkInput(event.target.value),
                }))
              }
              placeholder="A drink name, if you have one"
              autoComplete="off"
            />
          </label>

          <WithTagField
            value={withWho}
            onChange={(next) => setDraft((current) => ({ ...current, withWho: next }))}
            tagsAllowed
            subject="diary"
          />

          <label className="diaryLotToggle">
            <input
              type="checkbox"
              data-testid="diary-tell-your-lot"
              checked={tellYourLot}
              onChange={(event) => setTellYourLot(event.currentTarget.checked)}
            />
            <span>
              Tell your lot
              <small>
                Your mutuals see one line saying you were here. Your rating,
                words, usual and names stay private.
              </small>
            </span>
          </label>

          <button
            type="button"
            className="visitReportSubmit"
            data-testid="diary-log-submit"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Log visit"}
          </button>
          <p className="visitReportTrust">
            Only you can see your diary. It is a record of where you went and what
            you thought, not of what you drank.
          </p>
        </div>
      ) : null}

      {feedback ? (
        <p
          className={feedback.kind === "error" ? "visitReportError" : "visitReportOk"}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      ) : null}
      {/* Rank at the moment: below the receipt line, never in front of it. */}
      {logged ? <RankAfterVisitCard visits={[{ venueId, venueName }]} /> : null}
      {contributionGateDialog}
    </section>
  );
}
