"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import {
  useCallback,
  useReducer,
  useRef,
  useState,
  type SetStateAction,
} from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import SignInButton from "@/components/auth/SignInButton";
import type { AccountAuthSnapshot } from "@/lib/accountBoundFetch";
import { authedActionFetch } from "@/lib/authedFetch";
import { HANDLE_CLAIM_NEXT } from "@/lib/authRedirect";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import {
  CONTRIBUTION_ADULT_REFUSAL,
  CONTRIBUTION_HANDLE_REFUSAL,
  CONTRIBUTION_UNDER_18_REFUSAL,
  type ContributionGateStatus,
} from "@/lib/contributionGateStatus";
import { discardBody } from "@/lib/responseBody";
import { ADULT_SELF_ASSERTION_ACTION } from "@/lib/adultGate";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { trackEvent } from "@/lib/analytics";

import "./contributionGate.css";

/** The dialog answers the gate, so it speaks the gate's own vocabulary. */
export type ContributionGateDialogMode = ContributionGateStatus;

type ContributionGateDialogProps = {
  mode: ContributionGateDialogMode;
  error: string | null;
  onClose: () => void;
  /** Called once the one tap is recorded, so the held action can run. */
  onAsserted?: () => void;
};

/**
 * The one tap, in the price path's own frame. Social records the same
 * assertion through the same route (`/api/identity/adult-assertion`); this is
 * that door where a drinker already asked to log a price, so the age question
 * is answered where it was raised rather than on another surface.
 */
function AdultCheck({
  onAsserted,
}: {
  onAsserted?: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [assertError, setAssertError] = useState<string | null>(null);
  const assert = useCallback(() => {
    setBusy(true);
    setAssertError(null);
    authedActionFetch(
      "/api/identity/adult-assertion",
      { method: "POST", cache: "no-store", credentials: "same-origin" },
      { requiresIdentity: true },
    )
      .then((response) => {
        discardBody(response);
        if (!response.ok) throw new Error("Adult assertion refused");
        onAsserted?.();
      })
      .catch(() => {
        setAssertError("We could not save that just now. Try again.");
      })
      .finally(() => setBusy(false));
  }, [onAsserted]);
  return (
    <>
      <button
        type="button"
        className="contributionGatePrimary"
        onClick={assert}
        disabled={busy}
      >
        {ADULT_SELF_ASSERTION_ACTION}
      </button>
      {assertError ? (
        <p className="contributionGateError" role="alert">
          {assertError}
        </p>
      ) : null}
    </>
  );
}

export function ContributionGateDialog({
  mode,
  error,
  onClose,
  onAsserted,
}: ContributionGateDialogProps): React.JSX.Element {
  // A blocking dialog owes a keyboard way out. This one had a close button and
  // nothing else, so a reader who reached it with the keyboard had to tab to
  // the end of the dialog to leave.
  useDismissOnEscape(true, onClose);
  const dialog = (
    <div className="contributionGateBackdrop" role="presentation">
      <section
        className="contributionGate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contribution-gate-title"
      >
        {mode === "sign_in_required" ? (
          <>
            <p className="contributionGateEyebrow">Account needed</p>
            <h2 id="contribution-gate-title">Sign in to contribute</h2>
            <p>
              Contributions show your public handle, so you need an account
              first. Email sign-in works even when Google, Apple and
              Microsoft are unavailable.
            </p>
            <SignInButton />
          </>
        ) : mode === "adult_check_required" ? (
          <>
            <p className="contributionGateEyebrow">Age check</p>
            <h2 id="contribution-gate-title">Confirm your age</h2>
            <p>
              This is for over-18s. One tap records it, and we ask once.
            </p>
            <AdultCheck onAsserted={onAsserted} />
          </>
        ) : mode === "adult_check_failed" ? (
          // The account HAS answered and the answer was under 18, so there is
          // no tap here: offering one that would not be honoured is the door
          // with nothing behind it. The line names the answer on file, which is
          // the only thing the reader could change.
          <>
            <p className="contributionGateEyebrow">Age check</p>
            <h2 id="contribution-gate-title">Not open to you</h2>
            <p>{CONTRIBUTION_UNDER_18_REFUSAL}</p>
          </>
        ) : (
          <>
            <p className="contributionGateEyebrow">Handle needed</p>
            <h2 id="contribution-gate-title">Choose your handle</h2>
            <p>
              Contributions carry your public handle, so pick one before you
              log a price.
            </p>
            <Link
              className="contributionGatePrimary"
              href={HANDLE_CLAIM_NEXT}
              onClick={onClose}
            >
              Choose a handle
            </Link>
          </>
        )}
        {error ? (
          <p className="contributionGateError" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="contributionGateClose"
          onClick={onClose}
        >
          Not now
        </button>
      </section>
    </div>
  );
  // A DIALOG IS THE VIEWPORT'S, NOT ITS OPENER'S. The desktop map drawer this
  // door is opened from is a transformed, filtered box, and a transformed
  // ancestor is the containing block for `position: fixed`, so the backdrop
  // centred itself inside the drawer and put the panel above the viewport with
  // only "Not now" showing (measured at 1440 on this branch and on main). The
  // phone shell never showed it because its sheet is already a body-level
  // portal. Server rendering has no document, so the markup is returned inline
  // there and the surface fence still reads it.
  return typeof document === "undefined"
    ? dialog
    : createPortal(dialog, document.body);
}

export type ContributionActionResult =
  | void
  | Readonly<{
      status: ContributionGateDialogMode;
      error?: string;
    }>;

type PendingContribution = (
  auth: AccountAuthSnapshot,
) => ContributionActionResult | Promise<ContributionActionResult>;

export type AccountScopedDrafts<T> = Readonly<Record<string, T>>;

export function readAccountScopedDraft<T>(
  drafts: AccountScopedDrafts<T>,
  accountId: string | null,
  createDraft: () => T,
): T | null {
  if (!accountId) return null;
  return drafts[accountId] ?? createDraft();
}

export function writeAccountScopedDraft<T>(
  drafts: AccountScopedDrafts<T>,
  accountId: string | null,
  createDraft: () => T,
  next: SetStateAction<T>,
): AccountScopedDrafts<T> {
  if (!accountId) return drafts;
  const current = readAccountScopedDraft(drafts, accountId, createDraft);
  if (!current) return drafts;
  return {
    ...drafts,
    [accountId]:
      typeof next === "function"
        ? (next as (value: T) => T)(current)
        : next,
  };
}

export function useAccountScopedDraft<T>(
  accountId: string | null,
  createDraft: () => T,
): readonly [T | null, (next: SetStateAction<T>) => void, () => void] {
  const [drafts, setDrafts] = useState<AccountScopedDrafts<T>>({});
  const draft = readAccountScopedDraft(drafts, accountId, createDraft);
  const setDraft = useCallback(
    (next: SetStateAction<T>) => {
      setDrafts((current) =>
        writeAccountScopedDraft(current, accountId, createDraft, next),
      );
    },
    [accountId, createDraft],
  );
  const clearDraft = useCallback(() => {
    if (!accountId) return;
    setDrafts((current) => {
      if (!(accountId in current)) return current;
      const next = { ...current };
      delete next[accountId];
      return next;
    });
  }, [accountId]);
  return [draft, setDraft, clearDraft];
}

export type ContributionGateState = {
  userId: string | null;
  mode: ContributionGateDialogMode | null;
  error: string | null;
};

type ContributionGateStateAction =
  | { type: "account_changed"; userId: string | null }
  | { type: "clear"; userId: string | null }
  | {
      type: "show";
      userId: string | null;
      mode: ContributionGateDialogMode;
      error: string | null;
    };

/**
 * The red line under a gate door, or nothing. A door that ASKS a question is
 * not a failure: the gate's own refusal sentence is the same thing the heading
 * and the button already say, and printing it in alarm colours reads as a
 * fault. A sentence the gate did NOT write is something else and still prints.
 * A signed-in reader is told the one thing an expired token needs.
 */
const OWN_REFUSALS: readonly string[] = [
  CONTRIBUTION_ADULT_REFUSAL,
  CONTRIBUTION_HANDLE_REFUSAL,
  CONTRIBUTION_UNDER_18_REFUSAL,
];

export function contributionGateError(
  result: Readonly<{ status: ContributionGateStatus; error?: string }>,
  signedIn: boolean,
): string | null {
  if (result.status === "sign_in_required" && signedIn) {
    return "Your sign-in expired. Sign out, then sign in again.";
  }
  if (OWN_REFUSALS.includes(result.error?.trim() ?? "")) return null;
  return errorMessageFrom(result, "That action could not be completed.");
}

export function contributionGateReducer(
  state: ContributionGateState,
  action: ContributionGateStateAction,
): ContributionGateState {
  if (action.type === "account_changed" || action.type === "clear") {
    return { userId: action.userId, mode: null, error: null };
  }
  if (action.userId !== state.userId) return state;
  return {
    userId: action.userId,
    mode: action.mode,
    error: action.error,
  };
}

export function useContributionGate(): {
  requestContribution: (action: PendingContribution) => Promise<void>;
  contributionGateDialog: React.JSX.Element | null;
} {
  const {
    user,
    contributionAuth,
    invalidateContributionAuth,
  } = useAuth();
  const userId = user?.id ?? null;
  const [gate, dispatch] = useReducer(contributionGateReducer, {
    userId,
    mode: null,
    error: null,
  });
  if (gate.userId !== userId) {
    dispatch({ type: "account_changed", userId });
  }

  const resetGate = useCallback((nextUserId: string | null) => {
    dispatch({ type: "clear", userId: nextUserId });
  }, []);

  // The action the drinker asked for, held while the gate stands in front of
  // it. A recorded age answer is the way through, so the price they typed goes
  // where they sent it rather than being retyped behind a closed dialog.
  const pendingAction = useRef<PendingContribution | null>(null);

  const requestContribution = useCallback(
    async (action: PendingContribution) => {
      dispatch({ type: "clear", userId });
      pendingAction.current = action;
      if (!user || !contributionAuth) {
        trackEvent("contribution_gate", { step: "sign_in_required" });
        dispatch({
          type: "show",
          userId,
          mode: "sign_in_required",
          error: null,
        });
        return;
      }
      const result = await action(contributionAuth);
      if (!result) return;
      if (result.status === "sign_in_required") {
        invalidateContributionAuth(contributionAuth);
      }
      trackEvent("contribution_gate", { step: result.status });
      dispatch({
        type: "show",
        userId,
        mode: result.status,
        error: contributionGateError(result, Boolean(user)),
      });
    },
    [contributionAuth, invalidateContributionAuth, user, userId],
  );

  const resumeAfterAssertion = useCallback(() => {
    const held = pendingAction.current;
    resetGate(userId);
    if (held) void requestContribution(held);
  }, [requestContribution, resetGate, userId]);

  return {
    requestContribution,
    contributionGateDialog:
      gate.userId === userId && gate.mode ? (
        <ContributionGateDialog
          key={gate.mode}
          mode={gate.mode}
          error={gate.error}
          onClose={() => resetGate(userId)}
          onAsserted={resumeAfterAssertion}
        />
      ) : null,
  };
}
