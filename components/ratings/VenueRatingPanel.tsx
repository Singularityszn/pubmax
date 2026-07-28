"use client";

// Venue rating panel (PRD E3): the star line a venue header used to carry.
// NOT MOUNTED: the bar-tab and ledger headers now carry the Visit Report lane
// instead (components/visits/VisitReportPanel.tsx), because a per-visit account
// may not sit beside a competing pub score. `POST /api/ratings` still exists.
// Two honest layers:
//   • the COMMUNITY score — shown only once the vote floor is met
//     (summary.shown); under it, the panel says so instead of flashing a
//     2-vote average;
//   • YOUR vote — the interactive picker. Identity is the self-asserted
//     handle (localStorage `pubmax_handle`, the app-wide convention); with no
//     handle stored yet, a small inline input appears on first use.
//
// Duty-of-care: the copy rates the PUB, never the drinker — no streaks, no
// counts of anyone's sessions.

import { useEffect, useState } from "react";

import type { RatingSummary, RatingValue } from "@/lib/ratings";

import StarRating from "./StarRating";
import { fetchRatingSummary, postRating, rememberHandle, storedHandle } from "./ratingsClient";

export type VenueRatingPanelProps = {
  venueId: string;
  venueName: string;
};

export default function VenueRatingPanel({ venueId, venueName }: VenueRatingPanelProps) {
  const [summary, setSummary] = useState<RatingSummary | null>(null);
  const [myRating, setMyRating] = useState<RatingValue | null>(null);
  const [handle, setHandle] = useState("");
  const [needsHandle, setNeedsHandle] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      const nextHandle = storedHandle();
      const result = await fetchRatingSummary("venue", venueId);
      if (cancelled) return;
      setHandle(nextHandle);
      if (result) setSummary(result);
    });
    return () => {
      cancelled = true;
    };
  }, [venueId]);

  const rate = async (value: RatingValue) => {
    const clean = handle.trim();
    if (!clean) {
      setNeedsHandle(true);
      setNote({ kind: "error", text: "Add a handle first. Your rating needs a name." });
      return;
    }
    setMyRating(value);
    setNote(null);
    try {
      const fresh = await postRating({ kind: "venue", ref: venueId, venueId, handle: clean, rating: value });
      rememberHandle(clean);
      setNeedsHandle(false);
      setSummary(fresh);
      setNote({ kind: "ok", text: "Saved. Rate again any time to change it." });
    } catch (err) {
      setNote({
        kind: "error",
        text: err instanceof Error ? err.message : "Couldn't save your rating just now.",
      });
    }
  };

  return (
    <div className="venueRatingPanel">
      <span className="ratingRowLabel">Pub rating</span>
      {summary?.shown && summary.average !== null ? (
        <span className="ratingLine">
          <StarRating value={summary.average} label={`${venueName} community rating`} />
          <span className="ratingCount">
            {summary.average.toFixed(1)} · {summary.count} ratings
          </span>
        </span>
      ) : (
        <span className="ratingUnrated">
          Not enough ratings yet. Scores show after 10 votes.
        </span>
      )}
      <span className="ratingLine">
        <span className="ratingPrompt">Your rating:</span>
        <StarRating
          value={myRating}
          label={`Rate ${venueName}`}
          interactive
          onRate={(value) => void rate(value)}
        />
        {needsHandle ? (
          <input
            className="ratingHandleInput"
            type="text"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="your handle"
            aria-label="Handle to rate as"
          />
        ) : null}
      </span>
      {note ? (
        <span className={note.kind === "error" ? "ratingError" : "ratingNote"} role="status">
          {note.text}
        </span>
      ) : null}
    </div>
  );
}
