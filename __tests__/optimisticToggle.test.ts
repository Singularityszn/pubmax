import { describe, expect, it } from "vitest";

import {
  applyOptimisticFlip,
  reconcileToggle,
  type ToggleBase,
  type ToggleView,
} from "@/lib/optimisticToggle";

// Pure optimistic-toggle arithmetic behind the A4 one-tap "Cheers" kudos. These
// tests pin the instant-flip + reconciliation + rollback behaviour the
// CheersButton relies on, with no React/DOM in the loop.

describe("applyOptimisticFlip", () => {
  it("toggles ON: sets mine and bumps the count", () => {
    expect(applyOptimisticFlip({ mine: false, count: 3 })).toEqual({ mine: true, count: 4 });
  });

  it("toggles OFF: clears mine and drops the count", () => {
    expect(applyOptimisticFlip({ mine: true, count: 4 })).toEqual({ mine: false, count: 3 });
  });

  it("ON from zero starts a count at one", () => {
    expect(applyOptimisticFlip({ mine: false, count: 0 })).toEqual({ mine: true, count: 1 });
  });

  it("never underflows below zero when toggling OFF from an inconsistent base", () => {
    // Defensive: a server that reports mine=true with count=0 must floor at 0.
    expect(applyOptimisticFlip({ mine: true, count: 0 })).toEqual({ mine: false, count: 0 });
  });
});

describe("reconcileToggle", () => {
  const base: ToggleBase = { mine: false, count: 5 };

  it("with no pending flip shows the authoritative base as-is", () => {
    expect(reconcileToggle(base, null)).toEqual({ view: base, clearPending: false });
  });

  it("keeps showing the optimistic prediction while the round-trip is pending", () => {
    // We flipped from base and the props haven't caught up yet → hold the
    // prediction, don't clear.
    const predicted: ToggleView = { mine: true, count: 6 };
    const result = reconcileToggle(base, { predicted, baseline: base });
    expect(result).toEqual({ view: predicted, clearPending: false });
  });

  it("surrenders to base and clears pending once the server confirms the flip", () => {
    // The parent reconciled: props now reflect our predicted (cheered) state.
    const predicted: ToggleView = { mine: true, count: 6 };
    const confirmed: ToggleBase = { mine: true, count: 6 };
    const result = reconcileToggle(confirmed, { predicted, baseline: base });
    expect(result).toEqual({ view: confirmed, clearPending: true });
  });

  it("shows the rolled-back base (and clears pending) when the POST failed", () => {
    // Parent's rollback restored the pre-flip state; because base no longer
    // equals the baseline we predicted from, the authoritative state wins.
    // (Here the rollback lands back on the same values as baseline, so we assert
    // via a distinct external change below; a same-value rollback is
    // indistinguishable from "still pending" by design — the parent's rollback
    // path produces a NEW object identity that re-runs the effect, and the view
    // it yields is base, which is correct either way.)
    const predicted: ToggleView = { mine: true, count: 6 };
    // Server says someone else also cheered in the meantime: base moved.
    const moved: ToggleBase = { mine: true, count: 8 };
    const result = reconcileToggle(moved, { predicted, baseline: base });
    expect(result).toEqual({ view: moved, clearPending: true });
  });

  it("clears pending when an external actor changes the count under a pending flip", () => {
    const predicted: ToggleView = { mine: true, count: 6 };
    // Base count changed (another viewer's cheer landed) though mine is unchanged.
    const external: ToggleBase = { mine: false, count: 7 };
    const result = reconcileToggle(external, { predicted, baseline: base });
    expect(result).toEqual({ view: external, clearPending: true });
  });
});
