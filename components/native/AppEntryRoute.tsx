"use client";

// Mounted only on the homepage (app/page.tsx) — the route the Capacitor
// remote-URL wrap always opens first and the only route the entry decision
// may rewrite. lib/entryDecision.ts owns the whole policy (deep links bypass,
// shell opens land on /tonight, native first-run opens onboarding,
// browser visits keep the landing page); this component only snapshots the
// live context, applies the decision, and persists the first-run mark.
// Renders nothing; a no-op on the web and during SSR.

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  decideEntry,
  entryFirstRunHref,
  readEntryContext,
} from "@/lib/entryDecision";
import {
  clearNativeFirstRunHandoff,
  issueNativeFirstRunHandoff,
  markNativeFirstRunRouted,
} from "@/lib/nativeFirstRun";

export default function AppEntryRoute(): null {
  const router = useRouter();
  const pathname = usePathname();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const decision = decideEntry(readEntryContext(pathname ?? "/"), entryFirstRunHref());
    if (decision.kind !== "route") {
      clearNativeFirstRunHandoff();
      return;
    }
    if (decision.reason === "native-first-run") {
      // Eligibility is carried out-of-URL and consumed by the guarded route.
      // Mark first so a slow transition can never double-fire on another boot.
      issueNativeFirstRunHandoff();
      markNativeFirstRunRouted();
    } else {
      clearNativeFirstRunHandoff();
    }
    router.replace(decision.href);
  }, [router, pathname]);

  return null;
}
