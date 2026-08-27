"use client";

import { useEffect, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import {
  accountBoundFetch,
  captureAccountAuth,
} from "@/lib/accountBoundFetch";
import { markActivePlan, setActivePlanRole } from "@/lib/activePlan";
import {
  parsePlanCapabilitySnapshot,
  planCapabilityEvent,
  readPlanCapabilitySnapshot,
  restorePlanCapability,
} from "@/lib/planSessionCapability";

// Records the plan being viewed as "on tonight" (lib/activePlan), so the shell's
// Night Mode card can surface it across every screen. Renders nothing — it's a
// pure side-effect marker mounted by the plan page.
//
// Gated on the same plan-member capability seam PlanCrew and NightCrawlMode
// read (lib/planSessionCapability, backed by the HttpOnly session in
// lib/planMemberCapability): only a viewer who holds host or accepted-guest
// capability for this plan gets marked. A pre-join visitor opening a shared
// /plan link has no capability yet, so nothing is marked and Night Mode never
// ambushes their join flow. An accepted mate does get Night Mode — joining
// writes the same capability event (role "guest") the host gets at creation
// (role "host"), so a mate who joins mid-visit picks this up live, no reload.
export default function ActivePlanMarker({ id, startTime }: { id: string; startTime: string }) {
  const { session, user } = useAuth();
  const capabilitySnapshot = useSyncExternalStore(
    (onChange) => {
      const event = planCapabilityEvent(id);
      window.addEventListener(event, onChange);
      return () => window.removeEventListener(event, onChange);
    },
    () => readPlanCapabilitySnapshot(id),
    () => "|0|",
  );
  const { role } = parsePlanCapabilitySnapshot(capabilitySnapshot);

  useEffect(() => {
    if (role === "host" || role === "guest") {
      markActivePlan(id, startTime);
      setActivePlanRole(id, role);
      return;
    }
    // No cached capability yet — this is either a bare visitor (fail closed,
    // mark nothing) or a member whose cookie hasn't been restored into the
    // client cache this tab. Ask once; a positive result fires the same
    // capability event and re-runs this effect with role set.
    void restorePlanCapability(id).catch(() => undefined);
  }, [id, startTime, role]);

  useEffect(() => {
    const auth = captureAccountAuth(user?.id ?? null, session);
    if (!auth || (role !== "host" && role !== "guest")) {
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const wait = (delayMs: number): Promise<void> => new Promise((resolve) => {
      retryTimer = setTimeout(resolve, delayMs);
    });
    const claim = async (): Promise<void> => {
      for (const delayMs of [0, 250, 1_000]) {
        if (cancelled) return;
        if (delayMs > 0) await wait(delayMs);
        if (cancelled) return;
        try {
          const response = await accountBoundFetch(
            auth,
            `/api/plans/${id}/session`,
            { method: "PUT" },
          );
          if (response.ok || (response.status !== 429 && response.status !== 503)) {
            return;
          }
        } catch {
          // A session or network race gets the same bounded retry as a 503.
        }
      }
    };
    void claim();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [id, role, session, user?.id]);

  return null;
}
