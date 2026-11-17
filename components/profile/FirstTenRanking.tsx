"use client";

// "Rank your first ten" on the owner's own profile: an offer, never a gate.
// It opens the same "which did you prefer?" flow every ranking door uses. The
// count is the server's list, so a pub already ranked counts, a reload keeps
// what was saved, and stopping short of ten is a normal end. A save here only
// ranks: no visit, points, post or follow, and it never tells anyone.

import { useId, useState } from "react";

import ComparePubFlow from "@/components/social/ComparePubFlow";
import { Button } from "@/components/ui/button";
import { FIRST_TEN_GOAL, firstTenCount, firstTenProgressLine } from "@/lib/firstTenRankingSession";
import type { SocialPubRankingEntry } from "@/lib/socialPubRankings";

import "./firstTenRanking.css";

export default function FirstTenRanking({
  entries,
  onSaved,
  onClosed,
}: {
  /** The list the server last answered for this account. */
  entries: SocialPubRankingEntry[];
  onSaved: (entries: SocialPubRankingEntry[]) => void;
  /** The session ended. The owner reads the list again. */
  onClosed: () => void;
}): React.JSX.Element | null {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const count = firstTenCount(entries);
  if (count >= FIRST_TEN_GOAL && !open) return null;

  return (
    <div className="firstTen" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="firstTen__title">Rank your first ten</h3>
      <p className="firstTen__line">
        Pick pubs you remember and answer a few quick questions. Only you see the list, and you can stop whenever you like.
      </p>
      <div className="firstTen__foot">
        <p className="firstTen__count">
          <span className="firstTen__figure">{Math.min(count, FIRST_TEN_GOAL)}</span> of {FIRST_TEN_GOAL} ranked
        </p>
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          {count === 0 ? "Start ranking" : "Keep ranking"}
        </Button>
      </div>
      {open ? (
        <ComparePubFlow
          entries={entries}
          progress={firstTenProgressLine(count)}
          onClose={() => {
            setOpen(false);
            onClosed();
          }}
          onSaved={onSaved}
        />
      ) : null}
    </div>
  );
}
