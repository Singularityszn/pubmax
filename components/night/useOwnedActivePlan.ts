"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@/components/auth/authContext";
import { parseActivePlan, readOwnedActivePlan, serializeActivePlan, subscribeActivePlan } from "@/lib/activePlan";
import { subscribeDeviceIdentity } from "@/lib/deviceAccountIdentity";

function subscribe(onChange: () => void): () => void {
  const stopPlan = subscribeActivePlan(onChange);
  const stopIdentity = subscribeDeviceIdentity(onChange);
  return () => { stopPlan(); stopIdentity(); };
}

export function useOwnedActivePlan() {
  const { user, loading, getCurrentUserId } = useAuth();
  const snapshot = useSyncExternalStore(subscribe, () => {
    const accountId = getCurrentUserId();
    if (loading || accountId !== (user?.id ?? null)) return null;
    const ref = readOwnedActivePlan(accountId);
    return ref ? serializeActivePlan(ref) : null;
  }, () => null);
  return useMemo(() => parseActivePlan(snapshot), [snapshot]);
}
