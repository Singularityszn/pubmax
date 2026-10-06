"use client";

// Your diary, on your own profile: every visit you logged, newest day first.
// Private in Phase 1, so it mounts on the owner's page only and reads the
// owner-only GET /api/diary. Rows are keyed to the account that fetched them,
// so a sign-out or an account switch never paints the previous account's log.

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import ContributionGateDoor from "@/components/identity/ContributionGateDoor";
import StarRating from "@/components/ratings/StarRating";
import { authedFetch } from "@/lib/authedFetch";
import {
  readContributionDoor,
  type ContributionDoorStatus,
} from "@/lib/contributionGateStatus";
import { diaryVisitedOnLabel, type DiaryEntryDTO } from "@/lib/diary";
import { venueMapUrl } from "@/lib/venueMapUrl";

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
            <li key={entry.id} className="diaryRow" data-testid="diary-entry">
              <div className="diaryRow__head">
                <a href={mapUrlFor(entry.venueId)} className="diaryRow__venue">
                  {entry.venueName}
                </a>
                <time className="diaryRow__date" dateTime={entry.visitedOn}>
                  {diaryVisitedOnLabel(entry.visitedOn)}
                </time>
              </div>
              {entry.rating === null ? null : (
                <StarRating
                  value={entry.rating}
                  label={`Your rating of ${entry.venueName}`}
                  size="sm"
                />
              )}
              {entry.review ? <p className="diaryRow__review">{entry.review}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
