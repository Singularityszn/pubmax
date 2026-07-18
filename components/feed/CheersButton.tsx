"use client";

import { useEffect, useRef, useState } from "react";

import {
  applyOptimisticFlip,
  cheersTapFeedback,
  reconcileToggle,
  type CheersTapFeedback,
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
  // to its toggleReaction(dropId, "cheers"). U2: the parent may return a
  // promise reporting whether the toggle actually stuck — false (or a
  // rejection) means the POST failed, so the button reverts its optimistic
  // tick and shows the claim-a-handle prompt. Void-returning callers keep the
  // old fire-and-forget behaviour.
  onToggle: (dropId: string) => Promise<boolean | void> | void;
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

  // U2 — inline failure feedback. When the parent reports the toggle didn't
  // save (anonymous store gating answers 503, or the network dropped), show a
  // small claim-a-handle prompt beside the button for a few seconds. Same
  // quiet shape as SaveToListControl's toast: local string state rendered with
  // role="status", auto-hidden on a timer, cleared on unmount with the ink
  // timer.
  const [gatePrompt, setGatePrompt] = useState<string | null>(null);
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (inkTimer.current) clearTimeout(inkTimer.current);
      if (promptTimer.current) clearTimeout(promptTimer.current);
    },
    [],
  );

  // Act on the resolved outcome of a tap (cheersTapFeedback in
  // lib/optimisticToggle.ts, unit-tested there). Revert FIRST: dropping the
  // pending override snaps the view back to the parent's already-rolled-back
  // authoritative props — the explicit signal prop-diffing alone cannot
  // provide, because a rollback landing on the exact pre-flip values looks
  // identical to "still pending".
  function applyTapFeedback(feedback: CheersTapFeedback) {
    if (feedback.revertOptimistic) setPending(null);
    if (feedback.prompt) {
      setGatePrompt(feedback.prompt);
      if (promptTimer.current) clearTimeout(promptTimer.current);
      promptTimer.current = setTimeout(() => setGatePrompt(null), 4200);
    }
  }

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

    // Fire the parent's toggle (it owns the network + its own summary
    // rollback). U2: consume the reported outcome — `false` or a rejection
    // means the POST failed (e.g. the anonymous 503 gate), so the optimistic
    // tick reverts and the prompt shows. A legacy void-returning parent
    // resolves to undefined, which counts as success — behaviour unchanged.
    void Promise.resolve(onToggle(dropId))
      .then((ok) => applyTapFeedback(cheersTapFeedback(ok !== false)))
      .catch(() => applyTapFeedback(cheersTapFeedback(false)));
  }

  return (
    <>
      <button
        type="button"
        className={`cheersBtn${view.mine ? " isCheered" : ""}${inking ? " isInking" : ""}${
          className ? ` ${className}` : ""
        }`}
        aria-pressed={view.mine}
        aria-label={
          view.count > 0
            ? `Cheers, ${view.count}${view.mine ? ". You cheered this" : ""}`
            : view.mine
              ? "Cheers. You cheered this"
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
      {/* U2 — failure prompt: shown only after a reported failed toggle, in
          the app's claim-a-handle voice. role="status" so screen readers hear
          it without stealing focus. */}
      {gatePrompt ? (
        <p className="cheersGatePrompt" role="status">
          {gatePrompt}
        </p>
      ) : null}
    </>
  );
}
