"use client";

import type { Route } from "next";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "@/components/auth/authContext";
import { readProviderAccountRevision, subscribeProviderIdentityRevision } from "@/lib/authProviderRevision";
import { buildCrawlMapHref } from "@/lib/crawlUrl";
import { parsePlanCapabilitySnapshot, planCapabilityEvent, readPlanCapabilitySnapshot } from "@/lib/planSessionCapability";

type PlanMapRoute = { planId: string; scope: string; href: Route };
type Registration = PlanMapRoute & { owner: symbol };
const PlanMapContext = createContext<{
  route: Registration | null;
  register: (route: PlanMapRoute) => () => void;
} | null>(null);

/** Bind the private member projection to the account and capability that read it. */
export function usePlanMapScope(planId: string): string {
  const { providerAuthState, user } = useAuth();
  const accountRevision = useSyncExternalStore(subscribeProviderIdentityRevision, readProviderAccountRevision, () => 0);
  const capability = useSyncExternalStore(
    useCallback((onChange: () => void) => {
      const event = planCapabilityEvent(planId);
      window.addEventListener(event, onChange);
      return () => window.removeEventListener(event, onChange);
    }, [planId]),
    useCallback(() => readPlanCapabilitySnapshot(planId), [planId]),
    () => "|0|",
  );
  const { token, role } = parsePlanCapabilitySnapshot(capability);
  if (!token || !role) return "";
  return JSON.stringify([planId, accountRevision, user?.id ?? null, providerAuthState, capability]);
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
export function useRegisterPlanMapRoute(planId: string, scope: string, venueIds: string[]) {
  const register = useContext(PlanMapContext)?.register;
  const href = buildCrawlMapHref(venueIds);
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
