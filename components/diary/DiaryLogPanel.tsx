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
import StarRating from "@/components/ratings/StarRating";
import {
  accountComposerAuth,
  sameAccountAuth,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import {
  DIARY_EARLIEST_VISITED_ON,
  MAX_DIARY_REVIEW,
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
  const composerAuth = accountComposerAuth(
    user?.id ?? null,
    session,
    rejectedContributionAuth,
  );
  const open = sameAccountAuth(openAuth, composerAuth);
  const visitedOn = draft?.visitedOn ?? latest;
  const rating = draft?.rating ?? null;
  const review = draft?.review ?? "";

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
          { venueId, visitedOn, rating, review: review.trim() },
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
        setFeedback({
          kind: "ok",
          text: `Logged ${venueName} for ${diaryVisitedOnLabel(result.entry.visitedOn)}. It is in your diary.`,
        });
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
                  review: event.target.value.slice(0, MAX_DIARY_REVIEW),
                }))
              }
              maxLength={MAX_DIARY_REVIEW}
              rows={3}
              placeholder="What do you want to remember about it?"
            />
            <small>{MAX_DIARY_REVIEW - review.length} characters left</small>
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
      {contributionGateDialog}
    </section>
  );
}
