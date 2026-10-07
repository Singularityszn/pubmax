"use client";

// Mounted only on the homepage (app/page.tsx) — the route the Capacitor
// older remote-URL binaries open first. New binaries use the static /app-entry
// document and keep this component as the storage fallback.
// lib/entryDecision.ts owns the whole policy (deep links bypass,
// shell cold-starts land on /tonight, native first-run opens onboarding,
// browser visits keep the landing page); this component only snapshots the
// live context, applies the decision, and records the unfinished first-run step.
//
// Owner amendment (2026-07-21, amends #439): the decision fires only on the
// session's FIRST arrival at "/". We stamp the per-session flag
// (markSessionEntryConsumed) right after deciding, so a later in-app arrival at
// "/" (e.g. tapping the PUBMAXXING wordmark) reads the flag and stays on the
// landing page instead of bouncing back to /tonight. This component remounts on
// every client navigation to "/", so the second arrival re-runs decideEntry
// with sessionEntryConsumed already true and resolves to a "stay".
// Renders nothing; a no-op on the web and during SSR.

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
    // THE REWRITE IS THE APP'S MOVE, NOT THE READER'S. Landing then Tonight
    // is two routes, and reaching a second route is one of the answers the
    // consent card waits for, so the shell's own cold-start rewrite used to put
    // the card on the first screen a new person ever saw
    // (lib/consentAnswerMoment.ts, docs/proof/mobile-shells-refresh/).
    // The destination is named, so the route the rewrite LEAVES is swallowed
    // whichever effect React runs first (lib/consentAnswerMoment.ts).
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
