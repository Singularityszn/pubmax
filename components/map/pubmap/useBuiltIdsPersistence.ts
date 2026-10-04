import { useEffect } from "react";
import { safeLocalStorage } from "@/lib/safeStorage";

// Refresh-safety net: mirror the hand-built stops to localStorage. This effect
// ONLY writes storage (no setState — react-hooks/set-state-in-effect is an
// error here). The explicit Clear action removes the key via clearBuilt.
// Extracted verbatim from PubMap (F1). Reading window.localStorage throws
// SecurityError when site data is blocked, so a missing store is a no-op.
export function useBuiltIdsPersistence(builtIds: string[], storageKey: string) {
  useEffect(() => {
    const storage = safeLocalStorage();
    if (!storage) return;
    if (builtIds.length) {
      storage.setItem(storageKey, JSON.stringify(builtIds));
    } else {
      storage.removeItem(storageKey);
    }
  }, [builtIds, storageKey]);
}
