"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import {
  accountBoundFetch,
  captureAccountAuth,
} from "@/lib/accountBoundFetch";
import { providerOwnsSession, readProviderAccountSignal } from "@/lib/authProviderRevision";
import { markActivePlan, setActivePlanRole } from "@/lib/activePlan";
import {
  INITIAL_PLAN_ACCOUNT_CLAIM,
  planAccountClaimDelay,
  planAccountClaimOutcome,
  transitionPlanAccountClaim,
  type PlanAccountClaimEvent,
  type PlanAccountClaimState,
} from "@/lib/planAccountClaim";
import {
  parsePlanCapabilitySnapshot,
  planAccountClaimEvent,
  planCapabilityEvent,
  readPlanCapabilitySnapshot,
  restorePlanCapability,
} from "@/lib/planSessionCapability";
import { discardBody } from "@/lib/responseBody";
import { subscribeToReconnectRecovery } from "@/lib/useReconnectRecovery";

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
  const { identityResolved, session, user, loading, getCurrentUserId } = useAuth();
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

  const restoreAttempt = useRef({ planId: id, identityResolved, attempted: false });

  useEffect(() => {
    if (!loading && (role === "host" || role === "guest")) {
      markActivePlan(id, startTime, Date.now(), getCurrentUserId());
      setActivePlanRole(id, role);
    }
  }, [id, startTime, role, loading, user?.id, getCurrentUserId]);

  useEffect(() => {
    const attempt = restoreAttempt.current;
    if (attempt.planId !== id || attempt.identityResolved !== identityResolved) {
      attempt.planId = id;
      attempt.identityResolved = identityResolved;
      attempt.attempted = false;
    }
    if (!identityResolved || role === "host" || role === "guest" || attempt.attempted) return;
    // No cached capability yet — this is either a bare visitor (fail closed,
    // mark nothing) or a member whose cookie hasn't been restored into the
    // client cache this tab. Ask once; a positive result fires the same
    // capability event and re-runs this effect with role set.
    attempt.attempted = true;
    void restorePlanCapability(id).catch(() => undefined);
  }, [id, identityResolved, role]);

  useEffect(() => {
    const auth = captureAccountAuth(user?.id ?? null, session);
    if (!auth || (role !== "host" && role !== "guest")) {
      return;
    }
    let state = INITIAL_PLAN_ACCOUNT_CLAIM;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let watched: { lifetime: number; signal: AbortSignal; stop: () => void } | undefined;
    const watch = (lifetime: number): AbortSignal => {
      if (watched?.lifetime === lifetime) return watched.signal;
      watched?.stop();
      const signal = readProviderAccountSignal();
      // Another provider can end the shared account lifetime while this
      // Supabase account stays signed in. Only then does the claim go on.
      const interrupted = () => step({
        type: "interrupted",
        lifetime,
        sameAccount: providerOwnsSession("supabase", auth.userId),
      });
      signal.addEventListener("abort", interrupted, { once: true });
      watched = { lifetime, signal, stop: () => signal.removeEventListener("abort", interrupted) };
      return signal;
    };
    const send = (lifetime: number, attempt: number): void => {
      void accountBoundFetch(auth, `/api/plans/${id}/session`, { method: "PUT", signal: watch(lifetime) }).then(
        (response) => {
          const outcome = planAccountClaimOutcome(response);
          discardBody(response);
          step({ type: "answered", lifetime, attempt, outcome });
        },
        () => step({ type: "answered", lifetime, attempt, outcome: planAccountClaimOutcome(null) }),
      );
    };
    const enter = (next: PlanAccountClaimState): void => {
      switch (next.phase) {
        case "sending":
          send(next.lifetime, next.attempt);
          return;
        case "waiting":
          watch(next.lifetime);
          retryTimer = setTimeout(
            () => step({ type: "waited", lifetime: next.lifetime, attempt: next.attempt }),
            planAccountClaimDelay(next.attempt),
          );
          return;
        case "exhausted":
          watch(next.lifetime);
          return;
        case "claimed":
          window.dispatchEvent(new Event(planAccountClaimEvent(id)));
          return;
        case "refused":
        case "stopped":
          return;
        default: {
          const unreachable: never = next;
          return unreachable;
        }
      }
    };
    function step(event: PlanAccountClaimEvent): void {
      const next = transitionPlanAccountClaim(state, event);
      if (next === state) return;
      state = next;
      clearTimeout(retryTimer);
      retryTimer = undefined;
      enter(next);
    }
    const stopRecovery = subscribeToReconnectRecovery(
      () => step({ type: "resumed" }),
      { events: ["online", "visible", "focus"] },
    );
    enter(state);
    return () => {
      step({ type: "disposed" });
      stopRecovery();
      watched?.stop();
    };
  }, [id, role, session, user?.id]);

  return null;
}
