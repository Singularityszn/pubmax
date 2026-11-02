"use client";

import { useEffect, useSyncExternalStore } from "react";

import { adoptWildModeParam, readWildMode, subscribeWildMode } from "./wildMode";

/**
 * True while the wild switch is on in this browser (lib/wildMode.ts). The
 * server and the hydrating render answer false, so a wild surface is always
 * the client's second paint and never a hydration mismatch. The first mount
 * also adopts `?wild=1` or `?wild=0` from the address.
 */
export function useWildMode(): boolean {
  useEffect(() => {
    if (typeof window !== "undefined") adoptWildModeParam(window.location.search);
  }, []);
  return useSyncExternalStore(subscribeWildMode, readWildMode, () => false);
}
