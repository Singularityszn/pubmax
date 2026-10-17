"use client";

// Fires plan_invite_opened once per page load for anonymous / first-open viewers
// of a shared plan link. Members who already have a capability still count as an
// invite open when they arrive via the shared URL (source from ?vibe= when set).
//
// The host is not an invite open. Locking a plan sends its host to
// /plan/{id}#share with the host capability already in memory, and counting
// that landing made every lock read as a guest arriving a second later: all
// four production opens were one host, each a second after their own save.

import { useEffect, useRef } from "react";

import { trackEvent } from "@/lib/analytics";
import { parsePlanCapabilitySnapshot, readPlanCapabilitySnapshot } from "@/lib/planSessionCapability";

/** True when this page load is someone other than the host opening the plan. */
export function isInviteOpen(input: { hash: string; role: "host" | "guest" | null }): boolean {
  if (input.role === "host") return false;
  // The composer's own hand-off after Lock, before any capability restore.
  if (input.hash === "#share") return false;
  return true;
}

export default function PlanInviteOpened({ planId }: { planId: string }) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    let source = "shared-plan";
    let hash = "";
    try {
      hash = window.location.hash;
      const vibe = new URLSearchParams(window.location.search).get("vibe");
      if (vibe) source = "vibe-link";
    } catch {
      source = "shared-plan";
    }
    const { role } = parsePlanCapabilitySnapshot(readPlanCapabilitySnapshot(planId));
    if (!isInviteOpen({ hash, role })) return;
    trackEvent("plan_invite_opened", { source });
  }, [planId]);

  return null;
}
