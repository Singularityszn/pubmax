"use client";

import { useEffect, useRef, useState } from "react";

import {
  applyOptimisticFlip,
  reconcileToggle,
  type ToggleBase,
  type ToggleView,
} from "@/lib/optimisticToggle";

import "./cheersButton.css";

// A4 — the ONE primary, thumb-sized acknowledgement on every Spill/feed card: a
// Strava-kudos-style "Cheers 🍺". Distinct from the tucked-away 5-reaction chip
// row (feedReactions), this is the dominant one-tap ack.
//
// It is a thin OPTIMISTIC OVERLAY over the parent's authoritative state. The
// parent (app/feed/page.tsx) already owns the POST, server reconciliation, and
// rollback for the "cheers" reaction key, and hands the reconciled count + mine
// down as props. On tap we flip the visual state INSTANTLY (count bump + pressed
// state) via a local pending override, call onToggle so the parent fires the
// network round-trip, and then surrender to the parent's props the moment they
// change — so a confirmed toggle, a rollback on failure, or another actor's
// count all resolve correctly with no extra network code here. The pure
// reconcile arithmetic lives in lib/optimisticToggle.ts (unit-tested there).
//
// Drop-in contract: <CheersButton dropId count mine onToggle /> — one line in
// FeedCard, once per card treatment (Spill scrim + text-only card).
export default function CheersButton({
  dropId,
  count,
  mine,
  onToggle,
  className,
}: {
  dropId: string;
  count: number;
  mine: boolean;
  // Same signature FeedCard already threads for reactions; the parent maps this
  // to its toggleReaction(dropId, "cheers").
  onToggle: (dropId: string) => void;
  className?: string;
}) {
  const base: ToggleBase = { mine, count };
  // The optimistic prediction currently overriding the parent's props (null when
  // we're showing the authoritative state). `baseline` is the state we flipped
  // FROM, so reconcileToggle can tell "round-trip still pending" from "the
  // server answered (confirm or rollback)".
  const [pending, setPending] = useState<{
    predicted: ToggleView;
    baseline: ToggleBase;
  } | null>(null);

  // Reconcile DURING RENDER (not in an effect): the moment the parent's
  // authoritative props move past the baseline we predicted from — a confirmed
  // toggle, a rollback, or another actor's count — the prediction has been
  // answered and we drop the override. This is React's supported
  // "adjust-state-while-rendering" pattern (react.dev "You Might Not Need an
  // Effect"): a synchronous setState during render re-renders immediately
  // without committing the stale UI and without cascading an effect. `view`
  // already reflects the cleared state in this same pass.
  const { view, clearPending } = reconcileToggle(base, pending);
  if (clearPending) {
    setPending(null);
  }

  // Pressed-ink pulse — a one-shot class toggled on tap, honouring
  // prefers-reduced-motion (the CSS no-ops the animation there, and we still
  // avoid scheduling the timer when motion is reduced so there's no needless
  // work). Cleared after the animation window so it can re-fire on the next tap.
  const [inking, setInking] = useState(false);
  const inkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (inkTimer.current) clearTimeout(inkTimer.current);
    },
    [],
  );

  function handleClick() {
    // Instant optimistic flip: predict the new view and override the props with
    // it until the parent's reconciled state lands.
    const predicted = applyOptimisticFlip({ mine: view.mine, count: view.count });
    setPending({ predicted, baseline: base });

    // Pressed-ink pulse, only when motion is allowed.
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) {
      if (inkTimer.current) clearTimeout(inkTimer.current);
      setInking(true);
      inkTimer.current = setTimeout(() => setInking(false), 420);
    }

    // Fire the parent's toggle (it owns the network + rollback).
    onToggle(dropId);
  }

  return (
    <button
      type="button"
      className={`cheersBtn${view.mine ? " isCheered" : ""}${inking ? " isInking" : ""}${
        className ? ` ${className}` : ""
      }`}
      aria-pressed={view.mine}
      aria-label={
        view.count > 0
          ? `Cheers, ${view.count}${view.mine ? " — you cheered this" : ""}`
          : view.mine
            ? "Cheers — you cheered this"
            : "Cheers"
      }
      onClick={handleClick}
    >
      <span className="cheersGlyph" aria-hidden="true">
        🍺
      </span>
      <span className="cheersText">Cheers</span>
      {view.count > 0 ? (
        <span className="cheersCount" aria-hidden="true">
          {view.count}
        </span>
      ) : null}
    </button>
  );
}
