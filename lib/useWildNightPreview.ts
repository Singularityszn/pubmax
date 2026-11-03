"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useWildMode } from "./useWildMode";
import { adoptWildNightPreviewFromAddress, readWildNightPreview, subscribeWildNightPreview, type WildNightPreview } from "./wildNightPreview";

export function useWildNightPreviewSelection(): WildNightPreview | null {
  useEffect(() => { adoptWildNightPreviewFromAddress(); }, []);
  return useSyncExternalStore(subscribeWildNightPreview, readWildNightPreview, () => null);
}

export function useWildNightPreview(key: WildNightPreview): boolean {
  const wild = useWildMode();
  const selection = useWildNightPreviewSelection();
  return wild && selection === key;
}
