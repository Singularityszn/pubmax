"use client";

import { useEffect } from "react";

import { markActivePlan } from "@/lib/activePlan";

// Records the plan being viewed as "on tonight" (lib/activePlan), so the shell's
// Night Mode card can surface it across every screen. Renders nothing — it's a
// pure side-effect marker mounted by the plan page. Writing only happens inside
// markActivePlan's own active-window/id validation, and re-recording the same
// plan preserves how far the crew has walked (stopIndex).
export default function ActivePlanMarker({ id, startTime }: { id: string; startTime: string }) {
  useEffect(() => {
    markActivePlan(id, startTime);
  }, [id, startTime]);
  return null;
}
