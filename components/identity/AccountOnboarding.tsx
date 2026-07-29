"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { trackEvent } from "@/lib/analytics";
import { authedFetch } from "@/lib/authedFetch";
import { emitIdentityHandleChanged } from "@/lib/identityClient";
import {
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
  fullName: string;
  sex: "" | PrivateIdentitySex;
  availability: Availability;
  busy: boolean;
  error: string | null;
  onHandleChange: (value: string) => void;
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
  fullName,
  sex,
  availability,
  busy,
  error,
  onHandleChange,
  onFullNameChange,
  onSexChange,
  onSubmit,
  onSkipOptional,
}: AccountOnboardingFormProps): React.JSX.Element {
  const status = availabilityCopy(availability);
  const canSubmit =
    availability === "available" && handle.trim().length > 0 && !busy;
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
            Your handle owns every contribution you make.
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
              <option value="">Not provided</option>
              {PRIVATE_IDENTITY_SEX_VALUES.map((value) => (
                <option value={value} key={value}>
                  {SEX_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p id="account-onboarding-privacy" className="accountOnboardingPrivacy">
          Only your handle is public. Full name and sex stay private.
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

function suggestedHandle(): string {
  try {
    const stored = window.localStorage.getItem("pubmax_handle") ?? "";
    const assessment = assessPubmaxxHandle(stored);
    return assessment.ok ? assessment.handle : "";
  } catch {
    return "";
  }
}

export default function AccountOnboarding(): React.JSX.Element | null {
  const { user, loading } = useAuth();
  const [needed, setNeeded] = useState(false);
  const [handle, setHandle] = useState(suggestedHandle);
  const [fullName, setFullName] = useState("");
  const [sex, setSex] = useState<"" | PrivateIdentitySex>("");
  const [availability, setAvailability] =
    useState<Availability>("idle");
  const [checkedHandle, setCheckedHandle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void authedFetch("/api/identity/onboarding")
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          complete?: unknown;
        };
        if (active) {
          const incomplete = response.ok && body.complete !== true;
          setNeeded(incomplete);
          if (incomplete) {
            const suggestion = suggestedHandle();
            setHandle(suggestion);
            setAvailability(suggestion ? "checking" : "idle");
          }
        }
      })
      .catch(() => {
        if (active) setError("Account setup is unavailable right now.");
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user || availability !== "checking") return;
    const assessment = assessPubmaxxHandle(handle);
    if (!assessment.ok) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ handle: assessment.handle });
      void fetch(`/api/identity/handle/availability?${query.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json().catch(() => ({}))) as {
            available?: unknown;
            reason?: unknown;
          };
          if (body.available === true) {
            setCheckedHandle(assessment.handle);
            setAvailability("available");
            return;
          }
          setCheckedHandle(null);
          setAvailability(body.reason === "reserved" ? "reserved" : "taken");
        })
        .catch((requestError: unknown) => {
          if ((requestError as { name?: unknown })?.name === "AbortError") return;
          setCheckedHandle(null);
          setAvailability("idle");
          setError("Could not check that handle. Try again.");
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [availability, handle, user]);

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
        busy
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const response = await authedFetch("/api/identity/onboarding", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            handle,
            ...(includeOptional && fullName.trim() ? { fullName } : {}),
            ...(includeOptional && sex ? { sex } : {}),
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          handle?: unknown;
          code?: unknown;
          error?: unknown;
        };
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
        emitIdentityHandleChanged(claimed);
        trackEvent("account_claimed", { source: "auth" });
        setNeeded(false);
      } catch {
        setError("Could not claim that handle. Check your connection.");
      } finally {
        setBusy(false);
      }
    },
    [availability, busy, checkedHandle, fullName, handle, sex],
  );

  if (loading || !user || !needed) return null;
  return (
    <AccountOnboardingForm
      handle={handle}
      fullName={fullName}
      sex={sex}
      availability={availability}
      busy={busy}
      error={error}
      onHandleChange={changeHandle}
      onFullNameChange={setFullName}
      onSexChange={setSex}
      onSubmit={() => void submit(true)}
      onSkipOptional={() => void submit(false)}
    />
  );
}
