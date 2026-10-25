"use client";

// The homepage owns the React fallback for native first-run routing.
// New binaries first open /app-entry, whose pre-paint script opens onboarding
// or Home. Older binaries open the root directly.
// lib/entryDecision.ts keeps explicit links, native onboarding and PWA entry
// behavior in one pure decision. Returning native launches stay on Home.
// The session stamp also lets a later PWA Home tap stay at the root.
// This component renders nothing and does not route an ordinary web visit.

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

import { readAuthCallbackAttempt } from "@/lib/authRedirect";
import { resetConsentWaitForEntryRewrite } from "@/lib/consentAnswerMoment";
import {
  decideEntry,
  entryFirstRunHref,
  markSessionEntryConsumed,
  readEntryContext,
} from "@/lib/entryDecision";
import {
  clearNativeFirstRunHandoff,
  beginNativeFirstRun,
  issueNativeFirstRunHandoff,
} from "@/lib/nativeFirstRun";

export default function AppEntryRoute(): null {
  const router = useRouter();
  const pathname = usePathname();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    // AuthProvider owns root callbacks before the shell can choose a destination.
    const decision = readAuthCallbackAttempt(window.location.href)
      ? null
      : decideEntry(readEntryContext(pathname ?? "/"), entryFirstRunHref());
    // The cold-start decision has now run for this session; every later arrival
    // at "/" (a deliberate in-app home tap) must stay on the landing page.
    // Stamp before acting so a slow route transition can't leave it unset.
    markSessionEntryConsumed();
    if (!decision) return;
    if (decision.kind !== "route") {
      clearNativeFirstRunHandoff();
      return;
    }
    // An automatic entry rewrite must not count as the reader's second route.
    // Naming the destination excludes the preceding route from consent timing,
    // regardless of which effect runs first (lib/consentAnswerMoment.ts).
    resetConsentWaitForEntryRewrite(decision.href);
    if (decision.reason === "native-first-run") {
      // Eligibility is carried out-of-URL and consumed by the guarded route.
      // Persist the unfinished journey before navigating, so a relaunch resumes it.
      issueNativeFirstRunHandoff();
      beginNativeFirstRun();
    } else {
      clearNativeFirstRunHandoff();
    }
    router.replace(decision.href);
  }, [router, pathname]);

  return null;
}
