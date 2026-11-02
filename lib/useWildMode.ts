"use client";

import { useEffect, useSyncExternalStore } from "react";

import { adoptWildModeFromAddress, readWildMode, subscribeWildMode } from "./wildMode";

/**
 * True while the wild switch is on in this browser (lib/wildMode.ts). The
 * server and the hydrating render answer false, so a wild surface is always
 * the client's second paint and never a hydration mismatch. The first mount
 * also adopts `?wild=1` or `?wild=0` from the address, and takes the param
 * off the address so a shared link does not carry it.
 */
export function useWildMode(): boolean {
  useEffect(() => {
    adoptWildModeFromAddress();
  }, []);
  return useSyncExternalStore(subscribeWildMode, readWildMode, () => false);
}
