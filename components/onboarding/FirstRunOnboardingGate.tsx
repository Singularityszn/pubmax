"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import FirstRunOnboarding from "@/components/onboarding/FirstRunOnboarding";
import { SHELL_START_PATH } from "@/lib/entryDecision";
import { webOnboardingStartRequested } from "@/lib/firstRunRoute";
import { hasSeenTour } from "@/lib/firstRunTour";
import { LANDING_PRIMARY_HREF } from "@/lib/landingHero";
import { consumeNativeFirstRunHandoff, readNativeFirstRunStep } from "@/lib/nativeFirstRun";
import { isNativeApp } from "@/lib/nativePlatform";

type ReviewedArea = {
  name: string;
  transportAnchor: string;
};

type EligibilityDecision = {
  allowed: boolean;
  fallback: Route;
  /** Where Skip lands: Tonight in the shell, the hero's own door on the web. */
  skipHref: Route;
};

/**
 * Fail-closed route boundary for /onboarding. The stateful onboarding UI is
 * mounted after a native entry handoff or while a native journey is unfinished.
 * On the web, it mounts when the landing hero sent a first-time visitor with the
 * start mark. A start-marked visit that already holds the seen mark (browser
 * Back after finishing or skipping) goes on to the hero's own door, any other
 * web visit returns home, and an ineligible native visit returns to Tonight.
 */
export default function FirstRunOnboardingGate({
  reviewedAreas,
}: {
  reviewedAreas: ReviewedArea[];
}) {
  const router = useRouter();
  const decision = useRef<EligibilityDecision | null>(null);
  const [skipHref, setSkipHref] = useState<Route | null>(null);

  useEffect(() => {
    if (!decision.current) {
      const isNative = isNativeApp();
      const webStart = !isNative && webOnboardingStartRequested(window.location.search);
      decision.current = {
        // The shell can start through its handoff or resume unfinished progress. A browser is let in
        // only when the landing hero said it meant to start (the web start
        // mark) and the visitor has not met the journey yet (the seen mark).
        allowed: isNative
          ? consumeNativeFirstRunHandoff(isNative) || readNativeFirstRunStep() !== null
          : webStart && !hasSeenTour(),
        fallback: isNative ? SHELL_START_PATH : webStart ? LANDING_PRIMARY_HREF : "/",
        // The landing hero is the one web door in, so a web Skip goes where
        // that tap was going before the journey stepped in front of it.
        skipHref: isNative ? SHELL_START_PATH : LANDING_PRIMARY_HREF,
      };
    }

    if (!decision.current.allowed) {
      router.replace(decision.current.fallback);
      return;
    }

    let cancelled = false;
    const { skipHref: target } = decision.current;
    void Promise.resolve().then(() => {
      if (!cancelled) setSkipHref(target);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!skipHref) {
    return <main
        id="main"
        className="firstRunOnboarding firstRunOnboardingGate pageHidesCreateFab"
        aria-busy="true"
      />;
  }

  return <FirstRunOnboarding reviewedAreas={reviewedAreas} skipHref={skipHref} />;
}
