"use client";

import type { ReactNode, RefObject } from "react";

// The modal and its accessible name stay mounted across form chunk retries.
export function AccountOnboardingFrame({
  dialogRef,
  children,
}: {
  dialogRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="accountOnboardingBackdrop" role="presentation">
      <section
        ref={dialogRef}
        className="accountOnboarding"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="account-onboarding-title"
        aria-describedby="account-onboarding-lead account-onboarding-privacy"
      >
        <header className="accountOnboardingHead">
          <p className="accountOnboardingEyebrow">Welcome to PUBMAXX</p>
          <h2 id="account-onboarding-title">Let&apos;s get you in</h2>
          <p id="account-onboarding-lead">
            Pick the name people see.{" "}
            {"Your public handle appears on every contribution you make."}
          </p>
        </header>
        {children}
      </section>
    </div>
  );
}

export function AccountOnboardingPrivacy(): React.JSX.Element {
  return (
    <p id="account-onboarding-privacy" className="accountOnboardingPrivacy">
      Only your handle is public. Date of birth and name stay private. We
      use a date of birth you give to check your age, and both for product
      analytics and social features.
    </p>
  );
}
