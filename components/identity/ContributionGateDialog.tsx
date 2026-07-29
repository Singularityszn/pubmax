"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
            <p className="contributionGateEyebrow">Account required</p>
            <h2 id="contribution-gate-title">Sign in to contribute</h2>
            <p>
              Your contribution needs an account-owned public handle. Email
              sign-in works even when Google and Apple are unavailable.
            </p>
            <SignInButton />
          </>
        ) : (
          <>
            <p className="contributionGateEyebrow">Profile required</p>
            <h2 id="contribution-gate-title">Finish account setup</h2>
            <p>
              Choose your public handle and add your private date of birth
              before contributing.
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
      status: "sign_in_required" | "onboarding_required";
      error?: string;
    }>;

type PendingContribution = (
  auth: AccountAuthSnapshot,
) => ContributionActionResult | Promise<ContributionActionResult>;

export function useContributionGate(): {
  requestContribution: (action: PendingContribution) => Promise<void>;
  contributionGateDialog: React.JSX.Element | null;
} {
  const { user, session } = useAuth();
  const userId = user?.id ?? null;
  const [mode, setMode] = useState<ContributionGateDialogMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stateUserId = useRef(userId);

  const resetGate = useCallback((nextUserId: string | null) => {
    setMode(null);
    setError(null);
    stateUserId.current = nextUserId;
  }, []);

  useEffect(() => {
    stateUserId.current = userId;
    return () => {
      stateUserId.current = null;
    };
  }, [userId]);

  const requestContribution = useCallback(
    async (action: PendingContribution) => {
      if (stateUserId.current !== userId) return;
      setError(null);
      const auth = captureAccountAuth(userId, session);
      if (!user || !auth) {
        trackEvent("contribution_gate", { step: "sign_in_required" });
        setMode("sign_in_required");
        return;
      }
      const result = await action(auth);
      if (stateUserId.current !== userId || !result) return;
      trackEvent("contribution_gate", { step: result.status });
      setError(
        result.status === "sign_in_required" && user
          ? "Your sign-in expired. Sign out, then sign in again."
          : result.error ?? null,
      );
      setMode(result.status);
    },
    [session, user, userId],
  );

  return {
    requestContribution,
    contributionGateDialog: mode ? (
      <ContributionGateDialog
        mode={mode}
        error={error}
        onClose={() => resetGate(userId)}
      />
    ) : null,
  };
}
