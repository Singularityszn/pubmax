// Pure optimistic-toggle logic for a single one-tap acknowledgement (the A4
// "Cheers" kudos). NO React, NO DOM — just the arithmetic, so it can be unit
// tested in isolation and reused by any optimistic one-tap affordance.
//
// The model: a card is handed the *authoritative* `count` + `mine` from the
// server (via its parent, which already owns the POST, reconciliation, and
// rollback). When the viewer taps, we want an INSTANT visual flip without
// waiting for that round-trip. So the button keeps a small local "pending"
// override that it applies on top of the incoming props, and clears the moment
// the props catch up to (or diverge from) what it predicted — at which point the
// server's answer is the truth and the optimistic layer gets out of the way.

// The visible state of a one-tap toggle: whether the viewer has it on, and the
// count shown. Always derived, never stored as the source of truth.
export type ToggleView = { mine: boolean; count: number };

// The base (authoritative) state a card is handed by its parent.
export type ToggleBase = { mine: boolean; count: number };

// Apply a single optimistic flip to a base state. Toggling ON bumps the count by
// one; toggling OFF drops it by one but never below zero (a defensive floor: a
// server that reports mine=true with count=0 must not underflow to -1).
export function applyOptimisticFlip(base: ToggleBase): ToggleView {
  if (base.mine) {
    return { mine: false, count: Math.max(0, base.count - 1) };
  }
  return { mine: true, count: base.count + 1 };
}

// Reconcile a pending optimistic prediction against freshly-arrived base props.
//
// `pending` is what we optimistically predicted after the last tap (or null when
// there is no in-flight flip). `base` is the newest authoritative state from the
// parent. Returns the state to DISPLAY plus whether the pending override should
// be cleared:
//   • no pending flip            → show base as-is.
//   • base already matches the    → the server confirmed our prediction; clear
//     prediction                    the pending override and show base.
//   • base disagrees (rollback,   → the server's answer wins; clear the pending
//     or another actor moved the    override and show base (this is how a failed
//     count)                        POST's rollback becomes visible).
//   • base unchanged, still        → keep showing the optimistic prediction until
//     matches the pre-flip base     the round-trip resolves.
//
// The rule collapses to: once base stops equalling the *pre-flip* baseline we
// predicted from, the prediction has been answered — surrender to base.
export function reconcileToggle(
  base: ToggleBase,
  pending: { predicted: ToggleView; baseline: ToggleBase } | null,
): { view: ToggleView; clearPending: boolean } {
  if (!pending) {
    return { view: base, clearPending: false };
  }
  // The parent's props still reflect the exact state we flipped FROM → the
  // round-trip hasn't landed yet; keep showing the optimistic prediction.
  if (base.mine === pending.baseline.mine && base.count === pending.baseline.count) {
    return { view: pending.predicted, clearPending: false };
  }
  // Base moved (confirmed, rolled back, or changed by someone else) → the
  // authoritative state is now the truth; drop the optimistic override.
  return { view: base, clearPending: true };
}
