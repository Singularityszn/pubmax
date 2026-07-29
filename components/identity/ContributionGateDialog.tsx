"use client";

import { useCallback, useReducer, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import SignInButton from "@/components/auth/SignInButton";
import {
  accountBoundFetch,
  captureAccountAuth,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import { trackEvent } from "@/lib/analytics";

import "./contributionGate.css";

export type ContributionGateDialogMode =
  | "sign_in_required"
  | "onboarding_required"
  | "age_assessment_required"
  | "age_restricted";

type ContributionGateDialogProps = {
  mode: ContributionGateDialogMode;
  error: string | null;
  onClose: () => void;
  ageBusy?: boolean;
  onConfirmAge?: (dateOfBirth: string) => void;
};

export function ContributionGateDialog({
  mode,
  error,
  onClose,
  ageBusy = false,
  onConfirmAge,
}: ContributionGateDialogProps): React.JSX.Element {
  const [dateOfBirth, setDateOfBirth] = useState("");
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
        ) : mode === "onboarding_required" ? (
          <>
            <p className="contributionGateEyebrow">Profile required</p>
            <h2 id="contribution-gate-title">Finish account setup</h2>
            <p>
              Choose your public handle before contributing.
            </p>
          </>
        ) : mode === "age_assessment_required" ? (
          <>
            <p className="contributionGateEyebrow">Age confirmation</p>
            <h2 id="contribution-gate-title">Confirm you’re 18 or over</h2>
            <p>
              Enter your date of birth for this one-time check. We discard it
              after assessment and keep only your eligibility result.
            </p>
            <label className="contributionGateField">
              Date of birth
              <input
                type="date"
                value={dateOfBirth}
                autoComplete="bday"
                onChange={(event) => setDateOfBirth(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="contributionGatePrimary"
              disabled={!dateOfBirth || ageBusy}
              onClick={() => onConfirmAge?.(dateOfBirth)}
            >
              {ageBusy ? "Checking…" : "Confirm age"}
            </button>
          </>
        ) : (
          <>
            <p className="contributionGateEyebrow">Contributions paused</p>
            <h2 id="contribution-gate-title">You can’t contribute yet</h2>
            <p>
              PUBMAXX blocks contributions from people under 18. You can still
              browse the map and pub pages.
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
  const [ageBusy, setAgeBusy] = useState(false);
  const pending = useRef<{
    userId: string;
    action: PendingContribution;
  } | null>(null);
  if (gate.userId !== userId) {
    dispatch({ type: "account_changed", userId });
  }

  const resetGate = useCallback((nextUserId: string | null) => {
    pending.current = null;
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
      pending.current =
        result.status === "age_assessment_required"
          ? { userId: auth.userId, action }
          : null;
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

  const confirmAge = useCallback(
    async (dateOfBirth: string) => {
      const auth = captureAccountAuth(userId, session);
      const waiting = pending.current;
      if (!auth || !waiting || waiting.userId !== auth.userId || ageBusy) return;
      setAgeBusy(true);
      try {
        const response = await accountBoundFetch(
          auth,
          "/api/identity/contribution-age",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ dateOfBirth }),
          },
        );
        const body = (await response.json().catch(() => ({}))) as {
          status?: ContributionGateDialogMode | "adult";
          error?: unknown;
        };
        if (!response.ok) {
          const mode =
            body.status === "age_restricted" ||
            body.status === "sign_in_required" ||
            body.status === "onboarding_required"
              ? body.status
              : "age_assessment_required";
          if (mode !== "age_assessment_required") pending.current = null;
          if (mode === "age_restricted") {
            trackEvent("contribution_gate", { step: "age_restricted" });
          }
          dispatch({
            type: "show",
            userId,
            mode,
            error: typeof body.error === "string" ? body.error : null,
          });
          return;
        }
        trackEvent("contribution_gate", { step: "age_assessment_passed" });
        const result = await waiting.action(auth);
        pending.current =
          result?.status === "age_assessment_required" ? waiting : null;
        if (!result) {
          dispatch({ type: "clear", userId });
          return;
        }
        dispatch({
          type: "show",
          userId,
          mode: result.status,
          error: result.error ?? null,
        });
      } catch {
        dispatch({
          type: "show",
          userId,
          mode: "age_assessment_required",
          error: "Age confirmation is unavailable right now.",
        });
      } finally {
        setAgeBusy(false);
      }
    },
    [ageBusy, session, userId],
  );

  return {
    requestContribution,
    contributionGateDialog:
      gate.userId === userId && gate.mode ? (
        <ContributionGateDialog
          key={gate.mode}
          mode={gate.mode}
          error={gate.error}
          ageBusy={ageBusy}
          onConfirmAge={(dateOfBirth) => void confirmAge(dateOfBirth)}
          onClose={() => resetGate(userId)}
        />
      ) : null,
  };
}
