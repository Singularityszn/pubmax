"use client";

import type { Route } from "next";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "@/components/auth/authContext";
import { readProviderAccountRevision, subscribeProviderIdentityRevision } from "@/lib/authProviderRevision";
import { parsePlanCapabilitySnapshot, planCapabilityEvent, readPlanCapabilitySnapshot } from "@/lib/planSessionCapability";

type PlanMapRoute = { planId: string; scope: string; href: Route };
type Registration = PlanMapRoute & { owner: symbol };
const PlanMapContext = createContext<{
  route: Registration | null;
  register: (route: PlanMapRoute) => () => void;
} | null>(null);

export function usePlanMapAccountKey(): string {
  const { user } = useAuth();
  const accountRevision = useSyncExternalStore(subscribeProviderIdentityRevision, readProviderAccountRevision, () => 0);
  return JSON.stringify([accountRevision, user?.id ?? null]);
}

/** The account a member route was last read for, and the mount it renders in. */
export type PlanMemberMount = { accountKey: string; mountKey: string };

/**
 * A member read that named no account belongs to nobody, so the first account
 * to prove the same capability keeps its mount. Any other account change mounts
 * a fresh route: a route read for one account never renders for another.
 */
export function planMemberMountFor(current: PlanMemberMount | null, accountKey: string): PlanMemberMount {
  if (current?.accountKey === accountKey) return current;
  const arrival = current !== null && !namesAccount(current.accountKey) && namesAccount(accountKey);
  return { accountKey, mountKey: arrival ? current.mountKey : accountKey };
}

function namesAccount(accountKey: string): boolean {
  const [, userId] = JSON.parse(accountKey) as [number, string | null];
  return userId !== null;
}

/** Bind the private member projection to the account and capability that read it. */
export function usePlanMapScope(planId: string): string {
  const { providerAuthState } = useAuth();
  const accountKey = usePlanMapAccountKey();
  const capability = useSyncExternalStore(
    useCallback((onChange: () => void) => {
      if (!planId) return () => undefined;
      const event = planCapabilityEvent(planId);
      window.addEventListener(event, onChange);
      return () => window.removeEventListener(event, onChange);
    }, [planId]),
    useCallback(() => readPlanCapabilitySnapshot(planId), [planId]),
    () => "|0|",
  );
  const { token, role } = parsePlanCapabilitySnapshot(capability);
  if (!planId || !token || !role) return "";
  return JSON.stringify([planId, accountKey, providerAuthState, capability]);
}

export function PlanMapNavigationProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Registration | null>(null);
  const register = useCallback((next: PlanMapRoute) => {
    const owner = Symbol();
    setRoute({ ...next, owner });
    return () => setRoute((current) => current?.owner === owner ? null : current);
  }, []);
  return <PlanMapContext.Provider value={{ route, register }}>{children}</PlanMapContext.Provider>;
}

/** Register saved stops only. Draft edits do not change the navigation destination. */
export function useRegisterPlanMapRoute(planId: string, scope: string, href: Route | null) {
  const register = useContext(PlanMapContext)?.register;
  useEffect(() => {
    if (!register || !scope || !href) return;
    return register({ planId, scope, href });
  }, [register, planId, scope, href]);
}

export function usePlanMapHref(fallback: Route): Route {
  const pathname = usePathname();
  const route = useContext(PlanMapContext)?.route;
  const planId = pathname?.match(/^\/plan\/([^/]+)$/)?.[1] ?? "";
  const scope = usePlanMapScope(planId);
  return route && planId === route.planId && scope !== "" && scope === route.scope ? route.href : fallback;
}
