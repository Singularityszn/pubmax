"use client";

// Your diary, on your own profile: every visit you logged, newest day first.
// Private in Phase 1, so it mounts on the owner's page only and reads the
// owner-only GET /api/diary. Rows are keyed to the account that fetched them,
// so a sign-out or an account switch never paints the previous account's log.

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import ContributionGateDoor from "@/components/identity/ContributionGateDoor";
import PintDropWithLine from "@/components/map/composer/PintDropWithLine";
import StarRating from "@/components/ratings/StarRating";
import { authedFetch } from "@/lib/authedFetch";
import {
  clampDiaryReviewInput,
  clampDiaryUsualDrinkInput,
  compareDiaryEntries,
  DIARY_EARLIEST_VISITED_ON,
  diaryReviewLength,
  latestDiaryVisitedOn,
  MAX_DIARY_REVIEW,
  MAX_DIARY_USUAL_DRINK,
} from "@/lib/diary";
import { parseDiaryWithTags, parseWithSummary } from "@/lib/pintDropWithTags";
import {
  readContributionDoor,
  type ContributionDoorStatus,
} from "@/lib/contributionGateStatus";
import { diaryVisitedOnLabel, type DiaryEntryDTO } from "@/lib/diary";
import type { RatingValue } from "@/lib/ratings";
import { venueMapUrl } from "@/lib/venueMapUrl";

import { deleteDiaryEntry, updateDiaryEntry } from "./diaryClient";

import "@/components/visits/visitReports.css";
import "./diary.css";

type DiaryRead = {
  userId: string;
  // "gated" is not a failure: an account that has not tapped "I'm 18 or over"
  // has no diary to open yet, so the read answers the gate as data and the
  // panel shows its door.
  status: "ready" | "degraded" | "error" | "gated";
  door?: ContributionDoorStatus;
  entries: DiaryEntryDTO[];
};

function mapUrlFor(venueId: string): string {
  try {
    return venueMapUrl(venueId);
  } catch {
    return `/map?sel=${encodeURIComponent(venueId)}`;
  }
}

export default function DiaryList(): React.JSX.Element | null {
  const { user } = useAuth();
  const viewerSession = useViewerSession();
  const userId = viewerSession.signedIn ? user?.id ?? null : null;
  const [read, setRead] = useState<DiaryRead | null>(null);
  // Bumped when the one tap is recorded, so the diary is read again.
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await authedFetch(
          "/api/diary",
          { signal: controller.signal },
          { requiresIdentity: true },
        );
        const body = (await res.json().catch(() => ({}))) as {
          status?: "ready" | "degraded";
          entries?: DiaryEntryDTO[];
        };
        if (controller.signal.aborted) return;
        const door = res.ok ? readContributionDoor(body) : undefined;
        if (door) {
          setRead({ userId, status: "gated", door, entries: [] });
          return;
        }
        setRead(
          res.ok
            ? {
                userId,
                status: body.status === "degraded" ? "degraded" : "ready",
                entries: Array.isArray(body.entries) ? body.entries : [],
              }
            : { userId, status: "error", entries: [] },
        );
      } catch {
        if (controller.signal.aborted) return;
        setRead({ userId, status: "error", entries: [] });
      }
    })();
    return () => controller.abort();
  }, [userId, reads]);

  if (!userId) return null;
  const current = read && read.userId === userId ? read : null;

  return (
    <section className="diaryPanel" id="diary" aria-labelledby="diary-heading">
      <h2 id="diary-heading" className="diaryPanel__title">
        Your diary
      </h2>
      <p className="diaryPanel__lede">
        Every visit you log, newest first. Only you can see it. Log one from a
        pub&apos;s page on the map.
      </p>
      {current === null ? (
        <p className="diaryPanel__empty" role="status">
          Opening your diary.
        </p>
      ) : current.status === "gated" && current.door ? (
        <ContributionGateDoor
          status={current.door}
          subject="keep a diary"
          onAsserted={() => setReads((count) => count + 1)}
        />
      ) : current.status !== "ready" ? (
        <p className="diaryPanel__empty" role="status">
          We couldn&apos;t open your diary just now. Try again shortly.
        </p>
      ) : current.entries.length === 0 ? (
        <p className="diaryPanel__empty">
          Nothing logged yet. Open a pub on the map and tap Log this visit.
        </p>
      ) : (
        <ul className="diaryList" data-testid="diary-list">
          {current.entries.map((entry) => (
            <DiaryEntryRow
              key={entry.id}
              entry={entry}
              onChanged={(changed, tagsFresh) =>
                setRead((previous) =>
                  previous
                    ? {
                        ...previous,
                        entries: previous.entries
                          // An edit of the fields answers the entry alone, so
                          // its tags are kept; an edit of the tags answers them.
                          .map((row) =>
                            row.id !== changed.id
                              ? row
                              : tagsFresh
                                ? changed
                                : {
                                    ...changed,
                                    ...(row.withTags ? { withTags: row.withTags } : {}),
                                    ...(row.withTagList ? { withTagList: row.withTagList } : {}),
                                  },
                          )
                          .sort(compareDiaryEntries),
                      }
                    : previous,
                )
              }
              onRemoved={(id) =>
                setRead((previous) =>
                  previous
                    ? { ...previous, entries: previous.entries.filter((row) => row.id !== id) }
                    : previous,
                )
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// One entry, with the two things its owner may do to it: correct it and take it
// out. The pub is the entry's identity, so only the day, the stars, the words,
// the usual and the people tagged open for editing. The server finds the row by
// its id and the session's account. A person added here is asked first, exactly
// as on a new log; a person taken off is untagged.
export function DiaryEntryRow({
  entry,
  onChanged,
  onRemoved,
}: {
  entry: DiaryEntryDTO;
  onChanged: (entry: DiaryEntryDTO, tagsFresh?: boolean) => void;
  onRemoved: (id: string) => void;
}): React.JSX.Element {
  const latest = latestDiaryVisitedOn();
  const [editing, setEditing] = useState(false);
  const [visitedOn, setVisitedOn] = useState(entry.visitedOn);
  const [rating, setRating] = useState<RatingValue | null>(entry.rating);
  const [review, setReview] = useState(entry.review);
  const [usualDrink, setUsualDrink] = useState(entry.usualDrink ?? "");
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tags = parseDiaryWithTags(entry.withTagList);
  const [takenOff, setTakenOff] = useState<readonly string[]>([]);
  const [withAdd, setWithAdd] = useState("");

  function open() {
    setVisitedOn(entry.visitedOn);
    setRating(entry.rating);
    setReview(entry.review);
    setUsualDrink(entry.usualDrink ?? "");
    setTakenOff([]);
    setWithAdd("");
    setError(null);
    setNotice(null);
    setEditing(true);
  }

  async function save() {
    if (!visitedOn || visitedOn > latest || visitedOn < DIARY_EARLIEST_VISITED_ON) {
      setError("Pick the day you were there. It cannot be in the future.");
      return;
    }
    setBusy("save");
    setError(null);
    setNotice(null);
    const remove = takenOff.filter((id) => tags.some((tag) => tag.id === id));
    const add = withAdd.trim();
    const result = await updateDiaryEntry(entry.id, {
      visitedOn,
      rating,
      review: review.trim(),
      // Sent only when it changed, so an edit of the day or the words never
      // writes the usual column on a database 0199 has not reached.
      ...(usualDrink.trim() !== (entry.usualDrink ?? "") ? { usualDrink: usualDrink.trim() } : {}),
      ...(add ? { withAdd: add } : {}),
      ...(remove.length ? { withRemove: remove } : {}),
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(false);
    if (result.tagsSent === false) {
      setNotice("Saved. The tags did not go through, so try them again shortly.");
    }
    onChanged(result.entry, result.tagsSent === true);
  }

  function toggleTag(id: string) {
    setTakenOff((current) => (current.includes(id) ? current.filter((held) => held !== id) : [...current, id]));
  }

  async function remove() {
    if (!window.confirm(`Remove your diary entry for ${entry.venueName}? It cannot be undone.`)) return;
    setBusy("delete");
    setError(null);
    const result = await deleteDiaryEntry(entry.id);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onRemoved(entry.id);
  }

  return (
    <li className="diaryRow" data-testid="diary-entry">
      <div className="diaryRow__head">
        <a href={mapUrlFor(entry.venueId)} className="diaryRow__venue">
          {entry.venueName}
        </a>
        <time className="diaryRow__date" dateTime={entry.visitedOn}>
          {diaryVisitedOnLabel(entry.visitedOn)}
        </time>
      </div>
      {editing ? (
        <div className="diaryRow__edit" data-testid="diary-entry-edit">
          <label className="visitReportDate">
            <span>When were you there?</span>
            <input
              type="date"
              value={visitedOn}
              min={DIARY_EARLIEST_VISITED_ON}
              max={latest}
              onChange={(event) => setVisitedOn(event.target.value)}
            />
          </label>
          <div className="diaryRatingField">
            <span className="diaryRatingLabel">Your rating</span>
            <div className="diaryRatingRow">
              <StarRating
                value={rating}
                label={`Your rating of ${entry.venueName}`}
                interactive
                onRate={(next) => setRating(next)}
              />
              <span className="diaryRatingValue" aria-live="polite">
                {rating === null ? "Not rated" : `${rating} / 5`}
              </span>
              {rating === null ? null : (
                <button type="button" className="diaryRatingClear" onClick={() => setRating(null)}>
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
              onChange={(event) => setReview(clampDiaryReviewInput(event.target.value))}
              rows={3}
            />
            <small>{MAX_DIARY_REVIEW - diaryReviewLength(review)} characters left</small>
          </label>
          <label className="visitReportNoteWrap">
            <span>Your usual here</span>
            <input
              className="diaryUsualInput"
              data-testid="diary-edit-usual"
              type="text"
              value={usualDrink}
              maxLength={MAX_DIARY_USUAL_DRINK * 2}
              onChange={(event) => setUsualDrink(clampDiaryUsualDrinkInput(event.target.value))}
              placeholder="A drink name, if you have one"
              autoComplete="off"
            />
          </label>
          <fieldset className="diaryWithEdit" data-testid="diary-edit-with">
            <legend>Who you were with</legend>
            {tags.length ? (
              <ul className="diaryWithEdit__list">
                {tags.map((tag) => {
                  const off = takenOff.includes(tag.id);
                  return (
                    <li key={tag.id} className="diaryWithEdit__tag" data-off={off ? "" : undefined}>
                      <span>
                        @{tag.handle}
                        {tag.state === "proposed" ? ", waiting for a yes" : null}
                      </span>
                      <button
                        type="button"
                        className="diaryRow__action"
                        onClick={() => toggleTag(tag.id)}
                        aria-pressed={off}
                        aria-label={off ? `Keep @${tag.handle} tagged` : `Untag @${tag.handle}`}
                      >
                        {off ? "Keep" : "Untag"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <label className="visitReportNoteWrap">
              <span>Tag someone on PUBMAXX</span>
              <input
                className="diaryUsualInput"
                data-testid="diary-edit-with-add"
                type="text"
                value={withAdd}
                maxLength={400}
                onChange={(event) => setWithAdd(event.target.value)}
                placeholder="@handle"
                autoComplete="off"
              />
              <small>Each person is asked first. Their handle shows once they say yes.</small>
            </label>
          </fieldset>
          <div className="diaryRow__actions">
            <button
              type="button"
              className="diaryRow__action diaryRow__action--primary"
              onClick={() => void save()}
              disabled={busy !== null}
            >
              {busy === "save" ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="diaryRow__action"
              onClick={() => setEditing(false)}
              disabled={busy !== null}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {entry.rating === null ? null : (
            <StarRating
              value={entry.rating}
              label={`Your rating of ${entry.venueName}`}
              size="sm"
            />
          )}
          {entry.review ? <p className="diaryRow__review">{entry.review}</p> : null}
          {entry.usualDrink ? (
            <p className="diaryRow__usual" data-testid="diary-row-usual">
              Your usual here: {entry.usualDrink}
            </p>
          ) : null}
          {entry.withNames ? (
            <p className="diaryRow__usual" data-testid="diary-row-with-names">
              With {entry.withNames}
            </p>
          ) : null}
          {/* Handles only after consent; a proposal is a count. */}
          <PintDropWithLine summary={parseWithSummary(entry.withTags)} className="diaryRow__usual" />
          <div className="diaryRow__actions">
            <button
              type="button"
              className="diaryRow__action"
              onClick={open}
              disabled={busy !== null}
              aria-label={`Edit your diary entry for ${entry.venueName}`}
            >
              Edit
            </button>
            <button
              type="button"
              className="diaryRow__action"
              onClick={() => void remove()}
              disabled={busy !== null}
              aria-label={`Remove your diary entry for ${entry.venueName}`}
            >
              {busy === "delete" ? "Removing…" : "Remove"}
            </button>
          </div>
        </>
      )}
      {error ? (
        <p className="diaryRow__error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="diaryRow__usual" role="status">
          {notice}
        </p>
      ) : null}
    </li>
  );
}
