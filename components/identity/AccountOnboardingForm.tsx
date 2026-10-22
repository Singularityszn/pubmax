"use client";

import { useState, type RefObject } from "react";
import { londonCalendarDate } from "@/lib/privateIdentity";
import {
  AccountOnboardingFrame,
  AccountOnboardingPrivacy,
} from "./AccountOnboardingFrame";

export type Availability =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "reserved"
  | "invalid";

export type AccountOnboardingFormProps = {
  dialogRef?: RefObject<HTMLElement | null>;
  handle: string;
  dateOfBirth: string;
  fullName: string;
  availability: Availability;
  busy: boolean;
  error: string | null;
  onHandleChange: (value: string) => void;
  onDateOfBirthChange: (value: string) => void;
  onFullNameChange: (value: string) => void;
  onSubmit: () => void;
};

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

/**
 * The first-timer welcome. Two beats and one action.
 *
 * Beat one is why they are here: a line of the place itself, not a form
 * heading. Beat two is the only thing the account genuinely cannot start
 * without, the handle. A name and a date of birth ride beside it and both are
 * OPTIONAL, because the age answer is the recorded adult tap (the 10 Aug rule,
 * `lib/socialLaunch.ts`) and a demanded birth date was a door with nothing
 * behind it. No second button offering to skip what was never demanded, and no
 * private details that profile editing already owns
 * (components/identity/PrivateIdentityEditor.tsx). A returning account never
 * reaches this surface at all.
 */
export default function AccountOnboardingFormBody({
  handle,
  dateOfBirth,
  fullName,
  availability,
  busy,
  error,
  onHandleChange,
  onDateOfBirthChange,
  onFullNameChange,
  onSubmit,
}: Omit<AccountOnboardingFormProps, "dialogRef">): React.JSX.Element {
  const status = availabilityCopy(availability);
  const [dateOfBirthMax] = useState(() => londonCalendarDate(Date.now()));
  // ONE RULE (captain, 5 Sep 2026): the handle is the only thing this card
  // demands. A date of birth is optional here as it is in profile editing, so
  // the age answer is the recorded adult tap for anybody who gives none.
  const canSubmit =
    availability === "available" && handle.trim().length > 0 && !busy;
  return (
    <>
      <div className="accountOnboardingStep">
        <label className="accountOnboardingField accountOnboardingHandle">
          <span>Your handle</span>
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

        <div className="accountOnboardingPair">
          <label className="accountOnboardingField">
            <span>
              Name <small>Optional</small>
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
              Date of birth <small>Optional</small>
            </span>
            <input
              type="date"
              value={dateOfBirth}
              autoComplete="bday"
              min="1900-01-01"
              max={dateOfBirthMax}
              onChange={(event) => onDateOfBirthChange(event.target.value)}
            />
          </label>
        </div>
      </div>

      <AccountOnboardingPrivacy />
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
      </div>
    </>
  );
}

// Compatibility for callers that render the complete form synchronously.
export function AccountOnboardingForm({
  dialogRef,
  ...props
}: AccountOnboardingFormProps): React.JSX.Element {
  return (
    <AccountOnboardingFrame dialogRef={dialogRef}>
      <AccountOnboardingFormBody {...props} />
    </AccountOnboardingFrame>
  );
}
