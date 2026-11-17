"use client";

// "Rank your first ten" on the owner's own profile: an offer, never a gate.
// It opens the same "which did you prefer?" flow every ranking door uses. The
// count is the server's list, so a pub already ranked counts, a reload keeps
// what was saved, and stopping short of ten is a normal end. A save here only
// ranks: no visit, points, post or follow, and it never tells anyone.

import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { FIRST_TEN_GOAL, firstTenCount, firstTenProgressLine } from "@/lib/firstTenRankingSession";
import type { SocialPubRankingEntry } from "@/lib/socialPubRankings";
import type { ComparePubCloseReason } from "@/components/social/ComparePubFlow";

import "./firstTenRanking.css";

const ComparePubFlow = dynamic(() => import("@/components/social/ComparePubFlow"), {
  loading: () => <p role="status">Opening your ranking…</p>,
});

export default function FirstTenRanking({
  entries,
  onSaved,
  onClosed,
  disabled,
  completionFocusRef,
}: {
  /** The list the server last answered for this account. */
  entries: SocialPubRankingEntry[];
  onSaved: (entries: SocialPubRankingEntry[]) => void;
  /** The session ended, with the comparison flow's own close answer (see ComparePubFlow's onClose). */
  onClosed: (refresh?: Promise<void>, reason?: ComparePubCloseReason) => void;
  disabled: boolean;
  completionFocusRef: RefObject<HTMLHeadingElement | null>;
}): React.JSX.Element | null {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const completedOnClose = useRef(false);
  const count = firstTenCount(entries);
  const previouslyBelowGoal = useRef(count < FIRST_TEN_GOAL);
  useEffect(() => {
    const completedOnRead = previouslyBelowGoal.current && count >= FIRST_TEN_GOAL;
    previouslyBelowGoal.current = count < FIRST_TEN_GOAL;
    if (!open && (completedOnClose.current || (completedOnRead && document.activeElement === document.body))) {
      completedOnClose.current = false;
      // The modal releases background inertness in its cleanup microtask.
      queueMicrotask(() => completionFocusRef.current?.focus());
    }
  }, [open, count, completionFocusRef]);
  if (count >= FIRST_TEN_GOAL && !open) return null;

  return (
    <div className="firstTen" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="firstTen__title">Rank your first ten</h3>
      <p className="firstTen__line">
        Pick pubs you remember and answer a few quick questions. You can stop whenever you like.
      </p>
      <div className="firstTen__foot">
        <p className="firstTen__count">
          <span className="firstTen__figure">{Math.min(count, FIRST_TEN_GOAL)}</span> of {FIRST_TEN_GOAL} ranked
        </p>
        <Button type="button" variant="secondary" aria-disabled={disabled} onClick={() => { if (!disabled) setOpen(true); }}>
          {count === 0 ? "Start ranking" : "Keep ranking"}
        </Button>
      </div>
      {open ? (
        <ComparePubFlow
          entries={entries}
          progress={firstTenProgressLine(count)}
          onClose={(refresh, reason) => {
            completedOnClose.current = reason !== "refused" && count >= FIRST_TEN_GOAL;
            setOpen(false);
            onClosed(refresh, reason);
          }}
          onSaved={onSaved}
        />
      ) : null}
    </div>
  );
}
