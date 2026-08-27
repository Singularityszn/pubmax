"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import {
  PAL_GUEST_PROMPT_LIMIT,
  palGuestSignupHref,
} from "@/lib/palGuestTrial";

export default function PalGuestAccountGate({
  answeredPrompts,
}: {
  answeredPrompts: number;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const gateRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      headingRef.current?.focus({ preventScroll: true });
      gateRef.current?.scrollIntoView({ block: "end" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section className="palGuestGate" aria-labelledby="pal-guest-gate-title" ref={gateRef}>
      <p className="palGuestGateCount">
        {Math.min(answeredPrompts, PAL_GUEST_PROMPT_LIMIT)} of {PAL_GUEST_PROMPT_LIMIT}
      </p>
      <h2 id="pal-guest-gate-title" ref={headingRef} tabIndex={-1}>Five guest answers complete</h2>
      <div className="palGuestGateActions">
        <Link className="palGuestGateCreate pressable" href={palGuestSignupHref()}>
          Create your account
        </Link>
        <Link className="palGuestGateSignIn" href="/login?mode=signin&from=%2Fpal">
          Sign in
        </Link>
      </div>
    </section>
  );
}
