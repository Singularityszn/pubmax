"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/authContext";
import { readLocalPal, subscribeLocalPal } from "@/lib/localPal";
import type { PubPal } from "@/lib/pubPal";

/**
 * The signed-in person's own Pal, or null. The stored Pal is a device cache, so
 * it counts only for the account that owns it, and a hidden Pal is no Pal. It
 * is read again when it changes, in this tab or another.
 */
export function useOwnPal(): PubPal | null {
  const [pal, setPal] = useState<PubPal | null>(null);
  const accountId = useAuth().user?.id ?? null;
  useEffect(() => {
    const read = () => {
      const stored = readLocalPal();
      setPal(stored && !stored.hidden && accountId && stored.ownerId === accountId ? stored : null);
    };
    queueMicrotask(read);
    return subscribeLocalPal(read);
  }, [accountId]);
  return pal;
}
