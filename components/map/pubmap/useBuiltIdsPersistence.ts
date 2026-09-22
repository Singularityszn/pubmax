import { useEffect } from "react";
import { safeLocalStorage } from "@/lib/safeStorage";

// Refresh-safety net: mirror the hand-built stops to localStorage. This effect
// ONLY writes storage (no setState — react-hooks/set-state-in-effect is an
// error here). An empty list removes the persisted refresh-safety net.
// Extracted verbatim from PubMap (F1).
export function useBuiltIdsPersistence(builtIds: string[], storageKey: string) {
  useEffect(() => {
    const storage = safeLocalStorage();
    if (!storage) return;
    try {
      if (builtIds.length) storage.setItem(storageKey, JSON.stringify(builtIds));
      else storage.removeItem(storageKey);
    } catch {
      // Persistence is optional; quota/permission failures keep the live route usable.
    }
  }, [builtIds, storageKey]);
}
