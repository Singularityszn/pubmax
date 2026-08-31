"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";

import { palGuestSignupHref } from "@/lib/palGuestTrial";

type PalGuestAccountGateProps = {
  onSignInOpen?: () => void;
  palName?: string;
};

const ACCOUNT_ACTION_STYLE = {
  alignItems: "center",
  display: "inline-flex",
  justifyContent: "center",
  minHeight: 44,
} as const;

export default function PalGuestAccountGate({
  onSignInOpen,
  palName,
}: PalGuestAccountGateProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const companion = palName?.trim() || "your Pub Pal";

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      className="palGuestAccountGate"
      role="region"
      aria-labelledby={headingId}
    >
      <h2 id={headingId} ref={headingRef} tabIndex={-1}>
        Five guest answers complete
      </h2>
      <p>Create an account to keep talking with {companion}.</p>
      <div className="palGuestAccountActions">
        <Link
          className="palGuestAccountPrimary"
          href={palGuestSignupHref()}
          onClick={onSignInOpen}
          style={ACCOUNT_ACTION_STYLE}
        >
          Create account
        </Link>
        <Link
          className="palGuestAccountSecondary"
          href="/login?mode=signin&from=%2Fpal"
          onClick={onSignInOpen}
          style={ACCOUNT_ACTION_STYLE}
        >
          Sign in
        </Link>
      </div>
    </section>
  );
}
