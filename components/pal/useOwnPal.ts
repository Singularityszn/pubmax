"use client";

import { useMemo, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/authContext";
import { readLocalPalSnapshot, subscribeLocalPal } from "@/lib/localPal";
import type { PubPal } from "@/lib/pubPal";

export function useOwnPalSnapshot(): string | null {
  const { user, loading, getCurrentUserId } = useAuth();
  return useSyncExternalStore(
    subscribeLocalPal,
    () => readLocalPalSnapshot(user && !loading && getCurrentUserId() === user.id ? user.id : null),
    () => null,
  );
}

/**
 * The signed-in person's own Pal, or null. The stored Pal is a device cache, so
 * it counts only for the account that owns it, and a hidden Pal is no Pal. It
 * is read again when it changes, in this tab or another.
 */
export function useOwnPal(): PubPal | null {
  const snapshot = useOwnPalSnapshot();
  return useMemo(() => {
    const pal = snapshot ? JSON.parse(snapshot) as PubPal : null;
    return pal && !pal.hidden ? pal : null;
  }, [snapshot]);
}
