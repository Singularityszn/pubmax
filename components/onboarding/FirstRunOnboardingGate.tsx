"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import FirstRunOnboarding from "@/components/onboarding/FirstRunOnboarding";
import { SHELL_START_PATH } from "@/lib/entryDecision";
import { webOnboardingStartRequested } from "@/lib/firstRunRoute";
import { consumeNativeFirstRunHandoff } from "@/lib/nativeFirstRun";
import { isNativeApp } from "@/lib/nativePlatform";

type ReviewedArea = {
  name: string;
  transportAnchor: string;
};

type EligibilityDecision = {
  allowed: boolean;
  fallback: "/" | typeof SHELL_START_PATH;
};

/**
 * Fail-closed route boundary for /onboarding. The stateful onboarding UI is
 * mounted only after consuming the one-time handoff issued at the native root,
 * or, on the web, when an in-app link carried the start mark. Any other web
 * visit returns home and an ineligible native visit returns to Tonight.
 */
export default function FirstRunOnboardingGate({
  reviewedAreas,
}: {
  reviewedAreas: ReviewedArea[];
}) {
  const router = useRouter();
  const decision = useRef<EligibilityDecision | null>(null);
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    if (!decision.current) {
      const isNative = isNativeApp();
      decision.current = {
        // The shell is let in by its one-time handoff. A browser is let in
        // only when an in-app link said it meant to start (the web start mark).
        allowed: isNative
          ? consumeNativeFirstRunHandoff(isNative)
          : webOnboardingStartRequested(window.location.search),
        fallback: isNative ? SHELL_START_PATH : "/",
      };
    }

    if (!decision.current.allowed) {
      router.replace(decision.current.fallback);
      return;
    }

    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setEligible(true);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!eligible) {
    return <main
        id="main"
        className="firstRunOnboarding firstRunOnboardingGate pageHidesCreateFab"
        aria-busy="true"
      />;
  }

  return <FirstRunOnboarding reviewedAreas={reviewedAreas} />;
}
