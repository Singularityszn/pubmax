"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import SignInButton from "@/components/auth/SignInButton";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  captureAccountAuth,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import { trackEvent } from "@/lib/analytics";
import {
  checkContributionGate,
  dateOfBirthAfterAssessment,
  submitContributionAge,
} from "@/lib/contributionGateClient";

import "./contributionGate.css";

export type ContributionGateDialogMode =
  | "sign_in_required"
  | "age_required"
  | "underage";

type ContributionGateDialogProps = {
  mode: ContributionGateDialogMode;
  eligibleOn?: string;
  dateOfBirth: string;
  busy: boolean;
  error: string | null;
  onDateOfBirthChange: (value: string) => void;
  onConfirmAge: () => void;
  onClose: () => void;
};

function formattedEligibilityDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

export function ContributionGateDialog({
  mode,
  eligibleOn,
  dateOfBirth,
  busy,
  error,
  onDateOfBirthChange,
  onConfirmAge,
  onClose,
}: ContributionGateDialogProps): React.JSX.Element {
  const eligibilityDate = formattedEligibilityDate(eligibleOn);
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
            <p className="contributionGateEyebrow">Before you log it</p>
            <h2 id="contribution-gate-title">Sign in to contribute</h2>
            <p>
              Your contribution needs an account-owned public handle. Email
              sign-in works even when Google and Apple are unavailable.
            </p>
            <SignInButton />
          </>
        ) : null}

        {mode === "age_required" ? (
          <>
            <p className="contributionGateEyebrow">One check, once</p>
            <h2 id="contribution-gate-title">Confirm you are 18 or over</h2>
            <p>
              We ask immediately before your first contribution because PUBMAXX
              is about buying alcohol. Your date of birth is checked, then
              discarded.
            </p>
            <label className="contributionGateField">
              <span>Date of birth</span>
              <input
                type="date"
                value={dateOfBirth}
                onChange={(event) => onDateOfBirthChange(event.target.value)}
                autoComplete="bday"
              />
            </label>
            <button
              type="button"
              className="contributionGatePrimary"
              disabled={busy || !dateOfBirth}
              onClick={onConfirmAge}
            >
              {busy ? "Checking…" : "Confirm and contribute"}
            </button>
          </>
        ) : null}

        {mode === "underage" ? (
          <>
            <p className="contributionGateEyebrow">Contribution blocked</p>
            <h2 id="contribution-gate-title">
              You must be 18 or over to contribute.
            </h2>
            <p>
              PUBMAXX is about buying alcohol, so under-18s cannot add community
              prices or pub signals.
            </p>
            {eligibilityDate ? (
              <p>You can contribute from {eligibilityDate}.</p>
            ) : null}
          </>
        ) : null}

        {error ? (
          <p className="contributionGateError" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="contributionGateClose"
          disabled={busy}
          onClick={onClose}
        >
          Not now
        </button>
      </section>
    </div>
  );
}

type PendingContribution = (
  auth: AccountAuthSnapshot,
) => void | Promise<void>;

type CapturedContribution = Readonly<{
  action: PendingContribution;
  auth: AccountAuthSnapshot;
}>;

export function useContributionGate(): {
  requestContribution: (action: PendingContribution) => Promise<void>;
  contributionGateDialog: React.JSX.Element | null;
} {
  const { user, session } = useAuth();
  const userId = user?.id ?? null;
  const [mode, setMode] = useState<ContributionGateDialogMode | null>(null);
  const [eligibleOn, setEligibleOn] = useState<string | undefined>();
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gateUserId, setGateUserId] = useState(userId);
  const pending = useRef<CapturedContribution | null>(null);
  const stateUserId = useRef(userId);

  const resetGate = useCallback((nextUserId: string | null) => {
    pending.current = null;
    setMode(null);
    setEligibleOn(undefined);
    setDateOfBirth("");
    setBusy(false);
    setError(null);
    setGateUserId(nextUserId);
    stateUserId.current = nextUserId;
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) resetGate(userId);
    });
    return () => {
      active = false;
      pending.current = null;
      stateUserId.current = null;
    };
  }, [resetGate, userId]);

  const requestContribution = useCallback(
    async (action: PendingContribution) => {
      if (stateUserId.current !== userId) return;
      setError(null);
      const auth = captureAccountAuth(userId, session);
      if (!user || !auth) {
        pending.current = null;
        trackEvent("contribution_gate", { step: "sign_in_required" });
        setMode("sign_in_required");
        return;
      }
      const contribution = { action, auth };
      pending.current = contribution;
      setBusy(true);
      const gate = await checkContributionGate(auth);
      if (
        stateUserId.current !== userId ||
        pending.current !== contribution
      ) {
        return;
      }
      setBusy(false);
      if (gate.status === "eligible") {
        pending.current = null;
        await action(auth);
        return;
      }
      if (gate.status === "age_required") {
        trackEvent("contribution_gate", { step: "age_required" });
        setMode("age_required");
        return;
      }
      if (gate.status === "underage") {
        trackEvent("contribution_gate", { step: "underage" });
        pending.current = null;
        setEligibleOn(gate.eligibleOn);
        setMode("underage");
        return;
      }
      if (gate.status === "onboarding_required") {
        trackEvent("contribution_gate", { step: "onboarding_required" });
        pending.current = null;
        setError("Choose your public handle in account setup first.");
        return;
      }
      pending.current = null;
      setError(gate.error ?? "Could not check contribution eligibility.");
    },
    [session, user, userId],
  );

  const confirmAge = useCallback(async () => {
    const contribution = pending.current;
    if (
      !dateOfBirth ||
      busy ||
      stateUserId.current !== userId ||
      !contribution ||
      contribution.auth.userId !== userId
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const gate = await submitContributionAge(
      dateOfBirth,
      contribution.auth,
    );
    if (
      stateUserId.current !== userId ||
      pending.current !== contribution
    ) {
      return;
    }
    setBusy(false);
    setDateOfBirth(dateOfBirthAfterAssessment(dateOfBirth, gate));
    if (gate.status === "eligible") {
      setMode(null);
      pending.current = null;
      trackEvent("contribution_gate", { step: "resumed" });
      await contribution.action(contribution.auth);
      return;
    }
    if (gate.status === "underage") {
      trackEvent("contribution_gate", { step: "underage" });
      pending.current = null;
      setEligibleOn(gate.eligibleOn);
      setMode("underage");
      return;
    }
    setError(gate.error ?? "Could not confirm contribution eligibility.");
  }, [busy, dateOfBirth, userId]);

  return {
    requestContribution,
    contributionGateDialog: mode && gateUserId === userId ? (
      <ContributionGateDialog
        mode={mode}
        eligibleOn={eligibleOn}
        dateOfBirth={dateOfBirth}
        busy={busy}
        error={error}
        onDateOfBirthChange={setDateOfBirth}
        onConfirmAge={() => void confirmAge()}
        onClose={() => resetGate(userId)}
      />
    ) : null,
  };
}
