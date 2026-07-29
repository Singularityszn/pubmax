"use client";

import { useCallback, useReducer } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import SignInButton from "@/components/auth/SignInButton";
import {
  captureAccountAuth,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import { trackEvent } from "@/lib/analytics";

import "./contributionGate.css";

export type ContributionGateDialogMode =
  | "sign_in_required"
  | "onboarding_required";

type ContributionGateDialogProps = {
  mode: ContributionGateDialogMode;
  error: string | null;
  onClose: () => void;
};

export function ContributionGateDialog({
  mode,
  error,
  onClose,
}: ContributionGateDialogProps): React.JSX.Element {
  return (
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
              first. Email sign-in works even when Google and Apple are
              unavailable.
            </p>
            <SignInButton />
          </>
        ) : (
          <>
            <p className="contributionGateEyebrow">Profile needed</p>
            <h2 id="contribution-gate-title">Finish account setup</h2>
            <p>
              Choose a public handle and add your date of birth before
              contributing.
            </p>
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
  const { user, session } = useAuth();
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

  const requestContribution = useCallback(
    async (action: PendingContribution) => {
      dispatch({ type: "clear", userId });
      const auth = captureAccountAuth(userId, session);
      if (!user || !auth) {
        trackEvent("contribution_gate", { step: "sign_in_required" });
        dispatch({
          type: "show",
          userId,
          mode: "sign_in_required",
          error: null,
        });
        return;
      }
      const result = await action(auth);
      if (!result) return;
      trackEvent("contribution_gate", { step: result.status });
      dispatch({
        type: "show",
        userId,
        mode: result.status,
        error:
          result.status === "sign_in_required" && user
            ? "Your sign-in expired. Sign out, then sign in again."
            : result.error ?? null,
      });
    },
    [session, user, userId],
  );

  return {
    requestContribution,
    contributionGateDialog:
      gate.userId === userId && gate.mode ? (
        <ContributionGateDialog
          key={gate.mode}
          mode={gate.mode}
          error={gate.error}
          onClose={() => resetGate(userId)}
        />
      ) : null,
  };
}
