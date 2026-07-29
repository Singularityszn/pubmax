"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import {
  accountBoundFetch,
  captureAccountAuth,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import { trackEvent } from "@/lib/analytics";
import {
  checkAccountHandleAvailability,
  loadAccountOnboardingStatus,
} from "@/lib/accountOnboardingClient";
import { emitIdentityHandleChanged } from "@/lib/identityClient";
import {
  cleanDateOfBirth,
  PRIVATE_IDENTITY_SEX_VALUES,
  type PrivateIdentitySex,
} from "@/lib/privateIdentity";
import { assessPubmaxxHandle } from "@/lib/pubmaxxIdentity";

import "./accountOnboarding.css";

type Availability =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "reserved"
  | "invalid";

type AccountOnboardingFormProps = {
  handle: string;
  dateOfBirth: string;
  fullName: string;
  sex: "" | PrivateIdentitySex;
  availability: Availability;
  busy: boolean;
  error: string | null;
  onHandleChange: (value: string) => void;
  onDateOfBirthChange: (value: string) => void;
  onFullNameChange: (value: string) => void;
  onSexChange: (value: "" | PrivateIdentitySex) => void;
  onSubmit: () => void;
  onSkipOptional: () => void;
};

const SEX_LABELS: Record<PrivateIdentitySex, string> = {
  female: "Female",
  male: "Male",
  intersex: "Intersex",
  prefer_not_to_say: "Prefer not to say",
};

export function canSubmitCheckedHandle(
  handle: string,
  checkedHandle: string | null,
  availability: Availability,
): boolean {
  return availability === "available" && handle === checkedHandle;
}

function availabilityCopy(availability: Availability): string | null {
  if (availability === "checking") return "Checking availability…";
  if (availability === "available") return "Handle available.";
  if (availability === "taken") return "That handle is already taken.";
  if (availability === "reserved") return "That handle is not available.";
  if (availability === "invalid") {
    return "Use 3–30 letters, numbers, or underscores.";
  }
  return null;
}

export function AccountOnboardingForm({
  handle,
  dateOfBirth,
  fullName,
  sex,
  availability,
  busy,
  error,
  onHandleChange,
  onDateOfBirthChange,
  onFullNameChange,
  onSexChange,
  onSubmit,
  onSkipOptional,
}: AccountOnboardingFormProps): React.JSX.Element {
  const status = availabilityCopy(availability);
  const canSubmit =
    availability === "available" &&
    handle.trim().length > 0 &&
    cleanDateOfBirth(dateOfBirth) !== null &&
    !busy;
  return (
    <div className="accountOnboardingBackdrop" role="presentation">
      <section
        className="accountOnboarding"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-onboarding-title"
        aria-describedby="account-onboarding-lead account-onboarding-privacy"
      >
        <header className="accountOnboardingHead">
          <p className="accountOnboardingEyebrow">Your PUBMAXX identity</p>
          <h2 id="account-onboarding-title">Choose how people know you</h2>
          <p id="account-onboarding-lead">
            Your public handle appears on every contribution you make.
          </p>
        </header>

        <label className="accountOnboardingField accountOnboardingHandle">
          <span>
            Public handle <strong>Required</strong>
          </span>
          <span className="accountOnboardingInputWrap">
            <i aria-hidden="true">@</i>
            <input
              value={handle}
              onChange={(event) => onHandleChange(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={31}
              aria-describedby="account-onboarding-handle-status"
            />
          </span>
        </label>
        <p
          id="account-onboarding-handle-status"
          className={`accountOnboardingStatus is-${availability}`}
          role={availability === "taken" || availability === "reserved" ? "alert" : "status"}
        >
          {status ?? "Letters, numbers and underscores."}
        </p>

        <label className="accountOnboardingField">
          <span>
            Date of birth <strong>Required</strong>
          </span>
          <input
            type="date"
            value={dateOfBirth}
            autoComplete="bday"
            required
            onChange={(event) => onDateOfBirthChange(event.target.value)}
          />
        </label>

        <div className="accountOnboardingOptional">
          <p>Optional private details</p>
          <label className="accountOnboardingField">
            <span>
              Full name <small>Optional</small>
            </span>
            <input
              value={fullName}
              onChange={(event) => onFullNameChange(event.target.value)}
              autoComplete="name"
              maxLength={100}
            />
          </label>
          <label className="accountOnboardingField">
            <span>
              Sex <small>Optional</small>
            </span>
            <select
              value={sex}
              onChange={(event) =>
                onSexChange(event.target.value as "" | PrivateIdentitySex)
              }
            >
              <option value="">Not added</option>
              {PRIVATE_IDENTITY_SEX_VALUES.map((value) => (
                <option value={value} key={value}>
                  {SEX_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p id="account-onboarding-privacy" className="accountOnboardingPrivacy">
          Only your handle is public. Date of birth, full name and sex stay
          private. We use them for product analytics and social features.
        </p>
        {error ? (
          <p className="accountOnboardingError" role="alert">
            {error}
          </p>
        ) : null}
        <div className="accountOnboardingActions">
          <button
            type="button"
            className="accountOnboardingPrimary"
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {busy ? "Claiming…" : availability === "checking" ? "Checking…" : "Claim handle"}
          </button>
          <button
            type="button"
            className="accountOnboardingSkip"
            disabled={!canSubmit}
            onClick={onSkipOptional}
          >
            Skip optional details
          </button>
        </div>
      </section>
    </div>
  );
}

export function AccountOnboardingLoadError({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="accountOnboardingBackdrop" role="presentation">
      <section
        className="accountOnboarding"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-onboarding-error-title"
      >
        <header className="accountOnboardingHead">
          <p className="accountOnboardingEyebrow">Your PUBMAXX identity</p>
          <h2 id="account-onboarding-error-title">Account setup paused</h2>
          <p className="accountOnboardingError" role="alert">
            {error}
          </p>
        </header>
        <button
          type="button"
          className="accountOnboardingPrimary accountOnboardingRetry"
          onClick={onRetry}
        >
          Try again
        </button>
      </section>
    </div>
  );
}

function suggestedHandle(): string {
  try {
    const stored = window.localStorage.getItem("pubmax_handle") ?? "";
    const assessment = assessPubmaxxHandle(stored);
    return assessment.ok ? assessment.handle : "";
  } catch {
    return "";
  }
}

function AccountOnboardingForUser({
  auth,
}: {
  auth: AccountAuthSnapshot;
}): React.JSX.Element | null {
  const [status, setStatus] = useState<
    "loading" | "needed" | "complete" | "unavailable"
  >("loading");
  const [statusError, setStatusError] = useState(
    "Account setup is unavailable right now.",
  );
  const [statusRequest, setStatusRequest] = useState(() => ({
    auth,
    attempt: 0,
  }));
  const [handle, setHandle] = useState(suggestedHandle);
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [fullName, setFullName] = useState("");
  const [sex, setSex] = useState<"" | PrivateIdentitySex>("");
  const [availability, setAvailability] =
    useState<Availability>("idle");
  const [checkedHandle, setCheckedHandle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void loadAccountOnboardingStatus(
      (input, init) => accountBoundFetch(statusRequest.auth, input, init),
      controller.signal,
    ).then(
      (result) => {
        if (!active) return;
        if (result.status === "complete") {
          setStatus("complete");
          return;
        }
        if (result.status === "unavailable") {
          setStatusError(result.error);
          setStatus("unavailable");
          return;
        }
        const suggestion = result.handle ?? suggestedHandle();
        setHandle(suggestion);
        setCheckedHandle(result.handle ?? null);
        setAvailability(result.handle ? "available" : suggestion ? "checking" : "idle");
        setStatus("needed");
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [statusRequest]);

  useEffect(() => {
    if (availability !== "checking") return;
    const assessment = assessPubmaxxHandle(handle);
    if (!assessment.ok) return;
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void checkAccountHandleAvailability(
        assessment.handle,
        fetch,
        controller.signal,
      ).then((result) => {
        if (!active) return;
        if (result.status === "available") {
          setCheckedHandle(assessment.handle);
          setAvailability("available");
          return;
        }
        if (result.status === "taken") {
          setCheckedHandle(null);
          setAvailability("taken");
          return;
        }
        setCheckedHandle(null);
        setAvailability("idle");
        if (!controller.signal.aborted) setError(result.error);
      });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [availability, handle]);

  const changeHandle = useCallback((value: string) => {
    const presented = value.trim().replace(/^@/, "").toLowerCase();
    setHandle(presented);
    setCheckedHandle(null);
    setError(null);
    const assessment = assessPubmaxxHandle(presented);
    setAvailability(
      assessment.ok
        ? "checking"
        : assessment.reason === "reserved"
          ? "reserved"
          : presented
            ? "invalid"
            : "idle",
    );
  }, []);

  const submit = useCallback(
    async (includeOptional: boolean) => {
      if (
        !canSubmitCheckedHandle(handle, checkedHandle, availability) ||
        !cleanDateOfBirth(dateOfBirth) ||
        busy
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const response = await accountBoundFetch(
          auth,
          "/api/identity/onboarding",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              handle,
              dateOfBirth,
              ...(includeOptional && fullName.trim() ? { fullName } : {}),
              ...(includeOptional && sex ? { sex } : {}),
            }),
          },
        );
        const body = (await response.json().catch(() => ({}))) as {
          handle?: unknown;
          code?: unknown;
          error?: unknown;
        };
        if (!active.current) return;
        if (!response.ok) {
          if (body.code === "taken") setAvailability("taken");
          if (body.code === "reserved") setAvailability("reserved");
          setCheckedHandle(null);
          setError(
            typeof body.error === "string"
              ? body.error
              : "Could not claim that handle.",
          );
          return;
        }
        const claimed =
          typeof body.handle === "string" ? body.handle : handle;
        try {
          window.localStorage.setItem("pubmax_handle", claimed);
        } catch {
          // Account ownership is durable even when browser storage is blocked.
        }
        emitIdentityHandleChanged({ ownerId: auth.userId, handle: claimed });
        trackEvent("account_claimed", { source: "auth" });
        setStatus("complete");
      } catch {
        if (active.current) {
          setError("Could not claim that handle. Check your connection.");
        }
      } finally {
        if (active.current) setBusy(false);
      }
    },
    [
      auth,
      availability,
      busy,
      checkedHandle,
      dateOfBirth,
      fullName,
      handle,
      sex,
    ],
  );

  if (status === "loading" || status === "complete") return null;
  if (status === "unavailable") {
    return (
      <AccountOnboardingLoadError
        error={statusError}
        onRetry={() => {
          setStatus("loading");
          setStatusRequest((current) => ({
            auth,
            attempt: current.attempt + 1,
          }));
        }}
      />
    );
  }
  return (
    <AccountOnboardingForm
      handle={handle}
      dateOfBirth={dateOfBirth}
      fullName={fullName}
      sex={sex}
      availability={availability}
      busy={busy}
      error={error}
      onHandleChange={changeHandle}
      onDateOfBirthChange={setDateOfBirth}
      onFullNameChange={setFullName}
      onSexChange={setSex}
      onSubmit={() => void submit(true)}
      onSkipOptional={() => void submit(false)}
    />
  );
}

export default function AccountOnboarding(): React.JSX.Element | null {
  const { user, loading, session } = useAuth();
  const auth = captureAccountAuth(user?.id ?? null, session);
  if (loading || !user || !auth) return null;
  return <AccountOnboardingForUser key={user.id} auth={auth} />;
}
